import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users, UserPlus, Search, Wallet, Receipt as ReceiptIcon } from "lucide-react";
import { useCustomers, useCustomerLedger } from "@/lib/butchery-store";
import { CustomerBalance, PaymentMethodSimple } from "@/lib/butchery-types";
import { ksh } from "@/lib/format";
import { toast } from "sonner";

/**
 * Customers — loan accounts. Guests who eat/drink on credit accumulate a
 * balance here; the manager records repayments and the balance clears.
 */
export const Customers = () => {
  const { customers, add } = useCustomers();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CustomerBalance | null>(null);

  // New customer form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(t) || (c.phone ?? "").includes(t),
    );
  }, [customers, search]);

  const totalOwed = customers.reduce((a, c) => a + Math.max(c.balance, 0), 0);

  const handleAdd = async () => {
    if (!name.trim()) return toast.error("Enter the customer name");
    setAdding(true);
    try {
      await add({ name: name.trim(), phone: phone.trim() || undefined });
      toast.success("Customer added");
      setName("");
      setPhone("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add customer");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="p-4 shadow-soft bg-gradient-primary text-primary-foreground sm:col-span-1">
          <p className="text-[10px] uppercase tracking-wider opacity-80">Total owed</p>
          <p className="text-2xl font-bold">{ksh(totalOwed)}</p>
          <p className="text-[10px] opacity-80 mt-1">{customers.length} customers</p>
        </Card>
        <Card className="p-4 shadow-soft sm:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <UserPlus className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Add a customer</h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Button onClick={handleAdd} disabled={adding} className="gap-1.5 shrink-0">
              <UserPlus className="h-4 w-4" /> Add
            </Button>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden shadow-elevated">
        <div className="p-4 border-b bg-gradient-surface flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Customer accounts</h2>
          </div>
          <div className="relative w-48">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 h-9"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No customers yet. Add one above, or a credit sale on the POS will create one.
          </p>
        ) : (
          <div className="divide-y">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{c.name}</p>
                  {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                </div>
                <div className="text-right">
                  <Badge
                    variant={c.balance > 0 ? "destructive" : "secondary"}
                    className="tabular-nums"
                  >
                    {c.balance > 0 ? ksh(c.balance) : "Cleared"}
                  </Badge>
                  {c.balance > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">owes</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <CustomerDetail customer={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

function CustomerDetail({
  customer,
  onClose,
}: {
  customer: CustomerBalance | null;
  onClose: () => void;
}) {
  const { payments, creditSales, addPayment } = useCustomerLedger(customer?.id ?? null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethodSimple>("cash");
  const [saving, setSaving] = useState(false);

  const record = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a valid amount");
    setSaving(true);
    try {
      await addPayment({ amount: n, method });
      toast.success(`Payment of ${ksh(n)} recorded`);
      setAmount("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer?.name}</DialogTitle>
        </DialogHeader>
        {customer && (
          <div className="space-y-4">
            {/* Balance */}
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Owed (credit)</span>
                <span className="tabular-nums">{ksh(customer.owed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Repaid</span>
                <span className="tabular-nums">{ksh(customer.repaid)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold">
                <span>Balance</span>
                <span className={`tabular-nums ${customer.balance > 0 ? "text-destructive" : "text-success"}`}>
                  {ksh(customer.balance)}
                </span>
              </div>
            </div>

            {/* Record repayment */}
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-primary" /> Record repayment
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="Amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="no-spinner"
                />
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethodSimple)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={record} disabled={saving} className="w-full bg-gradient-primary">
                {saving ? "Saving…" : "Record payment"}
              </Button>
            </div>

            {/* Ledger */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Credit sales</p>
              {creditSales.length === 0 ? (
                <p className="text-xs text-muted-foreground">No credit sales.</p>
              ) : (
                creditSales.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <ReceiptIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {s.receiptNo}
                    </span>
                    <span className="tabular-nums">{ksh(s.subtotal)}</span>
                  </div>
                ))
              )}

              {payments.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-muted-foreground uppercase pt-2">Repayments</p>
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString("en-KE", {
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        · {p.method}
                      </span>
                      <span className="tabular-nums text-success">-{ksh(p.amount)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
