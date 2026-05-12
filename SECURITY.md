# Security model — Spot Butchery

This document captures **exactly** what the database protects, what
the application code protects, and what is left to operational
discipline. Read this before you assume "Supabase + RLS is doing
everything for me" — because it isn't (yet).

## TL;DR

| Layer | Enforced by | Confidence |
|---|---|---|
| Referential integrity (no orphan rows, no negative qty/price) | **Database** (FKs, CHECK constraints) | High |
| Arithmetic consistency (`total_cost = qty × cost_per_unit`, `subtotal = SUM(items)`) | **Database** (triggers) | High |
| Atomic receipt numbering | **Database** (`next_receipt_no` RPC) | High |
| Password storage (bcrypt, never sent to the browser) | **Database** (`verify_login` RPC + column GRANT revoke) | High |
| Per-organisation isolation (cashier A can't see business B's data) | **App code** (every query filters by `org_id`) | **Medium — see "Known gap" below** |
| User session integrity | **App code** (localStorage; no JWT) | Low — anyone with browser dev tools can spoof |

## Architecture

```
┌─────────────┐      anon key      ┌──────────────────────┐
│   Browser   │ ─────────────────► │   Supabase PostgREST │
│ (React app) │                    │   /rest/v1/…         │
└─────────────┘                    └──────────┬───────────┘
       │                                      │
       │ supabase.rpc('verify_login', …)      │
       │ supabase.rpc('register_first_admin') │
       │ supabase.from('products').select()…  │
       │                                      ▼
       │                              ┌───────────────┐
       │                              │  PostgreSQL   │
       │                              │  (Supabase)   │
       │                              └───────────────┘
```

Authentication does **not** use Supabase Auth (`auth.users`,
`auth.jwt()`). It uses a custom bcrypt-in-`profiles` scheme:

1. Browser calls `verify_login(email, password)` (an RPC).
2. The function runs inside the database as the function owner (a
   `SECURITY DEFINER` privilege escalation), looks up the profile,
   compares the password with `pgcrypto.crypt()`, and returns a
   session bundle. **`password_hash` never leaves the database.**
3. The browser stores the session bundle in `localStorage` and uses
   the `org_id`, `branch_id`, and `role` to build every subsequent
   query.

## What the database fully protects

### 1. Data integrity (cannot be bypassed)

- All foreign keys use `ON DELETE CASCADE` or `SET NULL` — no
  orphans possible.
- `CHECK (price >= 0)`, `CHECK (quantity > 0)`, `CHECK (subtotal >= 0)`
  — no negative money/quantities.
- `UNIQUE (email)` on profiles, `UNIQUE (receipt_no)` on sales,
  `UNIQUE (branch_id, product_id, date)` on stock_entries —
  no duplicates.

### 2. Arithmetic consistency (triggers in `hardening.sql`)

Three `BEFORE`/`AFTER` triggers recompute derived columns inside
the database, so a buggy or malicious client cannot save mismatched
totals:

| Table | Trigger | What it enforces |
|---|---|---|
| `purchase_orders` | `po_total_cost_trigger` | `total_cost = quantity × cost_per_unit` |
| `sale_items` | `sale_items_amount_trigger` | `amount = quantity × unit_price` |
| `sale_items` | `sale_items_subtotal_trigger` | Parent `sales.subtotal` = SUM of items |

### 3. Password hashes never leave the database

Two layers of defence:

1. `verify_login` and `register_first_admin` are `SECURITY DEFINER`
   functions. They do the bcrypt compare inside Postgres and return
   only non-sensitive columns.
2. `REVOKE SELECT (password_hash) ON public.profiles FROM anon;` —
   even if some future code does a raw `SELECT * FROM profiles`,
   PostgREST refuses because the anon role has no read access to
   that column. This is a column-level GRANT, **enforced by Postgres
   regardless of what the app does**.

### 4. Atomic receipt numbering

`next_receipt_no(org_id)` uses `INSERT … ON CONFLICT … DO UPDATE
… RETURNING` to atomically bump and return the next number. Two
cashiers ringing up at the same millisecond get different numbers.

