import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  ACTIVE_DEPARTMENTS,
  Department,
} from "@/lib/butchery-types";

/**
 * DepartmentContext — "which department am I working in right now?"
 *
 * Plain English:
 *   - A Bar cashier only ever sees the Bar. Their login *is* the Bar — no
 *     picker, no way to wander into Restaurant stock.
 *   - Admins and managers see everything, so they get a small switcher chip
 *     in the header to flip between Restaurant and Bar.
 *
 * How "allowed" is decided:
 *   - admin / manager        → every live department (Restaurant + Bar).
 *   - cashier                → the departments listed on their profile
 *                              (permissions.departments). If none are set
 *                              (older accounts), we fall back to Restaurant so
 *                              they are never locked out of the till.
 *
 * The active choice is persisted per-user in localStorage so an admin who was
 * looking at the Bar yesterday lands back on the Bar today.
 */

interface DepartmentContextValue {
  /** Departments this user may see. Always at least one entry. */
  allowed: Department[];
  /** The department currently in focus. Always a member of `allowed`. */
  active: Department;
  /** Switch department (ignored if not in `allowed`). */
  setActive: (d: Department) => void;
  /** True when the user can see more than one department (show the switcher). */
  canSwitch: boolean;
}

const DepartmentContext = createContext<DepartmentContextValue | null>(null);

const STORAGE_KEY = "tavern_active_department";

function computeAllowed(
  role: string | null,
  departments: Department[] | undefined,
): Department[] {
  if (role === "admin" || role === "manager" || role === "super_admin") {
    return ACTIVE_DEPARTMENTS;
  }
  // Cashier: intersect their assigned departments with the live ones.
  const assigned = (departments ?? []).filter((d) => ACTIVE_DEPARTMENTS.includes(d));
  return assigned.length > 0 ? assigned : ["restaurant"];
}

export function DepartmentProvider({ children }: { children: ReactNode }) {
  const { role, profile } = useAuth();

  const allowed = useMemo(
    () => computeAllowed(role, profile?.permissions?.departments),
    [role, profile?.permissions?.departments],
  );

  const [active, setActiveState] = useState<Department>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Department | null;
    return stored ?? allowed[0];
  });

  // Keep `active` inside `allowed` — e.g. a cashier reassigned from Bar to
  // Restaurant, or a stored value that is no longer permitted.
  useEffect(() => {
    if (!allowed.includes(active)) {
      setActiveState(allowed[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const setActive = (d: Department) => {
    if (!allowed.includes(d)) return;
    setActiveState(d);
    localStorage.setItem(STORAGE_KEY, d);
  };

  const value: DepartmentContextValue = {
    allowed,
    active,
    setActive,
    canSwitch: allowed.length > 1,
  };

  return <DepartmentContext.Provider value={value}>{children}</DepartmentContext.Provider>;
}

export function useActiveDepartment() {
  const ctx = useContext(DepartmentContext);
  if (!ctx) throw new Error("useActiveDepartment must be used inside <DepartmentProvider>");
  return ctx;
}
