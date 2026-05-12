import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";
import type { Database, UserPermissions } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Organisation = Database["public"]["Tables"]["organisations"]["Row"];
type Branch = Database["public"]["Tables"]["branches"]["Row"];
type Role = Profile["role"];

export interface Session {
  profile: Profile;
  org: Organisation;
  branch: Branch | null;
}

interface AuthContextValue {
  profile: Profile | null;
  org: Organisation | null;
  branch: Branch | null;
  role: Role | null;
  isLoading: boolean;
  hasPermission: (key: keyof UserPermissions) => boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    businessName: string,
  ) => Promise<{ error: string | null }>;
  createUser: (params: {
    email: string;
    password: string;
    fullName: string;
    role: Exclude<Role, "pending">;
    branchId: string | null;
    permissions?: UserPermissions;
  }) => Promise<{ error: string | null }>;
  updatePermissions: (
    userId: string,
    permissions: UserPermissions,
  ) => Promise<{ error: string | null }>;
  /**
   * Re-fetches the current org, branch, and profile from the database
   * and updates both React state AND localStorage. Call this after any
   * mutation that changes the active org/branch/profile so the UI and
   * the cached session both pick up the new values immediately.
   */
  refreshSession: () => Promise<void>;
  signOut: () => void;
}

export const SESSION_KEY = "spot_butchery_session";

const AuthContext = createContext<AuthContextValue | null>(null);

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.profile?.email || !s.org?.id) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

/**
 * Resolves the "active operating branch" for an org.
 *
 * Why this exists:
 *   Admins are deliberately created with profiles.branch_id = NULL
 *   so they can read data from every branch. But every WRITE in the
 *   app (record sale, add stock, record PO) is scoped to a specific
 *   branch. Without a default, admins hit "No active branch" the
 *   moment they try to do anything.
 *
 * Strategy:
 *   1. If the session already has a branch, keep it.
 *   2. Otherwise, fetch the first (oldest) branch in the org —
 *      usually "Main Branch" created by register_first_admin.
 *   3. If the org somehow has zero branches, return null and let
 *      the UI surface a "create a branch in Settings" message.
 *
 * The profile's branch_id in the DB is NOT touched — only the
 * client-side session. That keeps the "admin sees all" semantics
 * intact for reports while giving them a sane default for writes.
 */
