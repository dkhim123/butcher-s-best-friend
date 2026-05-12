import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Banknote,
  Smartphone,
  Clock,
  Scale,
  PlugZap,
  Unplug,
  Search,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useProducts, useSales, useStockOnHand } from "@/lib/butchery-store";
import { PaymentMethod, Product, Sale, SaleItem } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";
import { toast } from "sonner";
import { ReceiptDialog } from "./ReceiptDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useWeighingScale } from "@/lib/useWeighingScale";

/**
 * POS — supermarket-style "tap to add" cashier UI.
 *
 * Mental model (plain English):
 *   - The big grid on the left = the products.
 *   - Tapping a product adds 1 of it to the cart.
 *   - Tapping the same product again increases its quantity.
 *   - The cart on the right shows what they bought, with +/- buttons.
 *   - Cashier can type a custom quantity (e.g. "1.5" for kg of beef).
 *   - Cashier can override the price of one line by clicking the pencil.
 *   - When ready, pick a payment method and click "Complete sale".
 *
 * Why not the old form-y POS?
 *   Cashiers shouldn't have to remember to click 4 places in order
 *   ("pick a product, scroll down, fill in qty, click Add to cart").
 *   That added friction every transaction. The supermarket pattern
 *   (tap-tap-tap-pay) is what a non-tech person already expects.
 */

interface CartLine {
  productId: string;
  quantity: number;
  /** When set, overrides the product's default price for this line only. */
  unitPriceOverride?: number;
}

