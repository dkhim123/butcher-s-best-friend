import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Beef, Truck, ChefHat, ClipboardCheck } from "lucide-react";
import { ProductsManager } from "./ProductsManager";
import { PurchaseOrders } from "./PurchaseOrders";
import { IngredientUsage } from "./IngredientUsage";
import { StockTake } from "./StockTake";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveDepartment } from "@/contexts/DepartmentContext";

/**
 * Inventory — one place for every "what stock do we have / what
 * stock did we buy" workflow.
 *
 * Replaces the old separate "Products" and "Purchases" top-level
 * tabs. They were doing two halves of the same job and forced the
 * user to think about which side of the system to use. Now:
 *
 *   - Products tab   — the menu (add / edit / delete items)
 *   - Purchases tab  — supplier deliveries (adds stock + cost)
 *   - Kitchen tab    — chef's ingredient usage (Restaurant only)
 *   - Stock-take tab — physical counts
 *
 * (The per-product stock movement summary lives on the Report, so it isn't
 * repeated here.) We persist the active sub-tab in the URL hash too, so a
 * reload on "Purchases" doesn't bounce you back to Products.
 */

type SubTabId = "products" | "purchases" | "usage" | "stocktake";
const DEFAULT_SUB: SubTabId = "products";

const isSubTab = (v: string): v is SubTabId =>
  v === "products" || v === "purchases" || v === "usage" || v === "stocktake";

// Read the part AFTER the slash in the URL hash:
//   "#inventory"          → ""
//   "#inventory/purchases" → "purchases"
function readSubFromHash(): SubTabId {
  if (typeof window === "undefined") return DEFAULT_SUB;
  const hash = window.location.hash.replace(/^#/, "");
  const [, sub] = hash.split("/");
  return sub && isSubTab(sub) ? sub : DEFAULT_SUB;
}

export const Inventory = () => {
  const { hasPermission, role } = useAuth();
  const { active: activeDepartment } = useActiveDepartment();
  const isManagerOrAbove = role === "admin" || role === "manager";

  // Permission gates per sub-tab. Mirrors the top-level checks so
  // that a cashier with only "can_view_products" doesn't accidentally
  // see purchases or the movements log.
  const canSeeProducts = isManagerOrAbove || hasPermission("can_view_products");
  const canSeePurchases =
    isManagerOrAbove ||
    hasPermission("can_create_purchase_orders") ||
    hasPermission("can_receive_purchases");
  const canSeeMovements = isManagerOrAbove || hasPermission("can_view_stock");
  // The chef's ingredient-usage log is a Restaurant-only workflow (the Bar
  // doesn't have "ingredients used" — it sells bottles/measures directly).
  const canSeeUsage = canSeeMovements && activeDepartment === "restaurant";
  // Stock-take is a manager control, in every department.
  const canSeeStockTake = isManagerOrAbove || hasPermission("can_view_stock");

  // Compute the first sub-tab this user can actually open. We use it
  // as the fallback when the URL points at a tab they can't see.
  const firstAllowed: SubTabId = canSeeProducts
    ? "products"
    : canSeePurchases
      ? "purchases"
      : canSeeUsage
        ? "usage"
        : canSeeStockTake
          ? "stocktake"
          : "products";

  const resolveInitial = (): SubTabId => {
    const raw = readSubFromHash();
    if (raw === "products" && canSeeProducts) return "products";
    if (raw === "purchases" && canSeePurchases) return "purchases";
    if (raw === "usage" && canSeeUsage) return "usage";
    if (raw === "stocktake" && canSeeStockTake) return "stocktake";
    return firstAllowed;
  };

  const [sub, setSub] = useState<SubTabId>(resolveInitial);

  // Keep URL ↔ state in sync. We only write to the hash when the
  // user actively clicks a sub-tab; we read from it on mount and on
  // any external hash change (browser back/forward).
  const writeHash = (next: SubTabId) => {
    if (typeof window === "undefined") return;
    const url = `${window.location.pathname}${window.location.search}#inventory/${next}`;
    window.history.replaceState(null, "", url);
  };

  const handleChange = (v: string) => {
    if (!isSubTab(v)) return;
    setSub(v);
    writeHash(v);
  };

  useEffect(() => {
    const onHash = () => setSub(resolveInitial());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeProducts, canSeePurchases, canSeeUsage, canSeeStockTake, canSeeMovements]);

  const tabCount = [canSeeProducts, canSeePurchases, canSeeUsage, canSeeStockTake].filter(Boolean).length;

  return (
    <Tabs value={sub} onValueChange={handleChange} className="space-y-6">
      <TabsList
        className="grid w-full sm:max-w-xl h-auto p-1 gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(tabCount, 1)}, minmax(0, 1fr))` }}
      >
        {canSeeProducts && (
          <TabsTrigger value="products" className="gap-1.5 py-2 text-xs sm:text-sm">
            <Beef className="h-4 w-4" /> Products
          </TabsTrigger>
        )}
        {canSeePurchases && (
          <TabsTrigger value="purchases" className="gap-1.5 py-2 text-xs sm:text-sm">
            <Truck className="h-4 w-4" /> Purchases
          </TabsTrigger>
        )}
        {canSeeUsage && (
          <TabsTrigger value="usage" className="gap-1.5 py-2 text-xs sm:text-sm">
            <ChefHat className="h-4 w-4" /> Kitchen
          </TabsTrigger>
        )}
        {canSeeStockTake && (
          <TabsTrigger value="stocktake" className="gap-1.5 py-2 text-xs sm:text-sm">
            <ClipboardCheck className="h-4 w-4" /> Stock-take
          </TabsTrigger>
        )}
      </TabsList>

      {canSeeProducts && (
        <TabsContent value="products" className="m-0">
          <ProductsManager />
        </TabsContent>
      )}
      {canSeePurchases && (
        <TabsContent value="purchases" className="m-0">
          <PurchaseOrders />
        </TabsContent>
      )}
      {canSeeUsage && (
        <TabsContent value="usage" className="m-0">
          <IngredientUsage />
        </TabsContent>
      )}
      {canSeeStockTake && (
        <TabsContent value="stocktake" className="m-0">
          <StockTake />
        </TabsContent>
      )}
    </Tabs>
  );
};
