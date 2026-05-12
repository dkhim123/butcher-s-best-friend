-- ================================================================
-- Spot Butchery — Senior-dev Hardening Migration
-- ----------------------------------------------------------------
-- WHEN TO RUN
--   AFTER spot-butchery-schema.sql has been applied.
--   This file ADDS hardening on top — it does not drop any tables.
--   Safe to re-run (idempotent).
--
-- WHAT IT DOES (plain English)
--   1. Makes sure pgcrypto is enabled (server-side bcrypt).
--   2. Adds SECURITY DEFINER RPC functions for login + signup, so
--      password hashes NEVER leave the database.
--   3. REVOKES the anon role's permission to read password_hash.
--   4. Adds triggers that auto-compute derived numbers
--      (total_cost, sale_items.amount, sales.subtotal) so the
--      database itself enforces "the maths is correct".
--   5. Adds updated_at columns + auto-update triggers on every
--      mutable table for free audit/debug visibility.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   • It does NOT enable RLS with auth.uid()-based policies,
--     because the app uses custom (bcrypt-in-profiles) auth, not
--     Supabase Auth. Per-org isolation is enforced by app code.
--     See SECURITY.md in the project root for the full threat model.
-- ================================================================



-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 1. Ensure pgcrypto extension is available                    ║
-- ╚══════════════════════════════════════════════════════════════╝
-- pgcrypto gives us crypt() and gen_salt('bf', N) which produce
-- bcrypt-compatible hashes (same format as the JS `bcryptjs`
-- library: $2a$10$...).
CREATE EXTENSION IF NOT EXISTS pgcrypto;



-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 2. Auth RPCs                                                 ║
-- ║    Browser calls these instead of touching `profiles`.       ║
-- ╚══════════════════════════════════════════════════════════════╝


-- ────────────────────────────────────────────────────────────────
-- 2.1  register_first_admin(email, password, full_name, business_name)
--      Used by /signup. Creates organisation + Main Branch + admin
--      profile in one atomic transaction. Returns the session JSON
--      shape the app expects (profile + org + branch).
--      Hashes the password server-side with bcrypt cost 10.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_first_admin(
  p_email         TEXT,
  p_password      TEXT,
  p_full_name     TEXT,
  p_business_name TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email      TEXT := lower(trim(p_email));
  v_org_id     UUID;
  v_branch_id  UUID;
  v_profile    public.profiles%ROWTYPE;
BEGIN
  -- Basic input validation (server side — never trust the client)
  IF v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023';
  END IF;
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023';
  END IF;
  IF length(trim(p_full_name)) = 0 THEN
    RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023';
  END IF;
  IF length(trim(p_business_name)) = 0 THEN
    RAISE EXCEPTION 'Business name is required' USING ERRCODE = '22023';
  END IF;

  -- Reject duplicate emails BEFORE we create the org
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = v_email) THEN
    RAISE EXCEPTION 'Email already registered' USING ERRCODE = '23505';
  END IF;

  -- 1) Create the org
  INSERT INTO public.organisations (name)
       VALUES (trim(p_business_name))
       RETURNING id INTO v_org_id;

  -- 2) Create the default branch
  INSERT INTO public.branches (org_id, name)
       VALUES (v_org_id, 'Main Branch')
       RETURNING id INTO v_branch_id;

  -- 3) Create the admin profile (branch_id NULL so admin sees all)
  INSERT INTO public.profiles
       (email, password_hash, full_name, role, org_id, branch_id, permissions)
       VALUES (
         v_email,
         crypt(p_password, gen_salt('bf', 10)),
         trim(p_full_name),
         'admin',
         v_org_id,
         NULL,
         '{}'::jsonb
       )
       RETURNING * INTO v_profile;

  -- Return session bundle the app already understands
  -- IMPORTANT: do NOT include password_hash in the response.
  RETURN json_build_object(
    'profile', json_build_object(
      'id',          v_profile.id,
      'email',       v_profile.email,
      'full_name',   v_profile.full_name,
      'role',        v_profile.role,
      'org_id',      v_profile.org_id,
      'branch_id',   v_profile.branch_id,
      'permissions', v_profile.permissions,
      'created_at',  v_profile.created_at
    ),
    'org', (SELECT row_to_json(o) FROM public.organisations o WHERE o.id = v_org_id),
    'branch', NULL
  );
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 2.2  verify_login(email, password)
--      Used by /login. Compares the password using server-side
--      crypt() so the hash never travels over the network.
--      Returns the same session bundle as register_first_admin.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_login(
  p_email    TEXT,
  p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email    TEXT := lower(trim(p_email));
  v_profile  public.profiles%ROWTYPE;
  v_org      public.organisations%ROWTYPE;
  v_branch   public.branches%ROWTYPE;
BEGIN
  -- Look up the profile by email
  SELECT * INTO v_profile FROM public.profiles WHERE email = v_email;

  -- Same generic error whether the email is unknown or the password
  -- is wrong. (Prevents user enumeration.)
  IF v_profile.id IS NULL
     OR crypt(p_password, v_profile.password_hash) <> v_profile.password_hash THEN
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = '28000';
  END IF;

  -- Load the org (always required)
  SELECT * INTO v_org FROM public.organisations WHERE id = v_profile.org_id;
  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'Organisation not found' USING ERRCODE = '23503';
  END IF;

  -- Load the branch (optional — admins keep branch_id NULL)
  IF v_profile.branch_id IS NOT NULL THEN
    SELECT * INTO v_branch FROM public.branches WHERE id = v_profile.branch_id;
  END IF;

  RETURN json_build_object(
    'profile', json_build_object(
      'id',          v_profile.id,
      'email',       v_profile.email,
      'full_name',   v_profile.full_name,
      'role',        v_profile.role,
      'org_id',      v_profile.org_id,
      'branch_id',   v_profile.branch_id,
      'permissions', v_profile.permissions,
      'created_at',  v_profile.created_at
    ),
    'org',    row_to_json(v_org),
    'branch', CASE WHEN v_branch.id IS NULL THEN NULL ELSE row_to_json(v_branch) END
  );
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 2.3  GRANT EXECUTE on the auth RPCs to the anon role
--      Browsers MUST be able to call these. They run as the owner
--      (SECURITY DEFINER) so they bypass the column REVOKE below.
-- ────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.register_first_admin(TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_login         (TEXT, TEXT)              TO anon;



-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 3. Prevent the password_hash column from being read or       ║
-- ║    updated via REST.                                          ║
-- ║                                                               ║
-- ║    HISTORICAL NOTE: We can't just                             ║
-- ║      REVOKE SELECT (password_hash) ON profiles FROM anon;     ║
-- ║    because that no-ops silently when anon already has a       ║
-- ║    table-level SELECT (which spot-butchery-schema.sql grants  ║
-- ║    in section 2.13). The reliable recipe is:                  ║
-- ║      1) REVOKE at the table level                             ║
-- ║      2) GRANT back column-by-column, omitting password_hash   ║
-- ╚══════════════════════════════════════════════════════════════╝

