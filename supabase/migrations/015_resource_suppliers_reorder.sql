-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 015 — Resource suppliers + reorder alerts + attributed restock
-- ════════════════════════════════════════════════════════════════════════════
-- Builds on 011 (resources / resource_movements / v_resources_on_hand):
--   1. resources.reorder_level  — low-stock threshold; the app alerts when the
--      count on hand falls to/below it (0 stays the hard "none left" state).
--   2. resource_suppliers        — a directory of the people/companies that
--      supply the business's resources (name, phone, what they supply).
--   3. resource_movements gains supplier_id + unit_cost + total_cost so a
--      RESTOCK (a "received" movement) records WHO supplied it and what it cost.
--   4. v_resources_on_hand re-created to expose reorder_level.
--
-- Safe to run anytime (idempotent). Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Reorder level on each resource -------------------------------------------
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0;

-- 2. Supplier directory -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resource_suppliers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id  UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT,
  supplies   TEXT,                      -- free text: "tissue, detergent, gas"
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resource_suppliers_branch
  ON public.resource_suppliers (org_id, branch_id);

-- 3. Attribute a restock to a supplier + record its cost ----------------------
ALTER TABLE public.resource_movements
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.resource_suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.resource_movements
  ADD COLUMN IF NOT EXISTS unit_cost  NUMERIC(12,3);
ALTER TABLE public.resource_movements
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(14,3);

-- 4. Current count per item (now with reorder_level) --------------------------
DROP VIEW IF EXISTS public.v_resources_on_hand;
CREATE VIEW public.v_resources_on_hand WITH (security_invoker = true) AS
  SELECT r.id AS resource_id, r.org_id, r.branch_id, r.name, r.category, r.unit,
         r.reorder_level,
         COALESCE(SUM(m.delta_qty), 0)::NUMERIC(14,3) AS qty_on_hand
  FROM   public.resources r
  LEFT   JOIN public.resource_movements m ON m.resource_id = r.id
  GROUP  BY r.id, r.org_id, r.branch_id, r.name, r.category, r.unit, r.reorder_level;

-- 5. Grants + RLS + realtime for the new table --------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resource_suppliers TO anon;
GRANT SELECT ON public.v_resources_on_hand TO anon;

ALTER TABLE public.resource_suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resource_suppliers_anon_all ON public.resource_suppliers;
CREATE POLICY resource_suppliers_anon_all ON public.resource_suppliers
  FOR ALL TO anon USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='resource_suppliers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_suppliers;
  END IF;
END $$;
ALTER TABLE public.resource_suppliers REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