## What the database **does not** protect (and why)

### Per-organisation isolation

Today the browser holds the only piece of evidence proving it
belongs to organisation X — the `org_id` stored in `localStorage`.
The database has no way to verify this, because:

- We are not using Supabase Auth.
- The browser uses the public `anon` key for every request.
- There is no JWT claim the DB can read.

So if a malicious actor:

1. Captures your `anon` key (visible in browser dev tools to anyone
   you let near your screen), and
2. Has a tool like `curl` or Postman,

…they can read every business's products, sales, stock entries,
etc. by hitting `/rest/v1/sales?select=*`. The app code filters,
but PostgREST does not.

### How to mitigate today (operational)

- Treat the anon key as a **shared, low-trust secret**.
- Do not paste the anon key in public chat, screenshots, or
  third-party tools.
- Run the app on company-controlled devices behind the counter.
- Use a strong screen lock policy.

### How to fix properly (next architectural step)

When you're ready to remove this gap:

1. **Migrate to Supabase Auth.** Replace bcrypt-in-`profiles` with
   `auth.users`. Sign-in / sign-up use `supabase.auth.signInWithPassword`.
2. **Re-enable RLS on every table.**
3. **Add policies using `auth.uid()` and a JWT custom claim for
   `org_id`.** Example:
   ```sql
   CREATE POLICY sales_read_own_org
     ON public.sales FOR SELECT
     USING (org_id = (auth.jwt() ->> 'org_id')::uuid);
   ```
4. **Issue the custom claim** via a `before_user_created` Supabase
   Auth hook that copies `profiles.org_id` into the JWT.

This is a 1–2 hour refactor when you're ready; the data already
fits.

## Session integrity

The session lives in `localStorage` (`spot_butchery_session`). It
contains:

```json
{
  "profile": { "id": "…", "role": "admin", "org_id": "…", … },
  "org":     { "id": "…", "name": "…", … },
  "branch":  null
}
```

Anyone with browser dev tools can edit `localStorage` to flip
themselves to `role: "admin"`. The **UI** will then show the admin
tabs — but every server-side write still goes through Postgres, and
Postgres doesn't know about that flag, so:

- Buttons that *display* in the UI ≠ operations that *succeed* in
  the DB.
- For destructive flows (DELETE, role change, etc.) we rely on the
  same "trust the app" assumption as the org isolation gap above.

The same Supabase Auth migration above closes this gap too.

## Threat model summary

| Threat | Protected? | Notes |
|---|---|---|
| Cashier types a negative price | ✅ Yes | `CHECK (price >= 0)` |
| Cashier types qty 0 in POS | ✅ Yes | `CHECK (quantity > 0)` |
| Duplicate receipt number | ✅ Yes | UNIQUE constraint + atomic RPC |
| Sale subtotal doesn't match items | ✅ Yes | Trigger recomputes server-side |
| Browser bug truncates an item line | ✅ Yes (via subtotal trigger) | Server overrides client total |
| Password sent in plain text over the wire | ✅ Yes | TLS by Supabase; hashed inside DB |
| Password hash leaked via SELECT | ✅ Yes | Column GRANT revoked from anon |
| Brute-force login | ⚠ Partial | bcrypt cost 10 is slow, but no rate limit yet |
| Stolen anon key → read all data | ❌ No | Mitigated only by operational discipline |
| Stolen anon key → write/delete data | ❌ No | Same |
| localStorage tampering → UI shows admin tabs | ❌ No | UI only; writes still validate against DB role |
| SQL injection | ✅ Yes | All queries parameterised by supabase-js |

## Next steps when going to production

1. Add `login_attempts` table + rate limit in `verify_login` (5
   failures in 15 min → reject).
2. Migrate to Supabase Auth (closes the org-isolation gap).
3. Add a server-side audit log table (who did what, when).
4. Rotate the anon key periodically.
5. Consider a Supabase Edge Function as a gateway for staff creation
   so admin-only operations require admin re-authentication.
