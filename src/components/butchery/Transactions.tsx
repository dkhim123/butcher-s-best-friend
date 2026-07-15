import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Check, Ban, ChevronRight, Download, Receipt as ReceiptIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOrgUsers, useProducts, useSales, useShiftWindow } from "@/lib/butchery-store";
import { Sale, isCancelled, todayISO } from "@/lib/butchery-types";
import { useAuth } from "@/contexts/AuthContext";
import { ksh } from "@/lib/format";
import { downloadCsv } from "@/lib/report-export";
import { ReceiptDialog } from "./ReceiptDialog";
import { toast } from "sonner";

// ── Payment "language": forest-green for money-in (cash / M-Pesa / paid credit),
// slate for neutral rails (card / split), soft crimson ONLY for owed credit. ──
type PayMeta = { label: string; cls: string };
const payMeta = (s: Sale): PayMeta => {
  switch (s.payment) {
    case "cash":
      return { label: "CASH", cls: "bg-primary/10 text-primary" };
    case "mpesa":
      return {
        label: "M-PESA",
        cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
      };
    case "card":
      return {
        label: "CARD",
        cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
      };
    case "split":
      return {
        label: "SPLIT",
        cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
      };
    case "credit":
      return s.paid
        ? { label: "CREDIT ✓", cls: "bg-primary/10 text-primary" }
        : { label: "CREDIT", cls: "bg-destructive/10 text-destructive" };
    default:
      return { label: s.payment.toUpperCase(), cls: "bg-muted text-muted-foreground" };
  }
};

const PAY_CHIPS = [
  { v: "all", label: "All" },
  { v: "cash", label: "Cash" },
  { v: "mpesa", label: "M-Pesa" },
  { v: "card", label: "Card" },
  { v: "credit", label: "Credit" },
] as const;

const yesterdayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

const dayLabel = (dateISO: string) => {
  const full = new Date(`${dateISO}T00:00:00`).toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (dateISO === todayISO()) return `Today · ${full}`;
  if (dateISO === yesterdayISO()) return `Yesterday · ${full}`;
  return full;
};

const timeStr = (s: Sale) =>
  new Date(s.timestamp).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });

