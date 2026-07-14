-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 009 — Only an ADMIN can approve/reject a cancellation
-- ════════════════════════════════════════════════════════════════════════════
-- Previously approve_cancel and reject_cancel allowed 'admin' OR 'manager'.
-- The business wants voiding a sale to be an admin-only action: cashiers and
-- managers may REQUEST a cancellation (request_cancel is unchanged), but only an
-- admin can approve it (which returns the stock) or reject it. This is the
-- server-side rule, so it can't be bypassed by calling the API directly.
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- Approve → void the sale + return its stock. Admin only.
CREATE OR REPLACE FUNCTION public.approve_cancel(p_actor_id UUID, p_sale_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org UUID; v_branch UUID; v_receipt TEXT; m RECORD;
BEGIN
  SELECT org_id, branch_id, receipt_no INTO v_org, v_branch, v_receipt
    FROM public.sales WHERE id = p_sale_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Sale not found' USING ERRCODE = '23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = p_actor_id AND role = 'admin' AND org_id = v_org) THEN
    RAISE EXCEPTION 'Only an admin can cancel a sale' USING ERRCODE = '42501';
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

-- Reject a pending cancellation request. Admin only.
CREATE OR REPLACE FUNCTION public.reject_cancel(p_actor_id UUID, p_sale_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM public.sales WHERE id = p_sale_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = p_actor_id AND role = 'admin' AND org_id = v_org) THEN
    RAISE EXCEPTION 'Only an admin can decide cancellations' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sales SET cancel_state = 'rejected'
   WHERE id = p_sale_id AND cancel_state = 'requested';
END; $$;
GRANT EXECUTE ON FUNCTION public.reject_cancel(UUID, UUID) TO anon;

NOTIFY pgrst, 'reload schema';