export const POS = () => {
  const { org } = useAuth();
  const { products } = useProducts();
  const { add: addSale } = useSales();
  const { byProductId: stockOnHand } = useStockOnHand();
  const scale = useWeighingScale();

  // ── Cart state ──────────────────────────────────────────────
  // We aggregate by productId (no duplicate lines) so tapping the
  // same card twice = quantity goes up, NOT a second line. That's
  // what makes the "tap again to add one more" UX feel natural.
  const [cart, setCart] = useState<CartLine[]>([]);

  // The most recently tapped per_kg product. The weighing scale's
  // live readings are written into THIS line so the cashier doesn't
  // have to manually associate a weight with a row.
  const [activeKgLineId, setActiveKgLineId] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  // ── Payment state ───────────────────────────────────────────
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [cashGiven, setCashGiven] = useState("");
  const [mpesaRef, setMpesaRef] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // ── Receipt + saving state ──────────────────────────────────
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [selling, setSelling] = useState(false);

  // Returns how much of a product is on hand right now.
  // Returns Infinity for products that don't track stock (meals, etc.)
  // so the cashier never gets blocked by a stock warning on those.
  const availableQty = (pid: string): number => {
    const p = products.find((x) => x.id === pid);
    if (!p) return 0;
    if (!p.trackStock) return Number.POSITIVE_INFINITY;
    return stockOnHand(pid);
  };

  // ── Cart operations ─────────────────────────────────────────

  /** Tap a product card → +1 if not already in cart, else qty + 1. */
  const tapProduct = (p: Product) => {
    setCart((c) => {
      const idx = c.findIndex(
        (l) => l.productId === p.id && l.unitPriceOverride === undefined,
      );
      if (idx === -1) {
        return [...c, { productId: p.id, quantity: 1 }];
      }
      const next = [...c];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
      return next;
    });
    if (p.type === "per_kg") setActiveKgLineId(p.id);
  };

  const setLineQty = (productId: string, q: number) =>
    setCart((c) =>
      c.map((l) =>
        l.productId === productId ? { ...l, quantity: Math.max(0, q) } : l,
      ),
    );

  const incrementLine = (productId: string, by: number) =>
    setCart((c) =>
      c.map((l) =>
        l.productId === productId
          ? { ...l, quantity: Math.max(0, Number((l.quantity + by).toFixed(3))) }
          : l,
      ),
    );

  const setLinePrice = (productId: string, price?: number) =>
    setCart((c) =>
      c.map((l) =>
        l.productId === productId ? { ...l, unitPriceOverride: price } : l,
      ),
    );

  const removeLine = (productId: string) =>
    setCart((c) => c.filter((l) => l.productId !== productId));

  // ── Scale → active kg line ──────────────────────────────────
  // When a kg product is in the cart AND the scale streams a weight,
  // write it into that line. The cashier can still type over it.
  useEffect(() => {
    if (!scale.connected || scale.lastWeight == null) return;
    if (!activeKgLineId) return;
    setLineQty(activeKgLineId, scale.lastWeight);
  }, [scale.connected, scale.lastWeight, scale.lastReadAt, activeKgLineId]);

  // ── Computed values ─────────────────────────────────────────
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, l) => {
      const p = products.find((x) => x.id === l.productId);
      if (!p) return sum;
      const price = l.unitPriceOverride ?? p.price;
      return sum + price * l.quantity;
    }, 0);
  }, [cart, products]);

  const change = Math.max((Number(cashGiven) || 0) - cartTotal, 0);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((p) => p.name.toLowerCase().includes(term));
  }, [products, search]);

  // ── Checkout ────────────────────────────────────────────────
  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    for (const line of cart) {
      const p = products.find((x) => x.id === line.productId);
      if (!p) continue;
      if (line.quantity <= 0) {
        toast.error(`Set quantity for ${p.name}`);
        return;
      }
      const price = line.unitPriceOverride ?? p.price;
      if (price <= 0) {
        toast.error(`Set price for ${p.name}`);
        return;
      }
    }
    if (payment === "cash" && cashGiven && Number(cashGiven) < cartTotal) {
      toast.error("Cash given is less than total");
      return;
    }
    if (payment === "mpesa" && !mpesaRef.trim()) {
      toast.error("Enter M-Pesa reference");
      return;
    }
    if (payment === "credit" && !customerName.trim()) {
      toast.error("Enter customer name for credit sale");
      return;
    }

    const items: SaleItem[] = cart.map((line) => {
      const p = products.find((x) => x.id === line.productId)!;
      const price = line.unitPriceOverride ?? p.price;
      return {
        productId: p.id,
        quantity: line.quantity,
        unitPrice: price,
        amount: line.quantity * price,
      };
    });

    setSelling(true);
    try {
      const sale = await addSale({
        items,
        payment,
        cashGiven:
          payment === "cash" ? Number(cashGiven) || cartTotal : undefined,
        change: payment === "cash" ? change : undefined,
        mpesaRef: payment === "mpesa" ? mpesaRef.trim() : undefined,
        customerName: payment === "credit" ? customerName.trim() : undefined,
        customerPhone:
          payment === "credit" ? customerPhone.trim() || undefined : undefined,
        paid: payment !== "credit",
      });
      setLastSale(sale);
      setShowReceipt(true);
      setCart([]);
      setActiveKgLineId(null);
      setCashGiven("");
      setMpesaRef("");
      setCustomerName("");
      setCustomerPhone("");
      toast.success(`Sale ${sale.receiptNo} recorded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save sale");
    } finally {
      setSelling(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <>
      <div className="grid lg:grid-cols-[1fr_420px] gap-6">
        {/* LEFT — product grid */}
        <div className="space-y-4">
          <Card className="p-3 shadow-soft">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search product…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 pl-9 text-base"
                />
              </div>
              <ScaleButton scale={scale} />
            </div>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filteredProducts.length === 0 ? (
              <p className="col-span-full text-center text-sm text-muted-foreground py-12">
                No matching product
              </p>
            ) : (
              filteredProducts.map((p) => (
                <ProductTile
                  key={p.id}
                  product={p}
                  stock={availableQty(p.id)}
                  inCart={cart.find((l) => l.productId === p.id)?.quantity ?? 0}
                  onTap={() => tapProduct(p)}
                />
              ))
            )}
          </div>
        </div>

        {/* RIGHT — cart.
            Sticky on desktop so it stays visible while scrolling the
            product grid. Uses the full viewport height minus the header
            so MANY cart rows are visible at once — receipt-style. */}
        <Card className="p-4 shadow-elevated lg:sticky lg:top-24 lg:self-start flex flex-col h-[calc(100vh-7rem)] min-h-[480px]">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Cart
            {cart.length > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {cart.length} item{cart.length === 1 ? "" : "s"}
              </Badge>
            )}
          </h3>

          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
              <ShoppingCart className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                Tap a product to add it to the sale.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Tap again to increase the quantity.
              </p>
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-2 overflow-auto pr-1 -mr-1 min-h-0">
                {cart.map((line) => {
                  const p = products.find((x) => x.id === line.productId);
                  if (!p) return null;
                  return (
                    <CartLineRow
                      key={line.productId}
                      product={p}
                      line={line}
                      available={availableQty(p.id)}
                      onIncrement={(by) => incrementLine(p.id, by)}
                      onSetQty={(v) => setLineQty(p.id, v)}
                      onSetPrice={(v) => setLinePrice(p.id, v)}
                      onRemove={() => removeLine(p.id)}
                    />
                  );
                })}
              </div>

              <div className="border-t mt-3 pt-3 flex items-center justify-between">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-2xl font-bold text-primary tabular-nums">
                  {ksh(cartTotal)}
                </span>
              </div>

              <div className="mt-3">
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
                onClick={handleCheckout}
                disabled={selling}
                className="w-full bg-gradient-primary h-12 mt-3 text-base font-semibold"
              >
                {selling ? "Saving…" : "Complete sale"}
              </Button>
            </>
          )}
        </Card>
      </div>

      <ReceiptDialog
        sale={lastSale}
        products={products}
        open={showReceipt}
        onClose={() => setShowReceipt(false)}
        autoPrint
        shopName={org?.name}
        logoUrl={org?.logo_url}
      />
    </>
  );
};

/* ───────────────────────────────────────────────────────────────
 * ProductTile — one tile in the product grid.
 *
 * Big, bold, tappable. Three live indicators:
 *   • Top-right badge: how many of this item are already in the cart
 *   • Available stock = total stock MINUS what's already in the cart
 *   • Out-of-stock state when available <= 0
 *
 * The "live deduction" is purely cosmetic — the actual stock_movement
 * row only gets written when the sale is completed. But by showing the
 * cashier "48 available · 2 in cart" instead of always "50 in stock",
 * we prevent the confusion of "why does it still say 50 when I've
 * already grabbed 2?".
 * ───────────────────────────────────────────────────────────── */
function ProductTile({
  product,
  stock,
  inCart,
  onTap,
}: {
  product: Product;
  /** Persisted stock on hand (from v_stock_on_hand). */
  stock: number;
  /** Quantity currently in the cart for THIS product. */
  inCart: number;
  onTap: () => void;
}) {
  const isInfinite = !Number.isFinite(stock);
  // Effective stock = what's left after the cart is committed.
  const effective = isInfinite ? stock : Math.max(0, stock - inCart);
  const out = !isInfinite && effective <= 0;

  return (
    <button
      type="button"
      onClick={onTap}
      className="group relative flex min-h-[7rem] flex-col gap-1 rounded-xl border bg-background p-4 text-left transition-all hover:border-primary/60 hover:shadow-soft active:scale-[0.98]"
    >
      {inCart > 0 && (
        <Badge className="absolute -top-2 -right-2 h-7 min-w-7 rounded-full flex items-center justify-center px-1.5 text-sm font-bold bg-primary text-primary-foreground border-2 border-background shadow-soft tabular-nums">
          {inCart}
        </Badge>
      )}

      <p className="font-semibold text-base leading-tight pr-6">
        {product.name}
      </p>
      <p className="text-primary font-bold text-lg">
        {ksh(product.price)}
        <span className="text-xs font-medium text-muted-foreground">
          {" "}
          / {product.unit}
        </span>
      </p>

      <div className="mt-auto pt-1">
        {product.trackStock ? (
          out ? (
            <p className="text-xs text-destructive font-semibold">
              Out of stock
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {qty(effective, product.unit)} available
              {inCart > 0 && (
                <span className="ml-1 text-[10px] text-primary">
                  · {qty(inCart, product.unit)} in cart
                </span>
              )}
            </p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">Tap to add</p>
        )}
      </div>
    </button>
  );
}

/* ───────────────────────────────────────────────────────────────
 * CartLineRow — one COMPACT line in the cart, receipt-style.
 *
 * Layout (2 rows for fixed/meal items, 3 rows for per_kg meat):
 *   Row 1: product name ······························ subtotal  [×]
 *   Row 2: [−] [qty input] [+] unit  ×  Ksh price /unit (tap to edit)
 *   Row 3 (per_kg only):
 *     Add: [+¼kg] [+½kg] [+¾kg] [+1kg] [+2kg]   or Ksh: [____]
 *
 * Why the extra row for meat?
 *   - Non-tech cashiers don't think "0.25" — they think "a quarter".
 *     Preset buttons let them stack fractional weights in single taps.
 *   - The presets are ADDITIVE: every tap adds its weight to the
 *     current quantity, mimicking a butcher's scale where you keep
 *     piling meat on. So "4¼ kg of fish" =
 *         tap Fish → 1 kg, +2kg → 3 kg, +1kg → 4 kg, +¼kg → 4.25 kg.
 *   - Customers say "Ksh 440 of beef" all the time. The Ksh field
 *     auto-divides by the unit price, so the cashier never does
 *     mental arithmetic.
 *
 * Per_kg lines step by 0.5 with the +/- buttons. Fixed/meal lines
 * step by 1.
 * ───────────────────────────────────────────────────────────── */

// Additive weight presets for kg products. Labels use the Unicode
// vulgar fractions (¼, ½, ¾) which are immediately recognisable to
// non-tech users — much clearer than typing "0.25".
const KG_PRESETS: { label: string; value: number }[] = [
  { label: "¼kg", value: 0.25 },
  { label: "½kg", value: 0.5 },
  { label: "¾kg", value: 0.75 },
  { label: "1kg", value: 1 },
  { label: "2kg", value: 2 },
];

function CartLineRow({
  product,
  line,
  available,
  onIncrement,
  onSetQty,
  onSetPrice,
  onRemove,
}: {
  product: Product;
  line: CartLine;
  available: number;
  onIncrement: (by: number) => void;
  onSetQty: (v: number) => void;
  onSetPrice: (v?: number) => void;
  onRemove: () => void;
}) {
  const isKg = product.type === "per_kg";
  const step = isKg ? 0.5 : 1;
  const price = line.unitPriceOverride ?? product.price;
  const subtotal = price * line.quantity;
  const overSell = product.trackStock && line.quantity > available;

  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState(String(price));

  // Local state for the "or Ksh" field. Typing here computes the
  // quantity in real time so the line subtotal lands close to the
  // amount the customer asked for. We don't auto-sync this field
  // back from quantity changes — it's a one-shot input the cashier
  // can ignore once they've used it.
  const [amountDraft, setAmountDraft] = useState("");

  const savePrice = () => {
    const n = Number(priceDraft);
    if (Number.isFinite(n) && n > 0) {
      // If the cashier types the default price back, drop the override
      // so the "override" badge disappears — keeps the UI clean.
      onSetPrice(n === product.price ? undefined : n);
    }
    setEditingPrice(false);
  };

  // When user types in the "or Ksh" field, recompute the kg quantity.
  // Rounded to 3 decimals which is the standard butchery precision.
  const handleAmountChange = (txt: string) => {
    setAmountDraft(txt);
    const amount = Number(txt);
    if (!Number.isFinite(amount) || amount < 0) return;
    if (price <= 0) return;
    onSetQty(Number((amount / price).toFixed(3)));
  };

  // Presets are ADDITIVE — every tap STACKS more weight onto the line.
  // That mirrors how a real butcher's scale works: you keep adding meat
  // until the customer says "stop". So "4¼ kg of fish" is:
  //   Tap Fish → 1 kg, Tap 2kg → 3 kg, Tap 1kg → 4 kg, Tap ¼kg → 4.25 kg.
  // No decimals, no typing — just four taps a non-tech cashier can do.
  const handlePreset = (value: number) => {
    const next = Number((line.quantity + value).toFixed(3));
    onSetQty(next);
    setAmountDraft("");
  };

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        overSell ? "border-destructive/50 bg-destructive/5" : "bg-background"
      }`}
    >
      {/* Row 1: name + subtotal + remove (no wasted vertical space) */}
      <div className="flex items-center gap-2">
        <p className="font-semibold text-sm flex-1 truncate">{product.name}</p>
        <span className="font-bold text-primary text-sm tabular-nums whitespace-nowrap">
          {ksh(subtotal)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 -mr-1 shrink-0"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>

      {/* Row 2: qty controls + per-unit price (click to edit) */}
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7 shrink-0"
          onClick={() => onIncrement(-step)}
          aria-label="Decrease"
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Input
          type="number"
          inputMode="decimal"
          value={line.quantity}
          step={step}
          min={0}
          onChange={(e) => onSetQty(Number(e.target.value) || 0)}
          className="h-7 w-14 text-center font-semibold tabular-nums px-1 no-spinner"
        />
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7 shrink-0"
          onClick={() => onIncrement(step)}
          aria-label="Increase"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <span className="text-muted-foreground">{product.unit}</span>
        <span className="text-muted-foreground">×</span>

        {editingPrice ? (
          <>
            <Input
              type="number"
              inputMode="decimal"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") savePrice();
                if (e.key === "Escape") setEditingPrice(false);
              }}
              className="h-7 w-16 text-xs px-1 no-spinner"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={savePrice}
            >
              <Check className="h-3 w-3 text-success" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setEditingPrice(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setPriceDraft(String(price));
              setEditingPrice(true);
            }}
            className="group/price inline-flex items-center gap-1 text-muted-foreground hover:text-foreground ml-auto"
            title="Tap to override the price for this sale"
          >
            <span className="tabular-nums">{ksh(price)}</span>
            <span className="opacity-70">/ {product.unit}</span>
            {line.unitPriceOverride != null && (
              <Badge variant="secondary" className="text-[9px] uppercase px-1 py-0">
                override
              </Badge>
            )}
            <Pencil className="h-3 w-3 opacity-40 group-hover/price:opacity-100 transition-opacity" />
          </button>
        )}
      </div>

      {/* Row 3: per_kg helpers — additive preset weights + amount input.
          Hidden for fixed/meal items because they're inherently
          whole-unit (1 bottle, 1 plate) and don't need helpers. */}
      {isKg && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap text-[11px]">
          <span className="text-muted-foreground mr-0.5">Add:</span>
          {KG_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => handlePreset(p.value)}
              className="px-1.5 py-0.5 rounded border border-border text-[10px] font-medium tabular-nums transition-colors hover:border-primary/60 hover:bg-primary/5 active:scale-[0.97]"
              title={`Add ${p.label} to the quantity`}
            >
              +{p.label}
            </button>
          ))}
          <span className="text-muted-foreground ml-1">or Ksh:</span>
          <Input
            type="number"
            inputMode="decimal"
            placeholder="e.g. 440"
            value={amountDraft}
            onChange={(e) => handleAmountChange(e.target.value)}
            className="h-6 w-16 text-[11px] px-1.5 no-spinner"
            title="Type the customer's amount; quantity is computed automatically"
          />
        </div>
      )}

      {overSell && (
        <p className="mt-1 text-[10px] text-destructive font-medium">
          ⚠ Only {qty(available, product.unit)} in stock
        </p>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
 * PaymentSection — cash / M-Pesa / credit picker + the
 * supplementary inputs each method needs. Compact variant fits
 * neatly inside the cart panel.
 * ───────────────────────────────────────────────────────────── */
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
    total,
    payment,
    setPayment,
    cashGiven,
    setCashGiven,
    change,
    mpesaRef,
    setMpesaRef,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    compact,
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
        {(
          [
            { key: "cash", label: "Cash", icon: Banknote },
            { key: "mpesa", label: "M-Pesa", icon: Smartphone },
            { key: "credit", label: "Credit", icon: Clock },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
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
            <div className="h-10 px-3 rounded-md border bg-muted flex items-center font-bold text-primary tabular-nums">
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

/* ───────────────────────────────────────────────────────────────
 * ScaleButton — tiny pill that connects/disconnects a USB scale.
 * Lives in the top search bar. Gracefully shows "Not supported"
 * on browsers without Web Serial (Firefox, Safari, mobile).
 * ───────────────────────────────────────────────────────────── */
function ScaleButton({
  scale,
}: {
  scale: ReturnType<typeof useWeighingScale>;
}) {
  if (!scale.isSupported) {
    return (
      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1 px-2 whitespace-nowrap">
        <Scale className="h-3.5 w-3.5" /> Type kg manually
      </span>
    );
  }
  if (scale.connected) {
    return (
      <button
        type="button"
        onClick={() => void scale.disconnect()}
        className="text-xs inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-3 py-2 text-success hover:bg-success/20 whitespace-nowrap"
        title={
          scale.lastWeight != null
            ? `Live reading: ${scale.lastWeight.toFixed(3)} kg`
            : "Scale connected"
        }
      >
        <Unplug className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Scale on</span>
        {scale.lastWeight != null && (
          <span className="font-mono font-semibold">
            {scale.lastWeight.toFixed(2)} kg
          </span>
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void scale.connect()}
      className="text-xs inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-2 text-primary hover:bg-primary/20 whitespace-nowrap"
      title={scale.error ?? "Click to pick the scale's COM port"}
    >
      <PlugZap className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Connect scale</span>
      <span className="sm:hidden">Scale</span>
    </button>
  );
}
