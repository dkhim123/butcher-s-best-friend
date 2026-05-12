-- ================================================================
-- Spot Butchery — RESET + INSTALL (one-shot, idempotent)
-- ----------------------------------------------------------------
-- HOW TO RUN
--   1. (Optional, only if bucket exists) Dashboard → Storage →
--      org-logos → delete all files → delete bucket.
--   2. Dashboard → SQL Editor → New query.
--   3. Paste this ENTIRE file. Click "Run".
--   4. Expect "Success. No rows returned".
--
-- WHAT IT DOES
--   SECTION 1 — drops every Spot Butchery object we own:
--                 4 storage policies, 1 function, 9 tables.
--                 Uses IF EXISTS so it's safe on a fresh DB.
--                 Does NOT delete from storage.objects /
--                 storage.buckets — Supabase forbids that via SQL.
--                 (Use the Storage UI for that, see step 1 above.)
--   SECTION 2 — rebuilds the entire schema from scratch.
--
-- ⚠ WARNING
--   This DROPs every Spot Butchery table (with CASCADE). Any
--   cashier accounts, receipts, stock entries, etc. are gone.
--   You will need to /signup again to create your first admin.
--
-- AFTER RUNNING — one manual step in the dashboard
--   Database → Replication → `supabase_realtime` → enable for:
--     products, profiles, branches, sales, sale_items,
--     purchase_orders, stock_entries
-- ================================================================



-- ╔══════════════════════════════════════════════════════════════╗
-- ║                   SECTION 1 — WIPE EVERYTHING                ║
-- ╚══════════════════════════════════════════════════════════════╝

-- 1.1 Drop our storage policies (metadata only — always allowed)
DROP POLICY IF EXISTS "org_logos_select_public" ON storage.objects;
DROP POLICY IF EXISTS "org_logos_insert_anon"   ON storage.objects;
DROP POLICY IF EXISTS "org_logos_update_anon"   ON storage.objects;
DROP POLICY IF EXISTS "org_logos_delete_anon"   ON storage.objects;

-- 1.2 Drop the helper function
DROP FUNCTION IF EXISTS public.next_receipt_no(UUID);

-- 1.3 Drop tables
--     CASCADE removes their indexes, foreign keys, and triggers
--     automatically — no need to drop those one by one.
DROP TABLE IF EXISTS public.sale_items       CASCADE;
DROP TABLE IF EXISTS public.sales            CASCADE;
DROP TABLE IF EXISTS public.purchase_orders  CASCADE;
DROP TABLE IF EXISTS public.stock_entries    CASCADE;
DROP TABLE IF EXISTS public.receipt_counter  CASCADE;
DROP TABLE IF EXISTS public.products         CASCADE;
DROP TABLE IF EXISTS public.profiles         CASCADE;
DROP TABLE IF EXISTS public.branches         CASCADE;
DROP TABLE IF EXISTS public.organisations    CASCADE;



-- ╔══════════════════════════════════════════════════════════════╗
-- ║                  SECTION 2 — INSTALL FRESH                   ║
-- ╚══════════════════════════════════════════════════════════════╝


-- ────────────────────────────────────────────────────────────────
-- 2.1  ORGANISATIONS — one row per business
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.organisations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  logo_url   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.organisations IS
  'One row per business (e.g. "Spot Butchery"). Everything else is scoped by org_id.';


-- ────────────────────────────────────────────────────────────────
-- 2.2  BRANCHES — physical shops belonging to an organisation
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.branches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ────────────────────────────────────────────────────────────────
-- 2.3  PROFILES — staff accounts (custom auth, NOT Supabase Auth)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (role IN ('admin','manager','cashier','pending')),
  org_id        UUID REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id     UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  permissions   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ────────────────────────────────────────────────────────────────
-- 2.4  PRODUCTS — your menu/catalogue, shared across all branches
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('per_kg','fixed','meal')),
  price      NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  unit       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ────────────────────────────────────────────────────────────────
-- 2.5  STOCK ENTRIES — opening qty per product, per branch, per day
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.stock_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id   UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  opening_qty NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (opening_qty >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, product_id, date)
);


-- ────────────────────────────────────────────────────────────────
-- 2.6  PURCHASE ORDERS — meat / supplies bought from suppliers
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.purchase_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
  supplier      TEXT NOT NULL,
  quantity      NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  cost_per_unit NUMERIC(12,2) NOT NULL CHECK (cost_per_unit >= 0),
  total_cost    NUMERIC(12,2) NOT NULL,
  notes         TEXT,
  received      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ────────────────────────────────────────────────────────────────
