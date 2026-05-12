-- ════════════════════════════════════════════════════════════════════════════
-- SPOT BUTCHERY — INVENTORY & CATEGORY MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
-- Run AFTER spot-butchery-schema.sql + hardening.sql.
--
-- What this adds:
--   1. Three new columns on products: category, food_group, track_stock
--   2. stock_movements — event-log table (the source of truth for "what's left")
--   3. v_stock_on_hand — view that always shows current stock per branch
--   4. Two triggers — purchase_orders -> stock movements (+qty)
--                     sale_items     -> stock movements (-qty)
--   5. Two report RPCs the dashboard will call
--   6. Grants so the anon role (the browser) can read the new objects
--
-- This migration is ADDITIVE — no existing data is touched or destroyed.
-- It is idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- 1.  PRODUCTS — add category / food_group / track_stock columns
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category    TEXT,
  ADD COLUMN IF NOT EXISTS food_group  TEXT,
  ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT FALSE;

-- food_group is a CHECK-constrained vocabulary. We DROP the constraint
-- first (idempotent re-run) then re-add it.
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_food_group_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_food_group_check
  CHECK (food_group IS NULL OR food_group IN
        ('meat','prepared_food','drinks','raw_material','sides','groceries'));

-- Back-fill existing rows with sensible defaults based on their `type`:
--   per_kg  → meat,          track_stock = TRUE
--   fixed   → groceries,     track_stock = FALSE
--   meal    → prepared_food, track_stock = FALSE
UPDATE public.products
   SET food_group  = COALESCE(food_group, CASE type
                                            WHEN 'per_kg' THEN 'meat'
                                            WHEN 'fixed'  THEN 'groceries'
                                            WHEN 'meal'   THEN 'prepared_food'
                                          END),
       track_stock = CASE
                       WHEN track_stock IS TRUE THEN TRUE
                       WHEN type = 'per_kg' THEN TRUE
                       ELSE FALSE
                     END
 WHERE food_group IS NULL OR track_stock IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_food_group ON public.products (org_id, food_group);
CREATE INDEX IF NOT EXISTS idx_products_category   ON public.products (org_id, category);


-- ────────────────────────────────────────────────────────────────────────────
-- 2.  STOCK MOVEMENTS — the event log
-- ────────────────────────────────────────────────────────────────────────────
-- Each row is a single +/- to the count of one product at one branch.
-- "Current stock" is always SUM(delta_qty) for that product+branch.
--
-- We never UPDATE or DELETE these rows in normal flow — only INSERT.
-- That gives us a perfect audit trail and avoids race conditions.
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id   UUID NOT NULL REFERENCES public.branches(id)      ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id)      ON DELETE CASCADE,
  delta_qty   NUMERIC(12,3) NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN
              ('purchase','sale','waste','adjustment','opening')),
  ref_table   TEXT,
  ref_id      UUID,
  note        TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_lookup
  ON public.stock_movements (org_id, branch_id, product_id, occurred_at);

