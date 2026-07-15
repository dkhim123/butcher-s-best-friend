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
import {
  Boxes, Plus, Trash2, ArrowDownToLine, ArrowUpFromLine, AlertCircle,
  Truck, Phone, Pencil, PackagePlus, AlertTriangle, CalendarDays,
} from "lucide-react";
import {
  useResources, useResourceLedger, useResourceSuppliers, useResourceSupplierPayments, useOrgUsers,
  ResourceItem, ResourceSupplier, ResourceLedgerRow, ResourceSupplierPayment,
} from "@/lib/butchery-store";
import { todayISO } from "@/lib/butchery-types";
import { qty, ksh } from "@/lib/format";
import { toast } from "sonner";

/**
 * Resources — non-sellable hotel supplies & equipment (housekeeping + kitchen).
 * Two mini-modules: "Items" (stock, with low-stock reorder alerts + restock) and
 * "Suppliers" (who supplies the business). Restocking an item is attributed to a
 * supplier and can record its cost — all logged for accountability.
 */
export const Resources = () => {
  const [tab, setTab] = useState<"items" | "suppliers">("items");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Resources</h2>
            <p className="text-sm text-muted-foreground">
              Housekeeping supplies &amp; kitchen equipment — owned, never sold.
            </p>
          </div>
        </div>
        {/* Mini-module switch. */}
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm">
          {([
            { id: "items", label: "Items", icon: Boxes },
            { id: "suppliers", label: "Suppliers", icon: Truck },
          ] as const).map((t) => {
            const on = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "items" ? <ItemsModule /> : <SuppliersModule />}
    </div>
  );
};

/* ══ ITEMS MODULE ══════════════════════════════════════════════════════════ */
function ItemsModule() {
  const { items } = useResources();
  const { rows: ledger } = useResourceLedger();
  const { suppliers } = useResourceSuppliers();
  const supplierName = (id: string | null) => (id ? suppliers.find((s) => s.id === id)?.name ?? null : null);
  const [adjust, setAdjust] = useState<ResourceItem | null>(null);

  // Low = out of stock (0) or at/below the reorder level (when one is set).
  const isLow = (it: ResourceItem) =>
    it.qtyOnHand <= 0 || (it.reorderLevel > 0 && it.qtyOnHand <= it.reorderLevel);
  const lowItems = useMemo(() => items.filter(isLow), [items]);

  // Group items by category so housekeeping vs kitchen read separately.
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
      {/* Low-stock alert banner — what needs reordering, at a glance. */}
      {lowItems.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-4 shadow-soft">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {lowItems.length} item{lowItems.length === 1 ? "" : "s"} need restocking
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {lowItems.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setAdjust(it)}
                    className="mr-2 inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  >
                    <span className="font-medium text-foreground">{it.name}</span>
                    <span>({qty(it.qtyOnHand, it.unit)})</span>
                  </button>
                ))}
              </p>
            </div>
          </div>
        </Card>
      )}

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
                const out = it.qtyOnHand <= 0;
                const low = !out && it.reorderLevel > 0 && it.qtyOnHand <= it.reorderLevel;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setAdjust(it)}
                    className={`rounded-xl border p-4 text-left transition-all hover:shadow-soft active:scale-[0.98] ${
                      out
                        ? "border-destructive/50 bg-destructive/5"
                        : low
                          ? "border-amber-500/50 bg-amber-500/5"
                          : "bg-background hover:border-primary/50"
                    }`}
                  >
                    <p className="font-semibold leading-tight">{it.name}</p>
                    <p className={`text-2xl font-bold mt-1 ${out ? "text-destructive" : low ? "text-amber-600" : ""}`}>
                      {qty(it.qtyOnHand, it.unit)}
                    </p>
                    {out ? (
                      <p className="text-[11px] text-destructive font-medium flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> None left
                      </p>
                    ) : low ? (
                      <p className="text-[11px] text-amber-600 font-medium flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Low · reorder at {qty(it.reorderLevel, it.unit)}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        {it.reorderLevel > 0 ? `Reorder at ${qty(it.reorderLevel, it.unit)}` : "Tap to update"}
                      </p>
                    )}
                    {supplierName(it.supplierId) && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Truck className="h-3 w-3 shrink-0" /> {supplierName(it.supplierId)}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      <DailyActivity ledger={ledger} />

      <AdjustDialog item={adjust} onClose={() => setAdjust(null)} />
    </div>
  );
}

