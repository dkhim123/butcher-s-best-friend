-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 019 — Supplier payments ledger (part-payments / running balance)
-- ════════════════════════════════════════════════════════════════════════════
-- A supplier is paid against a RUNNING BALANCE, in as many instalments as you
-- like:
--   Delivered = Σ cost of their restocks (resource_movements.total_cost)
--   Paid      = Σ resource_supplier_payments.amount   (this new table)
--   Owed      = Delivered − Paid
-- So you can pay Ksh 10,000 now and still owe the rest, or clear it in full.
-- Each payment stamps the amount, when, and who paid.
--
-- Backfills: any restock already flagged paid (migrations 016/017) becomes an
-- equivalent payment row, so existing "Paid" history is preserved.
--
-- Idempotent. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.resource_supplier_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id   UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.resource_suppliers(id) ON DELETE CASCADE,
  amount      NUMERIC(14,3) NOT NULL CHECK (amount > 0),
  note        TEXT,
  paid_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resource_supplier_payments
  ON public.resource_supplier_payments (org_id, branch_id, supplier_id, paid_at);

-- Backfill: turn each already-settled restock into a payment (once).
INSERT INTO public.resource_supplier_payments (org_id, branch_id, supplier_id, amount, paid_by, paid_at, note)
SELECT m.org_id, m.branch_id, m.supplier_id, m.total_cost, m.paid_by,
       COALESCE(m.paid_at, m.occurred_at), 'Imported from settled restock'
FROM   public.resource_movements m
WHERE  m.reason = 'received' AND m.paid IS TRUE
  AND  m.supplier_id IS NOT NULL AND m.total_cost IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1 FROM public.resource_supplier_payments p
    WHERE p.supplier_id = m.supplier_id
      AND p.note = 'Imported from settled restock'
      AND p.amount = m.total_cost
      AND p.paid_at = COALESCE(m.paid_at, m.occurred_at)
  );

-- Grants + RLS + realtime.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resource_supplier_payments TO anon;

ALTER TABLE public.resource_supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resource_supplier_payments_anon_all ON public.resource_supplier_payments;
CREATE POLICY resource_supplier_payments_anon_all ON public.resource_supplier_payments
  FOR ALL TO anon USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='resource_supplier_payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_supplier_payments;
  END IF;
END $$;
ALTER TABLE public.resource_supplier_payments REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