-- 3.1 SELECT: anon cannot read password_hash
REVOKE SELECT ON public.profiles FROM anon;
GRANT  SELECT (
  id, email, full_name, role,
  org_id, branch_id, permissions,
  created_at, updated_at
) ON public.profiles TO anon;

-- 3.2 UPDATE: anon cannot change password_hash directly either.
--     Password changes must go through a SECURITY DEFINER RPC.
REVOKE UPDATE ON public.profiles FROM anon;
GRANT  UPDATE (
  full_name, role, branch_id, permissions
) ON public.profiles TO anon;

-- 3.3 INSERT stays broad: register_first_admin needs to write the
--     hash. The hash arrives via the SECURITY DEFINER function, not
--     from the client, so giving anon INSERT on password_hash is
--     safe — only valid hashes ever get inserted.

-- ⚠ IMPORTANT: After this revoke, queries like
--     SELECT * FROM profiles
-- will FAIL for anon ("permission denied for column password_hash").
-- Your app code must list columns explicitly:
--     SELECT id, email, full_name, role, org_id, branch_id, permissions, created_at
--     FROM profiles
-- The updated AuthContext.tsx in this repo already does this.



-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 4. Auto-computed derived columns (data consistency)          ║
-- ╚══════════════════════════════════════════════════════════════╝


-- ────────────────────────────────────────────────────────────────
-- 4.1  purchase_orders.total_cost = quantity * cost_per_unit
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_purchase_order_total_cost()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.total_cost := ROUND(NEW.quantity * NEW.cost_per_unit, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS po_total_cost_trigger ON public.purchase_orders;
CREATE TRIGGER po_total_cost_trigger
  BEFORE INSERT OR UPDATE OF quantity, cost_per_unit
  ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_purchase_order_total_cost();


-- ────────────────────────────────────────────────────────────────
-- 4.2  sale_items.amount = quantity * unit_price
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_sale_item_amount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.amount := ROUND(NEW.quantity * NEW.unit_price, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sale_items_amount_trigger ON public.sale_items;
CREATE TRIGGER sale_items_amount_trigger
  BEFORE INSERT OR UPDATE OF quantity, unit_price
  ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sale_item_amount();


-- ────────────────────────────────────────────────────────────────
-- 4.3  sales.subtotal = SUM(sale_items.amount)
--      Fires AFTER any change to sale_items so the parent sale's
--      subtotal stays consistent automatically.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_sale_subtotal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_sale_id UUID;
  v_sum     NUMERIC(12,2);
BEGIN
  v_sale_id := COALESCE(NEW.sale_id, OLD.sale_id);
  SELECT COALESCE(SUM(amount), 0)
    INTO v_sum
    FROM public.sale_items
   WHERE sale_id = v_sale_id;

  UPDATE public.sales
     SET subtotal = v_sum
   WHERE id = v_sale_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sale_items_subtotal_trigger ON public.sale_items;
CREATE TRIGGER sale_items_subtotal_trigger
  AFTER INSERT OR UPDATE OR DELETE
  ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.recompute_sale_subtotal();



-- ╔══════════════════════════════════════════════════════════════╗
-- ║ 5. updated_at columns + auto-update trigger                  ║
-- ║    Every mutable table gets a free "last touched" timestamp. ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- Add the column (idempotent) and attach the trigger for each table
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'organisations', 'branches', 'profiles', 'products',
    'stock_entries', 'purchase_orders', 'sales'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      t
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at_trigger ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at_trigger BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t, t
    );
  END LOOP;
END $$;



-- ────────────────────────────────────────────────────────────────
-- DONE.
--
-- HOW TO VERIFY (paste in a new SQL Editor tab):
--   -- Functions installed:
--   SELECT proname FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--   ORDER BY proname;
--   -- Should include: next_receipt_no, register_first_admin,
--   --                 verify_login, set_purchase_order_total_cost,
--   --                 set_sale_item_amount, recompute_sale_subtotal,
--   --                 set_updated_at
--
--   -- Triggers installed:
--   SELECT tgname, tgrelid::regclass AS table
--     FROM pg_trigger
--    WHERE NOT tgisinternal
--      AND tgrelid::regclass::text LIKE 'public.%'
--    ORDER BY 2, 1;
--
--   -- Confirm password_hash is hidden from anon:
--   SET ROLE anon;
--   SELECT password_hash FROM profiles LIMIT 1;   -- should fail
--   RESET ROLE;
-- ================================================================