export const Transactions = () => {
  const { org, profile, role } = useAuth();
  const { products } = useProducts();
  const { nameById } = useOrgUsers();
  const { shiftStart } = useShiftWindow();
  const { allSales, update, requestCancel, approveCancel, rejectCancel } = useSales();
  // Only an ADMIN can actually cancel (void) a sale. Cashiers and managers can
  // REQUEST a cancellation, which an admin then approves or rejects.
  const isAdmin = role === "admin";

  // Date RANGE filter (defaults to today→today = a single day).
  const [from, setFrom] = useState<string>(todayISO());
  const [to, setTo] = useState<string>(todayISO());
  const [pay, setPay] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Sale | null>(null);
  // "This shift" (anchor A — since the shift started) vs custom dates.
  const [period, setPeriod] = useState<"shift" | "custom">("shift");
  const useShift = period === "shift" && !!shiftStart;
  const shiftStartMs = shiftStart ? Date.parse(shiftStart) : 0;
  const shiftStartLabel = shiftStart
    ? new Date(shiftStart).toLocaleString("en-KE", { hour: "2-digit", minute: "2-digit" })
    : null;
  // Compare with the earlier date first so an inverted range still works.
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;

  // A transaction is the WHOLE receipt: we show its FULL amount and ALL its
  // items, never a per-department slice. (A mixed food + drink sale used to
  // show only its restaurant part on the Restaurant view — e.g. a Ksh 900
  // receipt read as Ksh 200 — which looked like money had gone missing.)
  const rows = useMemo(() => {
    return allSales
      .filter((s) => (useShift ? s.timestamp >= shiftStartMs : s.date >= lo && s.date <= hi))
      .filter((s) => (pay === "all" ? true : s.payment === pay))
      .filter((s) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          s.receiptNo.toLowerCase().includes(q) ||
          (s.customerName ?? "").toLowerCase().includes(q) ||
          (s.mpesaRef ?? "").toLowerCase().includes(q)
        );
      });
  }, [allSales, useShift, shiftStartMs, lo, hi, pay, search]);

  const totals = useMemo(() => {
    const t = { cash: 0, mpesa: 0, card: 0, credit: 0, all: 0, count: 0 };
    rows.forEach((s) => {
      // A cancelled sale is void — it never counts toward the money totals.
      if (isCancelled(s)) return;
      t.count += 1;
      t.all += s.subtotal;
      if (s.payment === "split" && s.payments?.length) {
        for (const p of s.payments) {
          if (p.method === "cash") t.cash += p.amount;
          else if (p.method === "mpesa") t.mpesa += p.amount;
        }
      } else if (s.payment === "cash") t.cash += s.subtotal;
      else if (s.payment === "mpesa") t.mpesa += s.subtotal;
      else if (s.payment === "card") t.card += s.subtotal;
      else if (s.payment === "credit") t.credit += s.subtotal;
    });
    return t;
  }, [rows]);

  // Human item names for a sale (product name, falling back to a free-text line).
  const itemNames = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p.name]));
    return (s: Sale) =>
      s.items.map((it) => byId.get(it.productId) ?? it.description ?? "—");
  }, [products]);

  // Group the (already newest-first) rows into day sections for sticky headers.
  const dayGroups = useMemo(() => {
    const map = new Map<string, Sale[]>();
    for (const s of rows) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return [...map.entries()].map(([date, sales]) => ({
      date,
      sales,
      count: sales.length,
      subtotal: sales.reduce((a, s) => a + (isCancelled(s) ? 0 : s.subtotal), 0),
    }));
  }, [rows]);

  const exportCsv = () => {
    const head = ["Receipt", "Date", "Time", "Items", "Payment", "Reference", "Customer", "Amount", "Status"];
    const body = rows.map((s) => [
      s.receiptNo,
      s.date,
      timeStr(s),
      itemNames(s).join("; "),
      s.payment,
      s.mpesaRef ?? "",
      s.customerName ?? "",
      isCancelled(s) ? 0 : Math.round(s.subtotal),
      isCancelled(s) ? "cancelled" : s.cancelState === "requested" ? "cancel pending" : "ok",
    ]);
    downloadCsv(`transactions_${lo}_${hi}.csv`, [head, ...body]);
  };

  const markPaid = (id: string) => {
    update(id, { paid: true });
    toast.success("Marked as paid");
  };

  // ── Cancellation workflow ────────────────────────────────────────────────
  // A cashier or manager REQUESTS a cancel (with a reason); only an ADMIN can
  // APPROVE it (which reverses the stock the sale removed) or REJECT it. For an
  // admin the button reads "Cancel" and voids immediately; for everyone else it
  // reads "Request cancel".
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    const id = cancelTarget.id;
    setBusyId(id);
    try {
      await requestCancel(id, cancelReason.trim() || undefined);
      if (isAdmin) {
        await approveCancel(id);
        toast.success("Sale cancelled — stock returned");
      } else {
        toast.success("Cancellation requested — an admin must approve it");
      }
      setCancelTarget(null);
      setCancelReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel the sale");
    } finally {
      setBusyId(null);
    }
  };

  const doApprove = async (id: string) => {
    setBusyId(id);
    try {
      await approveCancel(id);
      toast.success("Sale cancelled — stock returned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't approve the cancellation");
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async (id: string) => {
    setBusyId(id);
    try {
      await rejectCancel(id);
      toast.success("Cancellation rejected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reject the cancellation");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Hero: solid forest-green Total, then a slim divided breakdown. ── */}
      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_2fr]">
        <Card className="flex flex-col justify-center bg-primary p-5 text-primary-foreground shadow-elevated">
          <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
            Total sales
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{ksh(totals.all)}</p>
          <p className="mt-2 text-xs opacity-80">
            {totals.count} transaction{totals.count === 1 ? "" : "s"}
            {useShift && shiftStartLabel ? ` · since ${shiftStartLabel}` : ""}
          </p>
        </Card>
        <Card className="grid grid-cols-2 divide-y divide-border shadow-soft sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {(
            [
              { label: "Cash", value: totals.cash, danger: false },
              { label: "M-Pesa", value: totals.mpesa, danger: false },
              { label: "Card", value: totals.card, danger: false },
              { label: "Credit", value: totals.credit, danger: true },
            ] as const
          ).map((b) => (
            <div key={b.label} className="flex flex-col justify-center px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {b.label}
              </p>
              <p
                className={`mt-0.5 text-lg font-bold tabular-nums ${
                  b.danger && b.value > 0 ? "text-destructive" : "text-foreground"
                }`}
              >
                {ksh(b.value)}
              </p>
            </div>
          ))}
        </Card>
      </div>

      {/* ── Compact sticky toolbar: period · payment chips · dates · search · export. ── */}
      <div className="sticky top-[81px] z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-soft">
        {useShift && shiftStartLabel && (
          <span className="mr-1 hidden text-[11px] font-medium text-muted-foreground lg:inline">
            Shift from {shiftStartLabel}
          </span>
        )}
        {shiftStart && (
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
            {(["shift", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPeriod(m)}
                className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                  period === m
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "shift" ? "This shift" : "Custom"}
              </button>
            ))}
          </div>
        )}

        {!useShift && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10 w-[9.5rem]"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="h-10 w-[9.5rem]"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {PAY_CHIPS.map((c) => (
            <button
              key={c.v}
              type="button"
              onClick={() => setPay(c.v)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                pay === c.v
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-primary/5 text-muted-foreground hover:bg-primary/10 dark:bg-primary/10"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 pl-9"
            placeholder="Search receipt / customer / ref…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-10 shrink-0"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          <Download className="mr-1.5 h-4 w-4" /> Export
        </Button>
      </div>

      {/* ── Grouped, ultra-scannable list: table on desktop, cards on mobile. ── */}
      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-16 text-center shadow-soft">
          <ReceiptIcon className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No transactions match these filters</p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border shadow-soft">
          {dayGroups.map((g) => (
            <section key={g.date} className="border-t first:border-t-0">
              <div className="flex items-center justify-between gap-3 bg-muted px-4 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {dayLabel(g.date)}
                </span>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  {g.count} · {ksh(g.subtotal)}
                </span>
              </div>

              {/* Desktop: fixed-layout table so every day aligns identically. */}
              <table className="hidden w-full table-fixed text-sm md:table">
                <colgroup>
                  <col className="w-[24%]" />
                  <col className="w-[9%]" />
                  <col />
                  <col className="w-[17%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <tbody>
                  {g.sales.map((s) => {
                    const cancelled = isCancelled(s);
                    const names = itemNames(s);
                    const meta = payMeta(s);
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelected(s)}
                        className={`group cursor-pointer border-t transition-colors hover:bg-primary/5 ${
                          cancelled ? "border-l-2 border-l-destructive/40 opacity-60" : ""
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="truncate font-mono text-xs font-medium">{s.receiptNo}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            {nameById(s.createdBy) && <span className="truncate">by {nameById(s.createdBy)}</span>}
                            {cancelled && (
                              <Badge variant="destructive" className="gap-0.5 px-1 py-0 text-[9px]">
                                <Ban className="h-2.5 w-2.5" /> Cancelled
                              </Badge>
                            )}
                            {s.cancelState === "requested" && (
                              <Badge variant="secondary" className="gap-0.5 px-1 py-0 text-[9px]">
                                <Ban className="h-2.5 w-2.5" /> Pending
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-xs tabular-nums text-muted-foreground">
                          {timeStr(s)}
                        </td>
                        <td className="px-2 py-2.5 text-xs" title={names.join(", ")}>
                          <span className="block truncate">
                            <span className="font-medium text-foreground">{names.slice(0, 2).join(", ")}</span>
                            {names.length > 2 && (
                              <span className="text-muted-foreground"> +{names.length - 2} more</span>
                            )}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}
                          >
                            {meta.label}
                          </span>
                          {s.payment === "credit" && s.customerName && (
                            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{s.customerName}</p>
                          )}
                          {s.payment === "mpesa" && s.mpesaRef && (
                            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{s.mpesaRef}</p>
                          )}
                          {s.payment === "split" && (
                            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                              {(s.payments ?? [])
                                .map((p) => `${p.method === "cash" ? "Cash" : "M-Pesa"} ${ksh(p.amount)}`)
                                .join(" + ")}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            <span
                              className={`font-bold tabular-nums ${
                                cancelled ? "text-muted-foreground line-through" : "text-primary"
                              }`}
                            >
                              {ksh(s.subtotal)}
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Mobile: stacked cards, no horizontal scroll. */}
              <div className="divide-y md:hidden">
                {g.sales.map((s) => {
                  const cancelled = isCancelled(s);
                  const names = itemNames(s);
                  const meta = payMeta(s);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelected(s)}
                      className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors active:bg-primary/5 ${
                        cancelled ? "border-l-2 border-l-destructive/40 opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-xs font-medium">{s.receiptNo}</span>
                        <span
                          className={`shrink-0 font-bold tabular-nums ${
                            cancelled ? "text-muted-foreground line-through" : "text-primary"
                          }`}
                        >
                          {ksh(s.subtotal)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {timeStr(s)}
                          {nameById(s.createdBy) ? ` · ${nameById(s.createdBy)}` : ""}
                        </span>
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground" title={names.join(", ")}>
                        <span className="text-foreground">{names.slice(0, 2).join(", ")}</span>
                        {names.length > 2 && ` +${names.length - 2} more`}
                      </div>
                      {(cancelled || s.cancelState === "requested") && (
                        <Badge
                          variant={cancelled ? "destructive" : "secondary"}
                          className="mt-0.5 w-fit gap-0.5 px-1.5 py-0 text-[9px]"
                        >
                          <Ban className="h-2.5 w-2.5" /> {cancelled ? "Cancelled" : "Cancel pending"}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-destructive" />
              {isAdmin ? "Cancel this sale?" : "Request a cancellation"}
            </DialogTitle>
          </DialogHeader>
          {cancelTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Receipt{" "}
                <span className="font-mono font-medium text-foreground">
                  {cancelTarget.receiptNo}
                </span>{" "}
                · {ksh(cancelTarget.subtotal)}.{" "}
                {isAdmin
                  ? "The stock it sold will be returned to inventory and the money will stop counting."
                  : "An admin will need to approve it before it takes effect."}
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">Reason {isAdmin ? "(optional)" : "(recommended)"}</Label>
                <Textarea
                  placeholder="e.g. wrong item rung up, customer changed their mind…"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCancelTarget(null)}>
                  Keep sale
                </Button>
                <Button
                  variant="destructive"
                  disabled={busyId === cancelTarget.id}
                  onClick={() => void confirmCancel()}
                >
                  <Ban className="h-4 w-4 mr-1" />
                  {busyId === cancelTarget.id
                    ? "Working…"
                    : isAdmin
                      ? "Cancel sale"
                      : "Send request"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
        footer={(() => {
          const s = selected;
          if (!s) return null;
          // Already void — nothing to do.
          if (isCancelled(s)) {
            return (
              <p className="text-sm text-center text-muted-foreground">This sale is cancelled.</p>
            );
          }
          // A cancellation was requested: an admin reviews it here; others wait.
          if (s.cancelState === "requested") {
            return isAdmin ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground mr-auto">
                  {s.cancelReason ? `Reason: ${s.cancelReason}` : "Cancellation requested"}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyId === s.id}
                  onClick={async () => {
                    await doApprove(s.id);
                    setSelected(null);
                  }}
                >
                  <Ban className="h-3.5 w-3.5 mr-1" /> Approve cancel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === s.id}
                  onClick={async () => {
                    await doReject(s.id);
                    setSelected(null);
                  }}
                >
                  Reject
                </Button>
              </div>
            ) : (
              <p className="text-sm text-center text-muted-foreground">
                Cancellation requested — awaiting admin.
              </p>
            );
          }
          // Active sale: print (in the header) + cancel/request + mark-paid.
          return (
            <div className="flex flex-wrap justify-end gap-2">
              {s.payment === "credit" && !s.paid && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    markPaid(s.id);
                    setSelected(null);
                  }}
                >
                  <Check className="h-3.5 w-3.5 mr-1" /> Mark paid
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  setSelected(null);
                  setCancelReason("");
                  setCancelTarget(s);
                }}
              >
                <Ban className="h-3.5 w-3.5 mr-1" />
                {isAdmin ? "Cancel transaction" : "Request cancel"}
              </Button>
            </div>
          );
        })()}
      />
    </div>
  );
};
