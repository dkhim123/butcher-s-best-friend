import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/butchery/Header";
import { Dashboard } from "@/components/butchery/Dashboard";
import { POS } from "@/components/butchery/POS";
import { Inventory } from "@/components/butchery/Inventory";
import { DailyReport } from "@/components/butchery/DailyReport";
import { Transactions } from "@/components/butchery/Transactions";
import { UserManagement } from "@/components/butchery/UserManagement";
import { MySalesReport } from "@/components/butchery/MySalesReport";
import { Customers } from "@/components/butchery/Customers";
import { useAuth } from "@/contexts/AuthContext";
import { usePendingCancellations } from "@/lib/butchery-store";
import { DepartmentProvider } from "@/contexts/DepartmentContext";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  BarChart3,
  ReceiptText,
  Users,
  Wallet,
  Settings,
  Menu,
} from "lucide-react";

// Tab IDs are kept in one place so the URL hash and the sidebar links
// can never drift apart.
//
// "inventory" combines what used to be three separate tabs
// (Products + Purchases + Stock). Its own internal sub-tabs are
// managed inside Inventory.tsx and encoded in the URL as e.g.
// "#inventory/purchases".
type TabId = "dashboard" | "pos" | "inventory" | "transactions" | "report" | "mysales" | "customers" | "users";

// One nav entry per top-level page. Plain-English labels (no jargon) so
// staff can find things at a glance down the side of the screen.
const NAV: { id: TabId; label: string; icon: typeof ShoppingCart }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "pos", label: "POS", icon: ShoppingCart },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "transactions", label: "Transactions", icon: ReceiptText },
  { id: "report", label: "Reports", icon: BarChart3 },
  { id: "mysales", label: "My Sales", icon: BarChart3 },
  { id: "customers", label: "Customers", icon: Wallet },
  { id: "users", label: "Users", icon: Users },
];

