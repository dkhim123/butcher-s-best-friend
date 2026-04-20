import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Package } from "lucide-react";
import { useProducts, useStock } from "@/lib/butchery-store";
import { todayISO } from "@/lib/butchery-types";
import { qty } from "@/lib/format";
import { toast } from "sonner";

export const OpeningStock = () => {
  const { products } = useProducts();
  const { getOpening, setOpening } = useStock(todayISO());
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = (id: string) => {
    const v = Number(drafts[id]);
    if (!Number.isFinite(v) || v < 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    setOpening(id, v);
    setDrafts((d) => ({ ...d, [id]: "" }));
    toast.success("Opening stock saved");
  };

  return (
    <Card className="p-6 shadow-elevated">
      <div className="flex items-center gap-2 mb-5">
        <div className="h-9 w-9 rounded-lg bg-gradient-warm grid place-items-center">
          <Package className="h-5 w-5 text-accent-foreground" />
        </div>
        <div>
          <h2 className="font-semibold">Opening Stock — Today</h2>
          <p className="text-xs text-muted-foreground">
            Set the morning stock quantity for each product
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {products.map((p) => {
          const opening = getOpening(p.id);
          return (
            <div
              key={p.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_160px_120px_auto] gap-3 items-end border-b pb-3 last:border-0"
            >
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  Currently set: <span className="font-semibold text-foreground">{qty(opening, p.unit)}</span>
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">New opening ({p.unit})</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={p.unit === "kg" ? "e.g. 40" : "e.g. 20"}
                  value={drafts[p.id] ?? ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                />
              </div>
              <Button
                onClick={() => save(p.id)}
                disabled={!drafts[p.id]}
                className="bg-gradient-primary"
              >
                Save
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
