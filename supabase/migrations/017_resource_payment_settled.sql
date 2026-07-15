-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 017 — Record WHEN a supplier was paid and WHO paid them
-- ════════════════════════════════════════════════════════════════════════════
-- Builds on 016 (resource_movements.paid). When an owed restock is settled we
-- stamp the moment and the staff member who paid it, for clean accounting:
--   paid_at  — date + time the supplier was paid.
--   paid_by  — the profile (staff) who settled it.
-- Both NULL until a restock is actually marked paid.
--
-- Idempotent. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.resource_movements
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE public.resource_movements
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
