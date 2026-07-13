import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  BarChart3,
  TrendingUp,
  AlertCircle,
  Beef,
  PieChart,
  ChefHat,
} from "lucide-react";
import {
  useDailyStockReport,
  useKitchenUsage,
  useProducts,
  usePurchaseOrders,
  useSales,
  useSalesByCategory,
  useTopFoodGroups,
} from "@/lib/butchery-store";
import { DEPARTMENT_LABELS, FOOD_GROUP_LABELS, FoodGroup, isIngredient, paidVia, Product, todayISO } from "@/lib/butchery-types";
import { useActiveDepartment } from "@/contexts/DepartmentContext";
import { ksh, qty } from "@/lib/format";

export const DailyReport = () => {
  const { active: activeDepartment } = useActiveDepartment();
  const [date, setDate] = useState<string>(todayISO());
  const { products: allProducts } = useProducts();
  const { sales: allDaySales } = useSales(date);
  const { orders: dayOrders } = usePurchaseOrders(date);

  // Everything on this report is scoped to the department in focus, so the
  // Bar's report shows only Bar money & stock, and the Restaurant's only food.
  const products = useMemo(
    () => allProducts.filter((p) => p.department === activeDepartment),
    [allProducts, activeDepartment],
  );
  const deptProductIds = useMemo(
    () => new Set(products.map((p) => p.id)),
    [products],
  );
  // A sale belongs to a department if any of its line items is a product from
  // that department (sales are rung on a department-scoped till, so all items
  // in one sale share a department). Cancelled sales are dropped entirely —
  // their stock was returned and their money never counts.
  const sales = useMemo(
    () =>
      allDaySales.filter(
        (s) =>
          s.cancelState !== "cancelled" &&
          s.items.some((i) => deptProductIds.has(i.productId)),
      ),
    [allDaySales, deptProductIds],
  );
  // This department's deliveries recorded on this date (multi-line POs).
  const deptOrders = useMemo(
    () => dayOrders.filter((o) => o.department === activeDepartment),
    [dayOrders, activeDepartment],
  );
  // Single source of truth for stock numbers in the report — the
  // event log. Replaces the old useStock(date).getOpening which was
  // reading from a legacy table that no part of the system writes to
  // anymore, hence the all-zeros bug in the Opening / Purchased /
  // Available / Remaining columns.
  const { byProductId: dailyStock } = useDailyStockReport(date);
  const { rows: byCategory } = useSalesByCategory(date, date, activeDepartment);
  const { rows: byFoodGroup } = useTopFoodGroups(date, date, activeDepartment);

  const rows = useMemo(() => {
    return products.map((p) => {
      // Sale-side numbers — these apply to EVERY product, tracked or
      // not. `sale_items` is the authoritative source for both
      // revenue and "how many of this thing actually went out today".
      // We deliberately use this for the displayed "Sold" column on
      // BOTH tracked and untracked products so the column header
      // means one consistent thing: "what customers actually bought".
      // Waste and negative adjustments live in the Stock Movements
      // log, not in this column.
      const items = sales.flatMap((s) =>
        s.items.filter((i) => i.productId === p.id),
      );
      const revenue = items.reduce((a, i) => a + i.amount, 0);
      // For bar drinks poured by measure, "sold" is counted in BOTTLES so it
      // matches Opening/Purchased/Remaining (which are in bottles). A tot of a
      // 750ml bottle counts as 30/750 of a bottle. Everything else is whole units.
      const soldFromSales = items.reduce((a, i) => {
        if (p.containerMl) {
          return a + i.quantity * ((i.servingMl ?? p.containerMl) / p.containerMl);
        }
        return a + i.quantity;
      }, 0);

      // Untracked products (meals): no opening stock, no purchases,
      // no end-of-day remaining concept — they are made to order.
      // Show real plate counts only for Sold; everything else
      // renders as an em-dash so the cashier doesn't get a
      // misleading "0 plate" line.
      // Cost of goods sold + profit, only where a buying price is known.
      // `soldFromSales` is already in the same unit as `costPrice` (bottles
      // for pours, plates for meals, whole units otherwise), so this one
      // formula is correct for every product kind.
      const cogs = p.costPrice != null ? soldFromSales * p.costPrice : null;
      const profit = cogs != null ? revenue - cogs : null;

      if (!p.trackStock) {
        return {
          product: p,
          opening: null as number | null,
          purchased: null as number | null,
          sold: soldFromSales,
          remaining: null as number | null,
          revenue,
          cogs,
          profit,
          transactions: items.length,
        };
      }

      // Tracked product. Opening and Purchased come from the
      // stock_movements event log (so they include supplier
      // deliveries and opening-stock seeds). Sold and Remaining are
      // derived from sale_items so the visible formula
      //   Opening + Purchased − Sold = Remaining
      // ALWAYS balances on screen for tracked products.
      //
      // Important trade-off: if someone records waste or a
      // negative adjustment, this Remaining will be HIGHER than the
      // live stock-on-hand the POS shows. That divergence is
      // intentional — the discrepancy itself is the signal that
      // something other than a sale happened, and the Inventory →
      // Stock log tab makes that visible at a glance.
      const stock = dailyStock(p.id);
      const opening = stock.opening;
      const purchased = stock.purchased;
      const remaining = Math.max(opening + purchased - soldFromSales, 0);
      return {
        product: p,
        opening: opening as number | null,
        purchased: purchased as number | null,
        sold: soldFromSales,
        remaining: remaining as number | null,
        revenue,
        cogs,
        profit,
        transactions: items.length,
      };
    });
  }, [products, sales, dailyStock]);

  // This department's slice of a sale (line amounts for its products only), so a
  // mixed Food+Bar bill counts correctly in each department's totals.
  const deptAmount = (s: (typeof sales)[number]) =>
    s.items
      .filter((i) => deptProductIds.has(i.productId))
      .reduce((a, i) => a + i.amount, 0);

  // This department's share of a sale paid by a given method — apportions a
  // split payment (part cash / part M-Pesa) by the department's slice.
  const deptPaidVia = (s: (typeof sales)[number], method: "cash" | "mpesa" | "credit") =>
    s.subtotal > 0 ? paidVia(s, method) * (deptAmount(s) / s.subtotal) : 0;

  const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0);
  const cashTotal = sales.reduce((a, s) => a + deptPaidVia(s, "cash"), 0);
  const mpesaTotal = sales.reduce((a, s) => a + deptPaidVia(s, "mpesa"), 0);
  const creditTotal = sales.reduce((a, s) => a + deptPaidVia(s, "credit"), 0);
  const creditUnpaid = sales
    .filter((s) => !s.paid)
    .reduce((a, s) => a + deptPaidVia(s, "credit"), 0);
  const purchaseSpend = deptOrders.reduce((a, o) => a + o.totalCost, 0);

  // Profit only counts products whose buying price is known, so we don't
  // pretend an unknown-cost item is 100% margin. We surface how many items
  // are missing a cost so the owner knows to fill them in.
  const costKnownRows = rows.filter((r) => r.profit != null && r.revenue > 0);
  const revenueWithCost = costKnownRows.reduce((a, r) => a + r.revenue, 0);
  const totalCogs = costKnownRows.reduce((a, r) => a + (r.cogs ?? 0), 0);
  const grossProfit = costKnownRows.reduce((a, r) => a + (r.profit ?? 0), 0);
  const marginPct = revenueWithCost > 0 ? (grossProfit / revenueWithCost) * 100 : 0;
  const missingCostCount = rows.filter((r) => r.revenue > 0 && r.profit == null).length;

  // ── Food cost (kitchen usage vs food sales) ───────────────────────────────
  // The classic restaurant health check. The chef logs how much of each
  // ingredient was used today (Kitchen tab); we cost that usage (used × buying
  // price) and compare it against the day's food sales. A rising food-cost %
  // is the early signal for over-portioning, waste, or theft.
  const { rows: usageRows } = useKitchenUsage(date);
  const ingredients = useMemo(() => products.filter(isIngredient), [products]);

  const usageLines = useMemo(() => {
    return usageRows
      .map((u) => {
        const p = allProducts.find((x) => x.id === u.productId);
        if (!p || !isIngredient(p) || p.department !== activeDepartment) return null;
        const cost = p.costPrice != null ? u.qtyUsed * p.costPrice : null;
        return { product: p, qtyUsed: u.qtyUsed, cost };
      })
      .filter((l): l is { product: Product; qtyUsed: number; cost: number | null } => l !== null)
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  }, [usageRows, allProducts, activeDepartment]);

  const ingredientCost = usageLines.reduce((a, l) => a + (l.cost ?? 0), 0);
  const usageMissingCost = usageLines.filter((l) => l.cost == null).length;
  // Food sales = this department's sold revenue (ingredients are never sold, so
  // for the Restaurant this is exactly meals + sides).
  const foodSales = totalRevenue;
  const foodCostPct = foodSales > 0 ? (ingredientCost / foodSales) * 100 : null;
  // Standard kitchen benchmarks: ≤35% healthy, 36–45% keep an eye, >45% high.
  const foodCostHealth =
    foodCostPct == null
      ? null
      : foodCostPct <= 35
        ? { label: "Healthy", cls: "text-success", bar: "bg-success" }
        : foodCostPct <= 45
          ? { label: "Watch", cls: "text-amber-600", bar: "bg-amber-500" }
          : { label: "High", cls: "text-destructive", bar: "bg-destructive" };

  return (
    <div className="space-y-6">
      <Card className="p-5 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" /> End-of-Day Report
              <Badge variant="secondary" className="text-[10px]">
                {DEPARTMENT_LABELS[activeDepartment]}
              </Badge>
            </h2>
            <p className="text-xs text-muted-foreground">
              Stock movement, sales, and accountability summary
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 shadow-soft bg-gradient-primary text-primary-foreground">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider opacity-80">Total Revenue</p>
            <Wallet className="h-4 w-4 opacity-80" />
          </div>
          <p className="text-3xl font-bold">{ksh(totalRevenue)}</p>
          <p className="text-[10px] opacity-80 mt-1">{sales.length} transactions</p>
        </Card>
        <Card className="p-5 shadow-soft">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Cash</p>
          <p className="text-2xl font-bold">{ksh(cashTotal)}</p>
        </Card>
        <Card className="p-5 shadow-soft">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">M-Pesa</p>
          <p className="text-2xl font-bold">{ksh(mpesaTotal)}</p>
        </Card>
        <Card className={`p-5 shadow-soft ${creditUnpaid > 0 ? "border-destructive/40" : ""}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Credit</p>
            {creditUnpaid > 0 && <AlertCircle className="h-4 w-4 text-destructive" />}
          </div>
          <p className="text-2xl font-bold">{ksh(creditTotal)}</p>
          {creditUnpaid > 0 && (
            <p className="text-[11px] text-destructive font-semibold mt-1">
              {ksh(creditUnpaid)} unpaid
            </p>
          )}
        </Card>
      </div>

      {/* Profitability — revenue minus cost of goods sold, for products that
          have a buying price recorded. */}
      <Card className="overflow-hidden shadow-soft">
        <div className="p-4 border-b bg-gradient-surface flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <div>
            <h3 className="font-semibold">Profit today</h3>
            <p className="text-xs text-muted-foreground">
              Selling price − buying price, on items with a cost recorded
            </p>
          </div>
        </div>
        <div className="grid sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x">
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Sales (costed items)
            </p>
            <p className="text-xl font-bold">{ksh(revenueWithCost)}</p>
          </div>
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Cost of goods
            </p>
            <p className="text-xl font-bold text-destructive">{ksh(totalCogs)}</p>
          </div>
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Gross profit
            </p>
            <p className={`text-xl font-bold ${grossProfit >= 0 ? "text-success" : "text-destructive"}`}>
              {ksh(grossProfit)}
            </p>
          </div>
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Margin
            </p>
            <p className="text-xl font-bold">{marginPct.toFixed(1)}%</p>
          </div>
        </div>
        {missingCostCount > 0 && (
          <div className="px-4 pb-3 -mt-1">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              {missingCostCount} sold item{missingCostCount === 1 ? "" : "s"} have no buying
              price yet — add one in Inventory → Products to include them in profit.
            </p>
          </div>
        )}
      </Card>

      {/* Food cost — kitchen ingredient usage vs food sales. Only shown for
          departments that actually stock ingredients (the Restaurant). */}
      {ingredients.length > 0 && (
        <Card className="overflow-hidden shadow-soft">
          <div className="p-4 border-b bg-gradient-surface flex items-center gap-2">
            <ChefHat className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold">Food cost today</h3>
              <p className="text-xs text-muted-foreground">
                Ingredients used (from the Kitchen tab) vs food sales
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x">
            <div className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Ingredients used (cost)
              </p>
              <p className="text-xl font-bold text-destructive">{ksh(ingredientCost)}</p>
            </div>
            <div className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Food sales
              </p>
              <p className="text-xl font-bold">{ksh(foodSales)}</p>
            </div>
            <div className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Food cost %
              </p>
              {foodCostPct == null ? (
                <p className="text-xl font-bold text-muted-foreground">—</p>
              ) : (
                <p className={`text-xl font-bold ${foodCostHealth?.cls}`}>
                  {foodCostPct.toFixed(0)}%
                  <span className="ml-2 text-xs font-semibold align-middle">
                    {foodCostHealth?.label}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Proportion bar — how much of each shilling of food sales was eaten
              up by ingredient cost. */}
          {foodCostPct != null && (
            <div className="px-4 pb-3">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all ${foodCostHealth?.bar}`}
                  style={{ width: `${Math.min(foodCostPct, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Per-ingredient breakdown of what drove the cost. */}
          {usageLines.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              No ingredient usage logged for this date. The chef records it in
              Inventory → Kitchen.
            </p>
          ) : (
            <div className="overflow-x-auto border-t">
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-secondary-foreground">
                  <tr>
                    <th className="text-left p-3 font-semibold">Ingredient</th>
                    <th className="text-right p-3 font-semibold">Used</th>
                    <th className="text-right p-3 font-semibold">Buying price</th>
                    <th className="text-right p-3 font-semibold">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usageLines.map((l) => (
                    <tr key={l.product.id} className="border-t hover:bg-muted/40">
                      <td className="p-3 font-medium">{l.product.name}</td>
                      <td className="p-3 text-right tabular-nums">
                        {qty(l.qtyUsed, l.product.unit)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-muted-foreground">
                        {l.product.costPrice != null
                          ? `${ksh(l.product.costPrice)} / ${l.product.unit}`
                          : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums font-semibold">
                        {l.cost != null ? (
                          ksh(l.cost)
                        ) : (
                          <span className="text-amber-600 text-xs">no cost set</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-gradient-surface font-bold">
                    <td className="p-3" colSpan={3}>
                      Total ingredient cost
                    </td>
                    <td className="p-3 text-right tabular-nums text-destructive">
                      {ksh(ingredientCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {usageMissingCost > 0 && (
            <div className="px-4 pb-3">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                {usageMissingCost} used ingredient{usageMissingCost === 1 ? "" : "s"} have no
                buying price yet — add one in Inventory → Products for an accurate food cost.
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Two new senior-dev widgets: "by category" + "by food group" */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* WIDGET 1 — How much beef vs chicken vs goat sold today? */}
        <Card className="overflow-hidden shadow-soft">
          <div className="p-4 border-b bg-gradient-surface">
            <h3 className="font-semibold flex items-center gap-2">
              <Beef className="h-4 w-4 text-primary" /> Sales by category
            </h3>
            <p className="text-xs text-muted-foreground">
              Beef vs chicken vs goat (and everything else)
            </p>
          </div>
          {byCategory.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No sales recorded for this date.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-secondary-foreground">
                <tr>
                  <th className="text-left p-3 font-semibold">Category</th>
                  <th className="text-right p-3 font-semibold">Qty sold</th>
                  <th className="text-right p-3 font-semibold">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((r) => (
                  <tr key={`${r.category}-${r.foodGroup}`} className="border-t hover:bg-muted/40">
                    <td className="p-3">
                      <div className="font-medium font-mono">{r.category}</div>
                      <Badge variant="secondary" className="text-[10px] mt-0.5">
                        {FOOD_GROUP_LABELS[r.foodGroup as FoodGroup] ?? r.foodGroup}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.qtySold.toLocaleString("en-KE", { maximumFractionDigits: 3 })}
                    </td>
                    <td className="p-3 text-right tabular-nums font-bold text-primary">
                      {ksh(r.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* WIDGET 2 — Top-selling food group */}
        <Card className="overflow-hidden shadow-soft">
          <div className="p-4 border-b bg-gradient-surface">
            <h3 className="font-semibold flex items-center gap-2">
              <PieChart className="h-4 w-4 text-primary" /> Top-selling food group
            </h3>
            <p className="text-xs text-muted-foreground">
              Meat · meals · drinks · groceries
            </p>
          </div>
          {byFoodGroup.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No sales recorded for this date.
            </p>
          ) : (
            <div className="p-3 space-y-2">
              {byFoodGroup.map((r) => (
                <div key={r.foodGroup} className="rounded-md border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">
                      {FOOD_GROUP_LABELS[r.foodGroup as FoodGroup] ?? r.foodGroup}
                    </span>
                    <span className="font-bold text-primary">{ksh(r.revenue)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-gradient-primary transition-all"
                        style={{ width: `${Math.min(r.sharePct, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                      {r.sharePct.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {r.txnCount} item{r.txnCount === 1 ? "" : "s"} sold
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden shadow-elevated">
        <div className="p-4 border-b bg-gradient-surface flex items-center justify-between">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Stock Movement per Product
            </h3>
            <p className="text-xs text-muted-foreground">
              Opening + Purchased − Sold = Remaining
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase text-muted-foreground">Spent on stock</p>
            <p className="font-bold">{ksh(purchaseSpend)}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-secondary-foreground">
              <tr>
                <th className="text-left p-3 font-semibold">Product</th>
                <th className="text-right p-3 font-semibold">Opening</th>
                <th className="text-right p-3 font-semibold">+ Purchased</th>
                <th className="text-right p-3 font-semibold">− Sold</th>
                <th className="text-right p-3 font-semibold">Remaining</th>
                <th className="text-right p-3 font-semibold">Revenue</th>
                <th className="text-right p-3 font-semibold">Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // For untracked items (meals), the stock columns are
                // "not applicable". A muted em-dash makes that obvious
                // at a glance and stops the cashier from thinking the
                // system has lost their data.
                const dash = (
                  <span className="text-muted-foreground/60">—</span>
                );
                return (
                  <tr key={r.product.id} className="border-t hover:bg-muted/40">
                    <td className="p-3">
                      <div className="font-medium">{r.product.name}</div>
                      <Badge variant="secondary" className="text-[10px] mt-0.5">
                        {r.product.type === "per_kg"
                          ? "per kg"
                          : r.product.type === "meal"
                            ? "meal"
                            : "fixed"}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.opening === null ? dash : qty(r.opening, r.product.unit)}
                    </td>
                    <td className="p-3 text-right tabular-nums text-success">
                      {r.purchased === null
                        ? dash
                        : r.purchased > 0
                          ? `+${qty(r.purchased, r.product.unit)}`
                          : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {/* This column ALWAYS shows a real number —
                          including plate counts for meals. */}
                      {qty(r.sold, r.product.unit)}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.remaining === null ? (
                        dash
                      ) : (
                        // Show Remaining in red bold when stock ran out:
                        // there was inventory to sell today (opening +
                        // purchased > 0) but it's all gone now. That's
                        // a "restock soon" signal for the cashier.
                        <span
                          className={
                            (r.opening ?? 0) + (r.purchased ?? 0) > 0 &&
                            r.remaining === 0
                              ? "text-destructive font-bold"
                              : "font-semibold"
                          }
                        >
                          {qty(r.remaining, r.product.unit)}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums font-bold text-primary">
                      {ksh(r.revenue)}
                    </td>
                    <td className="p-3 text-right tabular-nums font-semibold">
                      {r.profit === null ? (
                        dash
                      ) : (
                        <span className={r.profit >= 0 ? "text-success" : "text-destructive"}>
                          {ksh(r.profit)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-gradient-surface font-bold">
                {/* colSpan is the number of columns to the LEFT of
                    Revenue. We removed the Available column, so this
                    drops from 6 to 5. Keeping these in sync prevents
                    the "Total Revenue" label from overshooting into
                    the Revenue cell or leaving a blank gap. */}
                <td className="p-3" colSpan={5}>
                  Total Revenue
                </td>
                <td className="p-3 text-right tabular-nums text-primary">
                  {ksh(totalRevenue)}
                </td>
                <td className="p-3 text-right tabular-nums">
                  <span className={grossProfit >= 0 ? "text-success" : "text-destructive"}>
                    {ksh(grossProfit)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
};
