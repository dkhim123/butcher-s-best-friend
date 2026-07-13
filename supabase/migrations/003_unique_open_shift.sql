-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 003 — One open shift per cashier (prevents split cash-ups)
-- ════════════════════════════════════════════════════════════════════════════
-- Problem: idx_shifts_open was a NON-unique index and open_shift() did a
-- check-then-insert. A cashier double-clicking "Open shift" (or two devices)
-- could create TWO open shifts, splitting their cash across two cash-ups.
--
-- Fix:
--   1. Collapse any existing duplicates (keep the newest open shift per
--      cashier, auto-close the rest) so the unique index can be created.
--   2. Make idx_shifts_open UNIQUE (partial: only while status='open').
--   3. open_shift() now inserts with ON CONFLICT DO NOTHING and, if it loses a
--      race, returns the shift the other request created — so the caller always
--      gets exactly one shift, never an error.
--
-- Safe to run anytime. Step 1 only touches genuine duplicates (none today).
-- Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Auto-close duplicate open shifts, keeping the most recently opened one.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY branch_id, cashier_id ORDER BY opened_at DESC) AS rn
  FROM public.shifts
  WHERE status = 'open'
)
UPDATE public.shifts s
   SET status = 'closed',
       closed_at = NOW(),
       note = COALESCE(s.note || ' ', '') || '[auto-closed duplicate open shift]'
  FROM ranked r
 WHERE s.id = r.id AND r.rn > 1;

-- 2. Enforce one open shift per (branch, cashier).
DROP INDEX IF EXISTS public.idx_shifts_open;
CREATE UNIQUE INDEX idx_shifts_open
  ON public.shifts (branch_id, cashier_id) WHERE status = 'open';

-- 3. Race-safe open_shift.
CREATE OR REPLACE FUNCTION public.open_shift(
  p_org_id UUID, p_branch_id UUID, p_cashier_id UUID, p_opening_float NUMERIC DEFAULT 0)
RETURNS public.shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_shift public.shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM public.shifts
   WHERE branch_id = p_branch_id AND cashier_id = p_cashier_id AND status = 'open' LIMIT 1;
  IF v_shift.id IS NOT NULL THEN RETURN v_shift; END IF;

  INSERT INTO public.shifts (org_id, branch_id, cashier_id, opening_float)
    VALUES (p_org_id, p_branch_id, p_cashier_id, COALESCE(p_opening_float, 0))
    ON CONFLICT (branch_id, cashier_id) WHERE status = 'open' DO NOTHING
    RETURNING * INTO v_shift;

  IF v_shift.id IS NULL THEN
    -- Lost the race with a concurrent open — return the shift that won.
    SELECT * INTO v_shift FROM public.shifts
     WHERE branch_id = p_branch_id AND cashier_id = p_cashier_id AND status = 'open' LIMIT 1;
  END IF;
  RETURN v_shift;
END; $$;

NOTIFY pgrst, 'reload schema';
