import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wallet, ShoppingBag, Receipt as ReceiptIcon, Printer, Download, UtensilsCrossed, Wine } from "lucide-react";
import { useProducts, useSales } from "@/lib/butchery-store";
import { ACTIVE_DEPARTMENTS, Department, Sale, isCancelled, todayISO } from "@/lib/butchery-types";
import { useAuth } from "@/contexts/AuthContext";
import { downloadCsv, printHtml, REPORT_PRINT_CSS } from "@/lib/report-export";
import { ksh, qty } from "@/lib/format";
import { ReceiptDialog } from "./ReceiptDialog";

/**
 * MySalesReport — what THIS cashier sold: items, quantities, totals, AND a list
 * of their own receipts they can re-open and re-print at any time. Deliberately
 * simple: no stock levels, no other cashiers — that fuller view is admin-only.
 *
 * The "Items you sold" list is split into Restaurant and Bar sections (each with
 * its own subtotal) plus a combined grand total, and the whole thing can be
 * exported to CSV or printed on the 80mm thermal roll for record-keeping.
 */

// Section headings, shared with the printed/exported copies so screen and paper
// always read the same.
const SECTION_TITLE: Record<Department, string> = {
  restaurant: "Main Kitchen (Restaurant)",
  bar: "Main Bar (Wines & Spirits)",
  rooms: "Rooms",
};
const SECTION_ICON: Record<Department, typeof Wine> = {
  restaurant: UtensilsCrossed,
  bar: Wine,
  rooms: Wine,
};

