-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 018 — Link a resource item to its supplier
-- ════════════════════════════════════════════════════════════════════════════
-- Each resource can now have a default supplier (who normally supplies it), so
-- the link is remembered on the item itself and every restock is automatically
-- attributed to that supplier's account. NULL = no supplier set.
--
-- Idempotent. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS supplier_id UUID
  REFERENCES public.resource_suppliers(id) ON DELETE SET NULL;

-- Re-create the on-hand view to expose the linked supplier.
DROP VIEW IF EXISTS public.v_resources_on_hand;
CREATE VIEW public.v_resources_on_hand WITH (security_invoker = true) AS
  SELECT r.id AS resource_id, r.org_id, r.branch_id, r.name, r.category, r.unit,
         r.reorder_level, r.supplier_id,
         COALESCE(SUM(m.delta_qty), 0)::NUMERIC(14,3) AS qty_on_hand
  FROM   public.resources r
  LEFT   JOIN public.resource_movements m ON m.resource_id = r.id
  GROUP  BY r.id, r.org_id, r.branch_id, r.name, r.category, r.unit, r.reorder_level, r.supplier_id;

GRANT SELECT ON public.v_resources_on_hand TO anon;

NOTIFY pgrst, 'reload schema';
