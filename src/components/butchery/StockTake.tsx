import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, Boxes } from "lucide-react";
import { useProducts, useStockOnHand, useStockTake } from "@/lib/butchery-store";
import { useActiveDepartment } from "@/contexts/DepartmentContext";
import { DEPARTMENT_LABELS } from "@/lib/butchery-types";
import { qty } from "@/lib/format";
import { toast } from "sonner";

/**
 * StockTake — count what's physically on the shelf, compare to the system, and
 * reconcile. Finalizing posts an 'adjustment' movement per line so on-hand
 * matches the count; the difference (variance) is where waste / theft / mis-pours
 * show up. Do it weekly.
 */
export const StockTake = () => {
  const { active: activeDepartment } = useActiveDepartment();
  const { products } = useProducts();
  const { byProductId } = useStockOnHand();
  const { recent, finalize } = useStockTake();

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const items = useMemo(
    () => products.filter((p) => p.department === activeDepartment && p.trackStock),
    [products, activeDepartment],
  );

  const entered = Object.entries(counts).filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)));

  const doFinalize = async () => {
    if (entered.length === 0) {
      toast.error("Enter the counted quantity for at least one product");
      return;
    }
    setSaving(true);
    try {
      await finalize({
        department: activeDepartment,
        note: note.trim() || undefined,
        items: entered.map(([productId, v]) => ({ productId, countedQty: Number(v) })),
      });
      toast.success("Stock-take finalized — stock reconciled to your count");
      setCounts({});
      setNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to finalize stock-take");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-warm grid place-items-center shrink-0">
            <ClipboardCheck className="h-5 w-5 text-accent-foreground" />
          </div>
          <div>
            <h3 className="font-semibold">
              Stock-take — {DEPARTMENT_LABELS[activeDepartment]}
            </h3>
            <p className="text-xs text-muted-foreground">
              Count what's on the shelf. Finalizing adjusts the system to match and
              records the variance.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-0 shadow-soft overflow-hidden">
        {items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No tracked products in this department yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground text-xs uppercase">
                <tr>
                  <th className="text-left p-3 font-semibold">Product</th>
                  <th className="text-right p-3 font-semibold">System</th>
                  <th className="text-right p-3 font-semibold w-40">Counted</th>
                  <th className="text-right p-3 font-semibold w-28">Variance</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const system = byProductId(p.id);
                  const raw = counts[p.id] ?? "";
                  const counted = Number(raw);
                  const hasCount = raw.trim() !== "" && Number.isFinite(counted);
                  const variance = hasCount ? counted - system : null;
                  return (
                    <tr key={p.id} className="border-t hover:bg-muted/40">
                      <td className="p-3 font-medium">{p.name}</td>
                      <td className="p-3 text-right">
                        <Badge variant="secondary" className="text-[10px] inline-flex items-center gap-1">
                          <Boxes className="h-3 w-3" />
                          {qty(system, p.unit)}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="—"
                            value={raw}
                            onChange={(e) =>
                              setCounts((s) => ({ ...s, [p.id]: e.target.value }))
                            }
                            className="h-9 w-24 text-right no-spinner"
                          />
                          <span className="text-xs text-muted-foreground w-10">{p.unit}</span>
                        </div>
                      </td>
                      <td className="p-3 text-right tabular-nums font-semibold">
                        {variance === null ? (
                          <span className="text-muted-foreground/60">—</span>
                        ) : variance === 0 ? (
                          <span className="text-success">0</span>
                        ) : (
                          <span className={variance < 0 ? "text-destructive" : "text-success"}>
                            {variance > 0 ? "+" : ""}
                            {qty(variance, p.unit)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {items.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Note (optional)</Label>
            <Input
              placeholder="e.g. Monday weekly count"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button
            onClick={doFinalize}
            disabled={saving || entered.length === 0}
            className="bg-gradient-primary gap-1.5"
          >
            <ClipboardCheck className="h-4 w-4" />
            {saving ? "Finalizing…" : `Finalize (${entered.length})`}
          </Button>
        </div>
      )}

      {/* Recent stock-takes */}
      {recent.length > 0 && (
        <Card className="p-5 shadow-soft">
          <h3 className="font-semibold mb-3">Recent stock-takes</h3>
          <div className="space-y-2">
            {recent.slice(0, 6).map((t) => {
              const variances = t.items.filter(
                (i) => i.systemQty != null && i.countedQty !== i.systemQty,
              );
              return (
                <div key={t.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div>
                    <span className="font-medium">
                      {new Date(t.createdAt).toLocaleDateString("en-KE", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {t.items.length} counted
                    </span>
                  </div>
                  <Badge variant={variances.length > 0 ? "destructive" : "secondary"} className="text-[10px]">
                    {variances.length > 0 ? `${variances.length} variance(s)` : "all matched"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
};
