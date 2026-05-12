/**
 * butchery-store.ts — Supabase-backed data layer (multi-tenant)
 *
 * All queries are scoped by org_id + branch_id from the active session.
 * Cashier sales are additionally filtered by created_by unless the cashier
 * has the can_view_transactions permission.
 */

import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { SESSION_KEY, type Session } from "@/contexts/AuthContext";
import {
  FoodGroup,
  Product,
  PurchaseOrder,
  Sale,
  SaleItem,
  StockEntry,
  todayISO,
} from "./butchery-types";

// Reads the active session from localStorage. Keep this in sync with
// AuthContext.SESSION_KEY so the data layer and auth layer agree.
function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function getOrgId(): string {
  return getSession()?.org?.id ?? "";
}

function getBranchId(): string {
  return getSession()?.branch?.id ?? "";
}

function getProfileId(): string | null {
  return getSession()?.profile?.id ?? null;
}

function getRole(): string {
  return getSession()?.profile?.role ?? "";
}

function hasPermission(key: string): boolean {
  const s = getSession();
  if (!s) return false;
  if (s.profile.role === "admin" || s.profile.role === "manager") return true;
  return (s.profile.permissions as Record<string, boolean>)[key] === true;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as Product["type"],
    price: Number(row.price),
    unit: row.unit as string,
    category: (row.category as string | null) ?? null,
    foodGroup: (row.food_group as FoodGroup | null) ?? null,
    trackStock: Boolean(row.track_stock),
  };
}

function mapStockEntry(row: Record<string, unknown>): StockEntry {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    date: row.date as string,
    openingQty: Number(row.opening_qty),
  };
}

function mapPurchaseOrder(row: Record<string, unknown>): PurchaseOrder {
  return {
    id: row.id as string,
    date: row.date as string,
    timestamp: new Date(row.created_at as string).getTime(),
    productId: row.product_id as string,
    supplier: row.supplier as string,
    quantity: Number(row.quantity),
    costPerUnit: Number(row.cost_per_unit),
    totalCost: Number(row.total_cost),
    notes: (row.notes as string) ?? undefined,
    received: Boolean(row.received),
  };
}

function mapSale(row: Record<string, unknown>): Sale {
  const items: SaleItem[] = (
    (row.sale_items as Record<string, unknown>[]) ?? []
  ).map((i) => ({
    productId: i.product_id as string,
    quantity: Number(i.quantity),
    unitPrice: Number(i.unit_price),
    amount: Number(i.amount),
  }));
  return {
    id: row.id as string,
    receiptNo: row.receipt_no as string,
    date: row.date as string,
    timestamp: new Date(row.created_at as string).getTime(),
    items,
    subtotal: Number(row.subtotal),
    payment: row.payment as Sale["payment"],
    cashGiven: row.cash_given != null ? Number(row.cash_given) : undefined,
    change: row.change_amount != null ? Number(row.change_amount) : undefined,
    mpesaRef: (row.mpesa_ref as string) ?? undefined,
    customerName: (row.customer_name as string) ?? undefined,
    customerPhone: (row.customer_phone as string) ?? undefined,
    paid: Boolean(row.paid),
  };
}

// ── useProducts ───────────────────────────────────────────────────────────────

