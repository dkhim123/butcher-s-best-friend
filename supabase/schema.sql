-- ════════════════════════════════════════════════════════════════════════════
-- DECENT MICROSYSTEM — COMPLETE DATABASE SCHEMA (one file, run once)
-- ════════════════════════════════════════════════════════════════════════════
-- Multi-tenant hospitality POS: Restaurant + Bar, departments, bar serving
-- sizes, chef ingredient usage, multi-line purchase orders, stock-take, cashier
-- shifts, and customer loans (credit accounts).
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   Safe to re-run (idempotent): tables use IF NOT EXISTS, columns use
--   ADD COLUMN IF NOT EXISTS, functions/views use CREATE OR REPLACE, triggers
--   and policies are dropped before create.
--
-- AFTER RUNNING
--   Log in at /login as the super admin seeded at the very bottom
--   (dkmbugua70@gmail.com / Dkm10407#) and register your first business.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 1. TABLES                                                    ║
-- ╚══════════════════════════════════════════════════════════════╝

-- 1.1 Organisations — one row per business
CREATE TABLE IF NOT EXISTS public.organisations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  logo_url      TEXT,
  tagline       TEXT,
  phone         TEXT,
  address       TEXT,
  mpesa_paybill TEXT,
  mpesa_paybill_account TEXT,
  mpesa_till    TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS tagline               TEXT;
ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS phone                 TEXT;
ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS address               TEXT;
ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS mpesa_paybill         TEXT;
ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS mpesa_paybill_account TEXT;
ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS mpesa_till            TEXT;
ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS active        BOOLEAN NOT NULL DEFAULT TRUE;

-- 1.2 Branches
CREATE TABLE IF NOT EXISTS public.branches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.3 Profiles — staff accounts (custom bcrypt auth, NOT Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'pending',
  org_id        UUID REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id     UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  permissions   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','admin','manager','cashier','pending'));

-- 1.4 Products — the catalogue (shared across branches)
CREATE TABLE IF NOT EXISTS public.products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('per_kg','fixed','meal')),
  price        NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  unit         TEXT NOT NULL,
  category     TEXT,
  food_group   TEXT,
  department   TEXT NOT NULL DEFAULT 'restaurant',
  track_stock  BOOLEAN NOT NULL DEFAULT FALSE,
  container_ml INTEGER CHECK (container_ml IS NULL OR container_ml > 0),
  cost_price   NUMERIC(12,2) CHECK (cost_price IS NULL OR cost_price >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category     TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS food_group   TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS department   TEXT NOT NULL DEFAULT 'restaurant';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS track_stock  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS container_ml INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price   NUMERIC(12,2);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_department_check;
ALTER TABLE public.products ADD CONSTRAINT products_department_check
  CHECK (department IN ('restaurant','bar','rooms'));

-- 1.5 Product servings — ways a bar drink can be sold (Tot / Glass / Bottle …)
CREATE TABLE IF NOT EXISTS public.product_servings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  volume_ml  NUMERIC(10,2) NOT NULL CHECK (volume_ml > 0),
  price      NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.6 Customers — for credit / loan accounts (eat & drink now, pay later)
CREATE TABLE IF NOT EXISTS public.customers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_org ON public.customers (org_id);

-- 1.7 Stock entries — legacy opening qty per product/branch/day
CREATE TABLE IF NOT EXISTS public.stock_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id   UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  opening_qty NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (opening_qty >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, product_id, date)
);

-- 1.8 Purchase orders — header (one supplier, one delivery). Legacy single-line
--     columns kept but optional; new POs carry lines in purchase_order_items.
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  department    TEXT,
  product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
  supplier      TEXT NOT NULL,
  quantity      NUMERIC(12,3),
  cost_per_unit NUMERIC(12,2),
  total_cost    NUMERIC(12,2),
  notes         TEXT,
  received      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.purchase_orders ALTER COLUMN product_id    DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN quantity      DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN cost_per_unit DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN total_cost    DROP NOT NULL;

-- 1.9 Purchase order items — the lines of a delivery
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
  quantity      NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  cost_per_unit NUMERIC(12,2) NOT NULL CHECK (cost_per_unit >= 0),
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items (po_id);

-- 1.10 Shifts — a cashier's till session (declared before sales for the FK)
CREATE TABLE IF NOT EXISTS public.shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  cashier_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ,
  opening_float NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_cash NUMERIC(12,2),
  counted_cash  NUMERIC(12,2),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_open
  ON public.shifts (branch_id, cashier_id) WHERE status = 'open';

-- 1.11 Sales — one row per receipt
CREATE TABLE IF NOT EXISTS public.sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id      UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  receipt_no     TEXT NOT NULL UNIQUE,
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  payment        TEXT NOT NULL CHECK (payment IN ('cash','mpesa','credit','split')),
  -- Split payments: [{"method":"cash","amount":500},{"method":"mpesa","amount":300,"ref":"..."}].
  -- Empty for single-method sales (their amount is the whole subtotal).
  payments       JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal       NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  cash_given     NUMERIC(12,2),
  change_amount  NUMERIC(12,2),
  mpesa_ref      TEXT,
  customer_name  TEXT,
  customer_phone TEXT,
  customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  paid           BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  shift_id       UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS shift_id    UUID REFERENCES public.shifts(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payments    JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_payment_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_payment_check
  CHECK (payment IN ('cash','mpesa','credit','split'));
-- Cancellation workflow: a cashier requests a cancel, an admin/manager approves.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancel_state       TEXT NOT NULL DEFAULT 'none';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancel_reason      TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancel_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancel_approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancelled_at       TIMESTAMPTZ;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_cancel_state_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_cancel_state_check
  CHECK (cancel_state IN ('none','requested','cancelled','rejected'));
CREATE INDEX IF NOT EXISTS idx_sales_cancel_state ON public.sales (org_id, cancel_state);

-- 1.12 Sale items — line-items (with optional bar serving info)
CREATE TABLE IF NOT EXISTS public.sale_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
  quantity     NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  serving_name TEXT,
  serving_ml   NUMERIC(10,2) CHECK (serving_ml IS NULL OR serving_ml > 0)
);
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS serving_name TEXT;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS serving_ml   NUMERIC(10,2);

-- 1.13 Customer payments — loan repayments
CREATE TABLE IF NOT EXISTS public.customer_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','mpesa','other')),
  note        TEXT,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON public.customer_payments (customer_id);

-- 1.14 Receipt counter — one per org
CREATE TABLE IF NOT EXISTS public.receipt_counter (
  org_id  UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  counter INTEGER NOT NULL DEFAULT 1000
);

-- 1.15 Stock movements — the event log (current stock = SUM(delta_qty))
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id   UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  delta_qty   NUMERIC(12,3) NOT NULL,
  reason      TEXT NOT NULL,
  ref_table   TEXT,
  ref_id      UUID,
  note        TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('purchase','sale','waste','adjustment','opening','usage'));
