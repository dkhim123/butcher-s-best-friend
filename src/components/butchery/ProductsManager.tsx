import { Fragment, useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Boxes, PackagePlus, Wine } from "lucide-react";
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
import { useProducts, useServings, useStockOnHand } from "@/lib/butchery-store";
import {
  ACTIVE_DEPARTMENTS,
  BOTTLE_SIZES_ML,
  Department,
  DEPARTMENT_LABELS,
  FOOD_GROUP_LABELS,
  FoodGroup,
  Product,
  ProductType,
} from "@/lib/butchery-types";
import { useActiveDepartment } from "@/contexts/DepartmentContext";
import { ksh, qty } from "@/lib/format";
import { toast } from "sonner";

/**
 * "Kind" is the SINGLE thing the user picks. It maps to a 4-tuple of
 * (sales-mode, unit, food-group, should-we-track-stock?) — all of
 * which used to be separate fields on the form. One choice, four
 * sensible defaults. Never wrong.
 *
 * The list shown depends on the department:
 *   Restaurant → a Menu item (sold, not stocked) or an Ingredient
 *                (stocked raw material — kg / litre / piece).
 *   Bar        → Beer/soda (whole bottle) or Spirit/wine (bottle;
 *                serving sizes like tot/glass are added separately).
 */
type Kind =
  | "menu"
  | "ingredient_kg"
  | "ingredient_litre"
  | "ingredient_piece"
  | "beer"
  | "spirit";

interface KindMeta {
  label: string;
  type: ProductType;
  unit: string;
  foodGroup: FoodGroup;
  trackStock: boolean;
  pricing: string;
}

const KIND_META: Record<Kind, KindMeta> = {
  menu: {
    label: "Menu item / plate (sold, not stocked)",
    type: "meal",
    unit: "plate",
    foodGroup: "prepared_food",
    trackStock: false,
    pricing: "per plate",
  },
  ingredient_kg: {
    label: "Ingredient — by kg",
    type: "per_kg",
    unit: "kg",
    foodGroup: "raw_material",
    trackStock: true,
    pricing: "per kg",
  },
  ingredient_litre: {
    label: "Ingredient — by litre",
    type: "per_kg",
    unit: "litre",
    foodGroup: "raw_material",
    trackStock: true,
    pricing: "per litre",
  },
  ingredient_piece: {
    label: "Ingredient — by piece",
    type: "fixed",
    unit: "piece",
    foodGroup: "raw_material",
    trackStock: true,
    pricing: "per piece",
  },
  beer: {
    label: "Beer / soda (per bottle)",
    type: "fixed",
    unit: "bottle",
    foodGroup: "drinks",
    trackStock: true,
    pricing: "per bottle",
  },
  spirit: {
    label: "Spirit / wine (per bottle)",
    type: "fixed",
    unit: "bottle",
    foodGroup: "drinks",
    trackStock: true,
    pricing: "per bottle",
  },
};

// Which kinds appear for each department.
const DEPARTMENT_KINDS: Record<Department, Kind[]> = {
  restaurant: ["menu", "ingredient_kg", "ingredient_litre", "ingredient_piece"],
  bar: ["beer", "spirit"],
  rooms: [],
};

/**
 * deriveCategory — pulls a short report-friendly category from the
 * product name (first alphanumeric word, lowercased). The admin
 * NEVER types this; we generate it so reports can still group by
 * "beef", "chicken", "pilau", etc.
 */
function deriveCategory(name: string): string {
  const first = name.trim().toLowerCase().split(/[\s,.()/-]+/)[0] ?? "";
  const cleaned = first.replace(/[^a-z0-9]/g, "");
  return cleaned || "general";
}

/** Map an existing Product's type back to a Kind (for the type badge). */
function productToKind(p: Product): Kind {
  if (p.type === "meal" || p.foodGroup === "prepared_food") return "menu";
  if (p.foodGroup === "drinks") return p.department === "bar" ? "spirit" : "beer";
  if (p.trackStock) {
    if (p.unit === "litre") return "ingredient_litre";
    if (p.unit === "piece") return "ingredient_piece";
    return "ingredient_kg";
  }
  return "menu";
}

