-- ════════════════════════════════════════════════════════════════════════════
-- SPOT BUTCHERY — ENABLE REALTIME
-- ════════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS (plain English)
--   The browser code in src/lib/butchery-store.ts subscribes to row
--   changes on tables like `sales`, `stock_movements`, etc., using
--   Supabase's realtime feature. Subscribing alone is not enough —
--   Postgres must also be told "please publish row changes for these
--   tables to the realtime stream". That's what this file does.
--
--   Without this migration, only the device that performed an action
--   sees the result (because React Query also invalidates locally).
--   An admin watching from a different laptop would see nothing
--   until they manually refresh.
--
-- WHEN TO RUN
--   AFTER spot-butchery-schema.sql, hardening.sql, and inventory.sql
--   have all been applied. Safe to re-run (idempotent).
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   If the editor warns about "destructive operations" — there are
--   none here, just publication membership changes. Confirm and run.
--
-- HOW TO VERIFY
--   After running, this query should return all the tables below:
--     SELECT schemaname, tablename
--     FROM pg_publication_tables
--     WHERE pubname = 'supabase_realtime'
--     ORDER BY tablename;
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1.  Make sure the realtime publication exists.
--     Supabase creates it by default on every project, so this
--     is just a safety net for self-hosted setups.
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END$$;


-- ─────────────────────────────────────────────────────────────
-- 2.  Add every table the front-end subscribes to.
--     `ALTER PUBLICATION … ADD TABLE` is NOT idempotent on its own —
--     it errors if the table is already a member. We wrap each
--     add in a DO block that checks pg_publication_tables first,
--     so this whole script is safe to re-run.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._add_to_realtime(p_table regclass)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_schema TEXT;
  v_table  TEXT;
BEGIN
  SELECT n.nspname, c.relname
    INTO v_schema, v_table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = p_table;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = v_schema
      AND tablename  = v_table
  ) THEN
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE %I.%I',
      v_schema, v_table
    );
    RAISE NOTICE 'Added %.% to supabase_realtime', v_schema, v_table;
  ELSE
    RAISE NOTICE 'Skipped %.% (already in supabase_realtime)', v_schema, v_table;
  END IF;
END
$$;

-- Sales tables (POS → admin dashboard)
SELECT public._add_to_realtime('public.sales');
SELECT public._add_to_realtime('public.sale_items');

-- Inventory event log + the tables that write to it
SELECT public._add_to_realtime('public.stock_movements');
SELECT public._add_to_realtime('public.purchase_orders');

-- Catalog
SELECT public._add_to_realtime('public.products');

-- Org-level updates (logo change, business name) so the header
-- on every connected device refreshes when Settings is touched.
SELECT public._add_to_realtime('public.organisations');
SELECT public._add_to_realtime('public.branches');

-- Profiles — admins adding/removing staff should reflect in the
-- User Management screen on the admin's other devices.
SELECT public._add_to_realtime('public.profiles');

-- Legacy stock_entries table (still queried by useStock, even
-- though new logic uses stock_movements).
SELECT public._add_to_realtime('public.stock_entries');


-- ─────────────────────────────────────────────────────────────
-- 3.  Make REPLICA IDENTITY FULL on the tables we DELETE from.
--     Why: without this, DELETE events arrive on the client with
--     only the primary key — fine for invalidation, but missing
--     the row payload. We don't strictly need full payloads, but
--     setting this avoids surprises later. Cost is negligible for
--     small tables.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.sales            REPLICA IDENTITY FULL;
ALTER TABLE public.sale_items       REPLICA IDENTITY FULL;
ALTER TABLE public.stock_movements  REPLICA IDENTITY FULL;
ALTER TABLE public.purchase_orders  REPLICA IDENTITY FULL;
ALTER TABLE public.products         REPLICA IDENTITY FULL;


-- ─────────────────────────────────────────────────────────────
-- 4.  Tidy up the helper function — we don't need it after the
--     migration runs. Comment this out if you want to keep it
--     around for future ad-hoc adds.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION public._add_to_realtime(regclass);
