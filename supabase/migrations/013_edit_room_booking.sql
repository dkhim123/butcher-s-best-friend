-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 013 — Edit a booking's nights/amount and re-price its sale
-- ════════════════════════════════════════════════════════════════════════════
-- To correct mistakes (e.g. a guest actually slept 2 nights, not 3), an admin
-- edits the booking. If it was already billed, its linked sale + receipt are
-- re-priced in the same step, so the receipt and every report stay correct.
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run ("Run without RLS").
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.edit_room_booking(
  p_booking_id UUID,
  p_nights     INTEGER,
  p_amount     NUMERIC
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_sale UUID; v_room UUID; v_room_no TEXT; v_type TEXT; v_label TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be zero or more' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bookings SET nights = p_nights, amount = p_amount
   WHERE id = p_booking_id
   RETURNING sale_id, room_id INTO v_sale, v_room;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = '23503'; END IF;

  -- Already billed AND not voided → re-price ONLY the room line (product_id IS
  -- NULL); quantity stays 1 so the amount + subtotal triggers recompute the sale
  -- and every report. We never touch a cancelled sale (that would resurrect
  -- revenue) and never touch a real product line.
  IF v_sale IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale AND cancel_state <> 'cancelled') THEN
    SELECT r.room_no, t.name INTO v_room_no, v_type
      FROM public.rooms r LEFT JOIN public.room_types t ON t.id = r.room_type_id
      WHERE r.id = v_room;
    v_label := 'Room ' || COALESCE(v_room_no, '?')
             || COALESCE(' · ' || v_type, '')
             || CASE WHEN p_nights IS NOT NULL
                     THEN ' · ' || p_nights || ' night' || CASE WHEN p_nights = 1 THEN '' ELSE 's' END
                     ELSE '' END;
    UPDATE public.sale_items
       SET unit_price = p_amount, description = v_label
     WHERE sale_id = v_sale AND product_id IS NULL;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.edit_room_booking(UUID, INTEGER, NUMERIC) TO anon;

NOTIFY pgrst, 'reload schema';
