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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Plus,
  Trash2,
  ShoppingCart,
  Zap,
  Banknote,
  Smartphone,
  Clock,
} from "lucide-react";
import { useProducts, useSales, usePurchases, useStock } from "@/lib/butchery-store";
import { PaymentMethod, Sale, SaleItem, todayISO } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";
import { toast } from "sonner";
import { ReceiptDialog } from "./ReceiptDialog";

export const POS = () => {
  const { products } = useProducts();
  const { add: addSale } = useSales();
  const { purchasedQtyFor } = usePurchases();
  const { soldQtyFor } = useSales();
  const { getOpening } = useStock();

  const [mode, setMode] = useState<"quick" | "cart">("quick");
  const [cart, setCart] = useState<SaleItem[]>([]);

  // shared inputs
  const [productId, setProductId] = useState<string>("");
  const [overridePrice, setOverridePrice] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [lastEdited, setLastEdited] = useState<"amount" | "qty">("amount");

  // payment
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [cashGiven, setCashGiven] = useState("");
  const [mpesaRef, setMpesaRef] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // receipt
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const product = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );

  const effectivePrice = useMemo(() => {
    const o = Number(overridePrice);
    if (Number.isFinite(o) && o > 0) return o;
    return product?.price ?? 0;
  }, [overridePrice, product]);

  const derivedAmount =
    lastEdited === "qty" && qtyInput && effectivePrice
      ? Number(qtyInput) * effectivePrice
      : null;
  const derivedQty =
    lastEdited === "amount" && amountInput && effectivePrice
      ? Number(amountInput) / effectivePrice
      : null;

  const finalQty = lastEdited === "qty" ? Number(qtyInput || 0) : derivedQty ?? 0;
  const finalAmount =
    lastEdited === "amount" ? Number(amountInput || 0) : derivedAmount ?? 0;

  const availableQty = (pid: string) =>
    getOpening(pid) + purchasedQtyFor(pid, todayISO()) - soldQtyFor(pid, todayISO());

  const resetItemInputs = () => {
    setOverridePrice("");
    setAmountInput("");
    setQtyInput("");
    setLastEdited("amount");
  };

  const resetPayment = () => {
    setCashGiven("");
    setMpesaRef("");
    setCustomerName("");
    setCustomerPhone("");
  };

  const buildItem = (): SaleItem | null => {
    if (!product) {
      toast.error("Pick a product");
      return null;
    }
    if (finalQty <= 0 || finalAmount <= 0) {
      toast.error("Enter amount or quantity");
      return null;
    }
    return {
      productId: product.id,
      quantity: finalQty,
      unitPrice: effectivePrice,
      amount: finalAmount,
    };
  };

  const cartTotal = cart.reduce((a, i) => a + i.amount, 0);
  const totalForPayment = mode === "quick" ? finalAmount : cartTotal;
  const change = Math.max((Number(cashGiven) || 0) - totalForPayment, 0);

  const validatePayment = () => {
    if (payment === "cash" && cashGiven && Number(cashGiven) < totalForPayment) {
      toast.error("Cash given is less than total");
      return false;
    }
    if (payment === "mpesa" && !mpesaRef.trim()) {
      toast.error("Enter M-Pesa reference");
      return false;
    }
    if (payment === "credit" && !customerName.trim()) {
      toast.error("Enter customer name for credit");
      return false;
    }
    return true;
  };

  const completeSale = (items: SaleItem[]) => {
    if (!validatePayment()) return;
    const sale = addSale({
      items,
      payment,
      cashGiven: payment === "cash" ? Number(cashGiven) || items.reduce((a, i) => a + i.amount, 0) : undefined,
      change: payment === "cash" ? change : undefined,
      mpesaRef: payment === "mpesa" ? mpesaRef.trim() : undefined,
      customerName: payment === "credit" ? customerName.trim() : undefined,
      customerPhone: payment === "credit" ? customerPhone.trim() || undefined : undefined,
      paid: payment === "credit" ? false : true,
    });
    setLastSale(sale);
    setShowReceipt(true);
    setCart([]);
    resetItemInputs();
    resetPayment();
    setProductId("");
    toast.success(`Sale ${sale.receiptNo} recorded`);
  };

  const handleQuickSell = () => {
    const item = buildItem();
    if (!item) return;
    completeSale([item]);
  };

  const addToCart = () => {
    const item = buildItem();
    if (!item) return;
    setCart((c) => [...c, item]);
    resetItemInputs();
    setProductId("");
    toast.success("Added to cart");
  };

  const removeCartItem = (i: number) =>
    setCart((c) => c.filter((_, idx) => idx !== i));

  const checkoutCart = () => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    completeSale(cart);
  };

  return (
    <>
      <Tabs value={mode} onValueChange={(v) => setMode(v as "quick" | "cart")}>
        <TabsList className="mb-4">
          <TabsTrigger value="quick" className="gap-2">
            <Zap className="h-4 w-4" /> Quick sell
          </TabsTrigger>
          <TabsTrigger value="cart" className="gap-2">
            <ShoppingCart className="h-4 w-4" /> Cart ({cart.length})
          </TabsTrigger>
        </TabsList>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          {/* LEFT — item entry */}
          <Card className="p-6 shadow-elevated">
            <ItemEntry
              products={products}
              productId={productId}
              setProductId={setProductId}
              overridePrice={overridePrice}
              setOverridePrice={setOverridePrice}
              amountInput={amountInput}
              setAmountInput={setAmountInput}
              qtyInput={qtyInput}
              setQtyInput={setQtyInput}
              lastEdited={lastEdited}
              setLastEdited={setLastEdited}
              derivedAmount={derivedAmount}
              derivedQty={derivedQty}
              effectivePrice={effectivePrice}
              availableQty={availableQty}
              finalQty={finalQty}
              finalAmount={finalAmount}
            />

            <TabsContent value="quick" className="mt-4 p-0">
              <PaymentSection
                total={totalForPayment}
                payment={payment}
                setPayment={setPayment}
                cashGiven={cashGiven}
                setCashGiven={setCashGiven}
                change={change}
                mpesaRef={mpesaRef}
                setMpesaRef={setMpesaRef}
                customerName={customerName}
                setCustomerName={setCustomerName}
                customerPhone={customerPhone}
                setCustomerPhone={setCustomerPhone}
              />
              <Button
                onClick={handleQuickSell}
                className="w-full bg-gradient-primary h-12 mt-4 text-base"
                disabled={!product || finalAmount <= 0}
              >
                Complete Sale & Print Receipt
              </Button>
            </TabsContent>

            <TabsContent value="cart" className="mt-4 p-0">
              <Button
                onClick={addToCart}
                variant="outline"
                className="w-full h-11"
                disabled={!product || finalAmount <= 0}
              >
                <Plus className="h-4 w-4 mr-1" /> Add to cart
              </Button>
            </TabsContent>
          </Card>

          {/* RIGHT — cart in cart-mode, recent sales in quick-mode */}
          <TabsContent value="cart" className="m-0">
            <Card className="p-5 shadow-soft sticky top-24">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" /> Cart
              </h3>
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No items added yet
                </p>
              ) : (
                <>
                  <div className="space-y-2 max-h-[280px] overflow-auto">
                    {cart.map((it, i) => {
                      const p = products.find((x) => x.id === it.productId);
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 border-b last:border-0 pb-2 last:pb-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{p?.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {qty(it.quantity, p?.unit ?? "")} × {ksh(it.unitPrice)}
                            </p>
                          </div>
                          <p className="font-bold text-primary text-sm">
                            {ksh(it.amount)}
                          </p>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removeCartItem(i)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t mt-3 pt-3 flex items-center justify-between">
                    <span className="text-sm font-semibold">Total</span>
                    <span className="text-xl font-bold text-primary">
                      {ksh(cartTotal)}
                    </span>
                  </div>
                  <div className="mt-4">
                    <PaymentSection
                      total={cartTotal}
                      payment={payment}
                      setPayment={setPayment}
                      cashGiven={cashGiven}
                      setCashGiven={setCashGiven}
                      change={change}
                      mpesaRef={mpesaRef}
                      setMpesaRef={setMpesaRef}
                      customerName={customerName}
                      setCustomerName={setCustomerName}
                      customerPhone={customerPhone}
                      setCustomerPhone={setCustomerPhone}
                      compact
                    />
                  </div>
                  <Button
                    onClick={checkoutCart}
                    className="w-full bg-gradient-primary h-11 mt-3"
                  >
                    Checkout & Print
                  </Button>
                </>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="quick" className="m-0">
            <RecentSalesCard />
          </TabsContent>
        </div>
      </Tabs>

      <ReceiptDialog
        sale={lastSale}
        products={products}
        open={showReceipt}
        onClose={() => setShowReceipt(false)}
        autoPrint
      />
    </>
  );
};

/* -------------------- Sub-components -------------------- */

function ItemEntry(props: {
  products: ReturnType<typeof useProducts>["products"];
  productId: string;
  setProductId: (v: string) => void;
  overridePrice: string;
  setOverridePrice: (v: string) => void;
  amountInput: string;
  setAmountInput: (v: string) => void;
  qtyInput: string;
  setQtyInput: (v: string) => void;
  lastEdited: "amount" | "qty";
  setLastEdited: (v: "amount" | "qty") => void;
  derivedAmount: number | null;
  derivedQty: number | null;
  effectivePrice: number;
  availableQty: (id: string) => number;
  finalQty: number;
  finalAmount: number;
}) {
  const {
    products, productId, setProductId, overridePrice, setOverridePrice,
    amountInput, setAmountInput, qtyInput, setQtyInput,
    lastEdited, setLastEdited, derivedAmount, derivedQty,
    effectivePrice, availableQty, finalQty, finalAmount,
  } = props;
  const [search, setSearch] = useState("");

  const product = products.find((p) => p.id === productId);
  const avail = product ? availableQty(product.id) : 0;
  const overSell = product && finalQty > avail;
  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const typeLabel: Record<string, string> = {
    per_kg: "Per kg",
    fixed: "Fixed",
    meal: "Meal",
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Choose product</Label>
          <Input
            placeholder="Search meat or item"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="grid gap-2 max-h-72 overflow-auto rounded-md border bg-muted/30 p-2">
          {filteredProducts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No matching product found
            </p>
          ) : (
            filteredProducts.map((p) => {
              const isActive = p.id === productId;
              const currentAvail = availableQty(p.id);

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProductId(p.id)}
                  className={[
                    "grid w-full grid-cols-[1fr_auto] gap-3 rounded-md border px-3 py-3 text-left transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 shadow-soft"
                      : "border-border bg-background hover:border-primary/40 hover:bg-accent/40",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{p.name}</span>
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {typeLabel[p.type]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {ksh(p.price)} / {p.unit}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {qty(currentAvail, p.unit)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">available</p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {product && (
          <div className="rounded-md border bg-accent/30 px-3 py-2 text-xs text-muted-foreground">
            Selected: <span className="font-semibold text-foreground">{product.name}</span>
            {" · "}Available today:{" "}
            <span className={avail <= 0 ? "font-semibold text-destructive" : "font-semibold text-foreground"}>
              {qty(avail, product.unit)}
            </span>
          </div>
        )}
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

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (Ksh)</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g. 400"
                value={
                  lastEdited === "amount"
                    ? amountInput
                    : derivedAmount != null ? derivedAmount.toFixed(0) : ""
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
                    : derivedQty != null ? derivedQty.toFixed(3) : ""
                }
                onChange={(e) => {
                  setQtyInput(e.target.value);
                  setLastEdited("qty");
                }}
              />
            </div>
          </div>

          {finalAmount > 0 && finalQty > 0 && (
            <div className={`rounded-xl border p-3 ${overSell ? "bg-destructive/10 border-destructive/40" : "bg-gradient-surface"}`}>
              <p className="text-sm">
                <span className="font-semibold">{product.name}</span> →{" "}
                <span className="font-bold text-primary">{qty(finalQty, product.unit)}</span> for{" "}
                <span className="font-bold text-primary">{ksh(finalAmount)}</span>{" "}
                @ {ksh(effectivePrice)}/{product.unit}
              </p>
              {overSell && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  ⚠ Exceeds available stock ({qty(avail, product.unit)})
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PaymentSection(props: {
  total: number;
  payment: PaymentMethod;
  setPayment: (p: PaymentMethod) => void;
  cashGiven: string;
  setCashGiven: (v: string) => void;
  change: number;
  mpesaRef: string;
  setMpesaRef: (v: string) => void;
  customerName: string;
  setCustomerName: (v: string) => void;
  customerPhone: string;
  setCustomerPhone: (v: string) => void;
  compact?: boolean;
}) {
  const {
    total, payment, setPayment, cashGiven, setCashGiven, change,
    mpesaRef, setMpesaRef, customerName, setCustomerName,
    customerPhone, setCustomerPhone, compact,
  } = props;

  return (
    <div className={compact ? "space-y-3" : "space-y-3 border-t pt-4"}>
      {!compact && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-2xl font-bold text-primary">{ksh(total)}</span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {([
          { key: "cash", label: "Cash", icon: Banknote },
          { key: "mpesa", label: "M-Pesa", icon: Smartphone },
          { key: "credit", label: "Credit", icon: Clock },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setPayment(key)}
            className={`rounded-lg border p-2.5 flex flex-col items-center gap-1 text-xs font-medium transition-all ${
              payment === key
                ? "border-primary bg-primary text-primary-foreground shadow-soft"
                : "border-border hover:border-primary/50 hover:bg-muted"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {payment === "cash" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Cash given</Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder={String(Math.round(total))}
              value={cashGiven}
              onChange={(e) => setCashGiven(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Change</Label>
            <div className="h-10 px-3 rounded-md border bg-muted flex items-center font-bold text-primary">
              {ksh(change)}
            </div>
          </div>
        </div>
      )}

      {payment === "mpesa" && (
        <div className="space-y-1">
          <Label className="text-xs">M-Pesa reference</Label>
          <Input
            placeholder="e.g. SLA8X9P21K"
            value={mpesaRef}
            onChange={(e) => setMpesaRef(e.target.value.toUpperCase())}
          />
        </div>
      )}

      {payment === "credit" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Customer name *</Label>
            <Input
              placeholder="Required"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone (optional)</Label>
            <Input
              placeholder="0700..."
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function RecentSalesCard() {
  const { products } = useProducts();
  const { sales } = useSales(todayISO());

  return (
    <Card className="p-5 shadow-soft h-fit">
      <h3 className="font-semibold mb-4">Recent sales today</h3>
      {sales.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No sales yet today
        </p>
      ) : (
        <div className="space-y-2 max-h-[480px] overflow-auto">
          {sales.slice(0, 15).map((s) => (
            <div key={s.id} className="border-b last:border-0 pb-2 last:pb-0">
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  {s.receiptNo}
                </span>
                <span className="font-bold text-primary">{ksh(s.subtotal)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {s.items.length} item(s) ·{" "}
                {new Date(s.timestamp).toLocaleTimeString("en-KE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · <span className="uppercase font-medium">{s.payment}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
