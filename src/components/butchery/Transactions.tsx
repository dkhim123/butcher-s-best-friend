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
import { Receipt as ReceiptIcon, Search, Check } from "lucide-react";
import { useProducts, useSales } from "@/lib/butchery-store";
import { Sale, todayISO } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";
import { ReceiptDialog } from "./ReceiptDialog";
import { toast } from "sonner";

export const Transactions = () => {
  const { products } = useProducts();
  const { allSales, update } = useSales();

  const [date, setDate] = useState<string>(todayISO());
  const [pay, setPay] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Sale | null>(null);

  const rows = useMemo(() => {
    return allSales
      .filter((s) => (date ? s.date === date : true))
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
  }, [allSales, date, pay, search]);

  const totals = useMemo(() => {
    const t = { cash: 0, mpesa: 0, credit: 0, all: 0 };
    rows.forEach((s) => {
      t[s.payment] += s.subtotal;
      t.all += s.subtotal;
    });
    return t;
  }, [rows]);

  const markPaid = (id: string) => {
    update(id, { paid: true });
    toast.success("Marked as paid");
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
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
                  <tr key={s.id} className="border-t hover:bg-muted/40 align-top">
                    <td className="p-3 font-mono text-xs">{s.receiptNo}</td>
                    <td className="p-3 text-xs">
                      {new Date(s.timestamp).toLocaleTimeString("en-KE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3 text-xs">
                      {s.items.map((it, i) => {
                        const p = products.find((x) => x.id === it.productId);
                        return (
                          <div key={i}>
                            <span className="font-medium">{p?.name ?? "—"}</span>{" "}
                            <span className="text-muted-foreground">
                              ({qty(it.quantity, p?.unit ?? "")})
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
                    </td>
                    <td className="p-3 text-right font-bold text-primary tabular-nums">
                      {ksh(s.subtotal)}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => setSelected(s)}>
                        <ReceiptIcon className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                      {s.payment === "credit" && !s.paid && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-1"
                          onClick={() => markPaid(s.id)}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" /> Paid
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ReceiptDialog
        sale={selected}
        products={products}
        open={!!selected}
        onClose={() => setSelected(null)}
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
