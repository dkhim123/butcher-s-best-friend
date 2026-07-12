import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Database, UserPermissions } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Organisation = Database["public"]["Tables"]["organisations"]["Row"];
type Branch = Database["public"]["Tables"]["branches"]["Row"];
type Role = Profile["role"];

export interface Session {
  profile: Profile;
  // Null for the platform super_admin, who has no business of their own.
  org: Organisation | null;
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
  /** Super-admin only: onboard a new business (org + its first admin). */
  registerBusiness: (params: {
    email: string;
    password: string;
    fullName: string;
    businessName: string;
    tagline?: string;
    phone?: string;
    address?: string;
    mpesaPaybill?: string;
    mpesaTill?: string;
  }) => Promise<{ error: string | null }>;
  /** Super-admin only: suspend or restore a business. */
  setBusinessActive: (orgId: string, active: boolean) => Promise<{ error: string | null }>;
  /**
   * Reset another user's password immediately (super-admin → anyone; business
   * admin → a user in their own org). Also clears any brute-force lockout.
   */
  resetPassword: (email: string, newPassword: string) => Promise<{ error: string | null }>;
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
// When the current session was established. Sessions auto-expire so a device
// left logged in (or a stolen localStorage session) stops working after a day.
const SESSION_ISSUED_KEY = "spot_butchery_session_issued_at";
// Absolute session lifetime — a device stays signed in up to this long between
// logins. Set generously so staff aren't nagged during a working day.
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Idle timeout — if the app sits untouched this long, it signs out. Any tap /
// key / touch resets it, so an in-use POS never logs out on its own.
const IDLE_LOGOUT_MS = 3 * 60 * 60 * 1000; // 3 hours of no interaction

const AuthContext = createContext<AuthContextValue | null>(null);

function stampSessionIssued() {
  try {
    localStorage.setItem(SESSION_ISSUED_KEY, String(Date.now()));
  } catch {
    /* storage disabled — session simply won't persist */
  }
}

function clearSessionStorage() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_ISSUED_KEY);
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    // Expire old sessions. A missing timestamp is treated as expired so
    // pre-upgrade sessions are re-authenticated once.
    const issued = Number(localStorage.getItem(SESSION_ISSUED_KEY) ?? 0);
    if (!issued || Date.now() - issued > SESSION_MAX_AGE_MS) {
      clearSessionStorage();
      return null;
    }

    const s = JSON.parse(raw) as Session;
    // Every session needs a profile. A business session also needs an org;
    // the platform super_admin legitimately has none.
    const isSuperAdmin = s.profile?.role === "super_admin";
    if (!s.profile?.email || (!isSuperAdmin && !s.org?.id)) {
      clearSessionStorage();
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

const PROFILE_SAFE_COLUMNS =
  "id, email, full_name, role, org_id, branch_id, permissions, created_at, updated_at";

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * After login/signup RPCs return a session bundle, re-fetch org / branch /
 * profile from the database. That guarantees the header shows the real
 * business name (not stale JSON or a fallback like "Spot Butchery").
 */
async function hydrateSessionFromDb(payload: {
  profile: Profile;
  org: Organisation;
  branch: Branch | null;
}): Promise<Session> {
  const [{ data: org }, { data: profile }] = await Promise.all([
    supabase.from("organisations").select("*").eq("id", payload.org.id).maybeSingle(),
    supabase
      .from("profiles")
      .select(PROFILE_SAFE_COLUMNS)
      .eq("id", payload.profile.id)
      .maybeSingle(),
  ]);

  let branch: Branch | null = payload.branch;
  const branchId = (profile as Profile | null)?.branch_id ?? payload.profile.branch_id;
  if (branchId) {
    const { data: branchRow } = await supabase
      .from("branches")
      .select("*")
      .eq("id", branchId)
      .maybeSingle();
    branch = (branchRow as Branch | null) ?? null;
  }

  const activeBranch = await resolveActiveBranch(
    (org as Organisation | null)?.id ?? payload.org.id,
    branch,
  );

  return {
    profile: (profile as Profile) ?? payload.profile,
    org: (org as Organisation) ?? payload.org,
    branch: activeBranch,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [isLoading] = useState(false);

  const persist = (s: Session | null) => {
    setSession(s);
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else clearSessionStorage();
    // NB: we do NOT stamp the issued-at time here — refreshSession() calls
    // persist() on every mount, and re-stamping would make the session never
    // expire. The timestamp is set only at real login/signup (stampSessionIssued).
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
      p_email: normaliseEmail(email),
      p_password: password,
    });

    if (error) {
      const msg = error.message.includes("Invalid email or password")
        ? "Invalid email or password"
        : error.message;
      return { error: msg };
    }
    if (!data) return { error: "Invalid email or password" };

    const payload = data as {
      profile: Profile;
      org: Organisation | null;
      branch: Branch | null;
    };

    // Platform super_admin: no org, no branch — go straight to a bare session.
    if (payload.profile.role === "super_admin") {
      persist({ profile: payload.profile, org: null, branch: null });
      stampSessionIssued();
      return { error: null };
    }

    if (!payload.org?.id) return { error: "Organisation not found" };

    const session = await hydrateSessionFromDb({
      profile: payload.profile,
      org: payload.org,
      branch: payload.branch,
    });
    persist(session);
    stampSessionIssued();
    return { error: null };
  };


  // ── createUser (admin → adds staff) ─────────────────────────
  // Password is hashed server-side via register_staff_user() so
  // verify_login() can check it. (Browser bcryptjs hashes did not
  // match Postgres crypt(), which blocked cashier/manager login.)
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

    if (password.length < 8) {
      return { error: "Password must be at least 8 characters" };
    }

    if ((role === "cashier" || role === "manager") && !branchId) {
      return {
        error: "Cashiers and managers must be assigned to a branch",
      };
    }

    const { error } = await supabase.rpc("register_staff_user", {
      p_email: normaliseEmail(email),
      p_password: password,
      p_full_name: fullName.trim(),
      p_role: role,
      p_org_id: session.org.id,
      p_branch_id: branchId,
      p_permissions: permissions,
    });

    if (error) {
      if (error.message.includes("function") && error.message.includes("does not exist")) {
        return {
          error:
            "Staff signup is not set up yet. Run supabase/register-staff-user.sql in Supabase SQL Editor, then try again.",
        };
      }
      return { error: error.message };
    }
    return { error: null };
  };

  const updatePermissions = async (userId: string, permissions: UserPermissions) => {
    if (!session) return { error: "Not authenticated" };
    const { error } = await supabase
      .from("profiles")
      .update({ permissions })
      .eq("id", userId)
      .eq("org_id", session.org.id);
    if (error) return { error: error.message };
    return { error: null };
  };

  // ── registerBusiness (super_admin → onboards a business) ────
  // Delegates atomic org + Main Branch + admin creation to the
  // register_business() RPC. The server verifies the caller is a
  // super_admin via p_actor_id.
  const registerBusiness = async (params: {
    email: string;
    password: string;
    fullName: string;
    businessName: string;
    tagline?: string;
    phone?: string;
    address?: string;
    mpesaPaybill?: string;
    mpesaTill?: string;
  }) => {
    if (!session) return { error: "Not authenticated" };
    if (session.profile.role !== "super_admin") {
      return { error: "Only a super admin can register a business" };
    }
    if (params.password.length < 8) {
      return { error: "Password must be at least 8 characters" };
    }
    const { error } = await supabase.rpc("register_business", {
      p_actor_id: session.profile.id,
      p_email: normaliseEmail(params.email),
      p_password: params.password,
      p_full_name: params.fullName.trim(),
      p_business_name: params.businessName.trim(),
      p_tagline: params.tagline?.trim() || null,
      p_phone: params.phone?.trim() || null,
      p_address: params.address?.trim() || null,
      p_mpesa_paybill: params.mpesaPaybill?.trim() || null,
      p_mpesa_till: params.mpesaTill?.trim() || null,
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const setBusinessActive = async (orgId: string, active: boolean) => {
    if (!session) return { error: "Not authenticated" };
    if (session.profile.role !== "super_admin") {
      return { error: "Only a super admin can change business status" };
    }
    const { error } = await supabase.rpc("set_business_active", {
      p_actor_id: session.profile.id,
      p_org_id: orgId,
      p_active: active,
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const resetPassword = async (email: string, newPassword: string) => {
    if (!session) return { error: "Not authenticated" };
    if (newPassword.length < 8) return { error: "Password must be at least 8 characters" };
    const { error } = await supabase.rpc("reset_staff_password", {
      p_actor_id: session.profile.id,
      p_email: normaliseEmail(email),
      p_password: newPassword,
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  // ── refreshSession ──────────────────────────────────────────
  // Pulls the latest org / branch / profile rows from the DB and
  // overwrites both React state AND localStorage. Run this after
  // any mutation that updates the active org or branch (logo
  // change, name change, branch add/delete, etc.) so the Header
  // and every other consumer of useAuth() re-renders immediately.
  const refreshSession = async () => {
    if (!session) return;
    // super_admin has no org/branch to refresh.
    if (session.profile.role === "super_admin" || !session.org) return;

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

  // ── Refresh org/profile from DB on first load ───────────────
  // Fixes stale business name in localStorage after logout/login
  // or after renaming the business in Settings on another tab.
  useEffect(() => {
    if (!session?.org?.id) return;
    void refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── Idle auto-logout ────────────────────────────────────────
  // On a shared till, walking away shouldn't leave the session open. After
  // IDLE_LOGOUT_MS with no interaction we sign out. Any tap/click/keypress
  // resets the timer, so an actively-used POS never logs out mid-service.
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => persist(null), IDLE_LOGOUT_MS);
    };
    const events: (keyof WindowEventMap)[] = [
      "mousedown",
      "keydown",
      "touchstart",
      "pointerdown",
      "visibilitychange",
    ];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.profile?.id]);

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
        createUser,
        updatePermissions,
        registerBusiness,
        setBusinessActive,
        resetPassword,
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
