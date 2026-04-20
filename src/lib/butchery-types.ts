export type ProductType = "per_kg" | "fixed" | "meal";

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  // For per_kg: price per kg. For fixed/meal: price per unit.
  price: number;
  unit: string; // "kg" | "piece" | "plate" | "bowl" etc
}

export interface StockEntry {
  id: string;
  productId: string;
  date: string; // YYYY-MM-DD
  openingQty: number; // kg for per_kg, units for others
}

export interface Sale {
  id: string;
  productId: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  quantity: number; // kg or units
  amount: number; // Ksh
  unitPriceAtSale: number; // price per kg or per unit at time of sale
}

export const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