export function useProducts() {
  const qc = useQueryClient();
  const chId = useRef(`products-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();

  const { data: products = [] } = useQuery({
    queryKey: ["products", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map(mapProduct);
    },
    staleTime: 60_000,
    enabled: !!orgId,
  });

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () =>
        qc.invalidateQueries({ queryKey: ["products", orgId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId]);

  const addMutation = useMutation({
    mutationFn: async (params: {
      product: Omit<Product, "id">;
      openingStock?: number;
    }) => {
      const p = params.product;
      const opening = params.openingStock ?? 0;

      const { data, error } = await supabase
        .from("products")
        .insert({
          org_id: orgId,
          name: p.name,
          type: p.type,
          price: p.price,
          unit: p.unit,
          category: p.category ?? null,
          food_group: p.foodGroup ?? null,
          track_stock: p.trackStock,
        })
        .select()
        .single();
      if (error) throw error;
      const created = mapProduct(data as Record<string, unknown>);

      // If the admin entered an "opening stock" value AND this is a tracked
      // product, log a single +qty movement so the new product starts with
      // the right balance immediately. We use reason='opening' so reports
      // know this isn't a purchase or a sale.
      if (p.trackStock && opening > 0) {
        const branchId = getBranchId();
        if (branchId) {
          const { error: stockErr } = await supabase
            .from("stock_movements")
            .insert({
              org_id: orgId,
              branch_id: branchId,
              product_id: created.id,
              delta_qty: opening,
              reason: "opening",
              ref_table: "product_create",
              ref_id: created.id,
              note: "Opening stock when product was created",
            });
          if (stockErr) {
            // Don't fail the whole product creation — surface a warning.
            console.warn("Opening stock movement failed:", stockErr.message);
          }
        }
      }
      return created;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products", orgId] }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Product> }) => {
      const { error } = await supabase
        .from("products")
        .update({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.price !== undefined && { price: patch.price }),
          ...(patch.type !== undefined && { type: patch.type }),
          ...(patch.unit !== undefined && { unit: patch.unit }),
          ...(patch.category !== undefined && { category: patch.category }),
          ...(patch.foodGroup !== undefined && { food_group: patch.foodGroup }),
          ...(patch.trackStock !== undefined && { track_stock: patch.trackStock }),
        })
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products", orgId] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id).eq("org_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products", orgId] }),
  });

  return {
    products,
    add: (product: Omit<Product, "id">, openingStock?: number) =>
      addMutation.mutate({ product, openingStock }),
    update: (id: string, patch: Partial<Product>) => updateMutation.mutate({ id, patch }),
    remove: (id: string) => removeMutation.mutate(id),
  };
}

// ── useStock ──────────────────────────────────────────────────────────────────

export function useStock(date: string = todayISO()) {
  const qc = useQueryClient();
  const chId = useRef(`stock-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data: entries = [] } = useQuery({
    queryKey: ["stock_entries", orgId, branchId],
    queryFn: async () => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase
        .from("stock_entries")
        .select("*")
        .eq("org_id", orgId)
        .eq("branch_id", branchId)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapStockEntry);
    },
    staleTime: 30_000,
    enabled: !!orgId && !!branchId,
  });

  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_entries" }, () =>
        qc.invalidateQueries({ queryKey: ["stock_entries", orgId, branchId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId]);

  const setOpeningMutation = useMutation({
    mutationFn: async ({ productId, openingQty }: { productId: string; openingQty: number }) => {
      const { error } = await supabase.from("stock_entries").upsert(
        { org_id: orgId, branch_id: branchId, product_id: productId, date, opening_qty: openingQty },
        { onConflict: "branch_id,product_id,date" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stock_entries", orgId, branchId] }),
  });

  const setOpening = (productId: string, openingQty: number) =>
    setOpeningMutation.mutate({ productId, openingQty });

  const getOpening = (productId: string) =>
    entries.find((e) => e.productId === productId && e.date === date)?.openingQty ?? 0;

  return { entries, setOpening, getOpening };
}

// ── usePurchases ──────────────────────────────────────────────────────────────

export function usePurchases(date?: string) {
  const qc = useQueryClient();
  const chId = useRef(`purchases-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data: allPurchases = [] } = useQuery({
    queryKey: ["purchase_orders", orgId, branchId],
    queryFn: async () => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*")
        .eq("org_id", orgId)
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapPurchaseOrder);
    },
    staleTime: 30_000,
    enabled: !!orgId && !!branchId,
  });

  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_orders" }, () =>
        qc.invalidateQueries({ queryKey: ["purchase_orders", orgId, branchId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId]);

  const purchases = date ? allPurchases.filter((p) => p.date === date) : allPurchases;

  const addMutation = useMutation({
    mutationFn: async (po: Omit<PurchaseOrder, "id" | "timestamp" | "date" | "totalCost" | "received">) => {
      const totalCost = po.quantity * po.costPerUnit;
      // Default received=TRUE so the po_to_stock_trigger fires immediately
      // and stock goes up the moment the PO is recorded. Small butcheries
      // don't have a "ordered but not delivered yet" stage; they pay when
      // they take the meat. If you ever need a two-step workflow, pass
      // received explicitly and add a "Mark received" button later.
      const { data, error } = await supabase
        .from("purchase_orders")
        .insert({
          org_id: orgId,
          branch_id: branchId,
          date: todayISO(),
          product_id: po.productId,
          supplier: po.supplier,
          quantity: po.quantity,
          cost_per_unit: po.costPerUnit,
          total_cost: totalCost,
          notes: po.notes ?? null,
          received: true,
          created_by: getProfileId(),
        })
        .select()
        .single();
      if (error) throw error;
      return mapPurchaseOrder(data as Record<string, unknown>);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase_orders", orgId, branchId] }),
  });

  const markReceivedMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ received: true })
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase_orders", orgId, branchId] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("purchase_orders")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase_orders", orgId, branchId] }),
  });

  const purchasedQtyFor = (productId: string, d: string) =>
    allPurchases
      .filter((p) => p.productId === productId && p.date === d)
      .reduce((a, p) => a + p.quantity, 0);

  return {
    purchases,
    allPurchases,
    add: (po: Omit<PurchaseOrder, "id" | "timestamp" | "date" | "totalCost" | "received">) =>
      addMutation.mutate(po),
    markReceived: (id: string) => markReceivedMutation.mutate(id),
    remove: (id: string) => removeMutation.mutate(id),
    purchasedQtyFor,
  };
}

// ── useSales ──────────────────────────────────────────────────────────────────

export function useSales(date?: string) {
  const qc = useQueryClient();
  const salesChId = useRef(`sales-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();
  const branchId = getBranchId();
  const profileId = getProfileId();
  const role = getRole();
  const canViewAll = role === "admin" || role === "manager" || hasPermission("can_view_transactions");

  const { data: allSales = [] } = useQuery({
    queryKey: ["sales", orgId, branchId, canViewAll ? "all" : profileId],
    queryFn: async () => {
      if (!orgId || !branchId) return [];
      let q = supabase
        .from("sales")
        .select("*, sale_items(*)")
        .eq("org_id", orgId)
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false });

      // Cashier without can_view_transactions sees only their own sales
      if (!canViewAll && profileId) {
        q = q.eq("created_by", profileId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((row) => mapSale(row as Record<string, unknown>));
    },
    staleTime: 15_000,
    enabled: !!orgId && !!branchId,
  });

  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(salesChId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () =>
        qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, () =>
        qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId]);

  const sales = date ? allSales.filter((s) => s.date === date) : allSales;

  const addMutation = useMutation({
    mutationFn: async (
      s: Omit<Sale, "id" | "timestamp" | "date" | "subtotal" | "receiptNo">,
    ) => {
      const subtotal = s.items.reduce((a, i) => a + i.amount, 0);

      const { data: receiptNo, error: receiptErr } = await supabase.rpc(
        "next_receipt_no",
        { p_org_id: orgId },
      );
      if (receiptErr) throw receiptErr;

      const { data: saleRow, error: saleErr } = await supabase
        .from("sales")
        .insert({
          org_id: orgId,
          branch_id: branchId,
          receipt_no: receiptNo as string,
          date: todayISO(),
          payment: s.payment,
          subtotal,
          cash_given: s.cashGiven ?? null,
          change_amount: s.change ?? null,
          mpesa_ref: s.mpesaRef ?? null,
          customer_name: s.customerName ?? null,
          customer_phone: s.customerPhone ?? null,
          paid: s.paid ?? false,
          created_by: profileId,
        })
        .select()
        .single();
      if (saleErr) throw saleErr;

      if (s.items.length > 0) {
        const { error: itemsErr } = await supabase.from("sale_items").insert(
          s.items.map((item) => ({
            sale_id: (saleRow as { id: string }).id,
            product_id: item.productId,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            amount: item.amount,
          })),
        );
        if (itemsErr) throw itemsErr;
      }

      return mapSale({
        ...(saleRow as Record<string, unknown>),
        sale_items: s.items.map((i) => ({
          product_id: i.productId,
          quantity: i.quantity,
          unit_price: i.unitPrice,
          amount: i.amount,
        })),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Sale> }) => {
      const payload: Record<string, unknown> = {};
      if (patch.paid !== undefined) payload.paid = patch.paid;
      if (patch.customerName !== undefined) payload.customer_name = patch.customerName;
      if (patch.customerPhone !== undefined) payload.customer_phone = patch.customerPhone;
      if (patch.mpesaRef !== undefined) payload.mpesa_ref = patch.mpesaRef;
      const { error } = await supabase.from("sales").update(payload).eq("id", id).eq("org_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales").delete().eq("id", id).eq("org_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
  });

  const soldQtyFor = (productId: string, d: string) =>
    allSales
      .filter((s) => s.date === d)
      .reduce(
        (a, s) =>
          a + s.items.filter((i) => i.productId === productId).reduce((aa, i) => aa + i.quantity, 0),
        0,
      );

  return {
    sales,
    allSales,
    add: (s: Omit<Sale, "id" | "timestamp" | "date" | "subtotal" | "receiptNo">) =>
      addMutation.mutateAsync(s),
    update: (id: string, patch: Partial<Sale>) => updateMutation.mutate({ id, patch }),
    remove: (id: string) => removeMutation.mutate(id),
    soldQtyFor,
  };
}

// ── useStockOnHand ────────────────────────────────────────────────────────────
// Live view: current stock per tracked product at the current branch.
// Backed by the v_stock_on_hand view (SUM of stock_movements).
// Realtime-invalidated when stock_movements change.
//
// Also exposes `addStock` — a one-click way to push a positive
// stock_movement (reason='adjustment'). Used by the "+ Add stock"
// button on each product card.

export interface StockOnHandRow {
  productId: string;
  productName: string;
  unit: string;
  category: string | null;
  foodGroup: FoodGroup | null;
  qtyOnHand: number;
}

export function useStockOnHand() {
  const qc = useQueryClient();
  const chId = useRef(`stock_on_hand-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data: rows = [] } = useQuery({
    queryKey: ["stock_on_hand", orgId, branchId],
    queryFn: async (): Promise<StockOnHandRow[]> => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase
        .from("v_stock_on_hand")
        .select("*")
        .eq("org_id", orgId)
        .eq("branch_id", branchId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        productId: r.product_id as string,
        productName: r.product_name as string,
        unit: r.unit as string,
        category: (r.category as string | null) ?? null,
        foodGroup: (r.food_group as FoodGroup | null) ?? null,
        qtyOnHand: Number(r.qty_on_hand),
      }));
    },
    staleTime: 15_000,
    enabled: !!orgId && !!branchId,
  });

  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_movements" }, () =>
        qc.invalidateQueries({ queryKey: ["stock_on_hand", orgId, branchId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId]);

  const byProductId = (pid: string) =>
    rows.find((r) => r.productId === pid)?.qtyOnHand ?? 0;

  // ── addStock ────────────────────────────────────────────────────────────
  // Inserts a +delta_qty row into stock_movements. Used by the "+ Add stock"
  // button and the corrective "Set stock to N" action.
  // Reason='adjustment' so reports know this wasn't a purchase or a sale.
  const addStockMutation = useMutation({
    mutationFn: async (params: {
      productId: string;
      delta: number;
      note?: string;
    }) => {
      if (!orgId || !branchId) {
        throw new Error(
          "No active branch. Try logging out and back in, or create a branch in Settings.",
        );
      }
      const { error } = await supabase.from("stock_movements").insert({
        org_id: orgId,
        branch_id: branchId,
        product_id: params.productId,
        delta_qty: params.delta,
        reason: "adjustment",
        ref_table: "manual",
        note: params.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stock_on_hand", orgId, branchId] }),
  });

  const addStock = (productId: string, delta: number, note?: string) =>
    addStockMutation.mutateAsync({ productId, delta, note });

  return { rows, byProductId, addStock };
}

// ── useStockMovements ─────────────────────────────────────────────────────────
// The audit log of EVERY change to stock — purchases, sales, manual
// adjustments, opening counts. Used by the "Stock movements" sub-tab
// inside the Inventory page. Each row tells you:
//
//   - WHAT product moved
//   - HOW MUCH (positive = stock added; negative = stock removed)
//   - WHY (reason: purchase / sale / adjustment / opening / waste)
//   - WHICH source row it came from (ref_table + ref_id)
//   - WHEN it happened
//   - WHO did it (via the source row; not exposed directly yet)
//
// We don't paginate yet — for a small butchery this rarely exceeds a few
// thousand rows even after months of trading. A LIMIT keeps it safe.

export interface StockMovementRow {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  deltaQty: number;
  reason: "purchase" | "sale" | "waste" | "adjustment" | "opening";
  refTable: string | null;
  note: string | null;
  occurredAt: string;
}

export function useStockMovements(limit = 200) {
  const orgId = getOrgId();
  const branchId = getBranchId();
  const qc = useQueryClient();
  const chId = useRef(`stock_movements_log-${Math.random().toString(36).slice(2)}`);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["stock_movements_log", orgId, branchId, limit],
    queryFn: async (): Promise<StockMovementRow[]> => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, product_id, delta_qty, reason, ref_table, note, occurred_at, products(name, unit)")
        .eq("org_id", orgId)
        .eq("branch_id", branchId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const productJoin = r.products as { name?: string; unit?: string } | null;
        return {
          id: r.id as string,
          productId: r.product_id as string,
          productName: productJoin?.name ?? "(deleted product)",
          unit: productJoin?.unit ?? "",
          deltaQty: Number(r.delta_qty),
          reason: r.reason as StockMovementRow["reason"],
          refTable: (r.ref_table as string | null) ?? null,
          note: (r.note as string | null) ?? null,
          occurredAt: r.occurred_at as string,
        };
      });
    },
    staleTime: 15_000,
    enabled: !!orgId && !!branchId,
  });

  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_movements" }, () =>
        qc.invalidateQueries({ queryKey: ["stock_movements_log", orgId, branchId, limit] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId, limit]);

  return { rows, isLoading };
}

// ── useDailyStockReport ───────────────────────────────────────────────────────
// Per-product stock breakdown for a given calendar date, computed entirely
// from the stock_movements event log. This is what powers the
// "Opening / + Purchased / − Sold / Remaining" table in the daily report.
//
// Mental model (plain English):
//   Opening   = stock at the START of that day
//             = cumulative net of every movement before 00:00 local time
//   Purchased = positive movements ON that day
//               (supplier deliveries, opening counts, +adjustments)
//   Sold      = negative movements ON that day
//               (sales, waste, −adjustments)
//   Remaining = Opening + Purchased − Sold
//
// The math reconciles by construction — no two-tables-disagree bugs.

export interface DailyStockBreakdown {
  opening: number;
  purchased: number;
  sold: number;
  remaining: number;
}

export function useDailyStockReport(date: string = todayISO()) {
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data, isLoading } = useQuery({
    queryKey: ["daily_stock_report", orgId, branchId, date],
    queryFn: async (): Promise<Map<string, DailyStockBreakdown>> => {
      const empty = new Map<string, DailyStockBreakdown>();
      if (!orgId || !branchId) return empty;

      // Interpret `date` as LOCAL midnight. JavaScript automatically
      // converts to UTC for the ISO string the DB compares against, so
      // we never lose hours to timezone confusion.
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const dayStartIso = dayStart.toISOString();
      const dayEndIso = dayEnd.toISOString();

      // Pull every movement up to the END of the chosen day. Anything
      // after that doesn't affect this date's report.
      const { data: rows, error } = await supabase
        .from("stock_movements")
        .select("product_id, delta_qty, reason, occurred_at")
        .eq("org_id", orgId)
        .eq("branch_id", branchId)
        .lt("occurred_at", dayEndIso);

      if (error) throw error;

      const map = new Map<string, DailyStockBreakdown>();
      const get = (pid: string): DailyStockBreakdown => {
        let agg = map.get(pid);
        if (!agg) {
          agg = { opening: 0, purchased: 0, sold: 0, remaining: 0 };
          map.set(pid, agg);
        }
        return agg;
      };

      for (const r of rows ?? []) {
        const pid = r.product_id as string;
        const delta = Number(r.delta_qty);
        const occurredAt = String(r.occurred_at);
        const agg = get(pid);

        if (occurredAt < dayStartIso) {
          // Before this date — counts toward opening (signed).
          agg.opening += delta;
        } else {
          // Between day-start and day-end. Split by sign so positive
          // adjustments show under Purchased and negative ones (waste,
          // corrections, sales) show under Sold. That keeps the math
          // simple: opening + purchased − sold = remaining, always.
          if (delta >= 0) agg.purchased += delta;
          else agg.sold += Math.abs(delta);
        }
      }

      // Compute remaining = opening + purchased − sold for each row.
      // We don't read v_stock_on_hand because that's "stock NOW", not
      // "stock at end of the selected date". For today's date they'll
      // be equal; for a past date they won't.
      for (const [, agg] of map) {
        agg.remaining = Math.max(agg.opening + agg.purchased - agg.sold, 0);
      }

      return map;
    },
    staleTime: 30_000,
    enabled: !!orgId && !!branchId,
  });

  const byProductId = (pid: string): DailyStockBreakdown =>
    data?.get(pid) ?? { opening: 0, purchased: 0, sold: 0, remaining: 0 };

  return { byProductId, isLoading };
}

// ── useSalesByCategory ────────────────────────────────────────────────────────
// "How much beef vs chicken vs goat did we sell today?"

export interface SalesByCategoryRow {
  category: string;
  foodGroup: string;
  qtySold: number;
  revenue: number;
  txnCount: number;
}

export function useSalesByCategory(
  from: string = todayISO(),
  to: string = todayISO(),
) {
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["report_sales_by_category", orgId, branchId, from, to],
    queryFn: async (): Promise<SalesByCategoryRow[]> => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase.rpc("report_sales_by_category", {
        p_org_id: orgId,
        p_branch_id: branchId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        category: r.category as string,
        foodGroup: r.food_group as string,
        qtySold: Number(r.qty_sold ?? 0),
        revenue: Number(r.revenue ?? 0),
        txnCount: Number(r.txn_count ?? 0),
      }));
    },
    staleTime: 30_000,
    enabled: !!orgId && !!branchId,
  });

  return { rows, isLoading };
}

// ── useTopFoodGroups ──────────────────────────────────────────────────────────
// "What's our top-selling food group — meat / meals / drinks?"

export interface TopFoodGroupRow {
  foodGroup: string;
  revenue: number;
  txnCount: number;
  sharePct: number;
}

export function useTopFoodGroups(
  from: string = todayISO(),
  to: string = todayISO(),
) {
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["report_top_food_groups", orgId, branchId, from, to],
    queryFn: async (): Promise<TopFoodGroupRow[]> => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase.rpc("report_top_food_groups", {
        p_org_id: orgId,
        p_branch_id: branchId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        foodGroup: r.food_group as string,
        revenue: Number(r.revenue ?? 0),
        txnCount: Number(r.txn_count ?? 0),
        sharePct: Number(r.share_pct ?? 0),
      }));
    },
    staleTime: 30_000,
    enabled: !!orgId && !!branchId,
  });

  return { rows, isLoading };
}
