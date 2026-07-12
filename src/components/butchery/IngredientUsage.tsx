import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Boxes, Save } from "lucide-react";
import { useProducts, useStockOnHand } from "@/lib/butchery-store";
import { useActiveDepartment } from "@/contexts/DepartmentContext";
import { qty } from "@/lib/format";
import { toast } from "sonner";

/**
 * IngredientUsage — the chef's "what did we use today?" log.
 *
 * Restaurant sales do NOT touch ingredient stock (a plate of pilau is just
 * counted). Instead the chef records, at the end of the day, how much of each
 * raw ingredient the kitchen actually used. Each entry posts a negative
 * 'usage' stock movement, so ingredient stock falls only when the chef says so.
 *
 * Ingredients = tracked products in the Restaurant department (rice, oil,
 * beef…). Menu items (meals) are untracked and never appear here.
 */
export const IngredientUsage = () => {
  const { active: activeDepartment } = useActiveDepartment();
  const { products } = useProducts();
  const { byProductId, recordUsage } = useStockOnHand();

  const [used, setUsed] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const ingredients = useMemo(
    () =>
      products.filter(
        (p) => p.department === activeDepartment && p.trackStock,
      ),
    [products, activeDepartment],
  );

  const enteredCount = Object.values(used).filter((v) => Number(v) > 0).length;

  const saveAll = async () => {
    const entries = Object.entries(used)
      .map(([id, v]) => ({ id, qty: Number(v) }))
      .filter((e) => Number.isFinite(e.qty) && e.qty > 0);

    if (entries.length === 0) {
      toast.error("Enter how much of at least one ingredient was used");
      return;
    }

    setSaving(true);
    try {
      for (const e of entries) {
        await recordUsage(e.id, e.qty, "Kitchen usage");
      }
      toast.success(
        `Recorded usage for ${entries.length} ingredient${entries.length === 1 ? "" : "s"}`,
      );
      setUsed({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record usage");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-warm grid place-items-center shrink-0">
            <ChefHat className="h-5 w-5 text-accent-foreground" />
          </div>
          <div>
            <h3 className="font-semibold">Ingredients used today</h3>
            <p className="text-xs text-muted-foreground">
              Enter how much of each ingredient the kitchen used. This is what
              lowers ingredient stock — selling plates does not.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-0 shadow-soft overflow-hidden">
        {ingredients.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No ingredients yet. Add tracked ingredients (rice, oil, beef…) in the
            Products tab, then record their daily usage here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground text-xs uppercase">
                <tr>
                  <th className="text-left p-3 font-semibold">Ingredient</th>
                  <th className="text-right p-3 font-semibold">In stock</th>
                  <th className="text-right p-3 font-semibold w-44">Used today</th>
                </tr>
              </thead>
              <tbody>
                {ingredients.map((p) => {
                  const onHand = byProductId(p.id);
                  return (
                    <tr key={p.id} className="border-t hover:bg-muted/40">
                      <td className="p-3 font-medium">{p.name}</td>
                      <td className="p-3 text-right">
                        <Badge
                          variant={onHand <= 0 ? "destructive" : "secondary"}
                          className="text-[10px] inline-flex items-center gap-1"
                        >
                          <Boxes className="h-3 w-3" />
                          {qty(onHand, p.unit)}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Input
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                            value={used[p.id] ?? ""}
                            onChange={(e) =>
                              setUsed((s) => ({ ...s, [p.id]: e.target.value }))
                            }
                            className="h-9 w-24 text-right no-spinner"
                          />
                          <span className="text-xs text-muted-foreground w-10">
                            {p.unit}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {ingredients.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {enteredCount > 0
              ? `${enteredCount} ingredient${enteredCount === 1 ? "" : "s"} ready to record`
              : "Enter usage above"}
          </p>
          <Button
            onClick={saveAll}
            disabled={saving || enteredCount === 0}
            className="bg-gradient-primary gap-1.5"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Record usage"}
          </Button>
        </div>
      )}
    </div>
  );
};
