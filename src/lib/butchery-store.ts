import { useCallback, useEffect, useState } from "react";
import { Product, Sale, StockEntry, todayISO } from "./butchery-types";

const KEYS = {
  products: "butchery.products.v1",
  stock: "butchery.stock.v1",
  sales: "butchery.sales.v1",
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

export function useSales(date?: string) {
  const [sales, setSales] = useStored<Sale[]>(KEYS.sales, []);

  const filtered = date ? sales.filter((s) => s.date === date) : sales;

  const add = (s: Omit<Sale, "id" | "timestamp" | "date">) => {
    const sale: Sale = {
      ...s,
      id: uid(),
      timestamp: Date.now(),
      date: todayISO(),
    };
    setSales((prev) => [sale, ...prev]);
    return sale;
  };

  const remove = (id: string) => setSales((prev) => prev.filter((s) => s.id !== id));

  return { sales: filtered, allSales: sales, add, remove };
}