const Index = () => {
  const { role, hasPermission } = useAuth();
  const isAdmin = role === "admin";
  const isManagerOrAbove = role === "admin" || role === "manager";

  // Pending cancellation requests → a red count badge on the installed app icon
  // (admins only, since only an admin can act on them). Cleared when none remain.
  const { pending } = usePendingCancellations();
  const pendingCount = isAdmin ? pending.length : 0;
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (pendingCount > 0) nav.setAppBadge?.(pendingCount).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [pendingCount]);

  // Inventory is shown if the user can see ANY of its sub-pages.
  // The Inventory wrapper itself does the per-sub-tab gating.
  const canSeeInventory =
    isManagerOrAbove ||
    hasPermission("can_view_products") ||
    hasPermission("can_create_purchase_orders") ||
    hasPermission("can_receive_purchases") ||
    hasPermission("can_view_stock");
  const canSeeTransactions = isManagerOrAbove || hasPermission("can_view_transactions");
  // The FULL report (stock, bottle levels, profit) is admin/manager only.
  const canSeeReports = isManagerOrAbove;
  // Cashiers get a simple "My Sales" report of their own sales instead.
  const canSeeMySales = role === "cashier";
  const canSeeCustomers = isManagerOrAbove || hasPermission("can_manage_credit");
  // The dashboard is the admin/manager landing page. Cashiers go straight to POS.
  const canSeeDashboard = isManagerOrAbove;
  const defaultTab: TabId = canSeeDashboard ? "dashboard" : "pos";

  // Build the set of top-level tabs this user is allowed to see.
  // Anything outside this set is treated as "doesn't exist" — the
  // URL hash router will silently rewrite to the default.
  const allowedTabs = useMemo<Set<TabId>>(() => {
    const s = new Set<TabId>(["pos"]);
    if (canSeeDashboard) s.add("dashboard");
    if (canSeeInventory) s.add("inventory");
    if (canSeeTransactions) s.add("transactions");
    if (canSeeReports) s.add("report");
    if (canSeeMySales) s.add("mysales");
    if (canSeeCustomers) s.add("customers");
    if (isAdmin) s.add("users");
    return s;
  }, [canSeeDashboard, canSeeInventory, canSeeTransactions, canSeeReports, canSeeMySales, canSeeCustomers, isAdmin]);

  // The nav entries this user may actually open, in order.
  const navItems = useMemo(() => NAV.filter((n) => allowedTabs.has(n.id)), [allowedTabs]);

  // Read the top-level tab from the URL hash. The hash format is
  // either "#tab" (e.g. "#inventory") or "#tab/sub" (e.g.
  // "#inventory/purchases"). Only the part BEFORE the slash is
  // owned by this file — the sub-part is handled by Inventory.tsx.
  const readTabFromHash = (): TabId => {
    if (typeof window === "undefined") return defaultTab;
    const raw = window.location.hash.replace(/^#/, "").split("/")[0] as TabId;
    return allowedTabs.has(raw) ? raw : defaultTab;
  };

  const [activeTab, setActiveTab] = useState<TabId>(readTabFromHash);
  // Mobile: the sidebar slides in as a sheet; closed by default.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleTabChange = (value: string) => {
    const next = (allowedTabs.has(value as TabId) ? value : defaultTab) as TabId;
    setActiveTab(next);
    setMobileNavOpen(false);
    if (typeof window !== "undefined") {
      const newUrl = `${window.location.pathname}${window.location.search}#${next}`;
      window.history.replaceState(null, "", newUrl);
    }
  };

  useEffect(() => {
    const onHashChange = () => setActiveTab(readTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    if (!allowedTabs.has(activeTab)) setActiveTab(defaultTab);
    return () => window.removeEventListener("hashchange", onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTabs]);

  // The list of nav buttons, reused by the desktop sidebar and the mobile sheet.
  const navList = (
    <nav className="space-y-1">
      {navItems.map((n) => {
        const Icon = n.icon;
        const on = n.id === activeTab;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => handleTabChange(n.id)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              on
                ? "bg-white/10 text-[hsl(45_90%_62%)] shadow-[inset_3px_0_0_hsl(45_92%_55%)]"
                : "text-emerald-100/60 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {n.label}
          </button>
        );
      })}
    </nav>
  );

  const settingsLink = isAdmin && (
    <Link
      to="/settings"
      className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-100/60 hover:bg-white/5 hover:text-white transition-colors"
    >
      <Settings className="h-4 w-4 shrink-0" />
      Business Settings
    </Link>
  );

  return (
    <DepartmentProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <Header
          leading={
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-9 w-9 lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
          }
        />

        <div className="flex flex-1 min-h-0">
          {/* Desktop sidebar — dark green, the main way to move around the app. */}
          <aside className="hidden lg:block w-60 shrink-0 bg-[hsl(150_32%_10%)] border-r border-white/5">
            <div className="sticky top-[89px] p-3">
              {navList}
              {settingsLink}
            </div>
          </aside>

          {/* Content area — one Tabs, driven by the sidebar (no top tab strip). */}
          <main className="flex-1 min-w-0">
            <div className="container py-6">
              <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                {canSeeDashboard && (
                  <TabsContent value="dashboard"><Dashboard onNavigate={handleTabChange} /></TabsContent>
                )}
                <TabsContent value="pos"><POS /></TabsContent>
                {canSeeInventory && <TabsContent value="inventory"><Inventory /></TabsContent>}
                {canSeeTransactions && <TabsContent value="transactions"><Transactions /></TabsContent>}
                {canSeeReports && <TabsContent value="report"><DailyReport /></TabsContent>}
                {canSeeMySales && <TabsContent value="mysales"><MySalesReport /></TabsContent>}
                {canSeeCustomers && <TabsContent value="customers"><Customers /></TabsContent>}
                {isAdmin && <TabsContent value="users"><UserManagement /></TabsContent>}
              </Tabs>
            </div>
          </main>
        </div>
      </div>

      {/* Mobile sidebar — same links, slides in from the left. */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-64 p-3 pt-10 bg-[hsl(150_32%_10%)] border-white/5 text-emerald-50">
          {navList}
          {settingsLink}
        </SheetContent>
      </Sheet>
    </DepartmentProvider>
  );
};

export default Index;
