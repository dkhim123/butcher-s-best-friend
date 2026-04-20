import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Receipt } from "lucide-react";
import { useProducts, useSales } from "@/lib/butchery-store";
import { ksh, qty } from "@/lib/format";
import { toast } from "sonner";

export const SaleEntry = () => {
  const { products } = useProducts();
  const { add, sales } = useSales(new Date().toISOString().slice(0, 10));

  const [productId, setProductId] = useState<string>("");
  const [overridePrice, setOverridePrice] = useState<string>("");
  const [amountInput, setAmountInput] = useState<string>("");
  const [qtyInput, setQtyInput] = useState<string>("");
  const [lastEdited, setLastEdited] = useState<"amount" | "qty">("amount");

  const product = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );

  const effectivePrice = useMemo(() => {
    const o = Number(overridePrice);
    if (Number.isFinite(o) && o > 0) return o;
    return product?.price ?? 0;
  }, [overridePrice, product]);

  // Auto-derive the field that wasn't last edited
  const derivedAmount = useMemo(() => {
    if (lastEdited === "qty" && qtyInput && effectivePrice) {
      return Number(qtyInput) * effectivePrice;
    }
    return null;
  }, [lastEdited, qtyInput, effectivePrice]);

  const derivedQty = useMemo(() => {
    if (lastEdited === "amount" && amountInput && effectivePrice) {
      return Number(amountInput) / effectivePrice;
    }
    return null;
  }, [lastEdited, amountInput, effectivePrice]);

  const finalQty =
    lastEdited === "qty" ? Number(qtyInput || 0) : derivedQty ?? 0;
  const finalAmount =
    lastEdited === "amount" ? Number(amountInput || 0) : derivedAmount ?? 0;

  const reset = () => {
    setOverridePrice("");
    setAmountInput("");
    setQtyInput("");
    setLastEdited("amount");
  };

  const handleSell = () => {
    if (!product) {
      toast.error("Pick a product first");
      return;
    }
    if (finalQty <= 0 || finalAmount <= 0) {
      toast.error("Enter amount or quantity");
      return;
    }
    add({
      productId: product.id,
      quantity: finalQty,
      amount: finalAmount,
      unitPriceAtSale: effectivePrice,
    });
    toast.success(
      `Sold ${qty(finalQty, product.unit)} of ${product.name} for ${ksh(finalAmount)}`,
    );
    reset();
  };

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      <Card className="p-6 shadow-elevated">
        <div className="flex items-center gap-2 mb-5">
          <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center">
            <ShoppingCart className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">New Sale</h2>
            <p className="text-xs text-muted-foreground">
              Enter amount in Ksh OR quantity — the other auto-fills
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {ksh(p.price)} / {p.unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {product && (
            <>
              <div className="space-y-1.5">
                <Label className="flex items-center justify-between">
                  <span>Price for this sale (Ksh / {product.unit})</span>
                  <Badge variant="secondary" className="text-xs">
                    Default {ksh(product.price)}
                  </Badge>
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={`Override default (${product.price})`}
                  value={overridePrice}
                  onChange={(e) => setOverridePrice(e.target.value)}
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Amount (Ksh)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="e.g. 400"
                    value={
                      lastEdited === "amount"
                        ? amountInput
                        : derivedAmount != null
                          ? derivedAmount.toFixed(0)
                          : ""
                    }
                    onChange={(e) => {
                      setAmountInput(e.target.value);
                      setLastEdited("amount");
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity ({product.unit})</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder={product.unit === "kg" ? "e.g. 0.5" : "e.g. 1"}
                    value={
                      lastEdited === "qty"
                        ? qtyInput
                        : derivedQty != null
                          ? derivedQty.toFixed(3)
                          : ""
                    }
                    onChange={(e) => {
                      setQtyInput(e.target.value);
                      setLastEdited("qty");
                    }}
                  />
                </div>
              </div>

              {(finalAmount > 0 && finalQty > 0) && (
                <div className="rounded-xl bg-gradient-surface border p-4">
                  <p className="text-xs uppercase text-muted-foreground tracking-wider mb-2">
                    Summary
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">{product.name}</span> — give the
                    customer{" "}
                    <span className="font-bold text-primary">
                      {qty(finalQty, product.unit)}
                    </span>{" "}
                    for{" "}
                    <span className="font-bold text-primary">{ksh(finalAmount)}</span>{" "}
                    @ {ksh(effectivePrice)} / {product.unit}
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSell} className="flex-1 bg-gradient-primary h-11">
                  <Receipt className="h-4 w-4 mr-2" /> Record Sale
                </Button>
                <Button variant="outline" onClick={reset} className="h-11">
                  Clear
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card className="p-5 shadow-soft h-fit">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" /> Recent sales today
        </h3>
        {sales.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No sales yet today
          </p>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-auto">
            {sales.slice(0, 20).map((s) => {
              const p = products.find((x) => x.id === s.productId);
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0"
                >
                  <div>
                    <p className="font-medium">{p?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {qty(s.quantity, p?.unit ?? "")} ·{" "}
                      {new Date(s.timestamp).toLocaleTimeString("en-KE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <p className="font-bold text-primary">{ksh(s.amount)}</p>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
