-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 016 — Mark a resource restock as paid / not paid
-- ════════════════════════════════════════════════════════════════════════════
-- When we receive resources from a supplier we may pay on the spot or owe them.
-- `paid` records that: TRUE = settled, FALSE = still owed. Only meaningful on a
-- 'received' movement that has a supplier/cost; NULL everywhere else.
--
-- Idempotent. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.resource_movements
  ADD COLUMN IF NOT EXISTS paid BOOLEAN;

NOTIFY pgrst, 'reload schema';