interface NewDraft {
  name: string;
  kind: Kind;
  department: Department;
  price: string;
  openingStock: string;
  containerMl: number; // bottle size for spirits
}

const blankDraft = (department: Department): NewDraft => ({
  name: "",
  kind: DEPARTMENT_KINDS[department][0] ?? "menu",
  department,
  price: "",
  openingStock: "",
  containerMl: 750,
});

export const ProductsManager = () => {
  const { active: activeDepartment } = useActiveDepartment();
  const { products, add, update, remove } = useProducts();
  const { forProduct: servingsFor, add: addServing, remove: removeServing } = useServings();
  const { byProductId, addStock } = useStockOnHand();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; price: string }>({
    name: "",
    price: "",
  });
  const [newP, setNewP] = useState<NewDraft>(() => blankDraft(activeDepartment));
  const [customBottle, setCustomBottle] = useState(false);

  // Only manage the department currently in focus (matches the header switcher),
  // so the Bar's menu and the Restaurant's menu never bleed together.
  const deptProducts = products.filter((p) => p.department === activeDepartment);

  // Per-card "Add stock" inline form state. Keyed by product id so each card
  // remembers its own open/closed + value independently.
  const [stockForm, setStockForm] = useState<Record<string, string>>({});
  const [stockOpenId, setStockOpenId] = useState<string | null>(null);
  const [addingStock, setAddingStock] = useState<string | null>(null);

  // Per-spirit "Servings" editor state (Tot / Glass / …).
  const [servingOpenId, setServingOpenId] = useState<string | null>(null);
  const [servingDraft, setServingDraft] = useState({ name: "", ml: "", price: "" });

  const handleAddServing = async (productId: string) => {
    const ml = Number(servingDraft.ml);
    const price = Number(servingDraft.price);
    if (!servingDraft.name.trim()) return toast.error("Enter a serving name (e.g. Tot)");
    if (!Number.isFinite(ml) || ml <= 0) return toast.error("Enter the pour size in ml");
    if (!Number.isFinite(price) || price < 0) return toast.error("Enter a price");
    try {
      await addServing({
        productId,
        name: servingDraft.name.trim(),
        volumeMl: ml,
        price,
        sort: Math.round(ml),
      });
      setServingDraft({ name: "", ml: "", price: "" });
      toast.success("Serving added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add serving");
    }
  };

  const handleAddStock = async (productId: string, unit: string) => {
    const raw = stockForm[productId] ?? "";
    const n = Number(raw);
    if (!Number.isFinite(n) || n === 0) {
      toast.error("Enter a non-zero amount");
      return;
    }
    setAddingStock(productId);
    try {
      await addStock(productId, n, "Manual stock entry");
      toast.success(
        n > 0
          ? `Added ${n} ${unit} to stock`
          : `Removed ${Math.abs(n)} ${unit} from stock`,
      );
      setStockForm((s) => ({ ...s, [productId]: "" }));
      setStockOpenId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update stock");
    } finally {
      setAddingStock(null);
    }
  };

  const meta = KIND_META[newP.kind];

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditDraft({ name: p.name, price: String(p.price) });
  };

  const saveEdit = (id: string) => {
    const priceNum = Number(editDraft.price);
    if (!editDraft.name.trim() || !Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error("Enter a valid name and price");
      return;
    }
    // Editing only touches name + price. The kind / category / track-stock
    // are immutable after creation. If the owner wants to change those,
    // they delete and re-add (cleaner audit trail anyway).
    update(id, {
      name: editDraft.name.trim(),
      price: priceNum,
      category: deriveCategory(editDraft.name),
    });
    setEditingId(null);
    toast.success("Updated");
  };

  const isSpirit = newP.kind === "spirit";

  const handleAdd = async () => {
    const priceNum = Number(newP.price);
    if (!newP.name.trim() || !Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error("Enter a valid name and price");
      return;
    }
    if (isSpirit && (!Number.isFinite(newP.containerMl) || newP.containerMl <= 0)) {
      toast.error("Enter a valid bottle size in ml");
      return;
    }
    const openingNum = Number(newP.openingStock);
    const opening =
      meta.trackStock && Number.isFinite(openingNum) && openingNum > 0
        ? openingNum
        : 0;

    const created = await add(
      {
        name: newP.name.trim(),
        type: meta.type,
        price: priceNum,
        unit: meta.unit,
        category: deriveCategory(newP.name),
        foodGroup: meta.foodGroup,
        department: newP.department,
        trackStock: meta.trackStock,
        containerMl: isSpirit ? newP.containerMl : null,
      },
      opening,
    );

    // A spirit/wine starts sellable as a full bottle. The user adds smaller
    // pours (Tot, Glass…) afterwards from the product's Servings editor.
    if (isSpirit && created) {
      try {
        await addServing({
          productId: created.id,
          name: "Full bottle",
          volumeMl: newP.containerMl,
          price: priceNum,
          sort: 100,
        });
      } catch {
        /* non-fatal: the product still exists, they can add servings manually */
      }
    }

    setNewP(blankDraft(newP.department));
    toast.success(
      opening > 0
        ? `Added — starting with ${opening} ${meta.unit}`
        : "Product added",
    );
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 shadow-soft">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" /> Add new product
        </h3>

        {/* Only THREE fields visible by default. A 4th appears
            when the kind is one we track stock for (meat / drinks). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              placeholder="e.g. Beef on bone, Tusker 500ml, Pilau"
              value={newP.name}
              onChange={(e) => setNewP({ ...newP, name: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select
              value={newP.department}
              onValueChange={(v) => {
                const dept = v as Department;
                // Reset kind to a valid one for the newly chosen department.
                setNewP({ ...newP, department: dept, kind: DEPARTMENT_KINDS[dept][0] ?? "menu" });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVE_DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DEPARTMENT_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>What is it?</Label>
            <Select
              value={newP.kind}
              onValueChange={(v) => setNewP({ ...newP, kind: v as Kind })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPARTMENT_KINDS[newP.department].map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_META[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isSpirit && (
            <div className="space-y-1.5">
              <Label>Bottle size</Label>
              <Select
                value={
                  customBottle || !BOTTLE_SIZES_ML.includes(newP.containerMl as (typeof BOTTLE_SIZES_ML)[number])
                    ? "custom"
                    : String(newP.containerMl)
                }
                onValueChange={(v) => {
                  if (v === "custom") {
                    setCustomBottle(true);
                  } else {
                    setCustomBottle(false);
                    setNewP({ ...newP, containerMl: Number(v) });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOTTLE_SIZES_ML.map((ml) => (
                    <SelectItem key={ml} value={String(ml)}>
                      {ml >= 1000 ? `${ml / 1000} litre` : `${ml} ml`}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom size…</SelectItem>
                </SelectContent>
              </Select>
              {(customBottle ||
                !BOTTLE_SIZES_ML.includes(newP.containerMl as (typeof BOTTLE_SIZES_ML)[number])) && (
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="Bottle size in ml (e.g. 700)"
                  value={newP.containerMl || ""}
                  onChange={(e) => setNewP({ ...newP, containerMl: Number(e.target.value) })}
                  className="no-spinner mt-1.5"
                />
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Price ({isSpirit ? "per full bottle" : meta.pricing})</Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={newP.price}
              onChange={(e) => setNewP({ ...newP, price: e.target.value })}
            />
          </div>
        </div>

        {/* Opening stock only appears for meat & drinks.
            Meals and "other" don't track stock, so no field at all. */}
        {meta.trackStock && (
          <div className="mt-3 rounded-md border bg-accent/30 p-3 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="space-y-1.5 flex-1">
              <Label className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-primary" />
                How much do you have right now? ({meta.unit})
                <span className="text-xs font-normal text-muted-foreground">
                  Optional
                </span>
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder={`e.g. 20 ${meta.unit}`}
                value={newP.openingStock}
                onChange={(e) => setNewP({ ...newP, openingStock: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:max-w-xs">
              Leave empty if you'll record a purchase order later.
              Each sale will auto-deduct from this.
            </p>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button onClick={handleAdd} className="bg-gradient-primary px-6">
            <Plus className="h-4 w-4 mr-1" /> Add product
          </Button>
        </div>
      </Card>

      {/* Existing products — proper table layout. Compact, scannable,
          columns line up so you can compare prices and stock levels
          at a glance instead of hunting around full-width cards. */}
      <Card className="overflow-hidden shadow-soft">
        <div className="p-4 border-b bg-gradient-surface flex items-center justify-between">
          <div>
            <h3 className="font-semibold">
              {DEPARTMENT_LABELS[activeDepartment]} products
            </h3>
            <p className="text-xs text-muted-foreground">
              {deptProducts.length} item{deptProducts.length === 1 ? "" : "s"} on the menu
            </p>
          </div>
        </div>

        {deptProducts.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No {DEPARTMENT_LABELS[activeDepartment].toLowerCase()} products yet.
            Add your first one above to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-secondary-foreground text-xs uppercase">
                <tr>
                  <th className="text-left p-3 font-semibold">Product</th>
                  <th className="text-left p-3 font-semibold w-32">Type</th>
                  <th className="text-right p-3 font-semibold w-32">Price</th>
                  <th className="text-right p-3 font-semibold w-36">Stock</th>
                  <th className="text-right p-3 font-semibold w-44">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deptProducts.map((p) => {
                  const editing = editingId === p.id;
                  const stock = byProductId(p.id);
                  const kind = productToKind(p);
                  const showCategoryInBadge =
                    p.category &&
                    !p.name.toLowerCase().startsWith(p.category.toLowerCase());

                  return (
                    <Fragment key={p.id}>
                      <tr className="border-t hover:bg-muted/40 transition-colors">
                        {/* PRODUCT cell — name + optional category sub-text */}
                        <td className="p-3 align-middle">
                          {editing ? (
                            <Input
                              value={editDraft.name}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, name: e.target.value })
                              }
                              className="h-9"
                            />
                          ) : (
                            <div className="space-y-0.5">
                              <p className="font-semibold">{p.name}</p>
                              {showCategoryInBadge && (
                                <p className="text-[11px] text-muted-foreground">
                                  · {p.category}
                                </p>
                              )}
                            </div>
                          )}
                        </td>

                        {/* TYPE cell — small badge */}
                        <td className="p-3 align-middle">
                          <Badge variant="secondary" className="text-[10px]">
                            {p.foodGroup
                              ? FOOD_GROUP_LABELS[p.foodGroup]
                              : KIND_META[kind].label}
                          </Badge>
                        </td>

                        {/* PRICE cell — right-aligned, currency styling */}
                        <td className="p-3 text-right align-middle">
                          {editing ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={editDraft.price}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, price: e.target.value })
                              }
                              className="h-9 w-28 ml-auto text-right no-spinner"
                            />
                          ) : (
                            <div className="font-bold text-primary tabular-nums">
                              {ksh(p.price)}
                              <span className="text-[11px] text-muted-foreground font-normal block">
                                / {p.unit}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* STOCK cell — coloured badge for tracked items, em-dash otherwise */}
                        <td className="p-3 text-right align-middle">
                          {p.trackStock ? (
                            <Badge
                              variant={stock <= 0 ? "destructive" : "default"}
                              className="text-[10px] uppercase inline-flex items-center gap-1"
                            >
                              <Boxes className="h-3 w-3" />
                              {qty(stock, p.unit)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              not tracked
                            </span>
                          )}
                        </td>

                        {/* ACTIONS cell — packed compactly on the right */}
                        <td className="p-3 align-middle">
                          <div className="flex items-center justify-end gap-1">
                            {editing ? (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => saveEdit(p.id)}
                                  title="Save"
                                >
                                  <Check className="h-4 w-4 text-success" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => setEditingId(null)}
                                  title="Cancel"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                {p.containerMl != null && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1 text-xs h-8"
                                    onClick={() =>
                                      setServingOpenId((id) =>
                                        id === p.id ? null : p.id,
                                      )
                                    }
                                    title="Serving sizes (Tot / Glass / Bottle)"
                                  >
                                    <Wine className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">
                                      Servings
                                    </span>
                                  </Button>
                                )}
                                {p.trackStock && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1 text-xs h-8"
                                    onClick={() =>
                                      setStockOpenId((id) =>
                                        id === p.id ? null : p.id,
                                      )
                                    }
                                    title="Add or remove stock"
                                  >
                                    <PackagePlus className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">
                                      Stock
                                    </span>
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => startEdit(p)}
                                  title="Edit name / price"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    remove(p.id);
                                    toast.success("Removed");
                                  }}
                                  title="Delete product"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Inline expansion row for the "Add stock" mini-form.
                          Spans the entire width below the product's row so
                          the table layout doesn't break. */}
                      {p.trackStock && stockOpenId === p.id && !editing && (
                        <tr className="bg-accent/30">
                          <td colSpan={5} className="p-3">
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                              <div className="flex-1 space-y-1.5">
                                <Label className="text-xs">
                                  How much {p.unit} to add for{" "}
                                  <strong>{p.name}</strong>? (use a negative
                                  number to remove)
                                </Label>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  autoFocus
                                  placeholder={`e.g. 20 ${p.unit}`}
                                  value={stockForm[p.id] ?? ""}
                                  onChange={(e) =>
                                    setStockForm((s) => ({
                                      ...s,
                                      [p.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      void handleAddStock(p.id, p.unit);
                                  }}
                                  className="no-spinner"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                  Current stock:{" "}
                                  <strong>{qty(stock, p.unit)}</strong>
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  onClick={() =>
                                    void handleAddStock(p.id, p.unit)
                                  }
                                  disabled={addingStock === p.id}
                                  className="bg-gradient-primary"
                                  size="sm"
                                >
                                  {addingStock === p.id ? "Saving…" : "Save"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setStockOpenId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Servings editor for a spirit/wine — Tot, Glass, etc. */}
                      {p.containerMl != null && servingOpenId === p.id && !editing && (
                        <tr className="bg-accent/30">
                          <td colSpan={5} className="p-3">
                            <div className="space-y-3">
                              <div>
                                <p className="text-xs font-medium mb-1.5">
                                  How <strong>{p.name}</strong> can be sold
                                  <span className="text-muted-foreground font-normal">
                                    {" "}(bottle is {p.containerMl} ml)
                                  </span>
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {servingsFor(p.id).length === 0 ? (
                                    <span className="text-xs text-muted-foreground">
                                      No servings yet.
                                    </span>
                                  ) : (
                                    servingsFor(p.id).map((sv) => (
                                      <Badge
                                        key={sv.id}
                                        variant="secondary"
                                        className="gap-1.5 py-1 pl-2.5 pr-1"
                                      >
                                        {sv.name} · {sv.volumeMl}ml · {ksh(sv.price)}
                                        <button
                                          type="button"
                                          onClick={() => removeServing(sv.id)}
                                          className="rounded-full hover:bg-destructive/20 p-0.5"
                                          title="Remove serving"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </Badge>
                                    ))
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                                <div className="space-y-1 flex-1">
                                  <Label className="text-[11px]">Name</Label>
                                  <Input
                                    placeholder="Tot / Glass / Quarter"
                                    value={servingDraft.name}
                                    onChange={(e) =>
                                      setServingDraft((s) => ({ ...s, name: e.target.value }))
                                    }
                                    className="h-9"
                                  />
                                </div>
                                <div className="space-y-1 w-24">
                                  <Label className="text-[11px]">Pour (ml)</Label>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="30"
                                    value={servingDraft.ml}
                                    onChange={(e) =>
                                      setServingDraft((s) => ({ ...s, ml: e.target.value }))
                                    }
                                    className="h-9 no-spinner"
                                  />
                                </div>
                                <div className="space-y-1 w-28">
                                  <Label className="text-[11px]">Price</Label>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    placeholder="150"
                                    value={servingDraft.price}
                                    onChange={(e) =>
                                      setServingDraft((s) => ({ ...s, price: e.target.value }))
                                    }
                                    className="h-9 no-spinner"
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  className="bg-gradient-primary"
                                  onClick={() => void handleAddServing(p.id)}
                                >
                                  <Plus className="h-4 w-4 mr-1" /> Add
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setServingOpenId(null)}
                                >
                                  Done
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
