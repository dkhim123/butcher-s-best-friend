import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShoppingCart,
  Boxes,
  BarChart3,
  Wallet,
  Banknote,
  Smartphone,
  Clock,
  CreditCard,
  ArrowRight,
  ChevronRight,
  Ban,
} from "lucide-react";
import {
  useOrgUsers,
  usePendingCancellations,
  useProducts,
  useSales,
  useShiftWindow,
} from "@/lib/butchery-store";
import { Sale, isCancelled, todayISO } from "@/lib/butchery-types";
import { useAuth } from "@/contexts/AuthContext";
import { ksh } from "@/lib/format";
import { toast } from "sonner";
import { ReceiptDialog } from "./ReceiptDialog";

/**
 * Dashboard — the admin's landing page. A calm, at-a-glance home:
 *   • Big coloured shortcuts to the busiest pages (New sale, Inventory, …)
 *   • Today's money at a glance (total, cash, M-Pesa, credit, receipts)
 *   • The most recent receipts
 *
 * It computes nothing new — it just re-presents today's sales the same way
 * the Report and Header do, so the numbers always agree.
 */

// How each sale's money splits across methods. A split sale carries its own
// breakdown; everything else counts wholly under its single method.
function payBreakdown(sales: Sale[]) {
  const t = { cash: 0, mpesa: 0, card: 0, credit: 0 };
  for (const s of sales) {
    if (isCancelled(s)) continue;
    if (s.payment === "split" && s.payments?.length) {
      for (const p of s.payments) {
        if (p.method === "cash") t.cash += p.amount;
        else if (p.method === "mpesa") t.mpesa += p.amount;
      }
    } else if (s.payment === "cash") t.cash += s.subtotal;
    else if (s.payment === "mpesa") t.mpesa += s.subtotal;
    else if (s.payment === "card") t.card += s.subtotal;
    else if (s.payment === "credit") t.credit += s.subtotal;
  }
  return t;
}

