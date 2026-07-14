-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 012 — A paid room stay becomes a normal SALE (one money stream)
-- ════════════════════════════════════════════════════════════════════════════
-- Instead of a separate money stream for rooms, a paid booking creates a real
-- sale with a single line (e.g. "Room 12 · Deluxe · 3 nights"). That way room
-- income automatically appears on a receipt AND in every report / dashboard /
-- transaction list / shift total — the same source of truth as the bar & kitchen.
--
-- Changes:
--   • sale_items.description — a label for lines with no product (a room stay).
--   • bookings.sale_id       — links a booking to the sale it generated (so we
--                              never double-charge; idempotent).
--   • create_room_sale(...)  — turns a booking into a sale + its receipt.
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run ("Run without RLS").
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.bookings   ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.create_room_sale(
  p_booking_id UUID,
  p_payment    TEXT,
  p_paid       BOOLEAN DEFAULT TRUE,
  p_cash_given NUMERIC DEFAULT NULL,
  p_change     NUMERIC DEFAULT NULL,
  p_mpesa_ref  TEXT    DEFAULT NULL
) RETURNS public.sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_org UUID; v_branch UUID; v_by UUID; v_amount NUMERIC; v_nights INT; v_room UUID;
  v_guest TEXT; v_existing UUID; v_room_no TEXT; v_type TEXT; v_label TEXT;
  v_receipt TEXT; v_sale public.sales%ROWTYPE;
BEGIN
  SELECT org_id, branch_id, created_by, amount, nights, room_id, guest_name, sale_id
    INTO v_org, v_branch, v_by, v_amount, v_nights, v_room, v_guest, v_existing
    FROM public.bookings WHERE id = p_booking_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = '23503'; END IF;

  -- Already billed → return that sale (idempotent; never double-charge).
  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_existing;
    RETURN v_sale;
  END IF;
  IF COALESCE(v_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Booking has no amount to charge' USING ERRCODE = '22023';
  END IF;

  SELECT r.room_no, t.name INTO v_room_no, v_type
    FROM public.rooms r LEFT JOIN public.room_types t ON t.id = r.room_type_id
    WHERE r.id = v_room;
  v_label := 'Room ' || COALESCE(v_room_no, '?')
           || COALESCE(' · ' || v_type, '')
           || CASE WHEN v_nights IS NOT NULL
                   THEN ' · ' || v_nights || ' night' || CASE WHEN v_nights = 1 THEN '' ELSE 's' END
                   ELSE '' END;

  v_receipt := public.next_receipt_no(v_org);
  INSERT INTO public.sales (org_id, branch_id, receipt_no, date, payment, subtotal,
    cash_given, change_amount, mpesa_ref, customer_name, paid, created_by)
  VALUES (v_org, v_branch, v_receipt, (NOW() AT TIME ZONE 'Africa/Nairobi')::date, p_payment, 0,
    p_cash_given, p_change, p_mpesa_ref, v_guest, COALESCE(p_paid, TRUE), v_by)
  RETURNING * INTO v_sale;

  -- One line, no product; amount is set by the sale_item amount trigger (1 × amount).
  INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, amount, description)
  VALUES (v_sale.id, NULL, 1, v_amount, v_amount, v_label);

  UPDATE public.bookings
     SET sale_id = v_sale.id, paid = COALESCE(p_paid, TRUE), payment = p_payment
   WHERE id = p_booking_id;

  SELECT * INTO v_sale FROM public.sales WHERE id = v_sale.id;  -- subtotal recomputed by trigger
  RETURN v_sale;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_room_sale(UUID, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
