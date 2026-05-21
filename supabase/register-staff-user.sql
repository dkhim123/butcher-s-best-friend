-- ════════════════════════════════════════════════════════════════════════════
-- SPOT BUTCHERY — register_staff_user (staff account creation)
-- ════════════════════════════════════════════════════════════════════════════
-- Run AFTER hardening.sql.
--
-- WHY THIS EXISTS (plain English)
--   When an admin creates a cashier/manager in the app, the password
--   MUST be hashed the same way as login checks it — server-side
--   bcrypt via pgcrypto crypt().
--
--   The old flow hashed passwords in the browser (bcryptjs). Postgres
--   crypt() often cannot verify those hashes, so staff could not log in.
--
--   This RPC hashes on the server (same as register_first_admin) so
--   verify_login() works for every account.
--
-- SAFE TO RE-RUN (CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.register_staff_user(
  p_email       TEXT,
  p_password    TEXT,
  p_full_name   TEXT,
  p_role        TEXT,
  p_org_id      UUID,
  p_branch_id   UUID DEFAULT NULL,
  p_permissions JSONB DEFAULT '{}'::jsonb
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email   TEXT := lower(trim(p_email));
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023';
  END IF;

  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023';
  END IF;

  IF length(trim(p_full_name)) = 0 THEN
    RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023';
  END IF;

  IF p_role NOT IN ('admin', 'manager', 'cashier', 'pending') THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023';
  END IF;

  IF p_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organisations WHERE id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Organisation not found' USING ERRCODE = '23503';
  END IF;

  -- Cashiers and managers need a branch so POS/stock queries work.
  IF p_role IN ('cashier', 'manager') AND p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Cashiers and managers must be assigned to a branch'
      USING ERRCODE = '22023';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = p_branch_id AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Branch not found for this organisation' USING ERRCODE = '23503';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = v_email) THEN
    RAISE EXCEPTION 'Email already registered' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.profiles
    (email, password_hash, full_name, role, org_id, branch_id, permissions)
  VALUES (
    v_email,
    crypt(p_password, gen_salt('bf', 10)),
    trim(p_full_name),
    p_role::text,
    p_org_id,
    p_branch_id,
    COALESCE(p_permissions, '{}'::jsonb)
  )
  RETURNING * INTO v_profile;

  RETURN json_build_object(
    'id',          v_profile.id,
    'email',       v_profile.email,
    'full_name',   v_profile.full_name,
    'role',        v_profile.role,
    'org_id',      v_profile.org_id,
    'branch_id',   v_profile.branch_id,
    'permissions', v_profile.permissions,
    'created_at',  v_profile.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_staff_user(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, JSONB
) TO anon;


-- ─────────────────────────────────────────────────────────────
-- Reset a staff password (for accounts created BEFORE this
-- migration, when passwords were hashed in the browser).
-- Admin re-enters the password in Users → delete & recreate,
-- OR run this from SQL Editor for a specific email.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reset_staff_password(
  p_email    TEXT,
  p_password TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
BEGIN
  IF length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET password_hash = crypt(p_password, gen_salt('bf', 10))
   WHERE email = v_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No account found for that email' USING ERRCODE = '23503';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_staff_password(TEXT, TEXT) TO anon;
