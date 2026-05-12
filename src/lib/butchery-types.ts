export type ProductType = "per_kg" | "fixed" | "meal";
export type PaymentMethod = "cash" | "mpesa" | "credit";

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
  trackStock: boolean;
}

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

export interface SaleItem {
  productId: string;
  quantity: number;
  unitPrice: number; // price per unit at sale time
  amount: number; // quantity * unitPrice
}

export interface Sale {
  id: string;
  receiptNo: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  items: SaleItem[];
  subtotal: number;
  payment: PaymentMethod;
  // Cash extras
  cashGiven?: number;
  change?: number;
  // M-Pesa extras
  mpesaRef?: string;
  // Credit extras
  customerName?: string;
  customerPhone?: string;
  paid?: boolean; // for credit: marked paid later
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