-- Guard against double-recording the SAME source transaction twice
-- (e.g. if a purchase trigger fires once on INSERT and again on UPDATE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_source_uniq
  ON public.stock_movements (ref_table, ref_id, reason)
  WHERE ref_table IS NOT NULL AND ref_id IS NOT NULL;

ALTER TABLE public.stock_movements DISABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────────────────────
-- 3.  v_stock_on_hand — always-fresh current stock per branch+product
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_stock_on_hand AS
SELECT  m.org_id,
        m.branch_id,
        m.product_id,
        p.name        AS product_name,
        p.unit        AS unit,
        p.category    AS category,
        p.food_group  AS food_group,
        SUM(m.delta_qty)::NUMERIC(14,3) AS qty_on_hand
FROM    public.stock_movements m
JOIN    public.products        p ON p.id = m.product_id
GROUP BY m.org_id, m.branch_id, m.product_id, p.name, p.unit, p.category, p.food_group;


-- ────────────────────────────────────────────────────────────────────────────
-- 4a.  Trigger: purchase_orders → stock_movements (+qty)
--      Fires on INSERT (with received=TRUE) OR when received flips to TRUE.
--      Only tracked products generate movements.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po_to_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_track BOOLEAN;
BEGIN
  -- Only act when the PO is marked received.
  IF NOT NEW.received THEN
    RETURN NEW;
  END IF;

  -- On UPDATE: only act when received transitioned FROM false TO true
  -- (avoids double-counting if other columns are edited later).
  IF TG_OP = 'UPDATE' AND OLD.received = TRUE THEN
    RETURN NEW;
  END IF;

  -- If the PO has no product (orphaned via ON DELETE SET NULL), skip.
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT track_stock INTO v_track FROM public.products WHERE id = NEW.product_id;

  IF v_track IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.stock_movements (
    org_id, branch_id, product_id,
    delta_qty, reason, ref_table, ref_id,
    note, occurred_at
  ) VALUES (
    NEW.org_id, NEW.branch_id, NEW.product_id,
    NEW.quantity, 'purchase', 'purchase_orders', NEW.id,
    NEW.supplier, COALESCE(NEW.created_at, NOW())
  )
  ON CONFLICT DO NOTHING;  -- Idempotent re: the unique index on (ref_table, ref_id, reason)

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS po_to_stock_trigger ON public.purchase_orders;
CREATE TRIGGER po_to_stock_trigger
  AFTER INSERT OR UPDATE OF received ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.po_to_stock_movement();


-- ────────────────────────────────────────────────────────────────────────────
-- 4b.  Trigger: sale_items → stock_movements (-qty)
--      Fires on every sale_item INSERT.
--      Only tracked products generate movements.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sale_item_to_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_track     BOOLEAN;
  v_org_id    UUID;
  v_branch_id UUID;
  v_sale_dt   TIMESTAMPTZ;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT track_stock INTO v_track FROM public.products WHERE id = NEW.product_id;

  IF v_track IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Pull org/branch/timestamp from the parent sale row
  SELECT org_id, branch_id, created_at
    INTO v_org_id, v_branch_id, v_sale_dt
    FROM public.sales WHERE id = NEW.sale_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;  -- Sale was deleted in between; bail.
  END IF;

  INSERT INTO public.stock_movements (
    org_id, branch_id, product_id,
    delta_qty, reason, ref_table, ref_id,
    note, occurred_at
  ) VALUES (
    v_org_id, v_branch_id, NEW.product_id,
    -ABS(NEW.quantity), 'sale', 'sale_items', NEW.id,
    NULL, COALESCE(v_sale_dt, NOW())
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sale_to_stock_trigger ON public.sale_items;
CREATE TRIGGER sale_to_stock_trigger
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.sale_item_to_stock_movement();


-- ────────────────────────────────────────────────────────────────────────────
-- 5a.  RPC: report_sales_by_category(org, branch?, from, to)
--      Returns one row per category: qty sold + revenue.
--      Used for the "How much beef vs chicken vs goat?" widget.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_sales_by_category(
  p_org_id     UUID,
  p_branch_id  UUID DEFAULT NULL,
  p_from       DATE DEFAULT CURRENT_DATE,
  p_to         DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  category    TEXT,
  food_group  TEXT,
  qty_sold    NUMERIC,
  revenue     NUMERIC,
  txn_count   BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT  COALESCE(p.category, '(uncategorised)')  AS category,
          COALESCE(p.food_group, '(none)')         AS food_group,
          SUM(si.quantity)::NUMERIC                AS qty_sold,
          SUM(si.amount)::NUMERIC                  AS revenue,
          COUNT(*)::BIGINT                         AS txn_count
  FROM    public.sale_items si
  JOIN    public.sales      s ON s.id = si.sale_id
  JOIN    public.products   p ON p.id = si.product_id
  WHERE   s.org_id = p_org_id
    AND   (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND   s.date BETWEEN p_from AND p_to
  GROUP BY p.category, p.food_group
  ORDER BY revenue DESC;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5b.  RPC: report_top_food_groups(org, branch?, from, to)
--      Returns one row per food_group: total revenue + share of total.
--      Used for the "Top selling — meat / meals / drinks" widget.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_top_food_groups(
  p_org_id     UUID,
  p_branch_id  UUID DEFAULT NULL,
  p_from       DATE DEFAULT CURRENT_DATE,
  p_to         DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  food_group  TEXT,
  revenue     NUMERIC,
  txn_count   BIGINT,
  share_pct   NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT  COALESCE(p.food_group, '(none)') AS food_group,
            SUM(si.amount)::NUMERIC AS revenue,
            COUNT(*)::BIGINT        AS txn_count
    FROM    public.sale_items si
    JOIN    public.sales      s ON s.id = si.sale_id
    JOIN    public.products   p ON p.id = si.product_id
    WHERE   s.org_id = p_org_id
      AND   (p_branch_id IS NULL OR s.branch_id = p_branch_id)
      AND   s.date BETWEEN p_from AND p_to
    GROUP BY p.food_group
  ),
  total AS (SELECT NULLIF(SUM(revenue), 0) AS grand FROM base)
  SELECT  b.food_group,
          b.revenue,
          b.txn_count,
          ROUND((b.revenue / COALESCE(t.grand, 1)) * 100, 1) AS share_pct
  FROM    base b CROSS JOIN total t
  ORDER BY b.revenue DESC;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 6.  GRANTS — let the anon (browser) role use the new objects
-- ────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON public.stock_movements TO anon;
GRANT SELECT         ON public.v_stock_on_hand TO anon;
GRANT EXECUTE        ON FUNCTION public.report_sales_by_category(UUID, UUID, DATE, DATE) TO anon;
GRANT EXECUTE        ON FUNCTION public.report_top_food_groups(UUID, UUID, DATE, DATE)   TO anon;


-- ────────────────────────────────────────────────────────────────────────────
-- 7.  REALTIME — stream stock_movements so the UI updates live
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_movements REPLICA IDENTITY FULL;
