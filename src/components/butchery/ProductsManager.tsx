import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useProducts } from "@/lib/butchery-store";
import { Product, ProductType } from "@/lib/butchery-types";
import { ksh } from "@/lib/format";
import { toast } from "sonner";

const typeMeta: Record<ProductType, { label: string; unit: string; pricing: string }> = {
  per_kg: { label: "Meat (per kg)", unit: "kg", pricing: "per kg" },
  fixed: { label: "Fixed item", unit: "piece", pricing: "per piece" },
  meal: { label: "Meal / Plate", unit: "plate", pricing: "per plate" },
};

export const ProductsManager = () => {
  const { products, add, update, remove } = useProducts();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; price: string }>({
    name: "",
    price: "",
  });
  const [newP, setNewP] = useState<{ name: string; type: ProductType; price: string; unit: string }>({
    name: "",
    type: "per_kg",
    price: "",
    unit: "kg",
  });

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setDraft({ name: p.name, price: String(p.price) });
  };

  const saveEdit = (id: string) => {
    const price = Number(draft.price);
    if (!draft.name.trim() || !Number.isFinite(price) || price <= 0) {
      toast.error("Enter a valid name and price");
      return;
    }
    update(id, { name: draft.name.trim(), price });
    setEditingId(null);
    toast.success("Updated");
  };

  const handleAdd = () => {
    const price = Number(newP.price);
    if (!newP.name.trim() || !Number.isFinite(price) || price <= 0) {
      toast.error("Enter a valid name and price");
      return;
    }
    add({
      name: newP.name.trim(),
      type: newP.type,
      price,
      unit: newP.unit || typeMeta[newP.type].unit,
    });
    setNewP({ name: "", type: "per_kg", price: "", unit: "kg" });
    toast.success("Product added");
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 shadow-soft">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" /> Add new product
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1.5 lg:col-span-2">
            <Label>Name</Label>
            <Input
              placeholder="e.g. Mutton, Sausage, Mukimo plate"
              value={newP.name}
              onChange={(e) => setNewP({ ...newP, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={newP.type}
              onValueChange={(v: ProductType) =>
                setNewP({ ...newP, type: v, unit: typeMeta[v].unit })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="per_kg">Meat (per kg)</SelectItem>
                <SelectItem value="fixed">Fixed item</SelectItem>
                <SelectItem value="meal">Meal / Plate</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Price ({typeMeta[newP.type].pricing})</Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={newP.price}
              onChange={(e) => setNewP({ ...newP, price: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={handleAdd} className="w-full bg-gradient-primary">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3">
        {products.map((p) => {
          const editing = editingId === p.id;
          return (
            <Card key={p.id} className="p-4 shadow-soft hover:shadow-elevated transition-shadow">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[180px]">
                  {editing ? (
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{p.name}</p>
                      <Badge variant="secondary" className="text-xs">
                        {typeMeta[p.type].label}
                      </Badge>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {editing ? (
                    <Input
                      type="number"
                      className="w-28"
                      value={draft.price}
                      onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                    />
                  ) : (
                    <p className="font-bold text-primary text-lg">
                      {ksh(p.price)}
                      <span className="text-xs text-muted-foreground font-normal">
                        {" "}/ {p.unit}
                      </span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {editing ? (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => saveEdit(p.id)}>
                        <Check className="h-4 w-4 text-success" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => startEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          remove(p.id);
                          toast.success("Removed");
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
