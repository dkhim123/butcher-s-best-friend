import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Wallet, BarChart3, TrendingUp, AlertCircle } from "lucide-react";
import {
  useProducts,
  usePurchases,
  useSales,
  useStock,
} from "@/lib/butchery-store";
import { todayISO } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";

export const DailyReport = () => {
  const [date, setDate] = useState<string>(todayISO());
  const { products } = useProducts();
  const { sales } = useSales(date);
  const { purchases } = usePurchases(date);
  const { getOpening } = useStock(date);

  const rows = useMemo(() => {
    return products.map((p) => {
      const purchased = purchases
        .filter((po) => po.productId === p.id)
        .reduce((a, po) => a + po.quantity, 0);

      const items = sales.flatMap((s) =>
        s.items.filter((i) => i.productId === p.id),
      );
      const sold = items.reduce((a, i) => a + i.quantity, 0);
      const revenue = items.reduce((a, i) => a + i.amount, 0);

      const opening = getOpening(p.id);
      const available = opening + purchased;
      const remaining = Math.max(available - sold, 0);

      return {
        product: p,
        opening,
        purchased,
        available,
        sold,
        remaining,
        revenue,
        transactions: items.length,
      };
    });
  }, [products, sales, purchases, getOpening]);

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
              {rows.map((r) => (
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
                    {qty(r.opening, r.product.unit)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-success">
                    {r.purchased > 0 ? `+${qty(r.purchased, r.product.unit)}` : "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums font-medium">
                    {qty(r.available, r.product.unit)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {qty(r.sold, r.product.unit)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    <span
                      className={
                        r.available > 0 && r.remaining === 0
                          ? "text-destructive font-bold"
                          : "font-semibold"
                      }
                    >
                      {qty(r.remaining, r.product.unit)}
                    </span>
                  </td>
                  <td className="p-3 text-right tabular-nums font-bold text-primary">
                    {ksh(r.revenue)}
                  </td>
                </tr>
              ))}
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
