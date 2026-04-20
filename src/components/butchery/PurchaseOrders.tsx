import { useState } from "react";
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
import { Truck, Plus, Trash2 } from "lucide-react";
import { useProducts, usePurchases } from "@/lib/butchery-store";
import { todayISO } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";
import { toast } from "sonner";

export const PurchaseOrders = () => {
  const { products } = useProducts();
  const [date, setDate] = useState<string>(todayISO());
  const { purchases, add, remove } = usePurchases(date);

  const [form, setForm] = useState({
    productId: "",
    supplier: "",
    quantity: "",
    costPerUnit: "",
    notes: "",
  });

  const product = products.find((p) => p.id === form.productId);
  const total =
    (Number(form.quantity) || 0) * (Number(form.costPerUnit) || 0);

  const submit = () => {
    if (!form.productId) return toast.error("Pick a product");
    if (!form.supplier.trim()) return toast.error("Enter supplier name");
    const q = Number(form.quantity);
    const c = Number(form.costPerUnit);
    if (!Number.isFinite(q) || q <= 0) return toast.error("Enter quantity");
    if (!Number.isFinite(c) || c <= 0) return toast.error("Enter cost");
    add({
      productId: form.productId,
      supplier: form.supplier.trim(),
      quantity: q,
      costPerUnit: c,
      notes: form.notes.trim() || undefined,
    });
    toast.success(`PO recorded — ${qty(q, product?.unit ?? "")} of ${product?.name}`);
    setForm({ productId: "", supplier: "", quantity: "", costPerUnit: "", notes: "" });
  };

  const totalSpent = purchases.reduce((a, p) => a + p.totalCost, 0);

  return (
    <div className="space-y-6">
      <Card className="p-6 shadow-elevated">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-lg bg-gradient-warm grid place-items-center">
            <Truck className="h-5 w-5 text-accent-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">Record Purchase / Delivery</h2>
            <p className="text-xs text-muted-foreground">
              Adds to today's available stock automatically
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Product</Label>
            <Select
              value={form.productId}
              onValueChange={(v) => setForm({ ...form, productId: v })}
            >
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.unit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Supplier</Label>
            <Input
              placeholder="e.g. Kariokor Slaughter"
              value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Quantity ({product?.unit ?? "unit"})</Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="e.g. 20"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cost per {product?.unit ?? "unit"} (Ksh)</Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="e.g. 450"
              value={form.costPerUnit}
              onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes (optional)</Label>
            <Input
              placeholder="Invoice no., delivery notes..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <div>
            <p className="text-xs text-muted-foreground">Total cost</p>
            <p className="text-2xl font-bold text-primary">{ksh(total)}</p>
          </div>
          <Button onClick={submit} className="bg-gradient-primary h-11">
            <Plus className="h-4 w-4 mr-1" /> Record PO
          </Button>
        </div>
      </Card>

      <Card className="p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold">Purchase Orders</h3>
            <p className="text-xs text-muted-foreground">
              {purchases.length} PO(s) · Total spent {ksh(totalSpent)}
            </p>
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
        </div>

        {purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No purchase orders for this date
          </p>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="text-left p-3 font-semibold">Time</th>
                  <th className="text-left p-3 font-semibold">Product</th>
                  <th className="text-left p-3 font-semibold">Supplier</th>
                  <th className="text-right p-3 font-semibold">Qty</th>
                  <th className="text-right p-3 font-semibold">Cost/unit</th>
                  <th className="text-right p-3 font-semibold">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((po) => {
                  const p = products.find((x) => x.id === po.productId);
                  return (
                    <tr key={po.id} className="border-t hover:bg-muted/40">
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(po.timestamp).toLocaleTimeString("en-KE", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-3 font-medium">{p?.name ?? "—"}</td>
                      <td className="p-3">
                        <Badge variant="secondary">{po.supplier}</Badge>
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {qty(po.quantity, p?.unit ?? "")}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {ksh(po.costPerUnit)}
                      </td>
                      <td className="p-3 text-right tabular-nums font-bold text-primary">
                        {ksh(po.totalCost)}
                      </td>
                      <td className="p-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            remove(po.id);
                            toast.success("PO removed");
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
