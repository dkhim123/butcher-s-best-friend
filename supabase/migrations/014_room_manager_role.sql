-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 014 — "Room Manager" staff role
-- ════════════════════════════════════════════════════════════════════════════
-- A room manager runs the hotel front desk (Rooms + Resources) and never touches
-- the POS. It's its own role so an admin can create one directly from the Users
-- page, instead of a cashier workaround. Like cashiers/managers, they belong to
-- a branch.
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run ("Run without RLS").
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Allow the new role.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','admin','manager','cashier','room_manager','pending'));

-- 2. Let register_staff_user create a room_manager (branch required).
CREATE OR REPLACE FUNCTION public.register_staff_user(
  p_email TEXT, p_password TEXT, p_full_name TEXT, p_role TEXT, p_org_id UUID,
  p_branch_id UUID DEFAULT NULL, p_permissions JSONB DEFAULT '{}'::jsonb)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_email TEXT := lower(trim(p_email)); v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023'; END IF;
  IF length(p_password) < 8 THEN RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023'; END IF;
  IF length(trim(p_full_name)) = 0 THEN RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023'; END IF;
  IF p_role NOT IN ('admin','manager','cashier','room_manager','pending') THEN
    RAISE EXCEPTION 'Invalid role' USING ERRCODE = '22023'; END IF;
  IF p_org_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.organisations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organisation not found' USING ERRCODE = '23503'; END IF;
  IF p_role IN ('cashier','manager','room_manager') AND p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Cashiers, managers and room managers must be assigned to a branch' USING ERRCODE = '22023'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Branch not found for this organisation' USING ERRCODE = '23503'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = v_email) THEN
    RAISE EXCEPTION 'Email already registered' USING ERRCODE = '23505'; END IF;
  INSERT INTO public.profiles (email, password_hash, full_name, role, org_id, branch_id, permissions)
    VALUES (v_email, crypt(p_password, gen_salt('bf',10)), trim(p_full_name), p_role, p_org_id, p_branch_id, COALESCE(p_permissions,'{}'::jsonb))
    RETURNING * INTO v_profile;
  RETURN json_build_object('id',v_profile.id,'email',v_profile.email,'full_name',v_profile.full_name,
    'role',v_profile.role,'org_id',v_profile.org_id,'branch_id',v_profile.branch_id,
    'permissions',v_profile.permissions,'created_at',v_profile.created_at);
END; $$;

NOTIFY pgrst, 'reload schema';
