-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 001 — Atomic sale creation (fixes "phantom sales")
-- ════════════════════════════════════════════════════════════════════════════
-- Problem: the client used to write a sale in THREE separate calls
--   (next_receipt_no → INSERT sales → INSERT sale_items). If the last call
--   failed (network drop, tab closed), a sale row survived with a total but no
--   items — money recorded, stock never deducted, nothing to audit.
--
-- Fix: create_sale() writes the sale AND all its items inside ONE transaction
-- (a plpgsql function is atomic — if any item insert fails, the whole sale rolls
-- back and no receipt number is "used up" in a way that leaves a broken row).
--
-- Safe to run anytime: CREATE OR REPLACE only, no data touched, no seeds.
-- Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_sale(
  p_org_id         UUID,
  p_branch_id      UUID,
  p_payment        TEXT,
  p_items          JSONB,                    -- [{product_id, quantity, unit_price, serving_name, serving_ml}]
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

  -- Receipt number is drawn INSIDE the transaction. If anything below fails,
  -- the whole function rolls back — but next_receipt_no already committed its
  -- counter bump via the upsert, so at worst a receipt number is skipped
  -- (a gap), never reused. A gap is harmless; a duplicate would not be.
  v_receipt := public.next_receipt_no(p_org_id);

  INSERT INTO public.sales (
    org_id, branch_id, receipt_no, date, payment, payments, subtotal,
    cash_given, change_amount, mpesa_ref, customer_name, customer_phone,
    customer_id, paid, created_by, shift_id
  ) VALUES (
    -- Business day in Nairobi wall-clock time (same basis as the receipt number),
    -- so a sale near midnight lands on the correct day regardless of the cashier's
    -- device clock or the DB server's UTC default.
    p_org_id, p_branch_id, v_receipt, (NOW() AT TIME ZONE 'Africa/Nairobi')::date,
    p_payment, COALESCE(p_payments, '[]'::jsonb), 0,
    p_cash_given, p_change, p_mpesa_ref, p_customer_name, p_customer_phone,
    p_customer_id, COALESCE(p_paid, FALSE), p_created_by, p_shift_id
  ) RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- amount is inserted as 0 and recomputed by the set_sale_item_amount
    -- trigger (ROUND(qty*price)); recompute_sale_subtotal then updates
    -- sales.subtotal — so money is always server-authoritative.
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

  -- Re-read so the trigger-computed subtotal is what we return to the client.
  SELECT * INTO v_sale FROM public.sales WHERE id = v_sale.id;
  RETURN v_sale;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_sale(
  UUID, UUID, TEXT, JSONB, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, BOOLEAN, UUID, UUID
) TO anon;

-- Tell PostgREST to reload its schema cache so the new RPC is callable at once.
NOTIFY pgrst, 'reload schema';
