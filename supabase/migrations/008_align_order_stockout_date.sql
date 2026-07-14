-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 008 — Date an order's stock-out on the SALE day, not the order day
-- ════════════════════════════════════════════════════════════════════════════
-- BUG: for "order now, pay later", stock leaves the shelf when the order is
-- PLACED (order_items trigger, dated at order time), but revenue is recognised
-- when it is PAID (sales.date). If an order is placed late one night and paid
-- after midnight, the End-of-Day report shows the revenue on the pay day but the
-- "− Out" quantity on the order day — so a product reads "Revenue Ksh 1,600" yet
-- "0 bottles Out" on the same report.
--
-- FIX: when pay_order converts the order to a sale, re-date each re-pointed
-- stock movement to the sale's created_at, so the outflow lands on the same day
-- as the revenue. This does NOT change current stock on hand — stock on hand is
-- SUM(delta_qty) and is independent of occurred_at; only the DAY the report
-- attributes the outflow to moves.
--
-- Part 2 backfills the movements of orders that were already paid so past
-- straddling sales line up too.
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. pay_order — same as before, but the re-point UPDATE also sets occurred_at.
CREATE OR REPLACE FUNCTION public.pay_order(
  p_order_id UUID, p_payment TEXT, p_payments JSONB DEFAULT '[]'::jsonb,
  p_cash_given NUMERIC DEFAULT NULL, p_change NUMERIC DEFAULT NULL, p_mpesa_ref TEXT DEFAULT NULL,
  p_customer_name TEXT DEFAULT NULL, p_customer_phone TEXT DEFAULT NULL, p_customer_id UUID DEFAULT NULL,
  p_paid BOOLEAN DEFAULT TRUE)
RETURNS public.sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org UUID; v_branch UUID; v_by UUID; v_shift UUID; v_receipt TEXT; v_sale public.sales%ROWTYPE; oi RECORD; v_si UUID;
BEGIN
  SELECT org_id, branch_id, created_by, shift_id INTO v_org, v_branch, v_by, v_shift
    FROM public.orders WHERE id = p_order_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'Order has no items' USING ERRCODE = '22023';
  END IF;

  v_receipt := public.next_receipt_no(v_org);
  INSERT INTO public.sales (org_id, branch_id, receipt_no, date, payment, payments, subtotal,
    cash_given, change_amount, mpesa_ref, customer_name, customer_phone, customer_id, paid, created_by, shift_id)
  VALUES (v_org, v_branch, v_receipt, (NOW() AT TIME ZONE 'Africa/Nairobi')::date, p_payment,
    COALESCE(p_payments,'[]'::jsonb), 0, p_cash_given, p_change, p_mpesa_ref, p_customer_name,
    p_customer_phone, p_customer_id, COALESCE(p_paid,TRUE), v_by, v_shift)
  RETURNING * INTO v_sale;

  PERFORM set_config('app.skip_sale_stock','1', true);
  FOR oi IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, amount, serving_name, serving_ml)
    VALUES (v_sale.id, oi.product_id, oi.quantity, oi.unit_price, 0, oi.serving_name, oi.serving_ml)
    RETURNING id INTO v_si;
    -- Re-point AND re-date the stock movement to the sale moment so "Out" and
    -- revenue land on the same day. Stock-on-hand is unchanged (same delta).
    UPDATE public.stock_movements SET ref_table = 'sale_items', ref_id = v_si, occurred_at = v_sale.created_at
      WHERE ref_table = 'order_items' AND ref_id = oi.id AND reason = 'sale';
  END LOOP;
  PERFORM set_config('app.skip_sale_stock','0', true);

  DELETE FROM public.orders WHERE id = p_order_id;  -- movements re-pointed → no reversal

  SELECT * INTO v_sale FROM public.sales WHERE id = v_sale.id;
  RETURN v_sale;
END; $$;
GRANT EXECUTE ON FUNCTION public.pay_order(UUID, TEXT, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, BOOLEAN) TO anon;

-- 2. Backfill: align every already-paid sale movement to its sale's created_at.
--    Only rows that currently differ are touched (direct sales already match, so
--    they're left alone) — this fixes the order-originated straddling ones.
UPDATE public.stock_movements sm
SET occurred_at = s.created_at
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE sm.ref_table = 'sale_items'
  AND sm.ref_id = si.id
  AND sm.reason = 'sale'
  AND sm.occurred_at IS DISTINCT FROM s.created_at;

NOTIFY pgrst, 'reload schema';
