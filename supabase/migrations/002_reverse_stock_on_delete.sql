-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 002 — Reverse stock when a sale or delivery is deleted
-- ════════════════════════════════════════════════════════════════════════════
-- Problem: stock_movements has NO foreign key back to sale_items /
-- purchase_order_items (ref_id is a plain UUID). So deleting a delivery (or a
-- sale) removed the record but LEFT its stock movement behind:
--   • delete a delivery  → the +qty it added stays → stock overstated
--   • delete a sale       → the −qty it removed stays → stock understated
--
-- Fix: BEFORE DELETE triggers post a reversing 'adjustment' movement equal and
-- opposite to whatever the item actually moved. So the net stock effect of the
-- deleted record becomes zero, and the audit log shows both the original and
-- the reversal.
--
-- Safe under edge cases:
--   • Reverses the ACTUAL posted movement, so bar-serving fractions are exact.
--   • Skips any movement that was ALREADY reversed (e.g. a sale that was
--     cancelled via approve_cancel first) → stock is never returned twice.
--   • ON CONFLICT DO NOTHING + the (ref_table,ref_id,reason) unique index make
--     it idempotent.
--
-- Safe to run anytime: functions/triggers only, no data touched, no seeds.
-- Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- Deleting a sale item → return the stock that sale removed.
CREATE OR REPLACE FUNCTION public.reverse_sale_item_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE m RECORD;
BEGIN
  FOR m IN
    SELECT * FROM public.stock_movements
    WHERE ref_table = 'sale_items' AND ref_id = OLD.id AND reason = 'sale'
  LOOP
    -- Already reversed (e.g. sale was cancelled first)? Don't double-return.
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements
      WHERE ref_id = m.id AND reason = 'adjustment'
    ) THEN
      INSERT INTO public.stock_movements
        (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note)
      VALUES (m.org_id, m.branch_id, m.product_id, -m.delta_qty, 'adjustment',
              'sale_item_delete', m.id, 'Sale deleted — stock returned')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS sale_item_delete_reverse ON public.sale_items;
CREATE TRIGGER sale_item_delete_reverse
  BEFORE DELETE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.reverse_sale_item_stock();

-- Deleting a purchase-order item (or the whole delivery, which cascades to its
-- items) → remove the stock that delivery added.
CREATE OR REPLACE FUNCTION public.reverse_po_item_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE m RECORD;
BEGIN
  FOR m IN
    SELECT * FROM public.stock_movements
    WHERE ref_table = 'purchase_order_items' AND ref_id = OLD.id AND reason = 'purchase'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements
      WHERE ref_id = m.id AND reason = 'adjustment'
    ) THEN
      INSERT INTO public.stock_movements
        (org_id, branch_id, product_id, delta_qty, reason, ref_table, ref_id, note)
      VALUES (m.org_id, m.branch_id, m.product_id, -m.delta_qty, 'adjustment',
              'po_item_delete', m.id, 'Delivery deleted — stock removed')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS po_item_delete_reverse ON public.purchase_order_items;
CREATE TRIGGER po_item_delete_reverse
  BEFORE DELETE ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.reverse_po_item_stock();

NOTIFY pgrst, 'reload schema';