export const MySalesReport = () => {
  const { profile, org } = useAuth();
  const { products } = useProducts();
  // Date RANGE (defaults to today→today) so a cashier can find an older receipt.
  const [from, setFrom] = useState<string>(todayISO());
  const [to, setTo] = useState<string>(todayISO());
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const singleDay = lo === hi;
  // useSales() already scopes a cashier to their OWN sales at the query level.
  const { sales: everySale } = useSales();

  // Re-print state: the receipt currently open.
  const [selected, setSelected] = useState<Sale | null>(null);

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

  // ── Items sold, grouped into Restaurant + Bar sections ──────────────────────
  // One section per active department; within it, items are aggregated by
  // product (a bar pour like "Tot" is its own line). Each section carries its
  // own subtotal; the grand total sums them.
  const sections = useMemo(() => {
    const secs = ACTIVE_DEPARTMENTS.map((dept) => {
      const map = new Map<
        string,
        { name: string; serving?: string; unit: string; qty: number; amount: number }
      >();
      for (const s of mySales) {
        for (const i of s.items) {
          const p = products.find((x) => x.id === i.productId);
          if (!p || p.department !== dept) continue;
          const key = i.productId + (i.servingName ? `|${i.servingName}` : "");
          const agg = map.get(key) ?? {
            name: p.name,
            serving: i.servingName ?? undefined,
            unit: p.unit,
            qty: 0,
            amount: 0,
          };
          agg.qty += i.quantity;
          agg.amount += i.amount;
          map.set(key, agg);
        }
      }
      const items = [...map.values()].sort((a, b) => b.amount - a.amount);
      const total = items.reduce((a, i) => a + i.amount, 0);
      const count = items.reduce((a, i) => a + i.qty, 0);
      return { dept, items, total, count };
    });
    const grand = secs.reduce((a, s) => a + s.total, 0);
    const grandCount = secs.reduce((a, s) => a + s.count, 0);
    return { secs, grand, grandCount };
  }, [mySales, products]);

  // Human label + filename-safe token for the selected period.
  const rangeLabel = singleDay ? lo : `${lo} to ${hi}`;
  const rangeFile = singleDay ? lo : `${lo}_to_${hi}`;
  const qn = (n: number) => Number(n.toFixed(3));

  // ── Export as CSV ──
  const handleExportCsv = () => {
    const now = new Date().toLocaleString("en-KE");
    const out: (string | number | null)[][] = [
      [org?.name ?? "Business"],
      ["My Sales Report"],
      ["Cashier", profile?.full_name ?? ""],
      [singleDay ? "Date" : "Period", rangeLabel],
      ["Generated", now],
      [],
    ];
    for (const sec of sections.secs) {
      out.push([SECTION_TITLE[sec.dept]]);
      out.push(["Item", "Quantity", "Amount"]);
      for (const i of sec.items)
        out.push([i.name + (i.serving ? ` (${i.serving})` : ""), qn(i.qty), Math.round(i.amount)]);
      out.push([`${SECTION_TITLE[sec.dept].split(" (")[0]} total`, "", Math.round(sec.total)]);
      out.push([]);
    }
    out.push(["GRAND TOTAL", "", Math.round(sections.grand)]);
    downloadCsv(`my_sales_${rangeFile}.csv`, out);
  };

  // ── Print on the 80mm thermal roll (also "Save as PDF" → 80mm PDF) ──
  const handlePrint = () => {
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
    const now = new Date().toLocaleString("en-KE");

    let body =
      `<h1>${esc(org?.name ?? "Business")}</h1>` +
      `<p class="sub">My Sales &middot; ${esc(profile?.full_name ?? "")}<br>${esc(rangeLabel)}<br>Generated: ${esc(now)}</p>`;

    for (const sec of sections.secs) {
      body += `<h2>${esc(SECTION_TITLE[sec.dept])}</h2>`;
      if (sec.items.length === 0) {
        body += `<p class="empty">No sales for this period.</p>`;
        continue;
      }
      body +=
        `<table class="grid"><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>` +
        sec.items
          .map(
            (i) =>
              `<tr><td>${esc(i.name)}${i.serving ? ` (${esc(i.serving)})` : ""}</td><td class="num">${qn(
                i.qty,
              )}</td><td class="num">${ksh(i.amount)}</td></tr>`,
          )
          .join("") +
        `</tbody><tfoot><tr><td>${esc(SECTION_TITLE[sec.dept].split(" (")[0])} total</td>` +
        `<td></td><td class="num">${ksh(sec.total)}</td></tr></tfoot></table>`;
    }

    body +=
      `<table class="grand"><tr><td>GRAND TOTAL</td><td class="num">${ksh(sections.grand)}</td></tr></table>` +
      `<p class="foot">Printed ${esc(now)}</p>`;

    printHtml(`My Sales ${rangeLabel}`, body, REPORT_PRINT_CSS);
  };

  const hasSales = mySales.length > 0;

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
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-10"
              onClick={handleExportCsv}
              disabled={!hasSales}
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-10"
              onClick={handlePrint}
              disabled={!hasSales}
            >
              <Printer className="h-4 w-4" /> Print
            </Button>
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
          <p className="text-2xl font-bold">
            {sections.grandCount.toLocaleString("en-KE", { maximumFractionDigits: 2 })}
          </p>
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

      {/* Items you sold — split into Restaurant + Bar, then a combined total. */}
      <Card className="overflow-hidden shadow-elevated">
        <div className="p-4 border-b bg-gradient-surface">
          <h3 className="font-semibold flex items-center gap-2">
            <ReceiptIcon className="h-4 w-4 text-primary" /> Items you sold
          </h3>
          <p className="text-xs text-muted-foreground">
            Grouped by Restaurant and Bar, with a combined total.
          </p>
        </div>
        {!hasSales ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No sales recorded for this period.
          </p>
        ) : (
          <div className="divide-y">
            {sections.secs.map((sec) => {
              const Icon = SECTION_ICON[sec.dept];
              return (
                <div key={sec.dept}>
                  <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <h4 className="font-semibold text-sm">{SECTION_TITLE[sec.dept]}</h4>
                  </div>
                  {sec.items.length === 0 ? (
                    <p className="px-4 pb-4 text-sm text-muted-foreground">
                      Nothing sold in this section.
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
                          {sec.items.map((r, i) => (
                            <tr key={i} className="border-t hover:bg-muted/40">
                              <td className="p-3">
                                <span className="font-medium">{r.name}</span>
                                {r.serving && (
                                  <Badge variant="secondary" className="ml-2 text-[10px]">
                                    {r.serving}
                                  </Badge>
                                )}
                              </td>
                              <td className="p-3 text-right tabular-nums">
                                {qty(r.qty, r.serving ?? r.unit)}
                              </td>
                              <td className="p-3 text-right tabular-nums font-bold text-primary">
                                {ksh(r.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t bg-muted/40 font-semibold">
                            <td className="p-3">
                              {SECTION_TITLE[sec.dept].split(" (")[0]} total
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {sec.count.toLocaleString("en-KE", { maximumFractionDigits: 2 })}
                            </td>
                            <td className="p-3 text-right tabular-nums text-primary">
                              {ksh(sec.total)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Combined grand total across both sections. */}
            <div className="flex items-center justify-between px-4 py-4 bg-gradient-surface">
              <span className="font-bold">Combined total</span>
              <span className="font-bold text-lg text-primary tabular-nums">
                {ksh(sections.grand)}
              </span>
            </div>
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
