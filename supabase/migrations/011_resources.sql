-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 011 — Resources (non-sellable hotel supplies & equipment)
-- ════════════════════════════════════════════════════════════════════════════
-- Things the hotel OWNS but never SELLS, tracked purely for accountability:
--   • Housekeeping supplies — tissue, air freshener, detergent…
--   • Kitchen equipment    — plates, sufurias, utensils…
-- Kept completely separate from products/sales so they never touch the POS,
-- revenue, or stock reports. A resources person just records what was RECEIVED
-- (+) and what was ISSUED/used (−); current count = the running sum.
--
-- Model mirrors the stock ledger (simple + auditable):
--   resources           — an item (name, category, unit).
--   resource_movements   — every +/- change, with who and why.
--   v_resources_on_hand  — current count per item (SUM of movements).
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run (choose
-- "Run without RLS" — this file enables RLS itself, in the DO block below).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Resource items -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id  UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'housekeeping',   -- free text: housekeeping / kitchen / …
  unit       TEXT NOT NULL DEFAULT 'piece',          -- piece, roll, bottle, packet…
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resources_branch ON public.resources (org_id, branch_id);

-- 2. Movement ledger ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resource_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id    UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  resource_id  UUID NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  delta_qty    NUMERIC(12,3) NOT NULL,               -- + received / opening, − issued / waste
  reason       TEXT NOT NULL DEFAULT 'received'
               CHECK (reason IN ('opening','received','issued','waste','adjustment')),
  note         TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resource_moves ON public.resource_movements (org_id, branch_id, resource_id, occurred_at);

-- 3. Current count per item ---------------------------------------------------
DROP VIEW IF EXISTS public.v_resources_on_hand;
CREATE VIEW public.v_resources_on_hand WITH (security_invoker = true) AS
  SELECT r.id AS resource_id, r.org_id, r.branch_id, r.name, r.category, r.unit,
         COALESCE(SUM(m.delta_qty), 0)::NUMERIC(14,3) AS qty_on_hand
  FROM   public.resources r
  LEFT   JOIN public.resource_movements m ON m.resource_id = r.id
  GROUP  BY r.id, r.org_id, r.branch_id, r.name, r.category, r.unit;

-- 4. Grants + RLS + realtime --------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resources          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resource_movements TO anon;
GRANT SELECT ON public.v_resources_on_hand TO anon;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['resources','resource_movements'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t || '_anon_all', t);
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['resources','resource_movements'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.resources          REPLICA IDENTITY FULL;
ALTER TABLE public.resource_movements REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
