-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 006 — Orders (order now, pay later / open tabs)
-- ════════════════════════════════════════════════════════════════════════════
-- A waiter opens an order, items are served (stock deducts NOW because they're
-- consumed), the order can be reopened to add rounds, and on payment it converts
-- to a real sale. Orders live in their OWN tables, so they never touch
-- sales/reports/revenue until paid.
--
-- Stock model (deduct once):
--   • order_items INSERT  → deducts stock (reason 'sale', ref 'order_items').
--   • pay_order           → creates the sale, moves each order item to a
--                           sale_item, and RE-POINTS its stock movement to that
--                           sale_item (no second deduction). The order is then
--                           deleted; because the movements were re-pointed, the
--                           delete-reversal does NOT fire, so stock stays gone.
--   • void_order / remove item → deletes order_items, whose BEFORE DELETE
--                           trigger returns the stock.
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Per-org order number counter --------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_counter (
  org_id  UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  counter INTEGER NOT NULL DEFAULT 0
);
CREATE OR REPLACE FUNCTION public.next_order_no(p_org_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.order_counter (org_id, counter) VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE SET counter = order_counter.counter + 1
  RETURNING counter INTO n;
  RETURN n;
END; $$;

-- 2. Tables ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id  UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_no   INTEGER NOT NULL,
  note       TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  shift_id   UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_branch ON public.orders (org_id, branch_id);

CREATE TABLE IF NOT EXISTS public.order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
  quantity     NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  serving_name TEXT,
  serving_ml   NUMERIC(10,2) CHECK (serving_ml IS NULL OR serving_ml > 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);

-- 3. Triggers ----------------------------------------------------------------
-- 3a. amount = qty * price
CREATE OR REPLACE FUNCTION public.set_order_item_amount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.amount := ROUND(NEW.quantity * NEW.unit_price, 2); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS order_items_amount_trigger ON public.order_items;
CREATE TRIGGER order_items_amount_trigger
  BEFORE INSERT OR UPDATE OF quantity, unit_price ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_order_item_amount();

-- 3b. order item INSERT → deduct stock (served = consumed)
CREATE OR REPLACE FUNCTION public.order_item_to_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_track BOOLEAN; v_container INTEGER; v_org UUID; v_branch UUID; v_delta NUMERIC;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT track_stock, container_ml INTO v_track, v_container FROM public.products WHERE id = NEW.product_id;
  IF v_track IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT org_id, branch_id INTO v_org, v_branch FROM public.orders WHERE id = NEW.order_id;
  IF v_org IS NULL THEN RETURN NEW; END IF;
  IF NEW.serving_ml IS NOT NULL AND v_container IS NOT NULL AND v_container > 0 THEN
    v_delta := NEW.quantity * (NEW.serving_ml / v_container);
  ELSE
    v_delta := NEW.quantity;
  END IF;
  INSERT INTO public.stock_movements (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note)
  VALUES (v_org, v_branch, NEW.product_id, -ABS(v_delta), 'sale', 'order_items', NEW.id, 'Ordered (unpaid)')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS order_item_stock_trigger ON public.order_items;
CREATE TRIGGER order_item_stock_trigger
  AFTER INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_item_to_stock_movement();

-- 3c. order item DELETE → return stock (unless already re-pointed to a sale)
CREATE OR REPLACE FUNCTION public.reverse_order_item_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE m RECORD;
BEGIN
  FOR m IN
    SELECT * FROM public.stock_movements
    WHERE ref_table = 'order_items' AND ref_id = OLD.id AND reason = 'sale'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE ref_id = m.id AND reason = 'adjustment') THEN
      INSERT INTO public.stock_movements (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note)
      VALUES (m.org_id, m.branch_id, m.product_id, -m.delta_qty, 'adjustment',
              'order_item_delete', m.id, 'Order item removed — stock returned')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS order_item_delete_reverse ON public.order_items;
CREATE TRIGGER order_item_delete_reverse
  BEFORE DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.reverse_order_item_stock();

-- 3d. Teach the SALE-item stock trigger to skip when pay_order already has the
--     stock (deducted at order time). Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.sale_item_to_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_track BOOLEAN; v_container INTEGER; v_org UUID; v_branch UUID; v_sale_dt TIMESTAMPTZ; v_delta NUMERIC;
BEGIN
  -- pay_order sets this flag: the order already deducted the stock, so don't
  -- deduct again when its items become sale_items.
  IF current_setting('app.skip_sale_stock', true) = '1' THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT track_stock, container_ml INTO v_track, v_container FROM public.products WHERE id = NEW.product_id;
  IF v_track IS NOT TRUE THEN RETURN NEW; END IF;
  SELECT org_id, branch_id, created_at INTO v_org, v_branch, v_sale_dt FROM public.sales WHERE id = NEW.sale_id;
  IF v_org IS NULL THEN RETURN NEW; END IF;
  IF NEW.serving_ml IS NOT NULL AND v_container IS NOT NULL AND v_container > 0 THEN
    v_delta := NEW.quantity * (NEW.serving_ml / v_container);
  ELSE
    v_delta := NEW.quantity;
  END IF;
  INSERT INTO public.stock_movements (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note, occurred_at)
  VALUES (v_org, v_branch, NEW.product_id, -ABS(v_delta), 'sale', 'sale_items', NEW.id, NEW.serving_name, COALESCE(v_sale_dt, NOW()))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

