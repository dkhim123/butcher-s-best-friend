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
  isIngredient,
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
  cost: string; // buying price per unit (optional)
  openingStock: string;
  containerMl: number; // bottle size for spirits
}

const blankDraft = (department: Department): NewDraft => ({
  name: "",
  kind: DEPARTMENT_KINDS[department][0] ?? "menu",
  department,
  price: "",
  cost: "",
  openingStock: "",
  containerMl: 750,
});

export const ProductsManager = () => {
  const { active: activeDepartment } = useActiveDepartment();
  const { products, add, update, remove } = useProducts();
  const { forProduct: servingsFor, add: addServing, remove: removeServing } = useServings();
  const { byProductId, addStock } = useStockOnHand();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; price: string; cost: string }>({
    name: "",
    price: "",
    cost: "",
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
  // Ingredients are bought & used in the kitchen, never sold — so the form
  // hides "Selling price" for them and keeps only the buying price.
  const isIngredientKind = meta.foodGroup === "raw_material";

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditDraft({
      name: p.name,
      price: String(p.price),
      cost: p.costPrice != null ? String(p.costPrice) : "",
    });
  };

  const saveEdit = (id: string) => {
    const target = products.find((p) => p.id === id);
    const ingredient = target ? isIngredient(target) : false;
    // Ingredients keep their 0 selling price; everything else needs a real one.
    const priceNum = ingredient ? target?.price ?? 0 : Number(editDraft.price);
    if (!editDraft.name.trim()) {
      toast.error("Enter a name");
      return;
    }
    if (!ingredient && (!Number.isFinite(priceNum) || priceNum <= 0)) {
      toast.error("Enter a valid selling price");
      return;
    }
    // An empty cost means "unknown" (null). A typed cost must be a valid,
    // non-negative number.
    const costTrimmed = editDraft.cost.trim();
    const costNum = Number(costTrimmed);
    if (costTrimmed && (!Number.isFinite(costNum) || costNum < 0)) {
      toast.error("Enter a valid buying price");
      return;
    }
    // Editing only touches name + price + cost. The kind / category / track-stock
    // are immutable after creation. If the owner wants to change those,
    // they delete and re-add (cleaner audit trail anyway).
    update(id, {
      name: editDraft.name.trim(),
      price: priceNum,
      costPrice: costTrimmed ? costNum : null,
      category: deriveCategory(editDraft.name),
    });
    setEditingId(null);
    toast.success("Updated");
  };

  const isSpirit = newP.kind === "spirit";

  // ── Bulk add ──────────────────────────────────────────────────────────────
  // Queue several products (e.g. a whole drinks list) then save them in one go.
  const [queue, setQueue] = useState<NewDraft[]>([]);
  const [savingAll, setSavingAll] = useState(false);

  /**
   * validateDraft — checks a single draft and, if valid, returns the exact
   * payload we'd send to the store. Returns an error message otherwise. Shared
   * by the single "Add product" button and the bulk queue so the rules can
   * never drift apart.
   */
  const validateDraft = (
    d: NewDraft,
  ):
    | { error: string }
    | { product: Omit<Product, "id">; opening: number; spirit: boolean; containerMl: number } => {
    const dMeta = KIND_META[d.kind];
    const spirit = d.kind === "spirit";
    const ingredient = dMeta.foodGroup === "raw_material";
    // Ingredients aren't sold, so they have no selling price — store 0.
    const priceNum = ingredient ? 0 : Number(d.price);
    if (!d.name.trim()) {
      return { error: `"${d.name || "Unnamed"}": enter a name` };
    }
    if (!ingredient && (!Number.isFinite(priceNum) || priceNum <= 0)) {
      return { error: `"${d.name}": enter a valid selling price` };
    }
    const costTrimmed = d.cost.trim();
    const costNum = Number(costTrimmed);
    if (costTrimmed && (!Number.isFinite(costNum) || costNum < 0)) {
      return { error: `"${d.name}": enter a valid buying price (or leave it blank)` };
    }
    if (spirit && (!Number.isFinite(d.containerMl) || d.containerMl <= 0)) {
      return { error: `"${d.name}": enter a valid bottle size in ml` };
    }
    const openingNum = Number(d.openingStock);
    const opening =
      dMeta.trackStock && Number.isFinite(openingNum) && openingNum > 0 ? openingNum : 0;
    return {
      product: {
        name: d.name.trim(),
        type: dMeta.type,
        price: priceNum,
        unit: dMeta.unit,
        category: deriveCategory(d.name),
        foodGroup: dMeta.foodGroup,
        department: d.department,
        trackStock: dMeta.trackStock,
        containerMl: spirit ? d.containerMl : null,
        costPrice: costTrimmed ? costNum : null,
      },
      opening,
      spirit,
      containerMl: d.containerMl,
    };
  };

  /** commitDraft — persists one validated draft (product + spirit's full-bottle
   *  serving). Throws on failure so callers can report it. */
  const commitDraft = async (d: NewDraft) => {
    const v = validateDraft(d);
    if ("error" in v) throw new Error(v.error);
    const created = await add(v.product, v.opening);
    if (v.spirit && created) {
      try {
        await addServing({
          productId: created.id,
          name: "Full bottle",
          volumeMl: v.containerMl,
          price: v.product.price,
          sort: 100,
        });
      } catch {
        /* non-fatal: the product still exists, they can add servings manually */
      }
    }
  };

  const handleAdd = async () => {
    const v = validateDraft(newP);
    if ("error" in v) {
      toast.error(v.error);
      return;
    }
    try {
      await commitDraft(newP);
      setNewP(blankDraft(newP.department));
      toast.success(
        v.opening > 0 ? `Added — starting with ${v.opening} ${meta.unit}` : "Product added",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add the product");
    }
  };

  /** Queue the current draft, keeping the chosen department + kind so you can
   *  rattle off many of the same type (e.g. lots of spirits) quickly. */
  const addToQueue = () => {
    const v = validateDraft(newP);
    if ("error" in v) {
      toast.error(v.error);
      return;
    }
    setQueue((q) => [...q, newP]);
    setNewP((p) => ({ ...blankDraft(p.department), kind: p.kind, containerMl: p.containerMl }));
  };

  const removeFromQueue = (idx: number) =>
    setQueue((q) => q.filter((_, i) => i !== idx));

  const handleSaveAll = async () => {
    if (queue.length === 0) return;
    setSavingAll(true);
    const failed: NewDraft[] = [];
    for (const item of queue) {
      try {
        await commitDraft(item);
      } catch {
        failed.push(item);
      }
    }
    setSavingAll(false);
    const okCount = queue.length - failed.length;
    if (okCount > 0) toast.success(`Added ${okCount} product${okCount === 1 ? "" : "s"}`);
    if (failed.length > 0) {
      toast.error(`${failed.length} couldn't be added — left in the list to fix`);
      setQueue(failed);
    } else {
      setQueue([]);
    }
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

          {/* Selling price — hidden for ingredients (they're never sold). */}
          {!isIngredientKind && (
            <div className="space-y-1.5">
              <Label>Selling price ({isSpirit ? "per full bottle" : meta.pricing})</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={newP.price}
                onChange={(e) => setNewP({ ...newP, price: e.target.value })}
              />
            </div>
          )}

          {/* Buying price (cost). For sold items it powers profit = selling −
              buying in the report. For a spirit/wine it's the cost of a WHOLE
              bottle; each pour's cost is worked out from its ml. For an
              INGREDIENT it's the only price — it drives the kitchen food-cost
              (usage × buying price) compared against meals sold. */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              Buying price ({isSpirit ? "per full bottle" : meta.pricing})
              <span className="text-xs font-normal text-muted-foreground">
                {isIngredientKind ? "Recommended" : "Optional"}
              </span>
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder={isSpirit ? "What the bottle cost you" : "What you paid"}
              value={newP.cost}
              onChange={(e) => setNewP({ ...newP, cost: e.target.value })}
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

        <div className="mt-4 flex flex-col sm:flex-row justify-end gap-2">
          <Button variant="outline" onClick={addToQueue} className="px-5">
            <PackagePlus className="h-4 w-4 mr-1" /> Add to list
          </Button>
          <Button onClick={handleAdd} className="bg-gradient-primary px-6">
            <Plus className="h-4 w-4 mr-1" /> Add product
          </Button>
        </div>

        {/* Bulk queue — add several (e.g. a whole drinks list) then save at once. */}
        {queue.length > 0 && (
          <div className="mt-4 rounded-lg border bg-accent/30 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-sm font-semibold">
                {queue.length} product{queue.length === 1 ? "" : "s"} ready to save
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setQueue([])}
                  disabled={savingAll}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  className="bg-gradient-primary"
                  onClick={() => void handleSaveAll()}
                  disabled={savingAll}
                >
                  {savingAll ? "Saving…" : `Save all ${queue.length}`}
                </Button>
              </div>
            </div>
            <ul className="space-y-1.5">
              {queue.map((item, idx) => (
                <li
                  key={idx}
                  className="flex items-center gap-2 rounded-md bg-background/60 px-3 py-2 text-sm"
                >
                  <span className="font-medium truncate">{item.name}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {KIND_META[item.kind].label.split(" ")[0]}
                  </Badge>
                  <span className="text-muted-foreground shrink-0">
                    {ksh(Number(item.price))}
                    {item.cost.trim() ? ` · cost ${ksh(Number(item.cost))}` : ""}
                    {item.openingStock.trim() ? ` · ${item.openingStock} ${KIND_META[item.kind].unit}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(idx)}
                    disabled={savingAll}
                    className="ml-auto rounded-full hover:bg-destructive/20 p-1 shrink-0"
                    title="Remove from list"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
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

                        {/* PRICE cell — selling price, plus buying price &
                            margin as subtext (right-aligned, currency styling) */}
                        <td className="p-3 text-right align-middle">
                          {editing ? (
                            <div className="space-y-1.5">
                              {/* Ingredients have no selling price — only cost. */}
                              {!isIngredient(p) && (
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  value={editDraft.price}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, price: e.target.value })
                                  }
                                  placeholder="Sell"
                                  title="Selling price"
                                  className="h-9 w-28 ml-auto text-right no-spinner"
                                />
                              )}
                              <Input
                                type="number"
                                inputMode="decimal"
                                value={editDraft.cost}
                                onChange={(e) =>
                                  setEditDraft({ ...editDraft, cost: e.target.value })
                                }
                                placeholder="Buy (cost)"
                                title="Buying price"
                                className="h-9 w-28 ml-auto text-right no-spinner"
                              />
                            </div>
                          ) : isIngredient(p) ? (
                            // Ingredient: show the buying price only — it's not sold.
                            <div className="tabular-nums">
                              <span className="text-xs text-muted-foreground italic block">
                                not sold
                              </span>
                              {p.costPrice != null ? (
                                <span className="text-[11px] font-normal block text-muted-foreground">
                                  cost {ksh(p.costPrice)} / {p.unit}
                                </span>
                              ) : (
                                <span className="text-[11px] font-normal block text-amber-600">
                                  set buying price
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="font-bold text-primary tabular-nums">
                              {ksh(p.price)}
                              <span className="text-[11px] text-muted-foreground font-normal block">
                                / {p.unit}
                              </span>
                              {p.costPrice != null && (
                                <span className="text-[11px] font-normal block text-muted-foreground">
                                  cost {ksh(p.costPrice)}
                                  <span
                                    className={
                                      p.price - p.costPrice >= 0
                                        ? "text-success ml-1"
                                        : "text-destructive ml-1"
                                    }
                                  >
                                    ({p.price - p.costPrice >= 0 ? "+" : ""}
                                    {ksh(p.price - p.costPrice)})
                                  </span>
                                </span>
                              )}
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
                                    {" "}(bottle is {p.containerMl} ml
                                    {p.costPrice != null && `, cost ${ksh(p.costPrice)}`})
                                  </span>
                                </p>
                                {p.costPrice == null && (
                                  <p className="text-[11px] text-amber-600 mb-1.5">
                                    Set this bottle's buying price (Edit ✎) to see
                                    profit per Tot / Glass / bottle here.
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  {servingsFor(p.id).length === 0 ? (
                                    <span className="text-xs text-muted-foreground">
                                      No servings yet.
                                    </span>
                                  ) : (
                                    servingsFor(p.id).map((sv) => {
                                      // Cost of THIS pour = its share of the bottle's cost.
                                      const pourCost =
                                        p.costPrice != null && p.containerMl
                                          ? (sv.volumeMl / p.containerMl) * p.costPrice
                                          : null;
                                      const pourProfit =
                                        pourCost != null ? sv.price - pourCost : null;
                                      return (
                                        <Badge
                                          key={sv.id}
                                          variant="secondary"
                                          className="gap-1.5 py-1 pl-2.5 pr-1"
                                        >
                                          {sv.name} · {sv.volumeMl}ml · {ksh(sv.price)}
                                          {pourProfit != null && (
                                            <span
                                              className={
                                                pourProfit >= 0 ? "text-success" : "text-destructive"
                                              }
                                            >
                                              {pourProfit >= 0 ? "+" : ""}
                                              {ksh(pourProfit)}
                                            </span>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => removeServing(sv.id)}
                                            className="rounded-full hover:bg-destructive/20 p-0.5"
                                            title="Remove serving"
                                          >
                                            <X className="h-3 w-3" />
                                          </button>
                                        </Badge>
                                      );
                                    })
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
