import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Wallet, ShoppingBag, Receipt as ReceiptIcon } from "lucide-react";
import { useProducts, useSales } from "@/lib/butchery-store";
import { todayISO } from "@/lib/butchery-types";
import { useAuth } from "@/contexts/AuthContext";
import { ksh, qty } from "@/lib/format";

/**
 * MySalesReport — what THIS cashier sold today: items, quantities, and totals.
 * Deliberately simple: no stock levels, no bottle counts, no other cashiers —
 * that fuller inventory view is for admins/managers only.
 */
export const MySalesReport = () => {
  const { profile } = useAuth();
  const { products } = useProducts();
  const [date, setDate] = useState<string>(todayISO());
  const { sales } = useSales(date);

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "—";
  const productUnit = (id: string) => products.find((p) => p.id === id)?.unit ?? "";

  // Only my own, non-cancelled sales for the day.
  const mySales = useMemo(
    () => sales.filter((s) => s.createdBy === profile?.id && s.cancelState !== "cancelled"),
    [sales, profile?.id],
  );

  const totalRevenue = mySales.reduce((a, s) => a + s.subtotal, 0);

  // Aggregate items sold by product.
  const rows = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number; serving?: string }>();
    for (const s of mySales) {
      for (const i of s.items) {
        const key = i.productId + (i.servingName ? `|${i.servingName}` : "");
        const agg = map.get(key) ?? { qty: 0, revenue: 0, serving: i.servingName ?? undefined };
        agg.qty += i.quantity;
        agg.revenue += i.amount;
        map.set(key, agg);
      }
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ productId: key.split("|")[0], ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [mySales]);

  const totalItems = rows.reduce((a, r) => a + r.qty, 0);

  return (
    <div className="space-y-6">
      <Card className="p-5 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-primary" /> My Sales
            </h2>
            <p className="text-xs text-muted-foreground">
              What you sold — {profile?.full_name ?? "you"}
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

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 shadow-soft bg-gradient-primary text-primary-foreground">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-wider opacity-80">My total</p>
            <Wallet className="h-4 w-4 opacity-80" />
          </div>
          <p className="text-2xl font-bold">{ksh(totalRevenue)}</p>
        </Card>
        <Card className="p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receipts</p>
          <p className="text-2xl font-bold">{mySales.length}</p>
        </Card>
        <Card className="p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Items sold</p>
          <p className="text-2xl font-bold">{totalItems.toLocaleString("en-KE", { maximumFractionDigits: 2 })}</p>
        </Card>
      </div>

      <Card className="overflow-hidden shadow-elevated">
        <div className="p-4 border-b bg-gradient-surface">
          <h3 className="font-semibold flex items-center gap-2">
            <ReceiptIcon className="h-4 w-4 text-primary" /> Items you sold
          </h3>
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No sales recorded for this date.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-secondary-foreground text-xs uppercase">
                <tr>
                  <th className="text-left p-3 font-semibold">Item</th>
                  <th className="text-right p-3 font-semibold">Qty sold</th>
                  <th className="text-right p-3 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-muted/40">
                    <td className="p-3">
                      <span className="font-medium">{productName(r.productId)}</span>
                      {r.serving && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">{r.serving}</Badge>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {qty(r.qty, r.serving ?? productUnit(r.productId))}
                    </td>
                    <td className="p-3 text-right tabular-nums font-bold text-primary">
                      {ksh(r.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-gradient-surface font-bold">
                  <td className="p-3">Total</td>
                  <td className="p-3 text-right tabular-nums">{totalItems.toLocaleString("en-KE", { maximumFractionDigits: 2 })}</td>
                  <td className="p-3 text-right tabular-nums text-primary">{ksh(totalRevenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