export const Dashboard = ({ onNavigate }: { onNavigate: (tab: string) => void }) => {
  const { profile, org, role } = useAuth();
  const { products } = useProducts();
  const { nameById } = useOrgUsers();
  const { sales, approveCancel, rejectCancel } = useSales(todayISO());
  const { shiftStart } = useShiftWindow();
  const { pending } = usePendingCancellations();
  // The receipt currently opened from the recent list (to see what was sold).
  const [selected, setSelected] = useState<Sale | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const doApprove = async (id: string) => {
    setBusyId(id);
    try {
      await approveCancel(id);
      toast.success("Sale cancelled — stock returned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel");
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
      toast.error(err instanceof Error ? err.message : "Couldn't reject");
    } finally {
      setBusyId(null);
    }
  };
  // Show totals since the shift started (anchor A) by default; the owner can
  // flip to the whole calendar day. If no shift is open, we only have "Today".
  const [period, setPeriod] = useState<"shift" | "today">("shift");
  const useShift = period === "shift" && !!shiftStart;
  const shiftStartMs = shiftStart ? Date.parse(shiftStart) : 0;

  // Sales in the chosen window (this shift, or the whole day).
  const scoped = useMemo(
    () => (useShift ? sales.filter((s) => s.timestamp >= shiftStartMs) : sales),
    [sales, useShift, shiftStartMs],
  );

  const live = useMemo(() => scoped.filter((s) => !isCancelled(s)), [scoped]);
  const total = live.reduce((a, s) => a + s.subtotal, 0);
  const pay = useMemo(() => payBreakdown(scoped), [scoped]);
  const recent = useMemo(
    () => [...live].sort((a, b) => b.timestamp - a.timestamp).slice(0, 6),
    [live],
  );
  const shiftStartLabel = shiftStart
    ? new Date(shiftStart).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
    : null;

  const shortcuts = [
    {
      tab: "pos",
      title: "New Sale",
      sub: "Start a transaction",
      icon: ShoppingCart,
      cls: "from-blue-500/15 to-blue-500/5 border-blue-500/30 text-blue-600 dark:text-blue-300",
    },
    {
      tab: "inventory",
      title: "Inventory",
      sub: "Manage stock",
      icon: Boxes,
      cls: "from-violet-500/15 to-violet-500/5 border-violet-500/30 text-violet-600 dark:text-violet-300",
    },
    {
      tab: "report",
      title: "Reports",
      sub: "View analytics",
      icon: BarChart3,
      cls: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    },
    {
      tab: "customers",
      title: "Customers",
      sub: "Credit & accounts",
      icon: Wallet,
      cls: "from-amber-500/15 to-amber-500/5 border-amber-500/40 text-amber-700 dark:text-amber-300",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Greeting + shift/day toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Welcome{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            {useShift && shiftStartLabel
              ? `This shift — since ${shiftStartLabel}`
              : shiftStart
                ? "Today's totals (whole day)"
                : "Today's totals — no shift open"}
          </p>
        </div>
        {shiftStart && (
          <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-sm">
            {(["shift", "today"] as const).map((m) => (
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
                {m === "shift" ? "This shift" : "Today"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cancellation requests — red alert; only an admin can approve/reject. */}
      {pending.length > 0 && (
        <Card className="overflow-hidden border-destructive/50 bg-destructive/5 shadow-soft">
          <div className="p-4 border-b border-destructive/20 flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" />
            <h3 className="font-semibold text-destructive">
              Cancellation request{pending.length === 1 ? "" : "s"} ({pending.length})
            </h3>
          </div>
          <div className="divide-y divide-destructive/10">
            {pending.map((s) => (
              <div key={s.id} className="p-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium">
                    {s.receiptNo} · {ksh(s.subtotal)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Requested by {nameById(s.createdBy) || "cashier"}
                    {s.cancelReason ? ` · “${s.cancelReason}”` : ""}
                  </p>
                </div>
                {role === "admin" ? (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === s.id}
                      onClick={() => doApprove(s.id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === s.id}
                      onClick={() => doReject(s.id)}
                    >
                      Reject
                    </Button>
                  </div>
                ) : (
                  <Badge variant="secondary" className="shrink-0">
                    Awaiting admin
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Coloured shortcuts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {shortcuts.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.tab}
              type="button"
              onClick={() => onNavigate(s.tab)}
              className={`group text-left rounded-2xl border bg-gradient-to-br ${s.cls} p-4 shadow-soft transition-all hover:shadow-elevated hover:-translate-y-0.5`}
            >
              <div className="flex items-center justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-background/70 shadow-soft">
                  <Icon className="h-6 w-6" />
                </span>
                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="mt-3 font-bold text-foreground">{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.sub}</p>
            </button>
          );
        })}
      </div>

      {/* Today's money */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="p-4 shadow-soft bg-gradient-primary text-primary-foreground">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-wider opacity-80">
              {useShift ? "This shift" : "Today's sales"}
            </p>
            <Wallet className="h-4 w-4 opacity-80" />
          </div>
          <p className="text-2xl font-bold">{ksh(total)}</p>
          <p className="text-[10px] opacity-80 mt-1">{live.length} receipts</p>
        </Card>
        <StatTile label="Cash" value={pay.cash} icon={Banknote} />
        <StatTile label="M-Pesa" value={pay.mpesa} icon={Smartphone} />
        <StatTile label="Card" value={pay.card} icon={CreditCard} />
        <StatTile label="Credit" value={pay.credit} icon={Clock} danger={pay.credit > 0} />
      </div>

      {/* Recent transactions — tap one to see exactly what was sold. */}
      <Card className="overflow-hidden shadow-soft">
        <div className="p-4 border-b bg-gradient-surface flex items-center justify-between">
          <h3 className="font-semibold">Recent Transactions</h3>
          <button
            type="button"
            onClick={() => onNavigate("transactions")}
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            See all <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No sales yet today. Tap “New Sale” to start.
          </p>
        ) : (
          <div className="p-3 space-y-2">
            {recent.map((s) => {
              const lines = s.items.length;
              const seller = nameById(s.createdBy);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s)}
                  className="w-full text-left rounded-xl border bg-card px-4 py-3 flex items-center gap-3 transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">
                      {s.payment === "mpesa" ? "M-Pesa" : s.payment.charAt(0).toUpperCase() + s.payment.slice(1)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {lines} item{lines === 1 ? "" : "s"} ·{" "}
                      {new Date(s.timestamp).toLocaleTimeString("en-KE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {seller ? ` · by ${seller}` : ""}
                    </p>
                  </div>
                  <span className="font-bold text-primary tabular-nums shrink-0">{ksh(s.subtotal)}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Tap-through: shows the items sold on that receipt, with a print option. */}
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

function StatTile({
  label,
  value,
  icon: Icon,
  danger,
}: {
  label: string;
  value: number;
  icon: typeof Banknote;
  danger?: boolean;
}) {
  return (
    <Card className={`p-4 shadow-soft ${danger ? "border-destructive/40" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className={`text-2xl font-bold ${danger ? "text-destructive" : ""}`}>{ksh(value)}</p>
    </Card>
  );
}
