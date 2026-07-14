-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 007 — Receipt numbers are unique PER ORG, not globally
-- ════════════════════════════════════════════════════════════════════════════
-- BUG: sales.receipt_no had a GLOBAL unique constraint (sales_receipt_no_key),
-- but receipt numbers are generated as  R{YYMMDD}-{counter}  where every org's
-- counter starts at 1001. Two organisations selling on the same day both
-- produce e.g. "R260713-1001", and the second one fails with:
--     duplicate key value violates unique constraint "sales_receipt_no_key"
-- This blocks every brand-new org from completing sales until its counter
-- happens to climb past whatever the older org reached that day.
--
-- FIX: a receipt number only needs to be unique WITHIN one business. Replace the
-- global unique with a composite unique on (org_id, receipt_no). Existing data
-- already satisfies this (each org's numbers are internally unique), so there is
-- nothing to clean up first.
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Drop the global unique constraint (auto-named when the column was declared
--    `receipt_no TEXT NOT NULL UNIQUE`).
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_receipt_no_key;

-- 2. Enforce uniqueness per organisation instead.
CREATE UNIQUE INDEX IF NOT EXISTS sales_org_receipt_no_key
  ON public.sales (org_id, receipt_no);

-- 3. Tell PostgREST to reload so the API picks up the change.
NOTIFY pgrst, 'reload schema';
