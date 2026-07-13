-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 004 — Block overselling stock-tracked items (race-safe)
-- ════════════════════════════════════════════════════════════════════════════
-- Behaviour change: a sale that would drive a STOCK-TRACKED product below zero
-- is now rejected. In practice this only affects the BAR (drinks track stock);
-- restaurant meals are untracked and raw ingredients aren't sold at the till, so
-- the kitchen is never blocked.
--
-- Race-safety (the hard part): two cashiers must not both sell the last bottle.
-- create_sale takes a per-(branch,product) transaction-level ADVISORY LOCK
-- (acquired in sorted product order to avoid deadlocks) BEFORE checking on-hand.
-- That serialises concurrent sales of the same product: the second cashier waits
-- for the first to commit, then sees the updated stock and is correctly rejected.
-- The check runs AFTER the item inserts so it reuses the existing deduction math
-- (bar-serving fractions included); a failure rolls the whole sale back.
--
-- Replaces the create_sale from migration 001. Safe to run anytime.
-- Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_sale(
  p_org_id         UUID,
  p_branch_id      UUID,
  p_payment        TEXT,
  p_items          JSONB,
  p_payments       JSONB    DEFAULT '[]'::jsonb,
  p_cash_given     NUMERIC  DEFAULT NULL,
  p_change         NUMERIC  DEFAULT NULL,
  p_mpesa_ref      TEXT     DEFAULT NULL,
  p_customer_name  TEXT     DEFAULT NULL,
  p_customer_phone TEXT     DEFAULT NULL,
  p_customer_id    UUID     DEFAULT NULL,
  p_paid           BOOLEAN  DEFAULT FALSE,
  p_created_by     UUID     DEFAULT NULL,
  p_shift_id       UUID     DEFAULT NULL
) RETURNS public.sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_receipt TEXT;
  v_sale    public.sales%ROWTYPE;
  v_item    JSONB;
  v_pid     UUID;
  v_onhand  NUMERIC;
  v_name    TEXT;
  v_unit    TEXT;
BEGIN
  IF p_org_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing organisation or branch' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A sale must have at least one item' USING ERRCODE = '22023';
  END IF;
  IF p_payment NOT IN ('cash','mpesa','credit','split') THEN
    RAISE EXCEPTION 'Invalid payment method %', p_payment USING ERRCODE = '22023';
  END IF;

  -- Lock each distinct stock-tracked product in this sale, in sorted order, so
  -- concurrent sales of the same product serialise (and can't deadlock).
  FOR v_pid IN
    SELECT DISTINCT (e->>'product_id')::uuid AS pid
    FROM jsonb_array_elements(p_items) e
    JOIN public.products p ON p.id = (e->>'product_id')::uuid
    WHERE p.track_stock IS TRUE
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(p_branch_id::text), hashtext(v_pid::text));
  END LOOP;

  v_receipt := public.next_receipt_no(p_org_id);

  INSERT INTO public.sales (
    org_id, branch_id, receipt_no, date, payment, payments, subtotal,
    cash_given, change_amount, mpesa_ref, customer_name, customer_phone,
    customer_id, paid, created_by, shift_id
  ) VALUES (
    p_org_id, p_branch_id, v_receipt, (NOW() AT TIME ZONE 'Africa/Nairobi')::date,
    p_payment, COALESCE(p_payments, '[]'::jsonb), 0,
    p_cash_given, p_change, p_mpesa_ref, p_customer_name, p_customer_phone,
    p_customer_id, COALESCE(p_paid, FALSE), p_created_by, p_shift_id
  ) RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.sale_items (
      sale_id, product_id, quantity, unit_price, amount, serving_name, serving_ml
    ) VALUES (
      v_sale.id,
      (v_item->>'product_id')::UUID,
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'unit_price')::NUMERIC,
      0,
      NULLIF(v_item->>'serving_name', ''),
      NULLIF(v_item->>'serving_ml', '')::NUMERIC
    );
  END LOOP;

  -- After the deduction movements are posted, reject if any tracked product went
  -- negative. We hold the advisory lock, so this read reflects every committed
  -- sale for that product — no two cashiers can both pass on the last unit.
  FOR v_pid IN
    SELECT DISTINCT (e->>'product_id')::uuid AS pid
    FROM jsonb_array_elements(p_items) e
    JOIN public.products p ON p.id = (e->>'product_id')::uuid
    WHERE p.track_stock IS TRUE
  LOOP
    SELECT COALESCE(SUM(delta_qty),0) INTO v_onhand
    FROM public.stock_movements
    WHERE branch_id = p_branch_id AND product_id = v_pid;
    IF v_onhand < 0 THEN
      SELECT name, unit INTO v_name, v_unit FROM public.products WHERE id = v_pid;
      RAISE EXCEPTION 'Not enough % in stock — short by % %',
        COALESCE(v_name,'stock'), ABS(v_onhand), COALESCE(v_unit,'')
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  SELECT * INTO v_sale FROM public.sales WHERE id = v_sale.id;
  RETURN v_sale;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_sale(
  UUID, UUID, TEXT, JSONB, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, BOOLEAN, UUID, UUID
) TO anon;

NOTIFY pgrst, 'reload schema';
