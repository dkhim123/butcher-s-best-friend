export type ProductType = "per_kg" | "fixed" | "meal";
export type PaymentMethod = "cash" | "mpesa" | "credit";
// A sale's overall payment. "split" means it was paid partly cash + partly
// M-Pesa (the breakdown lives in Sale.payments).
export type SalePaymentKind = PaymentMethod | "split";

/** One leg of a split payment. */
export interface SalePayment {
  method: "cash" | "mpesa";
  amount: number;
  ref?: string;
}

// A product belongs to exactly one department. Cashiers are scoped to a
// department, so a Bar cashier only ever sees Bar products.
export type Department = "restaurant" | "bar" | "rooms";

export const DEPARTMENT_LABELS: Record<Department, string> = {
  restaurant: "Restaurant",
  bar: "Bar (Wines & Spirits)",
  rooms: "Rooms",
};

// Short labels for tight spaces (chips, tabs).
export const DEPARTMENT_SHORT_LABELS: Record<Department, string> = {
  restaurant: "Restaurant",
  bar: "Bar",
  rooms: "Rooms",
};

// Departments that are live today. "rooms" exists in the model but its POS
// module ships in a later stage, so it is intentionally excluded here.
export const ACTIVE_DEPARTMENTS: Department[] = ["restaurant", "bar"];

export type FoodGroup =
  | "meat"
  | "prepared_food"
  | "drinks"
  | "raw_material"
  | "sides"
  | "groceries";

export const FOOD_GROUP_LABELS: Record<FoodGroup, string> = {
  meat: "Meat",
  prepared_food: "Prepared food / meals",
  drinks: "Drinks",
  raw_material: "Raw material (flour, oil, …)",
  sides: "Sides (chips, ugali, …)",
  groceries: "Groceries / packaged",
};

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  price: number;
  unit: string;
  category?: string | null;
  foodGroup?: FoodGroup | null;
  department: Department;
  trackStock: boolean;
  /** Full-bottle volume in ml for bar drinks poured by measure (else null). */
  containerMl?: number | null;
  /** Buying cost per unit — used for profit = revenue − cost (null = unknown). */
  costPrice?: number | null;
}

/**
 * Raw ingredients (flour, oil, rice…) are bought and consumed in the kitchen,
 * never rung up at the till. They carry a BUYING price (for food-cost) but no
 * selling price. Everything else — meals, drinks — is sellable.
 */
export const isIngredient = (p: Pick<Product, "foodGroup">) =>
  p.foodGroup === "raw_material";

/** A way a bar drink can be sold — e.g. Tot 30ml, Glass 250ml, Full bottle 750ml. */
export interface ProductServing {
  id: string;
  productId: string;
  name: string;
  volumeMl: number;
  price: number;
  sort: number;
}

// Common Kenyan bottle sizes, offered when setting up a spirit/wine.
export const BOTTLE_SIZES_ML = [350, 500, 750, 1000, 1250] as const;

export interface StockEntry {
  id: string;
  productId: string;
  date: string; // YYYY-MM-DD
  openingQty: number;
}

export interface PurchaseOrder {
  id: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  productId: string;
  supplier: string;
  quantity: number; // kg or units
  costPerUnit: number; // Ksh per kg / per unit
  totalCost: number;
  notes?: string;
  received?: boolean;
}

// ── Multi-line purchase orders (one supplier, many lines) ──────────────────────
export interface POItem {
  productId: string;
  quantity: number;
  costPerUnit: number;
  amount: number;
}

export interface PurchaseOrderDoc {
  id: string;
  date: string;
  timestamp: number;
  supplier: string;
  department: Department | null;
  received: boolean;
  totalCost: number;
  notes?: string;
  items: POItem[];
}

export interface SaleItem {
  productId: string;
  quantity: number;
  unitPrice: number; // price per unit (or per serving) at sale time
  amount: number; // quantity * unitPrice
  // Bar serving info (null for normal whole-unit items). servingMl lets stock
  // deduct the right fraction of a bottle; servingName prints on the receipt.
  servingName?: string | null;
  servingMl?: number | null;
}

export interface Sale {
  id: string;
  receiptNo: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  items: SaleItem[];
  subtotal: number;
  payment: SalePaymentKind;
  // For payment==='split', the cash/M-Pesa breakdown (sums to subtotal).
  payments?: SalePayment[];
  // Cash extras
  cashGiven?: number;
  change?: number;
  // M-Pesa extras
  mpesaRef?: string;
  // Credit extras
  customerName?: string;
  customerPhone?: string;
  customerId?: string | null; // linked loan account (credit sales)
  paid?: boolean; // for credit: marked paid later
  shiftId?: string | null; // which cashier shift rang this sale
  createdBy?: string | null; // profile id of the cashier who rang it
  // Cancellation workflow
  cancelState?: "none" | "requested" | "cancelled" | "rejected";
  cancelReason?: string | null;
}

// ── Customers / loans (credit accounts) ────────────────────────────────────────
export interface CustomerBalance {
  id: string;
  name: string;
  phone: string | null;
  owed: number;
  repaid: number;
  balance: number;
}

export type PaymentMethodSimple = "cash" | "mpesa" | "other";

export interface CustomerPayment {
  id: string;
  amount: number;
  method: PaymentMethodSimple;
  note: string | null;
  createdAt: string;
}

/**
 * How much of a sale was paid via a given method. Handles split sales (reads the
 * breakdown) and single-method sales (the whole subtotal counts for its method).
 * Credit is never split, so it's all-or-nothing.
 */
export function paidVia(
  sale: Pick<Sale, "payment" | "payments" | "subtotal">,
  method: PaymentMethod,
): number {
  if (sale.payment === "split") {
    if (method === "credit") return 0;
    return (sale.payments ?? [])
      .filter((p) => p.method === method)
      .reduce((a, p) => a + p.amount, 0);
  }
  return sale.payment === method ? sale.subtotal : 0;
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
