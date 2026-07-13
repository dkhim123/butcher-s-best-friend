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
import { Receipt as ReceiptIcon, Search, Check, Ban, X as XIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProducts, useSales } from "@/lib/butchery-store";
import { Sale, deptLineTotal, deptPaidVia, isCancelled, todayISO } from "@/lib/butchery-types";
import { useActiveDepartment } from "@/contexts/DepartmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { ksh, qty } from "@/lib/format";
import { ReceiptDialog } from "./ReceiptDialog";
import { toast } from "sonner";

export const Transactions = () => {
  const { active: activeDepartment } = useActiveDepartment();
  const { org, profile, role } = useAuth();
  const { products } = useProducts();
  const { allSales, update, requestCancel, approveCancel, rejectCancel } = useSales();
  const isManagerOrAbove = role === "admin" || role === "manager";

  // Date RANGE filter (defaults to today→today = a single day).
  const [from, setFrom] = useState<string>(todayISO());
  const [to, setTo] = useState<string>(todayISO());
  const [pay, setPay] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Sale | null>(null);
  // Compare with the earlier date first so an inverted range still works.
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;

  // Product IDs in the active department — used to keep this history scoped to
  // the Bar or the Restaurant, matching the header switcher.
  const deptProductIds = useMemo(
    () => new Set(products.filter((p) => p.department === activeDepartment).map((p) => p.id)),
    [products, activeDepartment],
  );

  const rows = useMemo(() => {
    return allSales
      .filter((s) => s.items.some((i) => deptProductIds.has(i.productId)))
      .filter((s) => s.date >= lo && s.date <= hi)
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
  }, [allSales, deptProductIds, lo, hi, pay, search]);

  // Thin bindings over the SHARED sale maths (butchery-types) so this screen and
  // the Report can never compute a department's slice differently.
  const deptAmount = (s: Sale) => deptLineTotal(s, deptProductIds);
  const deptPaid = (s: Sale, method: "cash" | "mpesa" | "credit") =>
    deptPaidVia(s, method, deptProductIds);

  const totals = useMemo(() => {
    const t = { cash: 0, mpesa: 0, credit: 0, all: 0 };
    rows.forEach((s) => {
      // A cancelled sale is void — it never counts toward the money totals.
      if (isCancelled(s)) return;
      t.cash += deptPaid(s, "cash");
      t.mpesa += deptPaid(s, "mpesa");
      t.credit += deptPaid(s, "credit");
      t.all += deptAmount(s);
    });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, deptProductIds]);

  const markPaid = (id: string) => {
    update(id, { paid: true });
    toast.success("Marked as paid");
  };

  // ── Cancellation workflow ────────────────────────────────────────────────
  // A cashier REQUESTS a cancel (with a reason); an admin/manager APPROVES it
  // (which reverses the stock the sale removed) or REJECTS it. A manager can
  // do both in one step, so for them the button reads "Cancel" and voids
  // immediately.
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    const id = cancelTarget.id;
    setBusyId(id);
    try {
      await requestCancel(id, cancelReason.trim() || undefined);
      if (isManagerOrAbove) {
        await approveCancel(id);
        toast.success("Sale cancelled — stock returned");
      } else {
        toast.success("Cancellation requested — a manager must approve it");
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
      <div className="grid sm:grid-cols-4 gap-3">
        <Stat label="Total" value={totals.all} highlight />
        <Stat label="Cash" value={totals.cash} />
        <Stat label="M-Pesa" value={totals.mpesa} />
        <Stat label="Credit" value={totals.credit} danger />
      </div>

      <Card className="p-4 shadow-soft">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-t hover:bg-muted/40 align-top ${
                      isCancelled(s) ? "opacity-55" : ""
                    }`}
                  >
                    <td className="p-3 font-mono text-xs">{s.receiptNo}</td>
                    <td className="p-3 text-xs">
                      {new Date(s.timestamp).toLocaleTimeString("en-KE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3 text-xs">
                      {s.items
                        .filter((it) => deptProductIds.has(it.productId))
                        .map((it, i) => {
                          const p = products.find((x) => x.id === it.productId);
                          return (
                            <div key={i}>
                              <span className="font-medium">{p?.name ?? "—"}</span>{" "}
                              <span className="text-muted-foreground">
                                ({qty(it.quantity, it.servingName ?? p?.unit ?? "")})
                              </span>
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
                      {ksh(deptAmount(s))}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => setSelected(s)}>
                          <ReceiptIcon className="h-3.5 w-3.5 mr-1" /> View
                        </Button>

                        {s.payment === "credit" && !s.paid && !isCancelled(s) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => markPaid(s.id)}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" /> Paid
                          </Button>
                        )}

                        {/* Cancellation controls depend on the sale's state + role. */}
                        {isCancelled(s) ? (
                          <Badge variant="destructive" className="gap-1">
                            <Ban className="h-3 w-3" /> Cancelled
                          </Badge>
                        ) : s.cancelState === "requested" ? (
                          isManagerOrAbove ? (
                            <>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={busyId === s.id}
                                onClick={() => doApprove(s.id)}
                                title={s.cancelReason ? `Reason: ${s.cancelReason}` : undefined}
                              >
                                <Ban className="h-3.5 w-3.5 mr-1" /> Approve cancel
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === s.id}
                                onClick={() => doReject(s.id)}
                              >
                                <XIcon className="h-3.5 w-3.5 mr-1" /> Reject
                              </Button>
                            </>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <Ban className="h-3 w-3" /> Cancel pending
                            </Badge>
                          )
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={busyId === s.id}
                            onClick={() => {
                              setCancelReason("");
                              setCancelTarget(s);
                            }}
                          >
                            <Ban className="h-3.5 w-3.5 mr-1" />
                            {isManagerOrAbove ? "Cancel" : "Request cancel"}
                          </Button>
                        )}
                      </div>
                      {s.cancelState === "rejected" && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Previous cancel request rejected
                        </p>
                      )}
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
              {isManagerOrAbove ? "Cancel this sale?" : "Request a cancellation"}
            </DialogTitle>
          </DialogHeader>
          {cancelTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Receipt{" "}
                <span className="font-mono font-medium text-foreground">
                  {cancelTarget.receiptNo}
                </span>{" "}
                · {ksh(deptAmount(cancelTarget))}.{" "}
                {isManagerOrAbove
                  ? "The stock it sold will be returned to inventory and the money will stop counting."
                  : "A manager will need to approve it before it takes effect."}
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">Reason {isManagerOrAbove ? "(optional)" : "(recommended)"}</Label>
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
                    : isManagerOrAbove
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
