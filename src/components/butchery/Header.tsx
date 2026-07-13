import { useEffect, useState } from "react";
import { Hotel, LogOut, Moon, Sun, User, UtensilsCrossed, Wine } from "lucide-react";
import { useTheme } from "next-themes";
import { ksh } from "@/lib/format";
import { useSales } from "@/lib/butchery-store";
import { todayISO, Department, DEPARTMENT_SHORT_LABELS } from "@/lib/butchery-types";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveDepartment } from "@/contexts/DepartmentContext";
import { InstallButton } from "@/components/InstallButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  pending: "Pending",
};

const DEPT_ICON: Record<Department, typeof Wine> = {
  restaurant: UtensilsCrossed,
  bar: Wine,
  rooms: Hotel,
};

/**
 * DepartmentSwitcher — segmented control shown when the user may see more than
 * one department (admin/manager). Cashiers see a single static badge instead,
 * because their department is fixed by their login.
 */
function DepartmentSwitcher() {
  const { allowed, active, setActive, canSwitch } = useActiveDepartment();

  if (!canSwitch) {
    const Icon = DEPT_ICON[active];
    return (
      <Badge variant="secondary" className="gap-1.5 py-1.5 px-3">
        <Icon className="h-3.5 w-3.5" />
        {DEPARTMENT_SHORT_LABELS[active]}
      </Badge>
    );
  }

  return (
    <div className="inline-flex rounded-full border bg-muted/40 p-0.5">
      {allowed.map((d) => {
        const Icon = DEPT_ICON[d];
        const on = d === active;
        return (
          <button
            key={d}
            type="button"
            onClick={() => setActive(d)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              on
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {DEPARTMENT_SHORT_LABELS[d]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ThemeToggle — flips between light and night mode. Uses next-themes, which
 * persists the choice and toggles the `.dark` class the palette hangs off.
 * We wait for mount so the icon matches the resolved theme (no flash).
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="outline"
      size="icon"
      className="rounded-full h-9 w-9"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to night mode"}
      aria-label="Toggle night mode"
    >
      {mounted && isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

export const Header = () => {
  const { sales } = useSales(todayISO());
  const { profile, org, branch, signOut } = useAuth();
  const total = sales.reduce((a, s) => a + s.subtotal, 0);
  const credit = sales
    .filter((s) => s.payment === "credit" && !s.paid)
    .reduce((a, s) => a + s.subtotal, 0);

  return (
    <header className="border-b bg-gradient-surface sticky top-0 z-30 backdrop-blur shadow-soft">
      <div className="container flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3 min-w-0">
          {org?.logo_url ? (
            <img
              src={org.logo_url}
              alt={org.name}
              className="h-11 w-11 rounded-xl object-contain border bg-white shadow-elevated shrink-0"
            />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-gradient-primary grid place-items-center shadow-elevated shrink-0">
              <Hotel className="h-6 w-6 text-primary-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight truncate">
                {org?.name ?? "Decent microsystem"}
              </h1>
              {branch && (
                <Badge variant="outline" className="text-xs shrink-0 hidden sm:flex">
                  {branch.name}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString("en-KE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          {/* Shown on every screen size (incl. phones) — the button already
              hides itself when the app is installed or can't be installed. */}
          <InstallButton variant="ghost" />
          <DepartmentSwitcher />

          <div className="text-right hidden sm:block">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Today's Sales
            </p>
            <p className="text-2xl font-bold text-primary leading-tight">
              {ksh(total)}
            </p>
            {credit > 0 && (
              <p className="text-[10px] text-destructive font-medium">
                {ksh(credit)} on credit
              </p>
            )}
          </div>

          <ThemeToggle />

          {/* Who's signed in — name + role, visible at a glance (no click). */}
          <div className="text-right hidden lg:block max-w-[160px]">
            <p className="text-sm font-semibold leading-tight truncate">
              {profile?.full_name ?? "User"}
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {ROLE_LABEL[profile?.role ?? ""] ?? profile?.role}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-full h-9 w-9">
                <User className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <p className="font-medium text-sm truncate">{profile?.full_name ?? "User"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {ROLE_LABEL[profile?.role ?? ""] ?? profile?.role}
                  {branch ? ` · ${branch.name}` : ""}
                </p>
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={signOut}
                className="text-destructive focus:text-destructive gap-2"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};
