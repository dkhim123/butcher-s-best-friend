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
import { Truck, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useProducts, usePurchaseOrders } from "@/lib/butchery-store";
import { POItem, todayISO, DEPARTMENT_LABELS } from "@/lib/butchery-types";
import { useActiveDepartment } from "@/contexts/DepartmentContext";
import { ksh, qty } from "@/lib/format";
import { toast } from "sonner";

/**
 * PurchaseOrders — record ONE supplier delivery with MANY lines.
 *
 * e.g. "Hussein Distributors: 30 broilers, 10 kienyeji, 40kg rice, 100 Royco".
 * Saving raises stock for every tracked line at once. Department-scoped: the
 * Bar records bottles/crates, the Restaurant records ingredients.
 */
export const PurchaseOrders = () => {
  const { active: activeDepartment } = useActiveDepartment();
  const { products } = useProducts();
  const { orders, add, remove } = usePurchaseOrders();
  const [date, setDate] = useState<string>(todayISO());

  // Only stock-tracked products can be delivered — a supplier brings ingredients
  // (Restaurant) or bottles/crates (Bar), never made-to-order meals. Meals are
  // untracked (trackStock=false), so this cleanly keeps plates out of the list.
  const deptProducts = useMemo(
    () =>
      products.filter(
        (p) => p.department === activeDepartment && p.trackStock,
      ),
    [products, activeDepartment],
  );
  const productById = (id: string) => products.find((p) => p.id === id);

  // Draft PO being built.
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<POItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Current line entry
  const [lineProduct, setLineProduct] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lineCost, setLineCost] = useState("");

  const addLine = () => {
    const q = Number(lineQty);
    const c = Number(lineCost);
    if (!lineProduct) return toast.error("Pick a product");
    if (!Number.isFinite(q) || q <= 0) return toast.error("Enter quantity");
    if (!Number.isFinite(c) || c < 0) return toast.error("Enter cost per unit");
    setLines((ls) => [
      ...ls,
      { productId: lineProduct, quantity: q, costPerUnit: c, amount: q * c },
    ]);
    setLineProduct("");
    setLineQty("");
    setLineCost("");
  };

  const removeLine = (idx: number) =>
    setLines((ls) => ls.filter((_, i) => i !== idx));

  const draftTotal = lines.reduce((a, l) => a + l.amount, 0);

  const savePO = async () => {
    if (!supplier.trim()) return toast.error("Enter the supplier name");
    if (lines.length === 0) return toast.error("Add at least one line");
    setSaving(true);
    try {
      await add({
        supplier: supplier.trim(),
        department: activeDepartment,
        notes: notes.trim() || undefined,
        items: lines,
      });
      toast.success(`Purchase order saved — ${lines.length} line(s), stock updated`);
      setSupplier("");
      setNotes("");
      setLines([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save purchase order");
    } finally {
      setSaving(false);
    }
  };

  const dayOrders = orders.filter((o) => o.date === date);
  const daySpend = dayOrders.reduce((a, o) => a + o.totalCost, 0);

  return (
    <div className="space-y-6">
      {/* Build a new PO */}
      <Card className="p-6 shadow-elevated">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-lg bg-gradient-warm grid place-items-center">
            <Truck className="h-5 w-5 text-accent-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">Record Delivery — {DEPARTMENT_LABELS[activeDepartment]}</h2>
            <p className="text-xs text-muted-foreground">
              One supplier, many items. Stock goes up when you save.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Supplier</Label>
            <Input
              placeholder="e.g. Hussein Distributors"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input
              placeholder="Invoice no., delivery note…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Line entry */}
        <div className="mt-4 rounded-lg border bg-accent/20 p-3">
          <p className="text-xs font-medium mb-2">Add a line</p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 sm:items-end">
            <div className="space-y-1">
              <Label className="text-[11px]">Product</Label>
              <Select value={lineProduct} onValueChange={setLineProduct}>
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {deptProducts.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      No stocked items yet. Add ingredients in Inventory → Products.
                    </div>
                  ) : (
                    deptProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} <span className="text-muted-foreground">({p.unit})</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Qty</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={lineQty}
                onChange={(e) => setLineQty(e.target.value)}
                className="w-24 no-spinner"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Cost / unit</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={lineCost}
                onChange={(e) => setLineCost(e.target.value)}
                className="w-28 no-spinner"
              />
            </div>
            <Button onClick={addLine} variant="outline" className="gap-1">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {/* Draft lines */}
        {lines.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-1.5">Product</th>
                  <th className="text-right py-1.5">Qty</th>
                  <th className="text-right py-1.5">Cost/unit</th>
                  <th className="text-right py-1.5">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const p = productById(l.productId);
                  return (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-1.5 font-medium">{p?.name ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {qty(l.quantity, p?.unit ?? "")}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{ksh(l.costPerUnit)}</td>
                      <td className="py-1.5 text-right tabular-nums font-semibold">
                        {ksh(l.amount)}
                      </td>
                      <td className="py-1.5 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => removeLine(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <div>
            <p className="text-xs text-muted-foreground">Delivery total</p>
            <p className="text-2xl font-bold text-primary">{ksh(draftTotal)}</p>
          </div>
          <Button onClick={savePO} disabled={saving} className="bg-gradient-primary h-11">
            {saving ? "Saving…" : "Save delivery"}
          </Button>
        </div>
      </Card>

      {/* Recorded POs */}
      <Card className="p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold">Deliveries</h3>
            <p className="text-xs text-muted-foreground">
              {dayOrders.length} delivery(ies) · Total spent {ksh(daySpend)}
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

        {dayOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No deliveries recorded for this date
          </p>
        ) : (
          <div className="space-y-2">
            {dayOrders.map((o) => (
              <PurchaseOrderCard
                key={o.id}
                supplier={o.supplier}
                total={o.totalCost}
                lines={o.items.map((i) => ({
                  name: productById(i.productId)?.name ?? "—",
                  unit: productById(i.productId)?.unit ?? "",
                  quantity: i.quantity,
                  amount: i.amount,
                }))}
                onRemove={() => {
                  remove(o.id);
                  toast.success("Delivery removed");
                }}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

function PurchaseOrderCard({
  supplier,
  total,
  lines,
  onRemove,
}: {
  supplier: string;
  total: number;
  lines: { name: string; unit: string; quantity: number; amount: number }[];
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg">
      <div className="flex items-center gap-2 p-3">
        <Badge variant="secondary" className="shrink-0">
          {supplier}
        </Badge>
        <span className="text-xs text-muted-foreground">{lines.length} line(s)</span>
        <span className="ml-auto font-bold text-primary tabular-nums">{ksh(total)}</span>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onRemove}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {open && (
        <div className="border-t px-3 py-2 space-y-1">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="font-medium">{l.name}</span>
              <span className="text-muted-foreground">
                {qty(l.quantity, l.unit)} · {ksh(l.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