-- 2.7  SALES — one row per receipt rung at the till
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id      UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  receipt_no     TEXT NOT NULL UNIQUE,
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  payment        TEXT NOT NULL CHECK (payment IN ('cash','mpesa','credit')),
  subtotal       NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  cash_given     NUMERIC(12,2),
  change_amount  NUMERIC(12,2),
  mpesa_ref      TEXT,
  customer_name  TEXT,
  customer_phone TEXT,
  paid           BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ────────────────────────────────────────────────────────────────
-- 2.8  SALE ITEMS — line-items on each receipt
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.sale_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id    UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  quantity   NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0)
);


-- ────────────────────────────────────────────────────────────────
-- 2.9  RECEIPT COUNTER — one counter per organisation
-- ────────────────────────────────────────────────────────────────
CREATE TABLE public.receipt_counter (
  org_id  UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  counter INTEGER NOT NULL DEFAULT 1000
);


-- ────────────────────────────────────────────────────────────────
-- 2.10  INDEXES — make common queries fast
-- ────────────────────────────────────────────────────────────────
CREATE INDEX idx_profiles_org      ON public.profiles        (org_id);
CREATE INDEX idx_profiles_email    ON public.profiles        (email);
CREATE INDEX idx_branches_org      ON public.branches        (org_id);
CREATE INDEX idx_products_org      ON public.products        (org_id);
CREATE INDEX idx_stock_branch_date ON public.stock_entries   (branch_id, date);
CREATE INDEX idx_po_branch_date    ON public.purchase_orders (branch_id, date);
CREATE INDEX idx_sales_branch_date ON public.sales           (branch_id, date);
CREATE INDEX idx_sales_created_by  ON public.sales           (created_by);
CREATE INDEX idx_sale_items_sale   ON public.sale_items      (sale_id);


-- ────────────────────────────────────────────────────────────────
-- 2.11  next_receipt_no(org_id) — atomic per-org receipt numbering
--       Returns strings like "R260512-1001"
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_receipt_no(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
  d TEXT;
BEGIN
  INSERT INTO public.receipt_counter (org_id, counter)
       VALUES (p_org_id, 1001)
  ON CONFLICT (org_id) DO UPDATE
       SET counter = receipt_counter.counter + 1
  RETURNING counter INTO n;
  d := TO_CHAR(NOW() AT TIME ZONE 'Africa/Nairobi', 'YYMMDD');
  RETURN 'R' || d || '-' || n::TEXT;
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 2.12  ROW LEVEL SECURITY — OFF (app filters by org_id itself)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.organisations    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_entries    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_counter  DISABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────────
-- 2.13  GRANTS — let the anon role (used by the browser) read & write
-- ────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;


-- ────────────────────────────────────────────────────────────────
-- 2.14  REALTIME — send full rows over the change stream
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.sales            REPLICA IDENTITY FULL;
ALTER TABLE public.sale_items       REPLICA IDENTITY FULL;
ALTER TABLE public.purchase_orders  REPLICA IDENTITY FULL;
ALTER TABLE public.stock_entries    REPLICA IDENTITY FULL;
ALTER TABLE public.products         REPLICA IDENTITY FULL;
ALTER TABLE public.profiles         REPLICA IDENTITY FULL;
ALTER TABLE public.branches         REPLICA IDENTITY FULL;


-- ────────────────────────────────────────────────────────────────
-- 2.15  STORAGE BUCKET — for organisation logos
--       NOTE: We can't DELETE from storage.* via SQL, so the bucket
--       is created with ON CONFLICT DO NOTHING. If you need to
--       wipe the bucket completely, do it in the dashboard:
--         Storage → org-logos → delete files → delete bucket
--       BEFORE running this script.
-- ────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-logos', 'org-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "org_logos_select_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-logos');

CREATE POLICY "org_logos_insert_anon"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'org-logos');

CREATE POLICY "org_logos_update_anon"
  ON storage.objects FOR UPDATE
  TO anon
  USING       (bucket_id = 'org-logos')
  WITH CHECK  (bucket_id = 'org-logos');

CREATE POLICY "org_logos_delete_anon"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'org-logos');


-- ────────────────────────────────────────────────────────────────
-- DONE.
-- After running this file:
--   1. Database → Replication → enable supabase_realtime for the
--      7 tables listed at the top.
--   2. Run `npm run dev` locally.
--   3. Open http://localhost:4100/signup and create your first
--      admin account.
-- ────────────────────────────────────────────────────────────────