/* ── Daily activity: opening · received · used · closing per item ── */
function DailyActivity({ ledger }: { ledger: ResourceLedgerRow[] }) {
  const { assignSupplier } = useResources();
  const { suppliers } = useResourceSuppliers();
  const [day, setDay] = useState<string>(todayISO());
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const dayEnd = dayStart + 86_400_000;

  // Per item: opening = balance before the day; received/used = the day's moves;
  // closing = opening + received − used (balance at end of day).
  const summary = useMemo(() => {
    const m = new Map<string, { id: string; name: string; unit: string; opening: number; received: number; used: number; closing: number }>();
    for (const r of ledger) {
      const t = new Date(r.occurredAt).getTime();
      if (t >= dayEnd) continue; // after this day — doesn't affect its closing
      const e = m.get(r.resourceId) ?? { id: r.resourceId, name: r.resourceName, unit: r.unit, opening: 0, received: 0, used: 0, closing: 0 };
      e.closing += r.deltaQty;
      if (t < dayStart) {
        e.opening += r.deltaQty;
      } else if (r.deltaQty >= 0) {
        e.received += r.deltaQty;
      } else {
        e.used += -r.deltaQty;
      }
      m.set(r.resourceId, e);
    }
    return [...m.values()]
      .filter((e) => e.opening > 0 || e.received > 0 || e.used > 0 || e.closing > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ledger, dayStart, dayEnd]);

  // The day's individual movements (for the paid/supplier detail).
  const dayMoves = useMemo(
    () =>
      ledger.filter((r) => {
        const t = new Date(r.occurredAt).getTime();
        return t >= dayStart && t < dayEnd;
      }),
    [ledger, dayStart, dayEnd],
  );

  const yISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  return (
    <Card className="overflow-hidden shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-gradient-surface p-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <div>
            <h3 className="font-semibold">Daily activity</h3>
            <p className="text-xs text-muted-foreground">Opening, received, used and closing for the day.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
            {[{ l: "Today", v: todayISO() }, { l: "Yesterday", v: yISO }].map((b) => (
              <button
                key={b.l}
                type="button"
                onClick={() => setDay(b.v)}
                className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                  day === b.v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.l}
              </button>
            ))}
          </div>
          <Input type="date" value={day} max={todayISO()} onChange={(e) => setDay(e.target.value)} className="h-9 w-40" />
        </div>
      </div>

      {summary.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No resource activity for this day.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-secondary-foreground text-xs uppercase">
              <tr>
                <th className="text-left p-3 font-semibold">Item</th>
                <th className="text-right p-3 font-semibold">Opening</th>
                <th className="text-right p-3 font-semibold">+ Received</th>
                <th className="text-right p-3 font-semibold">− Used</th>
                <th className="text-right p-3 font-semibold">Closing</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((e) => (
                <tr key={e.id} className="border-t hover:bg-muted/40">
                  <td className="p-3 font-medium">{e.name}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">{qty(e.opening, e.unit)}</td>
                  <td className="p-3 text-right tabular-nums text-success">
                    {e.received > 0 ? `+${qty(e.received, e.unit)}` : "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums text-destructive">
                    {e.used > 0 ? `−${qty(e.used, e.unit)}` : "—"}
                  </td>
                  <td className={`p-3 text-right tabular-nums font-bold ${e.closing <= 0 ? "text-destructive" : ""}`}>
                    {qty(e.closing, e.unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Movements detail — supplier + paid/unpaid on restocks. */}
      {dayMoves.length > 0 && (
        <div className="border-t">
          <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Movements
          </p>
          <div className="divide-y">
            {dayMoves.map((m) => {
              const up = m.deltaQty >= 0;
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <span className="text-xs text-muted-foreground w-14 shrink-0">
                    {new Date(m.occurredAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="font-medium">{m.resourceName}</span>
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {m.reason === "waste" ? "lost" : m.reason === "received" ? "restock" : m.reason}
                  </Badge>
                  <span className={`font-semibold tabular-nums ${up ? "text-success" : "text-destructive"}`}>
                    {up ? "+" : "−"}{qty(Math.abs(m.deltaQty), m.unit)}
                  </span>
                  {m.reason === "received" && m.totalCost != null && (
                    <span className="text-xs text-muted-foreground">{ksh(m.totalCost)}</span>
                  )}
                  {/* Priced restock recorded without a supplier — let them attribute it. */}
                  {m.reason === "received" && m.totalCost != null && !m.supplierId && suppliers.length > 0 && (
                    <Select onValueChange={(v) => assignSupplier(m.id, v).then(() => toast.success("Supplier set")).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))}>
                      <SelectTrigger className="h-7 w-auto gap-1 text-[11px]"><SelectValue placeholder="Assign supplier" /></SelectTrigger>
                      <SelectContent>
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {m.note && <span className="text-xs text-muted-foreground truncate">· {m.note}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── Add a resource ───────────────────────────────────────────── */
function AddResource() {
  const { addItem } = useResources();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("housekeeping");
  const [unit, setUnit] = useState("piece");
  const [opening, setOpening] = useState("");
  const [reorder, setReorder] = useState("");

  const submit = async () => {
    if (!name.trim()) return toast.error("Enter an item name");
    try {
      await addItem({
        name: name.trim(),
        category,
        unit: unit.trim() || "piece",
        opening: Number(opening) > 0 ? Number(opening) : undefined,
        reorderLevel: Number(reorder) > 0 ? Number(reorder) : undefined,
      });
      setName(""); setOpening(""); setReorder("");
      toast.success("Resource added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    }
  };

  return (
    <Card className="p-4 shadow-soft grid sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
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
      <div className="space-y-1">
        <Label className="text-xs">Have now</Label>
        <Input type="number" inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} className="no-spinner" />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Alert at</Label>
          <Input type="number" inputMode="decimal" placeholder="0" value={reorder} onChange={(e) => setReorder(e.target.value)} className="no-spinner" />
        </div>
        <Button onClick={submit} className="gap-1.5"><Plus className="h-4 w-4" /> Add</Button>
      </div>
    </Card>
  );
}

/* ── Received (restock) / Used / Lost dialog ──────────────────── */
function AdjustDialog({ item, onClose }: { item: ResourceItem | null; onClose: () => void }) {
  const { record, updateItem, removeItem } = useResources();
  const { suppliers } = useResourceSuppliers();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [supplierId, setSupplierId] = useState<string>("none");
  const [unitCost, setUnitCost] = useState("");
  const [reorder, setReorder] = useState("");
  const [busy, setBusy] = useState(false);

  // Seed the reorder input from the item whenever the dialog opens on a new one.
  const [seededId, setSeededId] = useState<string | null>(null);
  if (item && item.id !== seededId) {
    setSeededId(item.id);
    setReorder(item.reorderLevel > 0 ? String(item.reorderLevel) : "");
    setAmount(""); setNote(""); setSupplierId(item.supplierId ?? "none"); setUnitCost("");
  }

  const act = async (reason: "received" | "issued" | "waste") => {
    if (!item) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter how many");
    // A cost must belong to a supplier so it shows in that supplier's account.
    if (reason === "received" && Number(unitCost) > 0 && supplierId === "none") {
      return toast.error("Pick a supplier for this restock cost");
    }
    setBusy(true);
    try {
      const delta = reason === "received" ? n : -n;
      const cost = reason === "received" && Number(unitCost) > 0 ? Number(unitCost) : null;
      const hasSupplier = reason === "received" && supplierId !== "none";
      await record({
        resourceId: item.id,
        delta,
        reason,
        note: note.trim() || undefined,
        supplierId: hasSupplier ? supplierId : null,
        unitCost: cost,
      });
      toast.success(
        reason === "received" ? `+${n} restocked` : reason === "issued" ? `${n} used` : `${n} recorded as lost`,
      );
      setAmount(""); setNote(""); setUnitCost("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const saveReorder = async () => {
    if (!item) return;
    try {
      await updateItem({ id: item.id, reorderLevel: Number(reorder) > 0 ? Number(reorder) : 0 });
      toast.success("Alert level updated");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const cost = Number(unitCost);
  const qtyN = Number(amount);
  const lineTotal = Number.isFinite(cost) && cost > 0 && Number.isFinite(qtyN) && qtyN > 0 ? cost * qtyN : null;

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

            {/* Restock attribution — used only when you press "Restock". */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <PackagePlus className="h-3.5 w-3.5" /> Restock details
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Supplier</Label>
                  <Select
                    value={supplierId}
                    onValueChange={(v) => {
                      setSupplierId(v);
                      if (item) {
                        updateItem({ id: item.id, supplierId: v === "none" ? null : v })
                          .then(() => toast.success(v === "none" ? "Supplier removed" : "Supplier linked"))
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
                      }
                    }}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No supplier</SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Cost / unit</Label>
                  <Input type="number" inputMode="decimal" placeholder="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="no-spinner h-9" />
                </div>
              </div>
              {lineTotal != null && (
                <p className="text-[11px] text-muted-foreground">Total cost: <span className="font-semibold text-foreground">{ksh(lineTotal)}</span></p>
              )}
              <p className="text-[11px] text-muted-foreground">
                This is added to what you owe the supplier. Pay them (in part or full) from the Suppliers tab → their account.
              </p>
              {suppliers.length === 0 && (
                <p className="text-[11px] text-muted-foreground">Add suppliers in the Suppliers tab to attribute a restock.</p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Note (optional)</Label>
              <Input placeholder="e.g. delivery, given to housekeeping, broken…" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" disabled={busy} onClick={() => act("received")} className="gap-1 text-success border-success/40">
                <ArrowDownToLine className="h-4 w-4" /> Restock
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => act("issued")} className="gap-1">
                <ArrowUpFromLine className="h-4 w-4" /> Used
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => act("waste")} className="gap-1 text-destructive border-destructive/40">
                <AlertCircle className="h-4 w-4" /> Lost
              </Button>
            </div>

            {/* Reorder / low-stock alert level. */}
            <div className="flex items-end gap-2 border-t pt-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Alert me when this drops to</Label>
                <Input type="number" inputMode="decimal" placeholder="0 = off" value={reorder} onChange={(e) => setReorder(e.target.value)} className="no-spinner h-9" />
              </div>
              <Button variant="secondary" size="sm" className="h-9" onClick={saveReorder}>Save</Button>
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

/* ══ SUPPLIERS MODULE ══════════════════════════════════════════════════════ */
function SuppliersModule() {
  const { suppliers, removeSupplier } = useResourceSuppliers();
  const { rows: ledger } = useResourceLedger();
  const { payments } = useResourceSupplierPayments();
  const [edit, setEdit] = useState<ResourceSupplier | null>(null);
  const [adding, setAdding] = useState(false);
  const [account, setAccount] = useState<ResourceSupplier | null>(null);

  // Every priced restock per supplier (their statement), newest first.
  const movesBySupplier = useMemo(() => {
    const m = new Map<string, ResourceLedgerRow[]>();
    for (const r of ledger) {
      if (r.reason === "received" && r.supplierId && r.totalCost != null) {
        const arr = m.get(r.supplierId) ?? [];
        arr.push(r);
        m.set(r.supplierId, arr);
      }
    }
    return m;
  }, [ledger]);

  // Running account per supplier: Owed = Σ delivered − Σ payments.
  const deliveredBySupplier = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ledger) {
      if (r.reason === "received" && r.supplierId && r.totalCost != null) {
        m.set(r.supplierId, (m.get(r.supplierId) ?? 0) + r.totalCost);
      }
    }
    return m;
  }, [ledger]);
  const paidBySupplier = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) m.set(p.supplierId, (m.get(p.supplierId) ?? 0) + p.amount);
    return m;
  }, [payments]);
  const owedOf = (id: string) => Math.max(0, (deliveredBySupplier.get(id) ?? 0) - (paidBySupplier.get(id) ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          The people &amp; companies that supply your resources.
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add supplier
        </Button>
      </div>

      {suppliers.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground shadow-soft">
          No suppliers yet. Add one — e.g. “Coastal Cleaning Supplies”, then attribute restocks to them.
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => (
            <Card key={s.id} className="p-4 shadow-soft space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold leading-tight flex items-center gap-1.5">
                    <Truck className="h-4 w-4 text-primary shrink-0" /> {s.name}
                  </p>
                  {s.phone && (
                    <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {s.phone}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => setEdit(s)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await removeSupplier(s.id); toast.success("Supplier removed"); }}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {s.supplies && (
                <p className="text-xs">
                  <span className="text-muted-foreground">Supplies: </span>
                  <span className="font-medium">{s.supplies}</span>
                </p>
              )}
              {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
              {/* Always indicate this supplier's standing: owed vs paid. */}
              <div className="mt-1 grid grid-cols-2 gap-2 border-t pt-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Owed</p>
                  <p className={`text-sm font-bold ${owedOf(s.id) > 0 ? "text-destructive" : ""}`}>
                    {ksh(owedOf(s.id))}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Paid</p>
                  <p className="text-sm font-bold text-success">{ksh(paidBySupplier.get(s.id) ?? 0)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAccount(s)}
                className="text-xs font-medium text-primary hover:underline"
              >
                View account
              </button>
            </Card>
          ))}
        </div>
      )}

      <SupplierDialog
        open={adding || !!edit}
        supplier={edit}
        onClose={() => { setAdding(false); setEdit(null); }}
      />
      <SupplierAccountDialog
        supplier={account}
        deliveries={account ? (movesBySupplier.get(account.id) ?? []) : []}
        payments={account ? payments.filter((p) => p.supplierId === account.id) : []}
        onClose={() => setAccount(null)}
      />
    </div>
  );
}

/* ── Supplier account: running balance, part-payments, deliveries & history ── */
function SupplierAccountDialog({
  supplier, deliveries, payments, onClose,
}: {
  supplier: ResourceSupplier | null;
  deliveries: ResourceLedgerRow[];
  payments: ResourceSupplierPayment[];
  onClose: () => void;
}) {
  const { nameById } = useOrgUsers();
  const { recordPayment, deletePayment } = useResourceSupplierPayments();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const delivered = deliveries.reduce((a, r) => a + (r.totalCost ?? 0), 0);
  const paidTotal = payments.reduce((a, p) => a + p.amount, 0);
  const owed = Math.max(0, delivered - paidTotal);

  const pay = async () => {
    if (!supplier) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter an amount");
    if (n > owed + 0.001) return toast.error(`That's more than the ${ksh(owed)} owed`);
    setBusy(true);
    try {
      await recordPayment({ supplierId: supplier.id, amount: n, note: note.trim() || undefined });
      toast.success(`Paid ${ksh(n)}`);
      setAmount(""); setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!supplier} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" /> {supplier?.name} — account
          </DialogTitle>
        </DialogHeader>
        {supplier && (
          <div className="space-y-3">
            {/* Running balance. */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Delivered</p>
                <p className="text-base font-bold">{ksh(delivered)}</p>
              </div>
              <div className="rounded-lg border bg-success/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Paid</p>
                <p className="text-base font-bold text-success">{ksh(paidTotal)}</p>
              </div>
              <div className="rounded-lg border bg-destructive/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Owed</p>
                <p className={`text-base font-bold ${owed > 0 ? "text-destructive" : ""}`}>{ksh(owed)}</p>
              </div>
            </div>

            {/* Record a payment — part or full. */}
            {owed > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-[11px]">Pay amount</Label>
                    <Input
                      type="number" inputMode="decimal" placeholder={String(Math.round(owed))}
                      value={amount} onChange={(e) => setAmount(e.target.value)} className="no-spinner h-9"
                    />
                  </div>
                  <Button variant="outline" size="sm" className="h-9" onClick={() => setAmount(String(Math.round(owed)))}>
                    Pay all
                  </Button>
                  <Button size="sm" className="h-9" disabled={busy} onClick={pay}>Record</Button>
                </div>
                <Input placeholder="Note (optional) — e.g. M-Pesa, cash" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
              </div>
            )}

            <div className="max-h-[46vh] space-y-3 overflow-y-auto">
              {/* Payment history. */}
              {payments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payments</p>
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-success">{ksh(p.amount)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(p.paidAt).toLocaleString("en-KE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {p.paidBy && nameById(p.paidBy) ? ` · ${nameById(p.paidBy)}` : ""}
                          {p.note ? ` · ${p.note}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => deletePayment(p.id).then(() => toast.success("Payment removed")).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Delete payment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Deliveries (what built up the bill). */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Deliveries</p>
                {deliveries.length === 0 ? (
                  <p className="py-3 text-center text-sm text-muted-foreground">No deliveries recorded.</p>
                ) : (
                  deliveries.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {r.resourceName} <span className="text-muted-foreground">+{qty(r.deltaQty, r.unit)}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(r.occurredAt).toLocaleString("en-KE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <span className="font-semibold tabular-nums">{ksh(r.totalCost ?? 0)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SupplierDialog({ open, supplier, onClose }: { open: boolean; supplier: ResourceSupplier | null; onClose: () => void }) {
  const { addSupplier, updateSupplier } = useResourceSuppliers();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [supplies, setSupplies] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Seed fields when the dialog opens (add = blank, edit = supplier values).
  const [seed, setSeed] = useState<string | null>(null);
  const seedKey = supplier?.id ?? (open ? "new" : null);
  if (seedKey !== seed) {
    setSeed(seedKey);
    setName(supplier?.name ?? "");
    setPhone(supplier?.phone ?? "");
    setSupplies(supplier?.supplies ?? "");
    setNote(supplier?.note ?? "");
  }

  const submit = async () => {
    if (!name.trim()) return toast.error("Enter a supplier name");
    if (!supplies.trim()) return toast.error("Enter what they supply");
    setBusy(true);
    try {
      const payload = { name: name.trim(), phone: phone.trim() || undefined, supplies: supplies.trim(), note: note.trim() || undefined };
      if (supplier) await updateSupplier({ id: supplier.id, ...payload });
      else await addSupplier(payload);
      toast.success(supplier ? "Supplier updated" : "Supplier added");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{supplier ? "Edit supplier" : "Add supplier"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. Coastal Cleaning Supplies" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">What they supply <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. tissue, detergent, gas" value={supplies} onChange={(e) => setSupplies(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone (optional)</Label>
            <Input placeholder="07…" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Note (optional)</Label>
            <Input placeholder="e.g. delivers on Mondays" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={busy} onClick={submit}>{supplier ? "Save" : "Add supplier"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