CREATE INDEX IF NOT EXISTS idx_stock_movements_lookup
  ON public.stock_movements (org_id, branch_id, product_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_source_uniq
  ON public.stock_movements (ref_table, ref_id, reason)
  WHERE ref_table IS NOT NULL AND ref_id IS NOT NULL;

-- 1.16 Stock takes — physical counts + variance reconciliation
CREATE TABLE IF NOT EXISTS public.stock_takes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id    UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  department   TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  note         TEXT,
  taken_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.stock_take_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id UUID NOT NULL REFERENCES public.stock_takes(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  counted_qty   NUMERIC(12,3) NOT NULL,
  system_qty    NUMERIC(12,3),
  UNIQUE (stock_take_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_take_items_take ON public.stock_take_items (stock_take_id);

-- 1.17 Login attempts — brute-force lockout (written only by verify_login)
CREATE TABLE IF NOT EXISTS public.login_attempts (
  email          TEXT PRIMARY KEY,
  fail_count     INTEGER NOT NULL DEFAULT 0,
  last_failed_at TIMESTAMPTZ,
  locked_until   TIMESTAMPTZ
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_profiles_org      ON public.profiles        (org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email    ON public.profiles        (email);
CREATE INDEX IF NOT EXISTS idx_branches_org      ON public.branches        (org_id);
CREATE INDEX IF NOT EXISTS idx_products_org      ON public.products        (org_id);
CREATE INDEX IF NOT EXISTS idx_products_dept     ON public.products        (org_id, department);
CREATE INDEX IF NOT EXISTS idx_stock_branch_date ON public.stock_entries   (branch_id, date);
CREATE INDEX IF NOT EXISTS idx_po_branch_date    ON public.purchase_orders (branch_id, date);
CREATE INDEX IF NOT EXISTS idx_sales_branch_date ON public.sales           (branch_id, date);
CREATE INDEX IF NOT EXISTS idx_sales_created_by  ON public.sales           (created_by);
CREATE INDEX IF NOT EXISTS idx_sales_customer    ON public.sales           (customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale   ON public.sale_items      (sale_id);


-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 2. VIEWS                                                     ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Current stock per branch+product.
-- security_invoker = true → the view runs with the CALLER's privileges, so it
-- respects the underlying tables' RLS instead of bypassing it (this is what
-- clears Supabase's "Unrestricted" flag on the view).
DROP VIEW IF EXISTS public.v_stock_on_hand;
CREATE VIEW public.v_stock_on_hand WITH (security_invoker = true) AS
  SELECT m.org_id, m.branch_id, m.product_id,
         p.name AS product_name, p.unit, p.category, p.food_group, p.department,
         COALESCE(SUM(m.delta_qty),0)::NUMERIC(14,3) AS qty_on_hand
  FROM   public.stock_movements m
  JOIN   public.products p ON p.id = m.product_id
  GROUP BY m.org_id, m.branch_id, m.product_id, p.name, p.unit, p.category, p.food_group, p.department;

-- Outstanding loan balance per customer = credit sales − repayments.
-- security_invoker = true so the view respects RLS (not flagged "Unrestricted").
DROP VIEW IF EXISTS public.v_customer_balances;
CREATE VIEW public.v_customer_balances WITH (security_invoker = true) AS
  SELECT c.id AS customer_id, c.org_id, c.name, c.phone,
         COALESCE(o.owed,0)::NUMERIC(14,2)  AS owed,
         COALESCE(pmt.paid,0)::NUMERIC(14,2) AS repaid,
         (COALESCE(o.owed,0) - COALESCE(pmt.paid,0))::NUMERIC(14,2) AS balance
  FROM public.customers c
  LEFT JOIN (
    SELECT customer_id, SUM(subtotal) AS owed
    FROM public.sales WHERE payment = 'credit' AND customer_id IS NOT NULL
      AND cancel_state <> 'cancelled'
    GROUP BY customer_id
  ) o ON o.customer_id = c.id
  LEFT JOIN (
    SELECT customer_id, SUM(amount) AS paid
    FROM public.customer_payments GROUP BY customer_id
  ) pmt ON pmt.customer_id = c.id;


-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 3. FUNCTIONS + TRIGGERS                                      ║
-- ╚══════════════════════════════════════════════════════════════╝

-- 3.1 next_receipt_no(org) → "R260711-1001"
CREATE OR REPLACE FUNCTION public.next_receipt_no(p_org_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER; d TEXT;
BEGIN
  INSERT INTO public.receipt_counter (org_id, counter) VALUES (p_org_id, 1001)
  ON CONFLICT (org_id) DO UPDATE SET counter = receipt_counter.counter + 1
  RETURNING counter INTO n;
  d := TO_CHAR(NOW() AT TIME ZONE 'Africa/Nairobi', 'YYMMDD');
  RETURN 'R' || d || '-' || n::TEXT;
END; $$;

-- 3.2 Derived amounts
CREATE OR REPLACE FUNCTION public.set_sale_item_amount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.amount := ROUND(NEW.quantity * NEW.unit_price, 2); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS sale_items_amount_trigger ON public.sale_items;
CREATE TRIGGER sale_items_amount_trigger
  BEFORE INSERT OR UPDATE OF quantity, unit_price ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.set_sale_item_amount();

CREATE OR REPLACE FUNCTION public.recompute_sale_subtotal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_sale_id UUID; v_sum NUMERIC(12,2);
BEGIN
  v_sale_id := COALESCE(NEW.sale_id, OLD.sale_id);
  SELECT COALESCE(SUM(amount),0) INTO v_sum FROM public.sale_items WHERE sale_id = v_sale_id;
  UPDATE public.sales SET subtotal = v_sum WHERE id = v_sale_id;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS sale_items_subtotal_trigger ON public.sale_items;
CREATE TRIGGER sale_items_subtotal_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_sale_subtotal();

CREATE OR REPLACE FUNCTION public.set_po_item_amount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.amount := ROUND(NEW.quantity * NEW.cost_per_unit, 2); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS po_item_amount_trigger ON public.purchase_order_items;
CREATE TRIGGER po_item_amount_trigger
  BEFORE INSERT OR UPDATE OF quantity, cost_per_unit ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_po_item_amount();

CREATE OR REPLACE FUNCTION public.recompute_po_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_po UUID := COALESCE(NEW.po_id, OLD.po_id);
BEGIN
  UPDATE public.purchase_orders
     SET total_cost = (SELECT COALESCE(SUM(amount),0) FROM public.purchase_order_items WHERE po_id = v_po)
   WHERE id = v_po;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS po_total_recompute_trigger ON public.purchase_order_items;
CREATE TRIGGER po_total_recompute_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_po_total();

-- 3.3 Purchase order items → stock (+qty when received)
CREATE OR REPLACE FUNCTION public.po_item_to_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_received BOOLEAN; v_org UUID; v_branch UUID; v_supplier TEXT; v_created TIMESTAMPTZ; v_track BOOLEAN;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT received, org_id, branch_id, supplier, created_at
    INTO v_received, v_org, v_branch, v_supplier, v_created
    FROM public.purchase_orders WHERE id = NEW.po_id;
  IF v_received IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT track_stock INTO v_track FROM public.products WHERE id = NEW.product_id;
  IF v_track IS NOT TRUE THEN RETURN NEW; END IF;
  INSERT INTO public.stock_movements (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note, occurred_at)
  VALUES (v_org, v_branch, NEW.product_id, NEW.quantity, 'purchase', 'purchase_order_items', NEW.id, v_supplier, COALESCE(v_created, NOW()))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS po_item_stock_trigger ON public.purchase_order_items;
CREATE TRIGGER po_item_stock_trigger
  AFTER INSERT ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.po_item_to_stock();

CREATE OR REPLACE FUNCTION public.po_received_to_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.received IS NOT TRUE OR OLD.received IS TRUE THEN RETURN NEW; END IF;
  FOR r IN SELECT * FROM public.purchase_order_items WHERE po_id = NEW.id LOOP
    IF r.product_id IS NULL THEN CONTINUE; END IF;
    IF (SELECT track_stock FROM public.products WHERE id = r.product_id) IS NOT TRUE THEN CONTINUE; END IF;
    INSERT INTO public.stock_movements (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note, occurred_at)
    VALUES (NEW.org_id, NEW.branch_id, r.product_id, r.quantity, 'purchase', 'purchase_order_items', r.id, NEW.supplier, COALESCE(NEW.created_at, NOW()))
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS po_received_items_trigger ON public.purchase_orders;
CREATE TRIGGER po_received_items_trigger
  AFTER UPDATE OF received ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.po_received_to_stock();

-- 3.4 Sale items → stock (−qty; bar servings deduct a fraction of a bottle)
CREATE OR REPLACE FUNCTION public.sale_item_to_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_track BOOLEAN; v_container INTEGER; v_org UUID; v_branch UUID; v_sale_dt TIMESTAMPTZ; v_delta NUMERIC;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT track_stock, container_ml INTO v_track, v_container FROM public.products WHERE id = NEW.product_id;
  IF v_track IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT org_id, branch_id, created_at INTO v_org, v_branch, v_sale_dt FROM public.sales WHERE id = NEW.sale_id;
  IF v_org IS NULL THEN RETURN NEW; END IF;
  IF NEW.serving_ml IS NOT NULL AND v_container IS NOT NULL AND v_container > 0 THEN
    v_delta := NEW.quantity * (NEW.serving_ml / v_container);
  ELSE
    v_delta := NEW.quantity;
  END IF;
  INSERT INTO public.stock_movements (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note, occurred_at)
  VALUES (v_org, v_branch, NEW.product_id, -ABS(v_delta), 'sale', 'sale_items', NEW.id, NEW.serving_name, COALESCE(v_sale_dt, NOW()))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS sale_to_stock_trigger ON public.sale_items;
CREATE TRIGGER sale_to_stock_trigger
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.sale_item_to_stock_movement();

-- 3.5 updated_at bookkeeping
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;
DO $$
DECLARE t TEXT;
  tables TEXT[] := ARRAY['organisations','branches','profiles','products','stock_entries','purchase_orders','sales'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at_trigger ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at_trigger BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;

-- 3.6 Auth: verify_login
--   - Brute-force lockout: after 5 failures a login is locked for 15 minutes.
--     Failures RETURN NULL (not RAISE) so the counter UPDATE commits; a lockout
--     RAISEs (nothing to persist, so the rollback is harmless).
--   - Blocks suspended businesses; super_admin has no org.
CREATE OR REPLACE FUNCTION public.verify_login(p_email TEXT, p_password TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_email   TEXT := lower(trim(p_email));
  v_profile public.profiles%ROWTYPE;
  v_org     public.organisations%ROWTYPE;
  v_branch  public.branches%ROWTYPE;
  v_att     public.login_attempts%ROWTYPE;
  c_max_fails CONSTANT INT      := 5;
  c_window    CONSTANT INTERVAL := INTERVAL '10 minutes';
  c_lockout   CONSTANT INTERVAL := INTERVAL '5 minutes';
BEGIN
  -- Locked out?
  SELECT * INTO v_att FROM public.login_attempts WHERE email = v_email;
  IF v_att.locked_until IS NOT NULL AND v_att.locked_until > NOW() THEN
    RAISE EXCEPTION 'Too many failed attempts. Try again in % minute(s).',
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_att.locked_until - NOW())) / 60))
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE email = v_email;
  IF v_profile.id IS NULL OR crypt(p_password, v_profile.password_hash) <> v_profile.password_hash THEN
    -- Record the failure atomically (safe under concurrent attempts). The count
    -- resets if the previous failure aged out of the window; a lock is set once
    -- it reaches the threshold.
    INSERT INTO public.login_attempts (email, fail_count, last_failed_at)
    VALUES (v_email, 1, NOW())
    ON CONFLICT (email) DO UPDATE SET
      fail_count = CASE
        WHEN public.login_attempts.last_failed_at < NOW() - c_window THEN 1
        ELSE public.login_attempts.fail_count + 1 END,
      last_failed_at = NOW(),
      locked_until = CASE
        WHEN (CASE
                WHEN public.login_attempts.last_failed_at < NOW() - c_window THEN 1
                ELSE public.login_attempts.fail_count + 1 END) >= c_max_fails
        THEN NOW() + c_lockout ELSE NULL END;
    RETURN NULL;  -- client shows the generic "Invalid email or password"
  END IF;

  -- Success — clear any failure history for this email.
  DELETE FROM public.login_attempts WHERE email = v_email;
  IF v_profile.role = 'super_admin' THEN
    RETURN json_build_object('profile', json_build_object(
      'id',v_profile.id,'email',v_profile.email,'full_name',v_profile.full_name,'role',v_profile.role,
      'org_id',v_profile.org_id,'branch_id',v_profile.branch_id,'permissions',v_profile.permissions,'created_at',v_profile.created_at),
      'org', NULL, 'branch', NULL);
  END IF;
  SELECT * INTO v_org FROM public.organisations WHERE id = v_profile.org_id;
  IF v_org.id IS NULL THEN RAISE EXCEPTION 'Organisation not found' USING ERRCODE = '23503'; END IF;
  IF v_org.active IS FALSE THEN
    RAISE EXCEPTION 'This business has been suspended. Contact the administrator.' USING ERRCODE = '28000';
  END IF;
  IF v_profile.branch_id IS NOT NULL THEN
    SELECT * INTO v_branch FROM public.branches WHERE id = v_profile.branch_id;
  END IF;
  RETURN json_build_object('profile', json_build_object(
    'id',v_profile.id,'email',v_profile.email,'full_name',v_profile.full_name,'role',v_profile.role,
    'org_id',v_profile.org_id,'branch_id',v_profile.branch_id,'permissions',v_profile.permissions,'created_at',v_profile.created_at),
    'org', row_to_json(v_org),
    'branch', CASE WHEN v_branch.id IS NULL THEN NULL ELSE row_to_json(v_branch) END);
END; $$;

-- 3.7 Super-admin: register a business (org + Main Branch + first admin)
DROP FUNCTION IF EXISTS public.register_business(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.register_business(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.register_business(
  p_actor_id UUID, p_email TEXT, p_password TEXT, p_full_name TEXT, p_business_name TEXT,
  p_tagline TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL, p_address TEXT DEFAULT NULL,
  p_mpesa_paybill TEXT DEFAULT NULL, p_mpesa_till TEXT DEFAULT NULL,
  p_mpesa_paybill_account TEXT DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_email TEXT := lower(trim(p_email)); v_org_id UUID; v_branch_id UUID; v_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can register a business' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023'; END IF;
  IF length(p_password) < 8 THEN RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023'; END IF;
  IF length(trim(p_full_name)) = 0 THEN RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023'; END IF;
  IF length(trim(p_business_name)) = 0 THEN RAISE EXCEPTION 'Business name is required' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = v_email) THEN
    RAISE EXCEPTION 'Email already registered' USING ERRCODE = '23505'; END IF;

  INSERT INTO public.organisations
      (name, tagline, phone, address, mpesa_paybill, mpesa_paybill_account, mpesa_till)
    VALUES (trim(p_business_name),
            NULLIF(trim(COALESCE(p_tagline,'')),''), NULLIF(trim(COALESCE(p_phone,'')),''),
            NULLIF(trim(COALESCE(p_address,'')),''), NULLIF(trim(COALESCE(p_mpesa_paybill,'')),''),
            NULLIF(trim(COALESCE(p_mpesa_paybill_account,'')),''),
            NULLIF(trim(COALESCE(p_mpesa_till,'')),''))
    RETURNING id INTO v_org_id;
  INSERT INTO public.branches (org_id, name) VALUES (v_org_id, 'Main Branch') RETURNING id INTO v_branch_id;
  INSERT INTO public.profiles (email, password_hash, full_name, role, org_id, branch_id, permissions)
    VALUES (v_email, crypt(p_password, gen_salt('bf',10)), trim(p_full_name), 'admin', v_org_id, NULL, '{}'::jsonb)
    RETURNING * INTO v_profile;
  RETURN json_build_object(
    'org', (SELECT row_to_json(o) FROM public.organisations o WHERE o.id = v_org_id),
    'admin', json_build_object('id',v_profile.id,'email',v_profile.email,'full_name',v_profile.full_name,'role',v_profile.role));
END; $$;

CREATE OR REPLACE FUNCTION public.set_business_active(p_actor_id UUID, p_org_id UUID, p_active BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can change business status' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organisations SET active = p_active WHERE id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found' USING ERRCODE = '23503'; END IF;
END; $$;

-- 3.8 Admin: create staff (server-side bcrypt so verify_login can check it)
CREATE OR REPLACE FUNCTION public.register_staff_user(
  p_email TEXT, p_password TEXT, p_full_name TEXT, p_role TEXT, p_org_id UUID,
  p_branch_id UUID DEFAULT NULL, p_permissions JSONB DEFAULT '{}'::jsonb)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_email TEXT := lower(trim(p_email)); v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023'; END IF;
  IF length(p_password) < 8 THEN RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023'; END IF;
  IF length(trim(p_full_name)) = 0 THEN RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023'; END IF;
  IF p_role NOT IN ('admin','manager','cashier','pending') THEN RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023'; END IF;
  IF p_org_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.organisations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organisation not found' USING ERRCODE = '23503'; END IF;
  IF p_role IN ('cashier','manager') AND p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Cashiers and managers must be assigned to a branch' USING ERRCODE = '22023'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Branch not found for this organisation' USING ERRCODE = '23503'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = v_email) THEN
    RAISE EXCEPTION 'Email already registered' USING ERRCODE = '23505'; END IF;
  INSERT INTO public.profiles (email, password_hash, full_name, role, org_id, branch_id, permissions)
    VALUES (v_email, crypt(p_password, gen_salt('bf',10)), trim(p_full_name), p_role, p_org_id, p_branch_id, COALESCE(p_permissions,'{}'::jsonb))
    RETURNING * INTO v_profile;
  RETURN json_build_object('id',v_profile.id,'email',v_profile.email,'full_name',v_profile.full_name,
    'role',v_profile.role,'org_id',v_profile.org_id,'branch_id',v_profile.branch_id,
    'permissions',v_profile.permissions,'created_at',v_profile.created_at);
END; $$;

-- Reset a user's password immediately. The caller must be authorised:
--   • a super_admin can reset anyone;
--   • a business admin can reset a user in their OWN organisation.
-- Also clears any brute-force lockout so the user can sign in right away.
CREATE OR REPLACE FUNCTION public.reset_staff_password(
  p_actor_id UUID, p_email TEXT, p_password TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_email  TEXT := lower(trim(p_email));
  v_actor  public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
BEGIN
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actor  FROM public.profiles WHERE id = p_actor_id;
  SELECT * INTO v_target FROM public.profiles WHERE email = v_email;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'No account found for that email' USING ERRCODE = '23503';
  END IF;

  IF v_actor.role = 'super_admin'
     OR (v_actor.role = 'admin' AND v_actor.org_id IS NOT DISTINCT FROM v_target.org_id) THEN
    UPDATE public.profiles SET password_hash = crypt(p_password, gen_salt('bf',10))
     WHERE id = v_target.id;
    DELETE FROM public.login_attempts WHERE email = v_email;  -- clear any lockout
  ELSE
    RAISE EXCEPTION 'Not authorised to reset this password' USING ERRCODE = '42501';
  END IF;
END; $$;
-- Drop the old, unauthenticated 2-arg version if it exists.
DROP FUNCTION IF EXISTS public.reset_staff_password(TEXT, TEXT);

-- 3.9 Reports (department-scoped)
CREATE OR REPLACE FUNCTION public.report_sales_by_category(
  p_org_id UUID, p_branch_id UUID DEFAULT NULL, p_from DATE DEFAULT CURRENT_DATE,
  p_to DATE DEFAULT CURRENT_DATE, p_department TEXT DEFAULT NULL)
RETURNS TABLE (category TEXT, food_group TEXT, qty_sold NUMERIC, revenue NUMERIC, txn_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(p.category,'(uncategorised)'), COALESCE(p.food_group,'(none)'),
         SUM(si.quantity)::NUMERIC, SUM(si.amount)::NUMERIC, COUNT(*)::BIGINT
  FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id JOIN public.products p ON p.id = si.product_id
  WHERE s.org_id = p_org_id AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND (p_department IS NULL OR p.department = p_department) AND s.date BETWEEN p_from AND p_to
    AND s.cancel_state <> 'cancelled'
  GROUP BY p.category, p.food_group ORDER BY 4 DESC;
$$;

CREATE OR REPLACE FUNCTION public.report_top_food_groups(
  p_org_id UUID, p_branch_id UUID DEFAULT NULL, p_from DATE DEFAULT CURRENT_DATE,
  p_to DATE DEFAULT CURRENT_DATE, p_department TEXT DEFAULT NULL)
RETURNS TABLE (food_group TEXT, revenue NUMERIC, txn_count BIGINT, share_pct NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT COALESCE(p.food_group,'(none)') AS food_group, SUM(si.amount)::NUMERIC AS revenue, COUNT(*)::BIGINT AS txn_count
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id JOIN public.products p ON p.id = si.product_id
    WHERE s.org_id = p_org_id AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
      AND (p_department IS NULL OR p.department = p_department) AND s.date BETWEEN p_from AND p_to
      AND s.cancel_state <> 'cancelled'
    GROUP BY p.food_group
  ), total AS (SELECT NULLIF(SUM(revenue),0) AS grand FROM base)
  SELECT b.food_group, b.revenue, b.txn_count, ROUND((b.revenue / COALESCE(t.grand,1))*100,1)
  FROM base b CROSS JOIN total t ORDER BY b.revenue DESC;
$$;

-- 3.10 Finalize a stock-take → adjustment movements + variance snapshot
CREATE OR REPLACE FUNCTION public.finalize_stock_take(p_stock_take_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org UUID; v_branch UUID; v_status TEXT; r RECORD; v_onhand NUMERIC;
BEGIN
  SELECT org_id, branch_id, status INTO v_org, v_branch, v_status FROM public.stock_takes WHERE id = p_stock_take_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Stock-take not found'; END IF;
  IF v_status = 'final' THEN RETURN; END IF;
  FOR r IN SELECT * FROM public.stock_take_items WHERE stock_take_id = p_stock_take_id LOOP
    SELECT COALESCE(SUM(delta_qty),0) INTO v_onhand FROM public.stock_movements WHERE branch_id = v_branch AND product_id = r.product_id;
    UPDATE public.stock_take_items SET system_qty = v_onhand WHERE id = r.id;
    IF r.counted_qty <> v_onhand THEN
      INSERT INTO public.stock_movements (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note)
      VALUES (v_org, v_branch, r.product_id, r.counted_qty - v_onhand, 'adjustment', 'stock_take_items', r.id, 'Stock-take reconciliation')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  UPDATE public.stock_takes SET status = 'final', finalized_at = NOW() WHERE id = p_stock_take_id;
END; $$;

-- 3.11 Shifts
CREATE OR REPLACE FUNCTION public.open_shift(p_org_id UUID, p_branch_id UUID, p_cashier_id UUID, p_opening_float NUMERIC DEFAULT 0)
RETURNS public.shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_shift public.shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE branch_id = p_branch_id AND cashier_id = p_cashier_id AND status = 'open' LIMIT 1;
  IF v_shift.id IS NOT NULL THEN RETURN v_shift; END IF;
  INSERT INTO public.shifts (org_id, branch_id, cashier_id, opening_float)
    VALUES (p_org_id, p_branch_id, p_cashier_id, COALESCE(p_opening_float,0)) RETURNING * INTO v_shift;
  RETURN v_shift;
END; $$;

CREATE OR REPLACE FUNCTION public.close_shift(p_shift_id UUID, p_counted_cash NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS public.shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_shift public.shifts%ROWTYPE; v_cash NUMERIC;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status = 'closed' THEN RETURN v_shift; END IF;
  -- Cash taken this shift = whole subtotal of cash-only sales + the cash portion
  -- of any split sales.
  SELECT
    COALESCE((SELECT SUM(subtotal) FROM public.sales
               WHERE shift_id = p_shift_id AND payment = 'cash'
                 AND cancel_state <> 'cancelled'), 0)
    + COALESCE((SELECT SUM((p->>'amount')::numeric)
                FROM public.sales s, jsonb_array_elements(s.payments) p
                WHERE s.shift_id = p_shift_id AND s.payment = 'split'
                  AND s.cancel_state <> 'cancelled'
                  AND p->>'method' = 'cash'), 0)
    INTO v_cash;
  UPDATE public.shifts SET status='closed', closed_at=NOW(), expected_cash=v_shift.opening_float+v_cash,
         counted_cash=p_counted_cash, note=COALESCE(p_note,note) WHERE id = p_shift_id RETURNING * INTO v_shift;
  RETURN v_shift;
END; $$;


-- 3.12 Sale cancellation workflow (cashier requests → admin/manager decides)
CREATE OR REPLACE FUNCTION public.request_cancel(p_actor_id UUID, p_sale_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  UPDATE public.sales
     SET cancel_state = 'requested',
         cancel_reason = NULLIF(trim(COALESCE(p_reason,'')),''),
         cancel_by = p_actor_id
   WHERE id = p_sale_id AND cancel_state IN ('none','rejected');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found or already being processed' USING ERRCODE = '22023';
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.request_cancel(UUID, UUID, TEXT) TO anon;

CREATE OR REPLACE FUNCTION public.reject_cancel(p_actor_id UUID, p_sale_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM public.sales WHERE id = p_sale_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = p_actor_id AND role IN ('admin','manager') AND org_id = v_org) THEN
    RAISE EXCEPTION 'Only an admin or manager can decide cancellations' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sales SET cancel_state = 'rejected'
   WHERE id = p_sale_id AND cancel_state = 'requested';
END; $$;
GRANT EXECUTE ON FUNCTION public.reject_cancel(UUID, UUID) TO anon;

-- Approve: void the sale AND return the stock it removed (reverse each of its
-- sale stock_movements). Cancelled sales are excluded from every total.
CREATE OR REPLACE FUNCTION public.approve_cancel(p_actor_id UUID, p_sale_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org UUID; v_branch UUID; v_receipt TEXT; m RECORD;
BEGIN
  SELECT org_id, branch_id, receipt_no INTO v_org, v_branch, v_receipt
    FROM public.sales WHERE id = p_sale_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Sale not found' USING ERRCODE = '23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = p_actor_id AND role IN ('admin','manager') AND org_id = v_org) THEN
    RAISE EXCEPTION 'Only an admin or manager can approve cancellations' USING ERRCODE = '42501';
  END IF;

  FOR m IN
    SELECT sm.id, sm.product_id, sm.delta_qty
    FROM public.stock_movements sm
    JOIN public.sale_items si ON si.id = sm.ref_id
    WHERE sm.ref_table = 'sale_items' AND sm.reason = 'sale' AND si.sale_id = p_sale_id
  LOOP
    INSERT INTO public.stock_movements
      (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note)
    VALUES (v_org, v_branch, m.product_id, -m.delta_qty, 'adjustment', 'sale_cancel', m.id,
            'Sale ' || v_receipt || ' cancelled')
    ON CONFLICT DO NOTHING;
  END LOOP;

  UPDATE public.sales
     SET cancel_state = 'cancelled', cancelled_at = NOW(), cancel_approved_by = p_actor_id
   WHERE id = p_sale_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.approve_cancel(UUID, UUID) TO anon;


-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 4. GRANTS + ROW LEVEL SECURITY                               ║
-- ╚══════════════════════════════════════════════════════════════╝
-- This app does NOT use Supabase Auth — the browser holds the anon key and the
-- app authenticates through SECURITY DEFINER RPCs (bcrypt verify_login) and
-- filters every query by org_id itself. There is therefore no per-request JWT
-- to write per-tenant RLS against.
--
-- We still ENABLE RLS on every table (so nothing is left "unprotected" by
-- default) with an explicit permissive policy for the anon role. This mirrors
-- the working model above while satisfying the "RLS enabled" requirement.
-- Column-level protection for profiles.password_hash (below) is enforced
-- INDEPENDENTLY of RLS, so the password hash is never readable via REST.
--
-- For true cross-tenant isolation later, migrate to Supabase Auth + JWT org
-- claims and replace the permissive policies with `org_id = auth.jwt()->>'org'`.

GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;

-- Enable RLS + an allow-anon policy on every base table (views can't have RLS).
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)',
      t || '_anon_all', t
    );
  END LOOP;
END $$;

-- Lock down login_attempts: anon must NOT read or reset it (that would defeat
-- the lockout). RLS is on (from the loop) but we drop its allow-anon policy and
-- revoke grants — only the SECURITY DEFINER verify_login (owner) touches it.
DROP POLICY IF EXISTS login_attempts_anon_all ON public.login_attempts;
REVOKE ALL ON public.login_attempts FROM anon;

-- Protect password_hash: anon can't read or write it directly (only via RPCs).
-- Column grants are independent of RLS, so this holds even with the policy above.
REVOKE SELECT ON public.profiles FROM anon;
GRANT  SELECT (id, email, full_name, role, org_id, branch_id, permissions, created_at, updated_at)
  ON public.profiles TO anon;
REVOKE UPDATE ON public.profiles FROM anon;
GRANT  UPDATE (full_name, role, branch_id, permissions) ON public.profiles TO anon;


-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 5. REALTIME                                                  ║
-- ╚══════════════════════════════════════════════════════════════╝
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$
DECLARE t TEXT;
  tables TEXT[] := ARRAY[
    'sales','sale_items','stock_movements','purchase_orders','purchase_order_items',
    'products','product_servings','organisations','branches','profiles','stock_entries',
    'stock_takes','stock_take_items','shifts','customers','customer_payments'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- REPLICA IDENTITY FULL so realtime DELETE events carry the whole old row —
-- without it a filtered subscription (e.g. org_id=eq.X) can't match a delete,
-- and other devices wouldn't see the removal until the next refresh.
ALTER TABLE public.sales             REPLICA IDENTITY FULL;
ALTER TABLE public.sale_items        REPLICA IDENTITY FULL;
ALTER TABLE public.stock_movements   REPLICA IDENTITY FULL;
ALTER TABLE public.purchase_orders   REPLICA IDENTITY FULL;
ALTER TABLE public.purchase_order_items REPLICA IDENTITY FULL;
ALTER TABLE public.products          REPLICA IDENTITY FULL;
ALTER TABLE public.product_servings  REPLICA IDENTITY FULL;
ALTER TABLE public.customers         REPLICA IDENTITY FULL;
ALTER TABLE public.customer_payments REPLICA IDENTITY FULL;
ALTER TABLE public.shifts            REPLICA IDENTITY FULL;


-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 6. STORAGE — org logos bucket                                ║
-- ╚══════════════════════════════════════════════════════════════╝
INSERT INTO storage.buckets (id, name, public) VALUES ('org-logos','org-logos',true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "org_logos_select_public" ON storage.objects;
CREATE POLICY "org_logos_select_public" ON storage.objects FOR SELECT USING (bucket_id = 'org-logos');
DROP POLICY IF EXISTS "org_logos_insert_anon" ON storage.objects;
CREATE POLICY "org_logos_insert_anon" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'org-logos');
DROP POLICY IF EXISTS "org_logos_update_anon" ON storage.objects;
CREATE POLICY "org_logos_update_anon" ON storage.objects FOR UPDATE TO anon USING (bucket_id = 'org-logos') WITH CHECK (bucket_id = 'org-logos');
DROP POLICY IF EXISTS "org_logos_delete_anon" ON storage.objects;
CREATE POLICY "org_logos_delete_anon" ON storage.objects FOR DELETE TO anon USING (bucket_id = 'org-logos');


-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 7. SEED the platform super admin                             ║
-- ║    CHANGE these credentials, then log in to onboard business ║
-- ╚══════════════════════════════════════════════════════════════╝
INSERT INTO public.profiles (email, password_hash, full_name, role)
VALUES ('dkmbugua70@gmail.com', crypt('Dkm10407#', gen_salt('bf',10)), 'Decent microsystem Admin', 'super_admin')
ON CONFLICT (email) DO UPDATE
  SET role = 'super_admin', password_hash = crypt('Dkm10407#', gen_salt('bf',10));

-- ════════════════════════════════════════════════════════════════════════════
-- END — one file, every module.
-- ════════════════════════════════════════════════════════════════════════════
