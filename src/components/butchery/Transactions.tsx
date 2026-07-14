import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Check, Ban } from "lucide-react";
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
import { ksh, qty } from "@/lib/format";
import { ReceiptDialog } from "./ReceiptDialog";
import { toast } from "sonner";

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
    const t = { cash: 0, mpesa: 0, card: 0, credit: 0, all: 0 };
    rows.forEach((s) => {
      // A cancelled sale is void — it never counts toward the money totals.
      if (isCancelled(s)) return;
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
    <div className="space-y-6">
      {/* Shift vs custom-dates toggle (anchor A). */}
      {shiftStart && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-sm">
            {(["shift", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPeriod(m)}
                className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                  period === m
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "shift" ? "This shift" : "Custom dates"}
              </button>
            ))}
          </div>
          {useShift && shiftStartLabel && (
            <span className="text-xs text-muted-foreground">Since shift started · {shiftStartLabel}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Total" value={totals.all} highlight />
        <Stat label="Cash" value={totals.cash} />
        <Stat label="M-Pesa" value={totals.mpesa} />
        <Stat label="Card" value={totals.card} />
        <Stat label="Credit" value={totals.credit} danger />
      </div>

      <Card className="p-4 shadow-soft">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} max={to} disabled={useShift} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} min={from} disabled={useShift} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Payment</Label>
            <Select value={pay} onValueChange={setPay}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="mpesa">M-Pesa</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="split">Split</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Search receipt / customer / ref</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="R250420-1001..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden shadow-elevated">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No transactions match the filters
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="text-left p-3 font-semibold">Receipt</th>
                  <th className="text-left p-3 font-semibold">Time</th>
                  <th className="text-left p-3 font-semibold">Items</th>
                  <th className="text-left p-3 font-semibold">Payment</th>
                  <th className="text-right p-3 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={`border-t hover:bg-muted/40 align-top cursor-pointer ${
                      isCancelled(s) ? "opacity-55" : ""
                    }`}
                  >
                    <td className="p-3 font-mono text-xs">
                      {s.receiptNo}
                      {nameById(s.createdBy) && (
                        <div className="text-[10px] text-muted-foreground font-sans mt-0.5">
                          by {nameById(s.createdBy)}
                        </div>
                      )}
                      {isCancelled(s) && (
                        <Badge variant="destructive" className="mt-1 gap-1 text-[10px] font-sans">
                          <Ban className="h-2.5 w-2.5" /> Cancelled
                        </Badge>
                      )}
                      {s.cancelState === "requested" && (
                        <Badge variant="secondary" className="mt-1 gap-1 text-[10px] font-sans">
                          <Ban className="h-2.5 w-2.5" /> Cancel pending
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {new Date(s.timestamp).toLocaleTimeString("en-KE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3 text-xs">
                      {s.items
                        .map((it, i) => {
                          const p = products.find((x) => x.id === it.productId);
                          const label = p?.name ?? it.description ?? "—";
                          return (
                            <div key={i}>
                              <span className="font-medium">{label}</span>{" "}
                              {p && (
                                <span className="text-muted-foreground">
                                  ({qty(it.quantity, it.servingName ?? p.unit ?? "")})
                                </span>
                              )}
                            </div>
                          );
                        })}
                    </td>
                    <td className="p-3">
                      <Badge
                        variant={s.payment === "credit" && !s.paid ? "destructive" : "secondary"}
                      >
                        {s.payment.toUpperCase()}
                        {s.payment === "credit" && s.paid && " ✓"}
                      </Badge>
                      {s.payment === "credit" && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {s.customerName}
                        </p>
                      )}
                      {s.payment === "mpesa" && (
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                          {s.mpesaRef}
                        </p>
                      )}
                      {s.payment === "split" && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {(s.payments ?? [])
                            .map((p) => `${p.method === "cash" ? "Cash" : "M-Pesa"} ${ksh(p.amount)}`)
                            .join(" + ")}
                        </p>
                      )}
                    </td>
                    <td className="p-3 text-right font-bold text-primary tabular-nums">
                      {ksh(s.subtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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

function Stat({
  label,
  value,
  highlight,
  danger,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <Card
      className={`p-4 shadow-soft ${highlight ? "bg-gradient-primary text-primary-foreground" : ""}`}
    >
      <p
        className={`text-[10px] uppercase tracking-wider ${highlight ? "opacity-80" : "text-muted-foreground"}`}
      >
        {label}
      </p>
      <p
        className={`text-2xl font-bold ${danger && !highlight ? "text-destructive" : ""}`}
      >
        {ksh(value)}
      </p>
    </Card>
  );
}
