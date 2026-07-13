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
  CreditCard,
  Clock,
  Scale,
  PlugZap,
  Unplug,
  Search,
  Pencil,
  Check,
  X,
  UtensilsCrossed,
  Wine,
  Hotel,
  SplitSquareHorizontal,
  ClipboardList,
} from "lucide-react";
import { useCustomers, useOrders, useProducts, useSales, useServings, useShift, useStockOnHand } from "@/lib/butchery-store";
import type { OrderRow, OrderItemInput, PayOrderParams } from "@/lib/butchery-store";
import type { CustomerBalance } from "@/lib/butchery-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShiftBar } from "./ShiftBar";
import {
  Department,
  DEPARTMENT_SHORT_LABELS,
  PaymentMethod,
  Product,
  ProductServing,
  Sale,
  SaleItem,
  SalePayment,
  SalePaymentKind,
  isIngredient,
} from "@/lib/butchery-types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ksh, qty } from "@/lib/format";
import { toast } from "sonner";
import { ReceiptDialog } from "./ReceiptDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveDepartment } from "@/contexts/DepartmentContext";
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

const DEPT_ICON: Record<Department, typeof Wine> = {
  restaurant: UtensilsCrossed,
  bar: Wine,
  rooms: Hotel,
};

interface CartLine {
  /** Unique per cart row: productId, or productId|servingId for a bar pour. */
  key: string;
  productId: string;
  quantity: number;
  /** When set, overrides the product's default price for this line only. */
  unitPriceOverride?: number;
  /** Bar serving (Tot/Glass/Bottle) — absent for normal whole-unit lines. */
  serving?: ProductServing;
}

const lineKey = (productId: string, servingId?: string) =>
  servingId ? `${productId}|${servingId}` : productId;