async function resolveActiveBranch(
  orgId: string,
  currentBranch: Branch | null,
): Promise<Branch | null> {
  if (currentBranch) return currentBranch;

  const { data, error } = await supabase
    .from("branches")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("resolveActiveBranch failed", error);
    return null;
  }
  return (data as Branch | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [isLoading] = useState(false);

  const persist = (s: Session | null) => {
    setSession(s);
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  };

  const hasPermission = (key: keyof UserPermissions): boolean => {
    if (!session) return false;
    if (session.profile.role === "admin" || session.profile.role === "manager") return true;
    return session.profile.permissions[key] === true;
  };

  // ── signIn ──────────────────────────────────────────────────
  // Delegates bcrypt verification to the verify_login() RPC.
  // The browser NEVER sees password_hash — that column is
  // protected by a column-level GRANT in the schema.
  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.rpc("verify_login", {
      p_email: email,
      p_password: password,
    });

    if (error) return { error: error.message };
    if (!data) return { error: "Invalid email or password" };

    const payload = data as {
      profile: Profile;
      org: Organisation;
      branch: Branch | null;
    };

    if (!payload.org) return { error: "Organisation not found" };

    // If the user has no branch_id in their profile (admins), fall back
    // to the first branch in the org so they can perform operations.
    const activeBranch = await resolveActiveBranch(payload.org.id, payload.branch);

    persist({ profile: payload.profile, org: payload.org, branch: activeBranch });
    return { error: null };
  };

  // ── signUp ──────────────────────────────────────────────────
  // Delegates atomic org+branch+admin creation to register_user().
  // Runs in a single DB transaction — no half-created accounts.
  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    businessName: string,
  ) => {
    const { data, error } = await supabase.rpc("register_first_admin", {
      p_email: email,
      p_password: password,
      p_full_name: fullName,
      p_business_name: businessName,
    });

    if (error) return { error: error.message };
    if (!data) return { error: "Failed to create account" };

    const payload = data as {
      profile: Profile;
      org: Organisation;
      branch: Branch | null;
    };

    // register_first_admin returns branch: NULL by design (admins see all).
    // Resolve the just-created Main Branch as the active operating branch.
    const activeBranch = await resolveActiveBranch(payload.org.id, payload.branch);

    persist({ profile: payload.profile, org: payload.org, branch: activeBranch });
    return { error: null };
  };

  // ── createUser (admin → adds staff) ─────────────────────────
  // Still hashes client-side and inserts directly. INSERT on
  // password_hash is allowed; SELECT on it is not. Safe enough
  // for an admin-only flow; can move to an RPC later when we
  // add session tokens.
  const createUser = async ({
    email,
    password,
    fullName,
    role,
    branchId,
    permissions = {},
  }: {
    email: string;
    password: string;
    fullName: string;
    role: Exclude<Role, "pending">;
    branchId: string | null;
    permissions?: UserPermissions;
  }) => {
    if (!session) return { error: "Not authenticated" };

    const normalised = email.trim().toLowerCase();
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", normalised)
      .maybeSingle();

    if (existing) return { error: "Email already registered" };

    const password_hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from("profiles").insert({
      email: normalised,
      full_name: fullName,
      password_hash,
      role,
      org_id: session.org.id,
      branch_id: branchId,
      permissions,
    });

    if (error) return { error: error.message };
    return { error: null };
  };

  const updatePermissions = async (userId: string, permissions: UserPermissions) => {
    const { error } = await supabase
      .from("profiles")
      .update({ permissions })
      .eq("id", userId);
    if (error) return { error: error.message };
    return { error: null };
  };

  // ── refreshSession ──────────────────────────────────────────
  // Pulls the latest org / branch / profile rows from the DB and
  // overwrites both React state AND localStorage. Run this after
  // any mutation that updates the active org or branch (logo
  // change, name change, branch add/delete, etc.) so the Header
  // and every other consumer of useAuth() re-renders immediately.
  // Columns the anon role is ALLOWED to read on `profiles`.
  // Must stay in sync with hardening.sql section 3.1 (the
  // `GRANT SELECT (…) ON public.profiles TO anon` list).
  // We deliberately omit `password_hash` so REST queries don't
  // get "permission denied for column password_hash" errors.
  const PROFILE_SAFE_COLUMNS =
    "id, email, full_name, role, org_id, branch_id, permissions, created_at, updated_at";

  const refreshSession = async () => {
    if (!session) return;

    const [{ data: org, error: orgErr },
           { data: branch, error: branchErr },
           { data: profile, error: profileErr }] = await Promise.all([
      supabase.from("organisations").select("*").eq("id", session.org.id).maybeSingle(),
      session.branch?.id
        ? supabase.from("branches").select("*").eq("id", session.branch.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // NB: explicit columns — anon does NOT have SELECT on password_hash.
      // Doing select("*") here silently fails and the whole refresh aborts,
      // which makes the UI feel "stuck on the old org name".
      supabase
        .from("profiles")
        .select(PROFILE_SAFE_COLUMNS)
        .eq("id", session.profile.id)
        .maybeSingle(),
    ]);

    if (orgErr || profileErr || branchErr) {
      // Loud, named error so future bugs of this shape are easy to spot.
      console.error(
        "[refreshSession] failed — UI will keep stale data. " +
          "Most common cause: querying a column the anon role can't read.",
        { orgErr, branchErr, profileErr },
      );
      return;
    }
    if (!org || !profile) {
      // The org or the user was deleted in another window — log out gracefully.
      persist(null);
      return;
    }

    // If the active branch we had cached got deleted (or was never set
    // because this admin signed up before the resolveActiveBranch fix),
    // fall back to the first available branch in the org.
    const activeBranch = await resolveActiveBranch(
      (org as Organisation).id,
      (branch ?? null) as Branch | null,
    );

    persist({
      profile: profile as Profile,
      org: org as Organisation,
      branch: activeBranch,
    });
  };

  // ── Auto-heal a stored session that has no active branch ────
  // If you logged in BEFORE the resolveActiveBranch fix, your
  // localStorage session still has branch=null. This effect runs
  // once on mount and patches it without making you log in again.
  useEffect(() => {
    if (!session?.org?.id) return;
    if (session.branch) return;
    let cancelled = false;

    void (async () => {
      const branch = await resolveActiveBranch(session.org.id, null);
      if (!cancelled && branch) {
        persist({ ...session, branch });
      }
    })();

    return () => {
      cancelled = true;
    };
    // We intentionally only run this when the org id changes — once
    // we've patched the branch, we don't want to re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.org?.id]);

  const signOut = () => persist(null);

  return (
    <AuthContext.Provider
      value={{
        profile: session?.profile ?? null,
        org: session?.org ?? null,
        branch: session?.branch ?? null,
        role: session?.profile?.role ?? null,
        isLoading,
        hasPermission,
        signIn,
        signUp,
        createUser,
        updatePermissions,
        refreshSession,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
