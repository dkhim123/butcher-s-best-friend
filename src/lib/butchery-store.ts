import { useCallback, useEffect, useState } from "react";
import {
  Product,
  PurchaseOrder,
  Sale,
  StockEntry,
  todayISO,
} from "./butchery-types";

const KEYS = {
  products: "butchery.products.v1",
  stock: "butchery.stock.v1",
  sales: "butchery.sales.v2",
  purchases: "butchery.purchases.v1",
  receiptCounter: "butchery.receiptCounter.v1",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("butchery:update", { detail: { key } }));
}

function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.key === key) setValue(read(key, fallback));
    };
    window.addEventListener("butchery:update", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("butchery:update", handler);
      window.removeEventListener("storage", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (updater: (prev: T) => T) => {
      setValue((prev) => {
        const next = updater(prev);
        write(key, next);
        return next;
      });
    },
    [key],
  );

  return [value, update] as const;
}

const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const seedProducts: Product[] = [
  { id: uid(), name: "Beef", type: "per_kg", price: 600, unit: "kg" },
  { id: uid(), name: "Pork", type: "per_kg", price: 500, unit: "kg" },
  { id: uid(), name: "Goat", type: "per_kg", price: 800, unit: "kg" },
  { id: uid(), name: "Soup Bones", type: "fixed", price: 150, unit: "piece" },
  { id: uid(), name: "Nyama Choma Plate", type: "meal", price: 450, unit: "plate" },
];

export function useProducts() {
  const [products, setProducts] = useStored<Product[]>(KEYS.products, seedProducts);

  const add = (p: Omit<Product, "id">) =>
    setProducts((prev) => [...prev, { ...p, id: uid() }]);
  const update = (id: string, patch: Partial<Product>) =>
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id: string) =>
    setProducts((prev) => prev.filter((p) => p.id !== id));

  return { products, add, update, remove };
}

export function useStock(date: string = todayISO()) {
  const [entries, setEntries] = useStored<StockEntry[]>(KEYS.stock, []);

  const setOpening = (productId: string, openingQty: number) =>
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.productId === productId && e.date === date);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], openingQty };
        return next;
      }
      return [...prev, { id: uid(), productId, date, openingQty }];
    });

  const getOpening = (productId: string) =>
    entries.find((e) => e.productId === productId && e.date === date)?.openingQty ?? 0;

  return { entries, setOpening, getOpening };
}

export function usePurchases(date?: string) {
  const [purchases, setPurchases] = useStored<PurchaseOrder[]>(KEYS.purchases, []);
  const filtered = date ? purchases.filter((p) => p.date === date) : purchases;

  const add = (po: Omit<PurchaseOrder, "id" | "timestamp" | "date" | "totalCost">) => {
    const totalCost = po.quantity * po.costPerUnit;
    const next: PurchaseOrder = {
      ...po,
      id: uid(),
      timestamp: Date.now(),
      date: todayISO(),
      totalCost,
    };
    setPurchases((prev) => [next, ...prev]);
    return next;
  };

  const remove = (id: string) =>
    setPurchases((prev) => prev.filter((p) => p.id !== id));

  const purchasedQtyFor = (productId: string, d: string) =>
    purchases
      .filter((p) => p.productId === productId && p.date === d)
      .reduce((a, p) => a + p.quantity, 0);

  return { purchases: filtered, allPurchases: purchases, add, remove, purchasedQtyFor };
}

function nextReceiptNo(): string {
  const n = (read<number>(KEYS.receiptCounter, 1000) || 1000) + 1;
  write(KEYS.receiptCounter, n);
  const d = new Date();
  const dStr = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `R${dStr}-${n}`;
}

export function useSales(date?: string) {
  const [sales, setSales] = useStored<Sale[]>(KEYS.sales, []);
  const filtered = date ? sales.filter((s) => s.date === date) : sales;

  const add = (
    s: Omit<Sale, "id" | "timestamp" | "date" | "subtotal" | "receiptNo">,
  ) => {
    const subtotal = s.items.reduce((a, i) => a + i.amount, 0);
    const sale: Sale = {
      ...s,
      id: uid(),
      receiptNo: nextReceiptNo(),
      timestamp: Date.now(),
      date: todayISO(),
      subtotal,
    };
    setSales((prev) => [sale, ...prev]);
    return sale;
  };

  const update = (id: string, patch: Partial<Sale>) =>
    setSales((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const remove = (id: string) =>
    setSales((prev) => prev.filter((s) => s.id !== id));

  const soldQtyFor = (productId: string, d: string) =>
    sales
      .filter((s) => s.date === d)
      .reduce(
        (a, s) =>
          a + s.items.filter((i) => i.productId === productId).reduce((aa, i) => aa + i.quantity, 0),
        0,
      );

  return { sales: filtered, allSales: sales, add, update, remove, soldQtyFor };
}
