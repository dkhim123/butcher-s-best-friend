import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wallet, ShoppingBag, Receipt as ReceiptIcon, Printer } from "lucide-react";
import { useProducts, useSales } from "@/lib/butchery-store";
import { Sale, isCancelled, todayISO } from "@/lib/butchery-types";
import { useAuth } from "@/contexts/AuthContext";
import { ksh, qty } from "@/lib/format";
import { ReceiptDialog } from "./ReceiptDialog";

/**
 * MySalesReport — what THIS cashier sold: items, quantities, totals, AND a list
 * of their own receipts they can re-open and re-print at any time. Deliberately
 * simple: no stock levels, no other cashiers — that fuller view is admin-only.
 */
export const MySalesReport = () => {
  const { profile, org } = useAuth();
  const { products } = useProducts();
  // Date RANGE (defaults to today→today) so a cashier can find an older receipt.
  const [from, setFrom] = useState<string>(todayISO());
  const [to, setTo] = useState<string>(todayISO());
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  // useSales() already scopes a cashier to their OWN sales at the query level.
  const { sales: everySale } = useSales();

  // Re-print state: the receipt currently open.
  const [selected, setSelected] = useState<Sale | null>(null);

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "—";
  const productUnit = (id: string) => products.find((p) => p.id === id)?.unit ?? "";

  // My own, non-cancelled sales within the range (newest first).
  const mySales = useMemo(
    () =>
      everySale.filter(
        (s) =>
          s.createdBy === profile?.id &&
          !isCancelled(s) &&
          s.date >= lo &&
          s.date <= hi,
      ),
    [everySale, profile?.id, lo, hi],
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
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="w-40"
              />
            </div>
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

      {/* My receipts — tap any to re-open and re-print at your own time. */}
      <Card className="overflow-hidden shadow-elevated">
        <div className="p-4 border-b bg-gradient-surface">
          <h3 className="font-semibold flex items-center gap-2">
            <ReceiptIcon className="h-4 w-4 text-primary" /> My receipts
          </h3>
          <p className="text-xs text-muted-foreground">
            Tap a receipt to view it again and re-print.
          </p>
        </div>
        {mySales.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No receipts in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-secondary-foreground text-xs uppercase">
                <tr>
                  <th className="text-left p-3 font-semibold">Receipt</th>
                  <th className="text-left p-3 font-semibold">When</th>
                  <th className="text-left p-3 font-semibold">Pay</th>
                  <th className="text-right p-3 font-semibold">Items</th>
                  <th className="text-right p-3 font-semibold">Total</th>
                  <th className="text-right p-3 font-semibold w-28"></th>
                </tr>
              </thead>
              <tbody>
                {mySales.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t hover:bg-muted/40 cursor-pointer"
                    onClick={() => setSelected(s)}
                  >
                    <td className="p-3 font-mono font-medium">{s.receiptNo}</td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(s.timestamp).toLocaleString("en-KE", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {s.payment}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {s.items.reduce((a, i) => a + i.quantity, 0).toLocaleString("en-KE", {
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="p-3 text-right tabular-nums font-bold text-primary">
                      {ksh(s.subtotal)}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(s);
                        }}
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Print</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden shadow-elevated">
        <div className="p-4 border-b bg-gradient-surface">
          <h3 className="font-semibold flex items-center gap-2">
            <ReceiptIcon className="h-4 w-4 text-primary" /> Items you sold
          </h3>
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No sales recorded for this period.
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

      {/* Re-print dialog — opens the chosen receipt; its own Print button prints. */}
      <ReceiptDialog
        sale={selected}
        products={products}
        open={!!selected}
        onClose={() => setSelected(null)}
        shopName={org?.name}
        logoUrl={org?.logo_url}
        tagline={org?.tagline}
        phone={org?.phone}
        mpesaPaybill={org?.mpesa_paybill}
        mpesaPaybillAccount={org?.mpesa_paybill_account}
        mpesaTill={org?.mpesa_till}
      />
    </div>
  );
};