-- 4. RPCs --------------------------------------------------------------------
-- 4a. Add items to an order (deduct stock, block oversell). Shared by create.
CREATE OR REPLACE FUNCTION public.add_order_items(p_order_id UUID, p_items JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org UUID; v_branch UUID; v_item JSONB; v_pid UUID; v_onhand NUMERIC; v_name TEXT; v_unit TEXT;
BEGIN
  SELECT org_id, branch_id INTO v_org, v_branch FROM public.orders WHERE id = p_order_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '23503'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No items to add' USING ERRCODE = '22023';
  END IF;

  FOR v_pid IN
    SELECT DISTINCT (e->>'product_id')::uuid AS pid FROM jsonb_array_elements(p_items) e
    JOIN public.products p ON p.id = (e->>'product_id')::uuid WHERE p.track_stock IS TRUE ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(v_branch::text), hashtext(v_pid::text));
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, amount, serving_name, serving_ml)
    VALUES (p_order_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::numeric,
            (v_item->>'unit_price')::numeric, 0,
            NULLIF(v_item->>'serving_name',''), NULLIF(v_item->>'serving_ml','')::numeric);
  END LOOP;

  FOR v_pid IN
    SELECT DISTINCT (e->>'product_id')::uuid AS pid FROM jsonb_array_elements(p_items) e
    JOIN public.products p ON p.id = (e->>'product_id')::uuid WHERE p.track_stock IS TRUE
  LOOP
    SELECT COALESCE(SUM(delta_qty),0) INTO v_onhand FROM public.stock_movements
      WHERE branch_id = v_branch AND product_id = v_pid;
    IF v_onhand < 0 THEN
      SELECT name, unit INTO v_name, v_unit FROM public.products WHERE id = v_pid;
      RAISE EXCEPTION 'Not enough % in stock — short by % %',
        COALESCE(v_name,'stock'), ABS(v_onhand), COALESCE(v_unit,'') USING ERRCODE = '23514';
    END IF;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.add_order_items(UUID, JSONB) TO anon;

-- 4b. Open a new order with its first items.
CREATE OR REPLACE FUNCTION public.create_order(
  p_org_id UUID, p_branch_id UUID, p_items JSONB,
  p_created_by UUID DEFAULT NULL, p_shift_id UUID DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  IF p_org_id IS NULL OR p_branch_id IS NULL THEN RAISE EXCEPTION 'Missing org/branch' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.orders (org_id, branch_id, order_no, note, created_by, shift_id)
  VALUES (p_org_id, p_branch_id, public.next_order_no(p_org_id),
          NULLIF(trim(COALESCE(p_note,'')),''), p_created_by, p_shift_id)
  RETURNING * INTO v_order;
  PERFORM public.add_order_items(v_order.id, p_items);
  RETURN v_order;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_order(UUID, UUID, JSONB, UUID, UUID, TEXT) TO anon;

-- 4c. Convert an open order into a paid sale.
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

  -- Move items to sale_items WITHOUT re-deducting stock; re-point each order
  -- movement to the new sale item so refunds/cancels behave like a normal sale.
  PERFORM set_config('app.skip_sale_stock','1', true);
  FOR oi IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, amount, serving_name, serving_ml)
    VALUES (v_sale.id, oi.product_id, oi.quantity, oi.unit_price, 0, oi.serving_name, oi.serving_ml)
    RETURNING id INTO v_si;
    UPDATE public.stock_movements SET ref_table = 'sale_items', ref_id = v_si
      WHERE ref_table = 'order_items' AND ref_id = oi.id AND reason = 'sale';
  END LOOP;
  PERFORM set_config('app.skip_sale_stock','0', true);

  DELETE FROM public.orders WHERE id = p_order_id;  -- movements re-pointed → no reversal

  SELECT * INTO v_sale FROM public.sales WHERE id = v_sale.id;
  RETURN v_sale;
END; $$;
GRANT EXECUTE ON FUNCTION public.pay_order(UUID, TEXT, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, BOOLEAN) TO anon;

-- 4d. Void an unpaid order → returns its stock (via the delete trigger).
CREATE OR REPLACE FUNCTION public.void_order(p_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  DELETE FROM public.orders WHERE id = p_order_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.void_order(UUID) TO anon;

-- 5. Grants + RLS + realtime for the new tables ------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders        TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items   TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_counter TO anon;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','order_items','order_counter'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t || '_anon_all', t);
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','order_items'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.orders      REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
