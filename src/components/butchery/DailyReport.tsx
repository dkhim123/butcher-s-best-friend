import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Wallet, BarChart3 } from "lucide-react";
import { useProducts, useSales, useStock } from "@/lib/butchery-store";
import { todayISO } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";

export const DailyReport = () => {
  const [date, setDate] = useState<string>(todayISO());
  const { products } = useProducts();
  const { sales } = useSales(date);
  const { getOpening } = useStock(date);

  const rows = useMemo(() => {
    return products.map((p) => {
      const ps = sales.filter((s) => s.productId === p.id);
      const sold = ps.reduce((a, s) => a + s.quantity, 0);
      const revenue = ps.reduce((a, s) => a + s.amount, 0);
      const opening = getOpening(p.id);
      const remaining = Math.max(opening - sold, 0);
      return {
        product: p,
        opening,
        sold,
        remaining,
        revenue,
        transactions: ps.length,
      };
    });
  }, [products, sales, getOpening]);

  const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0);
  const totalTx = rows.reduce((a, r) => a + r.transactions, 0);
  const productsSold = rows.filter((r) => r.sold > 0).length;

  return (
    <div className="space-y-6">
      <Card className="p-5 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" /> Daily Report
            </h2>
            <p className="text-xs text-muted-foreground">
              End-of-day stock movement and sales summary
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

      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="p-5 shadow-soft bg-gradient-primary text-primary-foreground">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider opacity-80">Revenue</p>
            <Wallet className="h-4 w-4 opacity-80" />
          </div>
          <p className="text-3xl font-bold">{ksh(totalRevenue)}</p>
        </Card>
        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Transactions
            </p>
            <TrendingUp className="h-4 w-4 text-success" />
          </div>
          <p className="text-3xl font-bold">{totalTx}</p>
        </Card>
        <Card className="p-5 shadow-soft">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Products sold
            </p>
            <TrendingDown className="h-4 w-4 text-accent" />
          </div>
          <p className="text-3xl font-bold">
            {productsSold}
            <span className="text-base text-muted-foreground font-normal">
              {" "}/ {products.length}
            </span>
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden shadow-elevated">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                <th className="text-left p-3 font-semibold">Product</th>
                <th className="text-right p-3 font-semibold">Opening</th>
                <th className="text-right p-3 font-semibold">Sold</th>
                <th className="text-right p-3 font-semibold">Remaining</th>
                <th className="text-right p-3 font-semibold">Tx</th>
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
                  <td className="p-3 text-right tabular-nums font-medium">
                    {qty(r.sold, r.product.unit)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    <span
                      className={
                        r.remaining === 0 && r.opening > 0
                          ? "text-destructive font-semibold"
                          : ""
                      }
                    >
                      {qty(r.remaining, r.product.unit)}
                    </span>
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.transactions}</td>
                  <td className="p-3 text-right tabular-nums font-bold text-primary">
                    {ksh(r.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-gradient-surface font-bold">
                <td className="p-3" colSpan={4}>Total</td>
                <td className="p-3 text-right tabular-nums">{totalTx}</td>
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
