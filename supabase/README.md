# Supabase folder

This folder holds the database definition for the Spot Butchery app.

## Files

| File | What it is |
|---|---|
| `spot-butchery-schema.sql` | The **one** SQL file you paste into Supabase. It first wipes any existing Spot Butchery tables (idempotent — safe on a fresh DB) and then recreates everything from scratch. |

## How to install (or re-install)

1. Open <https://supabase.com/dashboard> → your project → **SQL Editor → New query**.
2. Open `spot-butchery-schema.sql` in your editor.
3. Select all → copy → paste into the SQL Editor.
4. Click **Run**. Expect *"Success. No rows returned."*

> ⚠ The first half of the file **DROPs** all Spot Butchery tables.
> Any cashier accounts, receipts, stock entries, etc. will be lost.
> The second half rebuilds the schema fresh.

## After running — one manual step

In Supabase Dashboard:

1. Go to **Database → Replication → `supabase_realtime`**.
2. Toggle ON these 7 tables (one click each):
   `products`, `profiles`, `branches`, `sales`,
   `sale_items`, `purchase_orders`, `stock_entries`.

That enables the live-update feature so two cashiers see each other's sales without refreshing.

## What's inside the schema

Nine tables, all scoped by `org_id`:

```
organisations         ← your business
   ├─ branches        ← physical shops
   ├─ profiles        ← staff accounts (admin/manager/cashier/pending)
   ├─ products        ← per_kg / fixed / meal items
   ├─ receipt_counter ← atomic per-org receipt numbering
   └─ branches has:
        ├─ stock_entries     ← opening qty per product per day
        ├─ purchase_orders   ← supplier deliveries
        └─ sales
             └─ sale_items   ← lines on each receipt
```

Plus:
- 1 function — `next_receipt_no(org_id)` for race-safe receipt numbering
- 9 performance indexes on the columns the app filters by
- RLS turned OFF on all tables (app filters by `org_id` itself)
- GRANTs so the `anon` role (your browser) can read/write
- REPLICA IDENTITY FULL for realtime push
- 1 storage bucket `org-logos` (public read; anon can upload/overwrite/delete)

## How to test it worked

1. Update `.env` with the new Supabase URL and anon key.
2. `npm run dev` → <http://localhost:4100/signup>.
3. Create your admin account.
4. In Supabase Dashboard → **Table Editor**, you should see:
   - `organisations` with 1 row (your business)
   - `branches` with 1 row called "Main Branch"
   - `profiles` with 1 row, `role = admin`, your email.