export const POS = () => {
  const { org, role } = useAuth();
  const {
    active: activeDepartment,
    allowed: allowedDepartments,
    setActive: setActiveDepartment,
    canSwitch: canSwitchDepartment,
  } = useActiveDepartment();
  const { products } = useProducts();
  const { forProduct: servingsFor } = useServings();
  const { add: addSale } = useSales();
  const { orders, createOrder, addItems, payOrder, voidOrder } = useOrders();
  const { shift, cashSoFar, openShift, closeShift } = useShift();
  const { customers, add: addCustomer } = useCustomers();
  // Cashiers must be on an open shift to sell (accountability + cash-up).
  // Admins/managers can ring up without one.
  const requiresShift = role === "cashier";
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

  // When a bar drink offers multiple pours, tapping it opens this picker.
  const [servingPickerFor, setServingPickerFor] = useState<Product | null>(null);

  const [search, setSearch] = useState("");

  // ── Payment state ───────────────────────────────────────────
  const [payment, setPayment] = useState<SalePaymentKind>("cash");
  const [cashGiven, setCashGiven] = useState("");
  const [mpesaRef, setMpesaRef] = useState("");
  // Split payment (part cash + part M-Pesa).
  const [splitCash, setSplitCash] = useState("");
  const [splitMpesa, setSplitMpesa] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // Existing loan account chosen for a credit sale (null = new / walk-in).
  const [creditCustomerId, setCreditCustomerId] = useState<string | null>(null);

  // ── Orders (pay later) state ────────────────────────────────
  const [ordersOpen, setOrdersOpen] = useState(false);
  // When set, the current cart is being ADDED to this existing open order
  // (a new round) rather than starting a fresh order/sale.
  const [addingToOrderId, setAddingToOrderId] = useState<string | null>(null);
  // The order whose payment is being collected (opens the pay dialog).
  const [payingOrder, setPayingOrder] = useState<OrderRow | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

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

  /** Add one of a plain product line (or bump its quantity). */
  const addPlainLine = (p: Product) => {
    setCart((c) => {
      const key = lineKey(p.id);
      const idx = c.findIndex((l) => l.key === key && l.unitPriceOverride === undefined);
      if (idx === -1) return [...c, { key, productId: p.id, quantity: 1 }];
      const next = [...c];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
      return next;
    });
    if (p.type === "per_kg") setActiveKgLineId(p.id);
  };

  /** Add one of a specific bar serving (Tot/Glass/Bottle) — or bump it. */
  const addServingLine = (p: Product, serving: ProductServing) => {
    const key = lineKey(p.id, serving.id);
    setCart((c) => {
      const idx = c.findIndex((l) => l.key === key);
      if (idx === -1) return [...c, { key, productId: p.id, quantity: 1, serving }];
      const next = [...c];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
      return next;
    });
    setServingPickerFor(null);
  };

  /**
   * Tap a product card. Bar drinks that offer more than one pour open a
   * serving picker; everything else drops straight into the cart.
   */
  const tapProduct = (p: Product) => {
    const servings = servingsFor(p.id);
    if (p.containerMl != null && servings.length > 1) {
      setServingPickerFor(p);
      return;
    }
    if (p.containerMl != null && servings.length === 1) {
      addServingLine(p, servings[0]);
      return;
    }
    addPlainLine(p);
  };

  const setLineQty = (key: string, q: number) =>
    setCart((c) =>
      c.map((l) => (l.key === key ? { ...l, quantity: Math.max(0, q) } : l)),
    );

  const incrementLine = (key: string, by: number) =>
    setCart((c) =>
      c.map((l) =>
        l.key === key
          ? { ...l, quantity: Math.max(0, Number((l.quantity + by).toFixed(3))) }
          : l,
      ),
    );

  const setLinePrice = (key: string, price?: number) =>
    setCart((c) =>
      c.map((l) => (l.key === key ? { ...l, unitPriceOverride: price } : l)),
    );

  const removeLine = (key: string) =>
    setCart((c) => c.filter((l) => l.key !== key));

  const clearCart = () => {
    setCart([]);
    setActiveKgLineId(null);
  };

  // ── Scale → active kg line ──────────────────────────────────
  // When a kg product is in the cart AND the scale streams a weight,
  // write it into that line. The cashier can still type over it.
  useEffect(() => {
    if (!scale.connected || scale.lastWeight == null) return;
    if (!activeKgLineId) return;
    setLineQty(activeKgLineId, scale.lastWeight);
  }, [scale.connected, scale.lastWeight, scale.lastReadAt, activeKgLineId]);

  // ── Computed values ─────────────────────────────────────────
  // Price for one unit of a cart line: a bar serving's price wins, then any
  // manual override, then the product's default price.
  const linePrice = (line: CartLine, p: Product) =>
    line.serving ? line.serving.price : line.unitPriceOverride ?? p.price;

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, l) => {
      const p = products.find((x) => x.id === l.productId);
      if (!p) return sum;
      return sum + linePrice(l, p) * l.quantity;
    }, 0);
  }, [cart, products]);

  // Total number of physical units across the cart (e.g. 3 plates + 2 kg = 5).
  // Shown next to the running total so the cashier can sanity-check the sale.
  const cartUnitCount = useMemo(
    () => cart.reduce((n, l) => n + l.quantity, 0),
    [cart],
  );

  const change = Math.max((Number(cashGiven) || 0) - cartTotal, 0);

  // The till only shows the active department's products. A Bar cashier can
  // never ring up a Restaurant plate, and vice-versa — this is the core of the
  // "your login is your department" model.
  const filteredProducts = useMemo(() => {
    // Raw ingredients (flour, oil…) are consumed in the kitchen, never sold at
    // the till — keep them out of the product grid so a cashier can't ring one up.
    const inDept = products.filter(
      (p) => p.department === activeDepartment && !isIngredient(p),
    );
    const term = search.trim().toLowerCase();
    if (!term) return inDept;
    return inDept.filter((p) => p.name.toLowerCase().includes(term));
  }, [products, activeDepartment, search]);

  // ── Checkout ────────────────────────────────────────────────
  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    if (requiresShift && !shift) {
      toast.error("Open your shift before selling");
      return;
    }
    for (const line of cart) {
      const p = products.find((x) => x.id === line.productId);
      if (!p) continue;
      if (line.quantity <= 0) {
        toast.error(`Set quantity for ${p.name}`);
        return;
      }
      if (linePrice(line, p) <= 0) {
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
    if (payment === "credit" && !creditCustomerId && !customerName.trim()) {
      toast.error("Pick or enter a customer for the credit sale");
      return;
    }
    // Build the split breakdown and check it adds up to the total.
    let splitPayments: SalePayment[] | undefined;
    if (payment === "split") {
      const c = Number(splitCash) || 0;
      const m = Number(splitMpesa) || 0;
      if (Math.abs(c + m - cartTotal) > 0.5) {
        toast.error(`Split must add up to ${ksh(cartTotal)} (currently ${ksh(c + m)})`);
        return;
      }
      if (m > 0 && !mpesaRef.trim()) {
        toast.error("Enter the M-Pesa reference for the M-Pesa part");
        return;
      }
      splitPayments = [
        ...(c > 0 ? [{ method: "cash" as const, amount: c }] : []),
        ...(m > 0 ? [{ method: "mpesa" as const, amount: m, ref: mpesaRef.trim() || undefined }] : []),
      ];
    }

    const items: SaleItem[] = cart.map((line) => {
      const p = products.find((x) => x.id === line.productId)!;
      const price = linePrice(line, p);
      return {
        productId: p.id,
        quantity: line.quantity,
        unitPrice: price,
        amount: line.quantity * price,
        servingName: line.serving?.name ?? null,
        servingMl: line.serving?.volumeMl ?? null,
      };
    });

    setSelling(true);
    try {
      // Credit sale: attach to a loan account. Use the chosen customer, or
      // create one from the typed name so it opens a trackable balance.
      let customerId: string | null = null;
      let creditName = customerName.trim();
      if (payment === "credit") {
        if (creditCustomerId) {
          customerId = creditCustomerId;
          creditName = customers.find((c) => c.id === creditCustomerId)?.name ?? creditName;
        } else if (creditName) {
          const created = await addCustomer({
            name: creditName,
            phone: customerPhone.trim() || undefined,
          });
          customerId = created.id;
        }
      }

      const sale = await addSale({
        items,
        payment,
        payments: splitPayments,
        cashGiven:
          payment === "cash" ? Number(cashGiven) || cartTotal : undefined,
        change: payment === "cash" ? change : undefined,
        mpesaRef: payment === "mpesa" ? mpesaRef.trim() : undefined,
        customerName: payment === "credit" ? creditName : undefined,
        customerPhone:
          payment === "credit" ? customerPhone.trim() || undefined : undefined,
        customerId,
        paid: payment !== "credit",
        shiftId: shift?.id ?? null,
      });
      setLastSale(sale);
      setShowReceipt(true);
      setCart([]);
      setActiveKgLineId(null);
      setCashGiven("");
      setMpesaRef("");
      setSplitCash("");
      setSplitMpesa("");
      setCustomerName("");
      setCustomerPhone("");
      setCreditCustomerId(null);
      toast.success(`Sale ${sale.receiptNo} recorded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save sale");
    } finally {
      setSelling(false);
    }
  };

  // ── Orders (pay later) ──────────────────────────────────────
  // Turn the current cart into order-item inputs (same price/serving rules as
  // a sale, just without the money side — that's collected at payment).
  const cartToOrderItems = (): OrderItemInput[] =>
    cart.map((line) => {
      const p = products.find((x) => x.id === line.productId)!;
      return {
        productId: p.id,
        quantity: line.quantity,
        unitPrice: linePrice(line, p),
        servingName: line.serving?.name ?? null,
        servingMl: line.serving?.volumeMl ?? null,
      };
    });

  const validateCartForOrder = (): boolean => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return false;
    }
    if (requiresShift && !shift) {
      toast.error("Open your shift first");
      return false;
    }
    for (const line of cart) {
      const p = products.find((x) => x.id === line.productId);
      if (!p) continue;
      if (line.quantity <= 0) {
        toast.error(`Set quantity for ${p.name}`);
        return false;
      }
      if (linePrice(line, p) <= 0) {
        toast.error(`Set price for ${p.name}`);
        return false;
      }
    }
    return true;
  };

  // Save the cart as a NEW open order, or append it to the one we're adding to.
  const handleSaveOrder = async () => {
    if (!validateCartForOrder()) return;
    setSavingOrder(true);
    try {
      const items = cartToOrderItems();
      if (addingToOrderId) {
        await addItems(addingToOrderId, items);
        toast.success("Added to order");
        setAddingToOrderId(null);
      } else {
        const order = await createOrder(items, undefined, shift?.id ?? null);
        toast.success(`Order #${(order as { order_no: number }).order_no} saved`);
      }
      setCart([]);
      setActiveKgLineId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save order");
    } finally {
      setSavingOrder(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <>
      {requiresShift && (
        <div className="mb-4">
          <ShiftBar
            shift={shift}
            cashSoFar={cashSoFar}
            onOpen={openShift}
            onClose={(counted) => closeShift(shift!.id, counted)}
          />
        </div>
      )}
      <div className="grid lg:grid-cols-[1fr_460px] gap-6">
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

          {/* One cashier, one bill: flip the grid between departments without
              losing the cart, so food + a drink land on the same receipt. */}
          {canSwitchDepartment && (
            <div className="flex gap-2">
              {allowedDepartments.map((d) => {
                const Icon = DEPT_ICON[d];
                const on = d === activeDepartment;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setActiveDepartment(d)}
                    aria-pressed={on}
                    className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition-colors ${
                      on
                        ? "bg-primary text-primary-foreground border-primary shadow-soft"
                        : "bg-background text-muted-foreground hover:text-foreground hover:border-primary/50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {DEPARTMENT_SHORT_LABELS[d]}
                  </button>
                );
              })}
            </div>
          )}

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
                  inCart={cart
                    .filter((l) => l.productId === p.id)
                    .reduce((a, l) => a + l.quantity, 0)}
                  hasServings={p.containerMl != null && servingsFor(p.id).length > 0}
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
        <Card className="p-4 shadow-elevated lg:sticky lg:top-24 lg:self-start flex flex-col h-[calc(100vh-7rem)] min-h-[480px] overflow-hidden">
          <div className="mb-3 flex items-center gap-2 shrink-0">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Cart</h3>
            {cart.length > 0 && (
              <>
                <Badge variant="secondary" className="ml-auto">
                  {cart.length} item{cart.length === 1 ? "" : "s"}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={clearCart}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Clear
                </Button>
              </>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center min-h-0">
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
              {/* Scrollable cart lines only — total/payment stay fixed below
                  so the last item is never hidden behind the pay section. */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1">
                <div className="space-y-2 pb-3">
                  {cart.map((line) => {
                    const p = products.find((x) => x.id === line.productId);
                    if (!p) return null;
                    return (
                      <CartLineRow
                        key={line.key}
                        product={p}
                        line={line}
                        available={availableQty(p.id)}
                        showDept={canSwitchDepartment}
                        onIncrement={(by) => incrementLine(line.key, by)}
                        onSetQty={(v) => setLineQty(line.key, v)}
                        onSetPrice={(v) => setLinePrice(line.key, v)}
                        onRemove={() => removeLine(line.key)}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Pinned footer: always visible, does not cover cart items */}
              <div className="shrink-0 border-t mt-2 pt-2 bg-card space-y-2 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">Total</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {cart.length} item{cart.length === 1 ? "" : "s"} ·{" "}
                      {Number(cartUnitCount.toFixed(3))} unit
                      {cartUnitCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className="text-2xl font-bold text-primary tabular-nums leading-none">
                    {ksh(cartTotal)}
                  </span>
                </div>

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
                  customers={customers}
                  creditCustomerId={creditCustomerId}
                  setCreditCustomerId={setCreditCustomerId}
                  splitCash={splitCash}
                  setSplitCash={setSplitCash}
                  splitMpesa={splitMpesa}
                  setSplitMpesa={setSplitMpesa}
                  compact
                />

                {addingToOrderId ? (
                  // Adding a round to an existing open order — no payment here.
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSaveOrder}
                        disabled={savingOrder}
                        className="flex-1 bg-gradient-primary h-11 text-base font-semibold"
                      >
                        {savingOrder
                          ? "Adding…"
                          : `Add to Order #${
                              orders.find((o) => o.id === addingToOrderId)?.orderNo ?? ""
                            }`}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11"
                        onClick={() => setAddingToOrderId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      onClick={handleCheckout}
                      disabled={selling || (requiresShift && !shift)}
                      className="w-full bg-gradient-primary h-11 text-base font-semibold"
                    >
                      {requiresShift && !shift
                        ? "Open a shift to sell"
                        : selling
                          ? "Saving…"
                          : "Complete sale"}
                    </Button>
                    {/* Order now, pay later: park this cart as an open order. */}
                    <Button
                      variant="outline"
                      onClick={handleSaveOrder}
                      disabled={savingOrder || (requiresShift && !shift)}
                      className="w-full h-10 text-sm font-semibold gap-1.5"
                    >
                      <ClipboardList className="h-4 w-4" />
                      {savingOrder ? "Saving…" : "Save as order (pay later)"}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Floating "Open orders" button — always reachable so any waiter can pick
          up a table's bill to add a round or collect payment. */}
      <button
        type="button"
        onClick={() => setOrdersOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-elevated px-5 py-3 font-semibold hover:opacity-95 active:scale-[0.98]"
      >
        <ClipboardList className="h-5 w-5" />
        Orders
        {orders.length > 0 && (
          <span className="ml-1 grid h-6 min-w-6 place-items-center rounded-full bg-primary-foreground text-primary text-sm font-bold px-1.5">
            {orders.length}
          </span>
        )}
      </button>

      {/* Orders panel */}
      <OrdersDialog
        open={ordersOpen}
        onClose={() => setOrdersOpen(false)}
        orders={orders}
        onAddItems={(id) => {
          setAddingToOrderId(id);
          setOrdersOpen(false);
          toast.info("Tap products, then 'Add to order'");
        }}
        onPay={(o) => {
          setPayingOrder(o);
          setOrdersOpen(false);
        }}
        onVoid={async (id) => {
          try {
            await voidOrder(id);
            toast.success("Order voided — stock returned");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to void");
          }
        }}
      />

      {/* Collect payment for an open order */}
      <OrderPayDialog
        order={payingOrder}
        onClose={() => setPayingOrder(null)}
        customers={customers}
        addCustomer={addCustomer}
        onPaid={async (params) => {
          const sale = await payOrder(params);
          setPayingOrder(null);
          setLastSale(sale);
          setShowReceipt(true);
          toast.success(`Sale ${sale.receiptNo} recorded`);
        }}
      />

      {/* Serving picker — appears when a bar drink has multiple pours. */}
      <Dialog open={!!servingPickerFor} onOpenChange={(o) => !o && setServingPickerFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{servingPickerFor?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2 mb-1">
            How is it being served?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {servingPickerFor &&
              servingsFor(servingPickerFor.id).map((sv) => (
                <button
                  key={sv.id}
                  type="button"
                  onClick={() => addServingLine(servingPickerFor, sv)}
                  className="rounded-xl border p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <p className="font-semibold">{sv.name}</p>
                  <p className="text-xs text-muted-foreground">{sv.volumeMl} ml</p>
                  <p className="text-sm font-bold text-primary mt-1">{ksh(sv.price)}</p>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <ReceiptDialog
        sale={lastSale}
        products={products}
        open={showReceipt}
        onClose={() => setShowReceipt(false)}
        autoPrint
        shopName={org?.name}
        logoUrl={org?.logo_url}
        tagline={org?.tagline}
        phone={org?.phone}
        mpesaPaybill={org?.mpesa_paybill}
        mpesaPaybillAccount={org?.mpesa_paybill_account}
        mpesaTill={org?.mpesa_till}
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
  hasServings,
  onTap,
}: {
  product: Product;
  /** Persisted stock on hand (from v_stock_on_hand). */
  stock: number;
  /** Quantity currently in the cart for THIS product. */
  inCart: number;
  /** Bar drink with pour options — tapping opens the serving picker. */
  hasServings?: boolean;
  onTap: () => void;
}) {
  const isInfinite = !Number.isFinite(stock);
  // Effective stock = what's left after the cart is committed. For drinks with
  // servings, cart quantity is in pours (not bottles), so we don't subtract it.
  const effective = isInfinite || hasServings ? stock : Math.max(0, stock - inCart);
  const out = !isInfinite && !hasServings && effective <= 0;

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
        {hasServings ? (
          <span className="text-sm">Tap to choose pour</span>
        ) : (
          <>
            {ksh(product.price)}
            <span className="text-xs font-medium text-muted-foreground">
              {" "}
              / {product.unit}
            </span>
          </>
        )}
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
              {!hasServings && inCart > 0 && (
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
  showDept,
  onIncrement,
  onSetQty,
  onSetPrice,
  onRemove,
}: {
  product: Product;
  line: CartLine;
  available: number;
  /** Show the department chip (mixed-department cart). */
  showDept?: boolean;
  onIncrement: (by: number) => void;
  onSetQty: (v: number) => void;
  onSetPrice: (v?: number) => void;
  onRemove: () => void;
}) {
  const serving = line.serving;
  const isKg = product.type === "per_kg" && !serving;
  const step = isKg ? 0.5 : 1;
  // A serving has a fixed price; otherwise use the override or the product price.
  const price = serving ? serving.price : line.unitPriceOverride ?? product.price;
  const unitLabel = serving ? serving.name : product.unit;
  const subtotal = price * line.quantity;
  // Serving quantities are in pours, not bottles, so the bottle-count "available"
  // can't be compared directly — skip the oversell warning for servings.
  const overSell = !serving && product.trackStock && line.quantity > available;

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
      className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
        overSell ? "border-destructive/50 bg-destructive/5" : "bg-background"
      }`}
    >
      {/* Row 1: name + subtotal + remove (no wasted vertical space) */}
      <div className="flex items-center gap-2">
        {showDept && (
          <Badge
            variant="outline"
            className="text-[9px] uppercase px-1 py-0 shrink-0 gap-0.5"
            title={DEPARTMENT_SHORT_LABELS[product.department]}
          >
            {(() => {
              const Icon = DEPT_ICON[product.department];
              return <Icon className="h-2.5 w-2.5" />;
            })()}
          </Badge>
        )}
        <p className="font-semibold text-sm flex-1 truncate">{product.name}</p>
        <span className="font-bold text-primary text-base tabular-nums whitespace-nowrap">
          {ksh(subtotal)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 -mr-1.5 shrink-0"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {/* Row 2: qty controls + per-unit price (click to edit) */}
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          onClick={() => onIncrement(-step)}
          aria-label="Decrease"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          type="number"
          inputMode="decimal"
          value={line.quantity}
          step={step}
          min={0}
          onChange={(e) => onSetQty(Number(e.target.value) || 0)}
          className="h-9 w-16 text-center text-base font-bold text-foreground tabular-nums px-1 no-spinner"
        />
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          onClick={() => onIncrement(step)}
          aria-label="Increase"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <span className="text-muted-foreground">{unitLabel}</span>
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
        ) : serving ? (
          // Bar servings are priced in the product's Servings editor — fixed here.
          <span className="inline-flex items-center gap-1 text-muted-foreground ml-auto tabular-nums">
            {ksh(price)} <span className="opacity-70">/ {serving.name}</span>
          </span>
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
  payment: SalePaymentKind;
  setPayment: (p: SalePaymentKind) => void;
  cashGiven: string;
  setCashGiven: (v: string) => void;
  change: number;
  mpesaRef: string;
  setMpesaRef: (v: string) => void;
  customerName: string;
  setCustomerName: (v: string) => void;
  customerPhone: string;
  setCustomerPhone: (v: string) => void;
  customers: CustomerBalance[];
  creditCustomerId: string | null;
  setCreditCustomerId: (v: string | null) => void;
  splitCash: string;
  setSplitCash: (v: string) => void;
  splitMpesa: string;
  setSplitMpesa: (v: string) => void;
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
    customers,
    creditCustomerId,
    setCreditCustomerId,
    splitCash,
    setSplitCash,
    splitMpesa,
    setSplitMpesa,
    compact,
  } = props;

  return (
    <div className={compact ? "space-y-2" : "space-y-3 border-t pt-4"}>
      {!compact && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-2xl font-bold text-primary">{ksh(total)}</span>
        </div>
      )}
      <div className="grid grid-cols-5 gap-1.5">
        {(
          [
            { key: "cash", label: "Cash", icon: Banknote },
            { key: "mpesa", label: "M-Pesa", icon: Smartphone },
            { key: "card", label: "Card", icon: CreditCard },
            { key: "credit", label: "Credit", icon: Clock },
            { key: "split", label: "Split", icon: SplitSquareHorizontal },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setPayment(key)}
            className={`rounded-lg border py-1.5 flex flex-col items-center gap-0.5 text-[11px] font-medium transition-all ${
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
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <Label className="text-[11px]">Cash given</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder={String(Math.round(total))}
                value={cashGiven}
                onChange={(e) => setCashGiven(e.target.value)}
                className="h-9 no-spinner"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[11px]">Change</Label>
              <div className="h-9 px-3 rounded-md border bg-muted flex items-center font-bold text-primary tabular-nums">
                {ksh(change)}
              </div>
            </div>
          </div>
          {/* One tap when the customer pays the exact total — no typing. */}
          <Button
            type="button"
            variant={cashGiven !== "" && Number(cashGiven) === total ? "default" : "outline"}
            className="w-full h-8 text-sm font-semibold"
            onClick={() =>
              setCashGiven(
                total % 1 === 0 ? String(Math.round(total)) : total.toFixed(2),
              )
            }
          >
            Exact — customer paid {ksh(total)}
          </Button>
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
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Loan account</Label>
            <Select
              value={creditCustomerId ?? "new"}
              onValueChange={(v) => setCreditCustomerId(v === "new" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">+ New customer</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.balance > 0 ? ` · owes ${ksh(c.balance)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Name + phone only when creating a new account */}
          {!creditCustomerId && (
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
      )}

      {payment === "split" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Cash part</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={splitCash}
                onChange={(e) => setSplitCash(e.target.value)}
                className="no-spinner"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">M-Pesa part</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={splitMpesa}
                onChange={(e) => setSplitMpesa(e.target.value)}
                className="no-spinner"
              />
            </div>
          </div>
          {Number(splitMpesa) > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">M-Pesa reference</Label>
              <Input
                placeholder="e.g. SFF1A2B3C4"
                value={mpesaRef}
                onChange={(e) => setMpesaRef(e.target.value)}
              />
            </div>
          )}
          {(() => {
            const entered = (Number(splitCash) || 0) + (Number(splitMpesa) || 0);
            const remaining = total - entered;
            const balanced = Math.abs(remaining) <= 0.5;
            return (
              <div
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold ${
                  balanced ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                }`}
              >
                <span>{balanced ? "Balances ✓" : "Remaining"}</span>
                <span className="tabular-nums">{balanced ? ksh(total) : ksh(remaining)}</span>
              </div>
            );
          })()}
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

/* ───────────────────────────────────────────────────────────────
 * OrdersDialog — the list of open orders (pay later). Each order can
 * be paid, reopened to add a round, or voided.
 * ───────────────────────────────────────────────────────────── */
function OrdersDialog({
  open,
  onClose,
  orders,
  onAddItems,
  onPay,
  onVoid,
}: {
  open: boolean;
  onClose: () => void;
  orders: OrderRow[];
  onAddItems: (id: string) => void;
  onPay: (o: OrderRow) => void;
  onVoid: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" /> Open orders
          </DialogTitle>
        </DialogHeader>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No open orders. Build a cart and tap “Save as order (pay later)”.
          </p>
        ) : (
          <div className="space-y-3 max-h-[62vh] overflow-y-auto -mx-1 px-1">
            {orders.map((o) => (
              <div key={o.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold">
                    Order #{o.orderNo}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {new Date(o.createdAt).toLocaleTimeString("en-KE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <span className="font-bold text-primary tabular-nums">{ksh(o.total)}</span>
                </div>
                <div className="text-xs text-muted-foreground mb-2">
                  {o.items
                    .map(
                      (i) =>
                        `${i.productName}${i.servingName ? ` (${i.servingName})` : ""} ×${Number(
                          i.quantity.toFixed(3),
                        )}`,
                    )
                    .join(", ")}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="bg-gradient-primary flex-1"
                    onClick={() => onPay(o)}
                  >
                    Pay {ksh(o.total)}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onAddItems(o.id)}>
                    Add items
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => onVoid(o.id)}
                  >
                    Void
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────────────────────────────────────────
 * OrderPayDialog — collect payment for an open order and convert it
 * to a sale. Holds its own payment state and reuses PaymentSection.
 * ───────────────────────────────────────────────────────────── */
function OrderPayDialog({
  order,
  onClose,
  customers,
  addCustomer,
  onPaid,
}: {
  order: OrderRow | null;
  onClose: () => void;
  customers: CustomerBalance[];
  addCustomer: (c: { name: string; phone?: string }) => Promise<{ id: string }>;
  onPaid: (params: PayOrderParams) => Promise<void>;
}) {
  const [payment, setPayment] = useState<SalePaymentKind>("cash");
  const [cashGiven, setCashGiven] = useState("");
  const [mpesaRef, setMpesaRef] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [splitMpesa, setSplitMpesa] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [creditCustomerId, setCreditCustomerId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const total = order?.total ?? 0;
  const change = Math.max((Number(cashGiven) || 0) - total, 0);

  // Reset the form whenever a different order is opened.
  useEffect(() => {
    setPayment("cash");
    setCashGiven("");
    setMpesaRef("");
    setSplitCash("");
    setSplitMpesa("");
    setCustomerName("");
    setCustomerPhone("");
    setCreditCustomerId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const handlePay = async () => {
    if (!order) return;
    if (payment === "cash" && cashGiven && Number(cashGiven) < total)
      return toast.error("Cash given is less than total");
    if (payment === "mpesa" && !mpesaRef.trim())
      return toast.error("Enter M-Pesa reference");
    if (payment === "credit" && !creditCustomerId && !customerName.trim())
      return toast.error("Pick or enter a customer for the credit sale");

    let splitPayments: SalePayment[] | undefined;
    if (payment === "split") {
      const c = Number(splitCash) || 0;
      const m = Number(splitMpesa) || 0;
      if (Math.abs(c + m - total) > 0.5)
        return toast.error(`Split must add up to ${ksh(total)}`);
      if (m > 0 && !mpesaRef.trim())
        return toast.error("Enter the M-Pesa reference for the M-Pesa part");
      splitPayments = [
        ...(c > 0 ? [{ method: "cash" as const, amount: c }] : []),
        ...(m > 0 ? [{ method: "mpesa" as const, amount: m, ref: mpesaRef.trim() || undefined }] : []),
      ];
    }

    setPaying(true);
    try {
      let customerId: string | null = null;
      let creditName = customerName.trim();
      if (payment === "credit") {
        if (creditCustomerId) {
          customerId = creditCustomerId;
          creditName = customers.find((c) => c.id === creditCustomerId)?.name ?? creditName;
        } else if (creditName) {
          const created = await addCustomer({
            name: creditName,
            phone: customerPhone.trim() || undefined,
          });
          customerId = created.id;
        }
      }
      await onPaid({
        order,
        payment,
        payments: splitPayments,
        cashGiven: payment === "cash" ? Number(cashGiven) || total : undefined,
        change: payment === "cash" ? change : undefined,
        mpesaRef: payment === "mpesa" ? mpesaRef.trim() : undefined,
        customerName: payment === "credit" ? creditName : undefined,
        customerPhone: payment === "credit" ? customerPhone.trim() || undefined : undefined,
        customerId,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay Order #{order?.orderNo}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-2xl font-bold text-primary tabular-nums">{ksh(total)}</span>
        </div>
        <PaymentSection
          total={total}
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
          customers={customers}
          creditCustomerId={creditCustomerId}
          setCreditCustomerId={setCreditCustomerId}
          splitCash={splitCash}
          setSplitCash={setSplitCash}
          splitMpesa={splitMpesa}
          setSplitMpesa={setSplitMpesa}
          compact
        />
        <Button
          onClick={handlePay}
          disabled={paying}
          className="w-full bg-gradient-primary h-11 text-base font-semibold"
        >
          {paying ? "Saving…" : "Complete payment"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
