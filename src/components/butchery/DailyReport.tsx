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
} from "lucide-react";
import {
  useDailyStockReport,
  useProducts,
  usePurchases,
  useSales,
  useSalesByCategory,
  useTopFoodGroups,
} from "@/lib/butchery-store";
import { FOOD_GROUP_LABELS, FoodGroup, todayISO } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";

export const DailyReport = () => {
  const [date, setDate] = useState<string>(todayISO());
  const { products } = useProducts();
  const { sales } = useSales(date);
  const { purchases } = usePurchases(date);
  // Single source of truth for stock numbers in the report — the
  // event log. Replaces the old useStock(date).getOpening which was
  // reading from a legacy table that no part of the system writes to
  // anymore, hence the all-zeros bug in the Opening / Purchased /
  // Available / Remaining columns.
  const { byProductId: dailyStock } = useDailyStockReport(date);
  const { rows: byCategory } = useSalesByCategory(date, date);
  const { rows: byFoodGroup } = useTopFoodGroups(date, date);

  const rows = useMemo(() => {
    return products.map((p) => {
      // Sale-side numbers — these apply to EVERY product, tracked or
      // not. `sale_items` is the authoritative source for both
      // revenue and "how many of this thing actually went out today".
      const items = sales.flatMap((s) =>
        s.items.filter((i) => i.productId === p.id),
      );
      const revenue = items.reduce((a, i) => a + i.amount, 0);
      const soldFromSales = items.reduce((a, i) => a + i.quantity, 0);

      // Stock-side numbers only apply to tracked products (meat,
      // drinks, raw materials). Meals are "made on demand": there is
      // no opening stock of "ugali plates", no purchase of "pilau
      // crates", and no remaining count at end of day. Returning
      // nulls here tells the JSX to render an em-dash instead of a
      // misleading "0 plate".
      if (!p.trackStock) {
        return {
          product: p,
          opening: null as number | null,
          purchased: null as number | null,
          available: null as number | null,
          sold: soldFromSales,
          remaining: null as number | null,
          revenue,
          transactions: items.length,
        };
      }

      // Tracked product: all stock numbers come from the
      // stock_movements event log so Opening + Purchased − Sold ==
      // Remaining is guaranteed by construction.
      const stock = dailyStock(p.id);
      return {
        product: p,
        opening: stock.opening as number | null,
        purchased: stock.purchased as number | null,
        available: (stock.opening + stock.purchased) as number | null,
        sold: stock.sold,
        remaining: stock.remaining as number | null,
        revenue,
        transactions: items.length,
      };
    });
  }, [products, sales, dailyStock]);

  const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0);
  const cashTotal = sales.filter((s) => s.payment === "cash").reduce((a, s) => a + s.subtotal, 0);
  const mpesaTotal = sales.filter((s) => s.payment === "mpesa").reduce((a, s) => a + s.subtotal, 0);
  const creditTotal = sales.filter((s) => s.payment === "credit").reduce((a, s) => a + s.subtotal, 0);
  const creditUnpaid = sales
    .filter((s) => s.payment === "credit" && !s.paid)
    .reduce((a, s) => a + s.subtotal, 0);
  const purchaseSpend = purchases.reduce((a, p) => a + p.totalCost, 0);

  return (
    <div className="space-y-6">
      <Card className="p-5 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" /> End-of-Day Report
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
                <th className="text-right p-3 font-semibold">= Available</th>
                <th className="text-right p-3 font-semibold">− Sold</th>
                <th className="text-right p-3 font-semibold">Remaining</th>
                <th className="text-right p-3 font-semibold">Revenue</th>
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
                    <td className="p-3 text-right tabular-nums font-medium">
                      {r.available === null
                        ? dash
                        : qty(r.available, r.product.unit)}
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
                        <span
                          className={
                            (r.available ?? 0) > 0 && r.remaining === 0
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
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-gradient-surface font-bold">
                <td className="p-3" colSpan={6}>
                  Total Revenue
                </td>
                <td className="p-3 text-right tabular-nums text-primary">
                  {ksh(totalRevenue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
};
