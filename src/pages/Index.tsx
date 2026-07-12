import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/butchery/Header";
import { POS } from "@/components/butchery/POS";
import { Inventory } from "@/components/butchery/Inventory";
import { DailyReport } from "@/components/butchery/DailyReport";
import { Transactions } from "@/components/butchery/Transactions";
import { UserManagement } from "@/components/butchery/UserManagement";
import { Customers } from "@/components/butchery/Customers";
import { useAuth } from "@/contexts/AuthContext";
import { DepartmentProvider } from "@/contexts/DepartmentContext";
import { Link } from "react-router-dom";
import {
  ShoppingCart,
  Boxes,
  BarChart3,
  ReceiptText,
  Users,
  Wallet,
  Settings,
} from "lucide-react";

// Tab IDs are kept in one place so the URL hash and TabsTrigger
// values can never drift apart.
//
// "inventory" combines what used to be three separate tabs
// (Products + Purchases + Stock). Its own internal sub-tabs are
// managed inside Inventory.tsx and encoded in the URL as e.g.
// "#inventory/purchases".
type TabId = "pos" | "inventory" | "transactions" | "report" | "customers" | "users";
const DEFAULT_TAB: TabId = "pos";

const Index = () => {
  const { role, hasPermission } = useAuth();
  const isAdmin = role === "admin";
  const isManagerOrAbove = role === "admin" || role === "manager";

  // Inventory is shown if the user can see ANY of its sub-pages.
  // The Inventory wrapper itself does the per-sub-tab gating.
  const canSeeInventory =
    isManagerOrAbove ||
    hasPermission("can_view_products") ||
    hasPermission("can_create_purchase_orders") ||
    hasPermission("can_receive_purchases") ||
    hasPermission("can_view_stock");
  const canSeeTransactions = isManagerOrAbove || hasPermission("can_view_transactions");
  const canSeeReports = isManagerOrAbove || hasPermission("can_view_reports");
  const canSeeCustomers = isManagerOrAbove || hasPermission("can_manage_credit");

  const extraTabCount = [canSeeInventory, canSeeTransactions, canSeeReports, canSeeCustomers, isAdmin].filter(Boolean).length;
  const totalTabs = 1 + extraTabCount;

  // Build the set of top-level tabs this user is allowed to see.
  // Anything outside this set is treated as "doesn't exist" — the
  // URL hash router will silently rewrite to the default.
  const allowedTabs = useMemo<Set<TabId>>(() => {
    const s = new Set<TabId>(["pos"]);
    if (canSeeInventory) s.add("inventory");
    if (canSeeTransactions) s.add("transactions");
    if (canSeeReports) s.add("report");
    if (canSeeCustomers) s.add("customers");
    if (isAdmin) s.add("users");
    return s;
  }, [canSeeInventory, canSeeTransactions, canSeeReports, canSeeCustomers, isAdmin]);

  // Read the top-level tab from the URL hash. The hash format is
  // either "#tab" (e.g. "#inventory") or "#tab/sub" (e.g.
  // "#inventory/purchases"). Only the part BEFORE the slash is
  // owned by this file — the sub-part is handled by Inventory.tsx.
  const readTabFromHash = (): TabId => {
    if (typeof window === "undefined") return DEFAULT_TAB;
    const raw = window.location.hash.replace(/^#/, "").split("/")[0] as TabId;
    return allowedTabs.has(raw) ? raw : DEFAULT_TAB;
  };

  const [activeTab, setActiveTab] = useState<TabId>(readTabFromHash);

  const handleTabChange = (value: string) => {
    const next = (allowedTabs.has(value as TabId) ? value : DEFAULT_TAB) as TabId;
    setActiveTab(next);
    if (typeof window !== "undefined") {
      const newUrl = `${window.location.pathname}${window.location.search}#${next}`;
      window.history.replaceState(null, "", newUrl);
    }
  };

  useEffect(() => {
    const onHashChange = () => setActiveTab(readTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    if (!allowedTabs.has(activeTab)) setActiveTab(DEFAULT_TAB);
    return () => window.removeEventListener("hashchange", onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTabs]);

  return (
    <DepartmentProvider>
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList
            className={`grid w-full h-auto p-1 gap-1`}
            style={{ gridTemplateColumns: `repeat(${Math.min(totalTabs, 6)}, minmax(0, 1fr))` }}
          >
            <TabsTrigger value="pos" className="gap-1.5 py-2.5 text-xs sm:text-sm">
              <ShoppingCart className="h-4 w-4" />
              POS
            </TabsTrigger>

            {canSeeInventory && (
              <TabsTrigger value="inventory" className="gap-1.5 py-2.5 text-xs sm:text-sm">
                <Boxes className="h-4 w-4" />
                Inventory
              </TabsTrigger>
            )}

            {canSeeTransactions && (
              <TabsTrigger value="transactions" className="gap-1.5 py-2.5 text-xs sm:text-sm">
                <ReceiptText className="h-4 w-4" />
                <span className="hidden sm:inline">History</span>
                <span className="sm:hidden">Tx</span>
              </TabsTrigger>
            )}

            {canSeeReports && (
              <TabsTrigger value="report" className="gap-1.5 py-2.5 text-xs sm:text-sm">
                <BarChart3 className="h-4 w-4" />
                Report
              </TabsTrigger>
            )}

            {canSeeCustomers && (
              <TabsTrigger value="customers" className="gap-1.5 py-2.5 text-xs sm:text-sm">
                <Wallet className="h-4 w-4" />
                Customers
              </TabsTrigger>
            )}

            {isAdmin && (
              <TabsTrigger value="users" className="gap-1.5 py-2.5 text-xs sm:text-sm">
                <Users className="h-4 w-4" />
                Users
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="pos"><POS /></TabsContent>
          {canSeeInventory && <TabsContent value="inventory"><Inventory /></TabsContent>}
          {canSeeTransactions && <TabsContent value="transactions"><Transactions /></TabsContent>}
          {canSeeReports && <TabsContent value="report"><DailyReport /></TabsContent>}
          {canSeeCustomers && <TabsContent value="customers"><Customers /></TabsContent>}
          {isAdmin && (
            <TabsContent value="users"><UserManagement /></TabsContent>
          )}
        </Tabs>

        {isAdmin && (
          <div className="mt-6 flex justify-end">
            <Link
              to="/settings"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-4 w-4" />
              Business Settings
            </Link>
          </div>
        )}
      </main>
    </div>
    </DepartmentProvider>
  );
};

export default Index;
