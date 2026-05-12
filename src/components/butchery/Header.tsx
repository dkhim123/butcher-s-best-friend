import { Beef, LogOut, User } from "lucide-react";
import { ksh } from "@/lib/format";
import { useSales } from "@/lib/butchery-store";
import { todayISO } from "@/lib/butchery-types";
import { useAuth } from "@/contexts/AuthContext";
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
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  pending: "Pending",
};

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
              <Beef className="h-6 w-6 text-primary-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight truncate">
                {org?.name ?? "Spot Butchery"}
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

        <div className="flex items-center gap-4 shrink-0">
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
