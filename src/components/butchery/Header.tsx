import { useEffect, useState } from "react";
import { Hotel, LogOut, Moon, Sun, User, UtensilsCrossed, Wine, ChevronDown } from "lucide-react";
import { useTheme } from "next-themes";
import { ksh } from "@/lib/format";
import { useSales } from "@/lib/butchery-store";
import { todayISO, Department, DEPARTMENT_SHORT_LABELS, isCancelled } from "@/lib/butchery-types";
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

export const Header = ({ leading }: { leading?: React.ReactNode } = {}) => {
  const { sales } = useSales(todayISO());
  const { profile, org, branch, signOut } = useAuth();
  // Exclude cancelled sales — a void receipt never counts, so this matches the
  // Report and Transactions totals exactly (no more "Header shows more than Report").
  const live = sales.filter((s) => !isCancelled(s));
  const total = live.reduce((a, s) => a + s.subtotal, 0);
  const credit = live
    .filter((s) => s.payment === "credit" && !s.paid)
    .reduce((a, s) => a + s.subtotal, 0);

  return (
    <header className="border-b bg-gradient-surface sticky top-0 z-30 backdrop-blur shadow-soft">
      <div className="container flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3 min-w-0">
          {leading}
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

        {/* Right side — three tidy clusters divided by hairlines:
            [ context ] | [ today's money ] | [ theme + account ] */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <InstallButton variant="ghost" />

          {/* Department context — only where it means something (POS sellers). */}
          {profile?.role !== "room_manager" && <DepartmentSwitcher />}

          {/* Today's sales — a POS metric, so not shown to a room manager
              (their room income lives on the Rooms page instead). */}
          {profile?.role !== "room_manager" && (
            <div className="hidden sm:flex items-center gap-3">
              <span className="h-8 w-px bg-border" aria-hidden />
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
                  Today's Sales
                </p>
                <p className="text-xl font-bold text-primary leading-tight tabular-nums">
                  {ksh(total)}
                </p>
                {credit > 0 && (
                  <p className="text-[10px] text-destructive font-medium leading-none">
                    {ksh(credit)} on credit
                  </p>
                )}
              </div>
            </div>
          )}

          <span className="hidden sm:block h-8 w-px bg-border" aria-hidden />

          <ThemeToggle />

          {/* Account — one clickable pill (avatar + name/role + caret) → menu. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 sm:pr-2.5 hover:bg-muted transition-colors"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-foreground font-bold shrink-0">
                  {profile?.full_name?.trim()?.[0]?.toUpperCase() ?? <User className="h-4 w-4" />}
                </span>
                <span className="hidden lg:block text-left leading-tight max-w-[130px]">
                  <span className="block text-sm font-semibold truncate">
                    {profile?.full_name ?? "User"}
                  </span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {ROLE_LABEL[profile?.role ?? ""] ?? profile?.role}
                  </span>
                </span>
                <ChevronDown className="hidden lg:block h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
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
