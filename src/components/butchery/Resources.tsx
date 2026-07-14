import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Boxes, Plus, Trash2, ArrowDownToLine, ArrowUpFromLine, AlertCircle } from "lucide-react";
import { useResources, useResourceMovements, ResourceItem } from "@/lib/butchery-store";
import { qty } from "@/lib/format";
import { toast } from "sonner";

/**
 * Resources — non-sellable hotel supplies & equipment (housekeeping + kitchen).
 * Deliberately simple: a list with a current count, and three actions —
 * Received (+), Used (−), Lost (−) — each logged for accountability.
 */
export const Resources = () => {
  const { items } = useResources();
  const { rows: log } = useResourceMovements(60);
  const [adjust, setAdjust] = useState<ResourceItem | null>(null);

  // Group items by their category so housekeeping vs kitchen read separately.
  const groups = useMemo(() => {
    const m = new Map<string, ResourceItem[]>();
    for (const it of items) {
      const k = it.category || "other";
      const arr = m.get(k) ?? [];
      arr.push(it);
      m.set(k, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Boxes className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Resources</h2>
          <p className="text-sm text-muted-foreground">
            Housekeeping supplies &amp; kitchen equipment — owned, never sold.
          </p>
        </div>
      </div>

      <AddResource />

      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground shadow-soft">
          No resources yet. Add one above — e.g. “Tissue rolls”, “Sufuria”, “Mop”.
        </Card>
      ) : (
        groups.map(([cat, list]) => (
          <div key={cat} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground capitalize">
              {cat}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {list.map((it) => {
                const low = it.qtyOnHand <= 0;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setAdjust(it)}
                    className={`rounded-xl border p-4 text-left transition-all hover:shadow-soft active:scale-[0.98] ${
                      low ? "border-destructive/50 bg-destructive/5" : "bg-background hover:border-primary/50"
                    }`}
                  >
                    <p className="font-semibold leading-tight">{it.name}</p>
                    <p className={`text-2xl font-bold mt-1 ${low ? "text-destructive" : ""}`}>
                      {qty(it.qtyOnHand, it.unit)}
                    </p>
                    {low ? (
                      <p className="text-[11px] text-destructive font-medium flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> None left
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">Tap to update</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Accountability log */}
      {log.length > 0 && (
        <Card className="overflow-hidden shadow-soft">
          <div className="p-4 border-b bg-gradient-surface">
            <h3 className="font-semibold">Activity log</h3>
            <p className="text-xs text-muted-foreground">Every stock-in and use, newest first.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-secondary-foreground text-xs uppercase">
                <tr>
                  <th className="text-left p-3 font-semibold">When</th>
                  <th className="text-left p-3 font-semibold">Item</th>
                  <th className="text-left p-3 font-semibold">Action</th>
                  <th className="text-right p-3 font-semibold">Change</th>
                  <th className="text-left p-3 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {log.map((m) => {
                  const up = m.deltaQty >= 0;
                  return (
                    <tr key={m.id} className="border-t">
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(m.occurredAt).toLocaleString("en-KE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="p-3 font-medium">{m.resourceName}</td>
                      <td className="p-3">
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {m.reason === "waste" ? "lost" : m.reason}
                        </Badge>
                      </td>
                      <td className={`p-3 text-right font-bold tabular-nums ${up ? "text-success" : "text-destructive"}`}>
                        {up ? "+" : ""}{qty(m.deltaQty, m.unit)}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[220px] truncate">{m.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AdjustDialog item={adjust} onClose={() => setAdjust(null)} />
    </div>
  );
};

/* ── Add a resource ───────────────────────────────────────────── */
function AddResource() {
  const { addItem } = useResources();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("housekeeping");
  const [unit, setUnit] = useState("piece");
  const [opening, setOpening] = useState("");

  const submit = async () => {
    if (!name.trim()) return toast.error("Enter an item name");
    try {
      await addItem({
        name: name.trim(),
        category,
        unit: unit.trim() || "piece",
        opening: Number(opening) > 0 ? Number(opening) : undefined,
      });
      setName(""); setOpening("");
      toast.success("Resource added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    }
  };

  return (
    <Card className="p-4 shadow-soft grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
      <div className="space-y-1 lg:col-span-2">
        <Label className="text-xs">Item name</Label>
        <Input placeholder="e.g. Tissue rolls, Sufuria, Mop" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="housekeeping">Housekeeping</SelectItem>
            <SelectItem value="incentives">Incentives (free to customers)</SelectItem>
            <SelectItem value="kitchen">Kitchen equipment</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Unit</Label>
        <Input placeholder="piece / roll / bottle" value={unit} onChange={(e) => setUnit(e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Have now</Label>
          <Input type="number" inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} className="no-spinner" />
        </div>
        <Button onClick={submit} className="gap-1.5"><Plus className="h-4 w-4" /> Add</Button>
      </div>
    </Card>
  );
}

/* ── Received / Used / Lost dialog ────────────────────────────── */
function AdjustDialog({ item, onClose }: { item: ResourceItem | null; onClose: () => void }) {
  const { record, removeItem } = useResources();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (reason: "received" | "issued" | "waste") => {
    if (!item) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter how many");
    setBusy(true);
    try {
      // Received is +; Used and Lost are −.
      const delta = reason === "received" ? n : -n;
      await record({ resourceId: item.id, delta, reason, note: note.trim() || undefined });
      toast.success(
        reason === "received" ? `+${n} received` : reason === "issued" ? `${n} used` : `${n} recorded as lost`,
      );
      setAmount(""); setNote("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{item?.name}</DialogTitle>
        </DialogHeader>
        {item && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Now: <span className="font-semibold text-foreground">{qty(item.qtyOnHand, item.unit)}</span>
            </p>
            <div className="space-y-1">
              <Label className="text-xs">How many?</Label>
              <Input type="number" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="no-spinner" autoFocus />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note (optional)</Label>
              <Input placeholder="e.g. restock, given to housekeeping, broken…" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" disabled={busy} onClick={() => act("received")} className="gap-1 text-success border-success/40">
                <ArrowDownToLine className="h-4 w-4" /> Received
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => act("issued")} className="gap-1">
                <ArrowUpFromLine className="h-4 w-4" /> Used
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => act("waste")} className="gap-1 text-destructive border-destructive/40">
                <AlertCircle className="h-4 w-4" /> Lost
              </Button>
            </div>
            <button
              type="button"
              onClick={async () => { await removeItem(item.id); onClose(); }}
              className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1 mt-1"
            >
              <Trash2 className="h-3 w-3" /> Delete this item
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
