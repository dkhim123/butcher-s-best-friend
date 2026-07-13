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
  CustomerBalance,
  CustomerPayment,
  Department,
  FoodGroup,
  PaymentMethodSimple,
  POItem,
  Product,
  ProductServing,
  PurchaseOrder,
  PurchaseOrderDoc,
  paidVia,
  Sale,
  SaleItem,
  StockEntry,
  todayISO,
} from "./butchery-types";

// ── Explicit column lists ─────────────────────────────────────────────────────
// We never `select("*")`. Listing columns keeps egress small and predictable
// (owners watch these screens all day on metered mobile data) and avoids
// pulling wide/derived columns we don't render.
const PRODUCT_COLS =
  "id, name, type, price, unit, category, food_group, department, track_stock, container_ml, cost_price, created_at";
const SALE_COLS =
  "id, receipt_no, date, payment, payments, subtotal, cash_given, change_amount, mpesa_ref, customer_name, customer_phone, customer_id, paid, created_by, shift_id, cancel_state, cancel_reason, created_at";
const SALE_ITEM_COLS = "product_id, quantity, unit_price, amount, serving_name, serving_ml";

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
    department: (row.department as Department | undefined) ?? "restaurant",
    trackStock: Boolean(row.track_stock),
    containerMl: row.container_ml != null ? Number(row.container_ml) : null,
    costPrice: row.cost_price != null ? Number(row.cost_price) : null,
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
    servingName: (i.serving_name as string | null) ?? null,
    servingMl: i.serving_ml != null ? Number(i.serving_ml) : null,
  }));
  return {
    id: row.id as string,
    receiptNo: row.receipt_no as string,
    date: row.date as string,
    timestamp: new Date(row.created_at as string).getTime(),
    items,
    subtotal: Number(row.subtotal),
    payment: row.payment as Sale["payment"],
    payments: Array.isArray(row.payments)
      ? (row.payments as Sale["payments"])
      : [],
    cashGiven: row.cash_given != null ? Number(row.cash_given) : undefined,
    change: row.change_amount != null ? Number(row.change_amount) : undefined,
    mpesaRef: (row.mpesa_ref as string) ?? undefined,
    customerName: (row.customer_name as string) ?? undefined,
    customerPhone: (row.customer_phone as string) ?? undefined,
    customerId: (row.customer_id as string | null) ?? null,
    paid: Boolean(row.paid),
    shiftId: (row.shift_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    cancelState: (row.cancel_state as Sale["cancelState"]) ?? "none",
    cancelReason: (row.cancel_reason as string | null) ?? null,
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
        .select(PRODUCT_COLS)
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
    // Server-side filter: this device only receives change events for its own
    // org, not every business on the platform. Fewer messages, less egress.
    const channel = supabase
      .channel(chId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products", filter: `org_id=eq.${orgId}` },
        () => qc.invalidateQueries({ queryKey: ["products", orgId] }),
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
          department: p.department ?? "restaurant",
          track_stock: p.trackStock,
          container_ml: p.containerMl ?? null,
          cost_price: p.costPrice ?? null,
        })
        .select(PRODUCT_COLS)
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
          ...(patch.department !== undefined && { department: patch.department }),
          ...(patch.trackStock !== undefined && { track_stock: patch.trackStock }),
          ...(patch.containerMl !== undefined && { container_ml: patch.containerMl }),
          ...(patch.costPrice !== undefined && { cost_price: patch.costPrice }),
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
    // Returns the created product so callers can chain (e.g. attach bar
    // serving sizes right after creating a spirit).
    add: (product: Omit<Product, "id">, openingStock?: number) =>
      addMutation.mutateAsync({ product, openingStock }),
    update: (id: string, patch: Partial<Product>) => updateMutation.mutate({ id, patch }),
    remove: (id: string) => removeMutation.mutate(id),
  };
}

// ── useServings ───────────────────────────────────────────────────────────────
// Bar serving options (Tot / Glass / Full bottle …) across the whole org.
// Loaded once and grouped by product on the client — the set is tiny.

export function useServings() {
  const qc = useQueryClient();
  const chId = useRef(`servings-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();

  const { data: servings = [] } = useQuery({
    queryKey: ["product_servings", orgId],
    queryFn: async (): Promise<ProductServing[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("product_servings")
        .select("id, product_id, name, volume_ml, price, sort")
        .eq("org_id", orgId)
        .order("sort");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        productId: r.product_id as string,
        name: r.name as string,
        volumeMl: Number(r.volume_ml),
        price: Number(r.price),
        sort: Number(r.sort),
      }));
    },
    staleTime: 60_000,
    enabled: !!orgId,
  });

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(chId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_servings", filter: `org_id=eq.${orgId}` },
        () => qc.invalidateQueries({ queryKey: ["product_servings", orgId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId]);

  const addMutation = useMutation({
    mutationFn: async (s: Omit<ProductServing, "id">) => {
      const { error } = await supabase.from("product_servings").insert({
        org_id: orgId,
        product_id: s.productId,
        name: s.name,
        volume_ml: s.volumeMl,
        price: s.price,
        sort: s.sort,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product_servings", orgId] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("product_servings")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product_servings", orgId] }),
  });

  const forProduct = (productId: string) =>
    servings.filter((s) => s.productId === productId);

  return {
    servings,
    forProduct,
    add: (s: Omit<ProductServing, "id">) => addMutation.mutateAsync(s),
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
        .select("id, product_id, date, opening_qty")
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_entries", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["stock_entries", orgId, branchId] }),
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
        .select("id, date, product_id, supplier, quantity, cost_per_unit, total_cost, notes, received, created_at")
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_orders", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["purchase_orders", orgId, branchId] }),
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

// ── usePurchaseOrders ─────────────────────────────────────────────────────────
// Multi-line purchase orders: one supplier, one delivery, many product lines.
// Receiving raises stock per line (via the po_item_to_stock trigger).

export function usePurchaseOrders(date?: string) {
  const qc = useQueryClient();
  const chId = useRef(`purchase_orders_v2-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data: all = [] } = useQuery({
    queryKey: ["purchase_orders_v2", orgId, branchId],
    queryFn: async (): Promise<PurchaseOrderDoc[]> => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase
        .from("purchase_orders")
        .select(
          "id, date, department, supplier, received, total_cost, notes, created_at, purchase_order_items(product_id, quantity, cost_per_unit, amount)",
        )
        .eq("org_id", orgId)
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        const items: POItem[] = ((row.purchase_order_items as Record<string, unknown>[]) ?? []).map(
          (i) => ({
            productId: i.product_id as string,
            quantity: Number(i.quantity),
            costPerUnit: Number(i.cost_per_unit),
            amount: Number(i.amount),
          }),
        );
        return {
          id: row.id as string,
          date: row.date as string,
          timestamp: new Date(row.created_at as string).getTime(),
          supplier: row.supplier as string,
          department: (row.department as Department | null) ?? null,
          received: Boolean(row.received),
          totalCost: Number(row.total_cost ?? 0),
          notes: (row.notes as string) ?? undefined,
          items,
        };
      });
    },
    staleTime: 30_000,
    enabled: !!orgId && !!branchId,
  });

  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_orders", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["purchase_orders_v2", orgId, branchId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_order_items" }, () =>
        qc.invalidateQueries({ queryKey: ["purchase_orders_v2", orgId, branchId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId]);

  const orders = date ? all.filter((o) => o.date === date) : all;

  const addMutation = useMutation({
    mutationFn: async (params: {
      supplier: string;
      department: Department;
      notes?: string;
      items: POItem[];
    }) => {
      const { data: header, error: headerErr } = await supabase
        .from("purchase_orders")
        .insert({
          org_id: orgId,
          branch_id: branchId,
          date: todayISO(),
          department: params.department,
          supplier: params.supplier,
          received: true,
          notes: params.notes ?? null,
          created_by: getProfileId(),
        })
        .select("id")
        .single();
      if (headerErr) throw headerErr;

      const poId = (header as { id: string }).id;
      const { error: itemsErr } = await supabase.from("purchase_order_items").insert(
        params.items.map((i) => ({
          po_id: poId,
          product_id: i.productId,
          quantity: i.quantity,
          cost_per_unit: i.costPerUnit,
        })),
      );
      if (itemsErr) throw itemsErr;
      return poId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase_orders_v2", orgId, branchId] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase_orders_v2", orgId, branchId] }),
  });

  return {
    orders,
    all,
    add: (params: { supplier: string; department: Department; notes?: string; items: POItem[] }) =>
      addMutation.mutateAsync(params),
    remove: (id: string) => removeMutation.mutate(id),
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
        .select(`${SALE_COLS}, sale_items(${SALE_ITEM_COLS})`)
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
    // Branch-filtered so a till only wakes for sales at its own branch.
    // (sale_items has no branch_id, so it stays unfiltered — its parent sale
    // is already branch-scoped, and item events are what carry the line data.)
    const channel = supabase
      .channel(salesChId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
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
      // One atomic call: the create_sale RPC writes the sale AND its items in a
      // single transaction, so a mid-write failure can never leave a "phantom
      // sale" (money recorded, no items, stock not deducted). The server draws
      // the receipt number and computes the subtotal, so both are authoritative.
      const { data: saleRow, error } = await supabase.rpc("create_sale", {
        p_org_id: orgId,
        p_branch_id: branchId,
        p_payment: s.payment,
        // Round-trip through JSON to drop any undefined `ref` and match JSONB.
        p_items: JSON.parse(
          JSON.stringify(
            s.items.map((item) => ({
              product_id: item.productId,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              serving_name: item.servingName ?? null,
              serving_ml: item.servingMl ?? null,
            })),
          ),
        ),
        p_payments: JSON.parse(JSON.stringify(s.payments ?? [])),
        p_cash_given: s.cashGiven ?? null,
        p_change: s.change ?? null,
        p_mpesa_ref: s.mpesaRef ?? null,
        p_customer_name: s.customerName ?? null,
        p_customer_phone: s.customerPhone ?? null,
        p_customer_id: s.customerId ?? null,
        p_paid: s.paid ?? false,
        p_created_by: profileId,
        p_shift_id: s.shiftId ?? null,
      });
      // Surface the DB's own message (e.g. "Not enough Tusker in stock — short
      // by 2 bottle") instead of a generic failure — it's a plain object, so
      // wrap it in a real Error for the POS's `instanceof Error` toast.
      if (error) throw new Error(error.message);

      // The RPC returns the sales row (authoritative id/receipt_no/subtotal).
      // Attach the items we just sent so the receipt can render immediately.
      return mapSale({
        ...(saleRow as Record<string, unknown>),
        sale_items: s.items.map((i) => ({
          product_id: i.productId,
          quantity: i.quantity,
          unit_price: i.unitPrice,
          amount: i.amount,
          serving_name: i.servingName ?? null,
          serving_ml: i.servingMl ?? null,
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

  const requestCancelMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("request_cancel", {
        p_actor_id: getProfileId() as string,
        p_sale_id: id,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
  });

  const approveCancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("approve_cancel", {
        p_actor_id: getProfileId() as string,
        p_sale_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
  });

  const rejectCancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("reject_cancel", {
        p_actor_id: getProfileId() as string,
        p_sale_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales", orgId, branchId] }),
  });

  // Cancelled sales don't count as sold (stock was returned).
  const soldQtyFor = (productId: string, d: string) =>
    allSales
      .filter((s) => s.date === d && s.cancelState !== "cancelled")
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
    requestCancel: (id: string, reason?: string) =>
      requestCancelMutation.mutateAsync({ id, reason }),
    approveCancel: (id: string) => approveCancelMutation.mutateAsync(id),
    rejectCancel: (id: string) => rejectCancelMutation.mutateAsync(id),
    soldQtyFor,
  };
}

// ── useCustomers ──────────────────────────────────────────────────────────────
// Loan accounts and their outstanding balances (credit sales − repayments),
// read from the v_customer_balances view.

export function useCustomers() {
  const qc = useQueryClient();
  const chId = useRef(`customers-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();

  const { data: customers = [] } = useQuery({
    queryKey: ["customer_balances", orgId],
    queryFn: async (): Promise<CustomerBalance[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("v_customer_balances")
        .select("customer_id, name, phone, owed, repaid, balance")
        .eq("org_id", orgId)
        .order("balance", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.customer_id as string,
        name: r.name as string,
        phone: (r.phone as string | null) ?? null,
        owed: Number(r.owed ?? 0),
        repaid: Number(r.repaid ?? 0),
        balance: Number(r.balance ?? 0),
      }));
    },
    staleTime: 20_000,
    enabled: !!orgId,
  });

  // Balances derive from customers + sales + payments; watch all three.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers", filter: `org_id=eq.${orgId}` }, () =>
        qc.invalidateQueries({ queryKey: ["customer_balances", orgId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_payments", filter: `org_id=eq.${orgId}` }, () =>
        qc.invalidateQueries({ queryKey: ["customer_balances", orgId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `org_id=eq.${orgId}` }, () =>
        qc.invalidateQueries({ queryKey: ["customer_balances", orgId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId]);

  const addMutation = useMutation({
    mutationFn: async (params: { name: string; phone?: string; note?: string }) => {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          org_id: orgId,
          name: params.name,
          phone: params.phone ?? null,
          note: params.note ?? null,
        })
        .select("id, name")
        .single();
      if (error) throw error;
      return data as { id: string; name: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer_balances", orgId] }),
  });

  return {
    customers,
    add: (params: { name: string; phone?: string; note?: string }) => addMutation.mutateAsync(params),
  };
}

// ── useCustomerLedger ─────────────────────────────────────────────────────────
// One customer's credit sales + repayments, and a way to record a repayment.

export interface CreditSaleRow {
  id: string;
  receiptNo: string;
  subtotal: number;
  paid: boolean;
  createdAt: string;
}

export function useCustomerLedger(customerId: string | null) {
  const qc = useQueryClient();
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data: payments = [] } = useQuery({
    queryKey: ["customer_payments", orgId, customerId],
    queryFn: async (): Promise<CustomerPayment[]> => {
      if (!orgId || !customerId) return [];
      const { data, error } = await supabase
        .from("customer_payments")
        .select("id, amount, method, note, created_at")
        .eq("org_id", orgId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        amount: Number(r.amount),
        method: r.method as PaymentMethodSimple,
        note: (r.note as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },
    staleTime: 15_000,
    enabled: !!orgId && !!customerId,
  });

  const { data: creditSales = [] } = useQuery({
    queryKey: ["customer_credit_sales", orgId, customerId],
    queryFn: async (): Promise<CreditSaleRow[]> => {
      if (!orgId || !customerId) return [];
      const { data, error } = await supabase
        .from("sales")
        .select("id, receipt_no, subtotal, paid, created_at")
        .eq("org_id", orgId)
        .eq("customer_id", customerId)
        .eq("payment", "credit")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        receiptNo: r.receipt_no as string,
        subtotal: Number(r.subtotal),
        paid: Boolean(r.paid),
        createdAt: r.created_at as string,
      }));
    },
    staleTime: 15_000,
    enabled: !!orgId && !!customerId,
  });

  const addPaymentMutation = useMutation({
    mutationFn: async (params: { amount: number; method: PaymentMethodSimple; note?: string }) => {
      if (!customerId) throw new Error("No customer selected");
      const { error } = await supabase.from("customer_payments").insert({
        org_id: orgId,
        branch_id: branchId || null,
        customer_id: customerId,
        amount: params.amount,
        method: params.method,
        note: params.note ?? null,
        created_by: getProfileId(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer_payments", orgId, customerId] });
      qc.invalidateQueries({ queryKey: ["customer_balances", orgId] });
    },
  });

  return {
    payments,
    creditSales,
    addPayment: (params: { amount: number; method: PaymentMethodSimple; note?: string }) =>
      addPaymentMutation.mutateAsync(params),
  };
}

// ── useShift ──────────────────────────────────────────────────────────────────
// A cashier's current till session. Open with a cash float, sell (each sale is
// stamped with shift_id), close with a cash-up (expected vs counted).

export interface Shift {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  expectedCash: number | null;
  countedCash: number | null;
  status: "open" | "closed";
}

function mapShift(row: Record<string, unknown>): Shift {
  return {
    id: row.id as string,
    openedAt: row.opened_at as string,
    closedAt: (row.closed_at as string | null) ?? null,
    openingFloat: Number(row.opening_float ?? 0),
    expectedCash: row.expected_cash != null ? Number(row.expected_cash) : null,
    countedCash: row.counted_cash != null ? Number(row.counted_cash) : null,
    status: row.status as "open" | "closed",
  };
}

export function useShift() {
  const qc = useQueryClient();
  const chId = useRef(`shift-${Math.random().toString(36).slice(2)}`);
  const orgId = getOrgId();
  const branchId = getBranchId();
  const profileId = getProfileId();

  const { data: shift = null } = useQuery({
    queryKey: ["shift_open", orgId, branchId, profileId],
    queryFn: async (): Promise<Shift | null> => {
      if (!orgId || !branchId || !profileId) return null;
      const { data, error } = await supabase
        .from("shifts")
        .select("id, opened_at, closed_at, opening_float, expected_cash, counted_cash, status")
        .eq("branch_id", branchId)
        .eq("cashier_id", profileId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? mapShift(data as Record<string, unknown>) : null;
    },
    staleTime: 15_000,
    enabled: !!orgId && !!branchId && !!profileId,
  });

  // Cash rung on this shift so far (for the running total on the shift bar).
  const { data: cashSoFar = 0 } = useQuery({
    queryKey: ["shift_cash", shift?.id],
    queryFn: async (): Promise<number> => {
      if (!shift?.id) return 0;
      const { data, error } = await supabase
        .from("sales")
        .select("payment, payments, subtotal")
        .eq("shift_id", shift.id)
        .in("payment", ["cash", "split"]);
      if (error) throw error;
      return (data ?? []).reduce(
        (a, r) => a + paidVia(r as unknown as Sale, "cash"),
        0,
      );
    },
    staleTime: 10_000,
    enabled: !!shift?.id,
  });

  useEffect(() => {
    if (!branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shifts", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["shift_open", orgId, branchId, profileId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId, profileId]);

  const openMutation = useMutation({
    mutationFn: async (openingFloat: number) => {
      const { data, error } = await supabase.rpc("open_shift", {
        p_org_id: orgId,
        p_branch_id: branchId,
        p_cashier_id: profileId as string,
        p_opening_float: openingFloat,
      });
      if (error) throw error;
      return mapShift(data as Record<string, unknown>);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift_open", orgId, branchId, profileId] }),
  });

  const closeMutation = useMutation({
    mutationFn: async (params: { shiftId: string; countedCash: number; note?: string }) => {
      const { data, error } = await supabase.rpc("close_shift", {
        p_shift_id: params.shiftId,
        p_counted_cash: params.countedCash,
        p_note: params.note ?? null,
      });
      if (error) throw error;
      return mapShift(data as Record<string, unknown>);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift_open", orgId, branchId, profileId] }),
  });

  return {
    shift,
    cashSoFar,
    openShift: (openingFloat: number) => openMutation.mutateAsync(openingFloat),
    closeShift: (shiftId: string, countedCash: number, note?: string) =>
      closeMutation.mutateAsync({ shiftId, countedCash, note }),
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
  department: Department;
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
        .select("product_id, product_name, unit, category, food_group, department, qty_on_hand")
        .eq("org_id", orgId)
        .eq("branch_id", branchId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        productId: r.product_id as string,
        productName: r.product_name as string,
        unit: r.unit as string,
        category: (r.category as string | null) ?? null,
        foodGroup: (r.food_group as FoodGroup | null) ?? null,
        department: (r.department as Department | undefined) ?? "restaurant",
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_movements", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["stock_on_hand", orgId, branchId] }),
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

  // ── recordUsage ─────────────────────────────────────────────────────────
  // The chef's "ingredients used today" log. Posts a NEGATIVE movement with
  // reason='usage' so reports can separate genuine kitchen consumption from
  // corrections (adjustment) and spoilage (waste).
  const recordUsageMutation = useMutation({
    mutationFn: async (params: { productId: string; qtyUsed: number; note?: string }) => {
      if (!orgId || !branchId) {
        throw new Error("No active branch. Log out and back in, or create a branch in Settings.");
      }
      const { error } = await supabase.from("stock_movements").insert({
        org_id: orgId,
        branch_id: branchId,
        product_id: params.productId,
        delta_qty: -Math.abs(params.qtyUsed),
        reason: "usage",
        ref_table: "kitchen_usage",
        note: params.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stock_on_hand", orgId, branchId] }),
  });

  const recordUsage = (productId: string, qtyUsed: number, note?: string) =>
    recordUsageMutation.mutateAsync({ productId, qtyUsed, note });

  return { rows, byProductId, addStock, recordUsage };
}

// ── useKitchenUsage ───────────────────────────────────────────────────────────
// How much of each ingredient the kitchen used on a given DATE — read straight
// from the 'usage' movements the chef logs in the Kitchen tab. The Food-cost
// widget multiplies each ingredient's used qty by its buying price and compares
// the total against the day's food sales.

export interface KitchenUsageRow {
  productId: string;
  qtyUsed: number; // total used that day, in the product's unit (always positive)
}

export function useKitchenUsage(from: string = todayISO(), to: string = from) {
  const orgId = getOrgId();
  const branchId = getBranchId();
  const qc = useQueryClient();
  const chId = useRef(`kitchen_usage-${Math.random().toString(36).slice(2)}`);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["kitchen_usage", orgId, branchId, from, to],
    queryFn: async (): Promise<KitchenUsageRow[]> => {
      if (!orgId || !branchId) return [];
      // Window [from 00:00 .. to+1day 00:00); single day when from===to.
      const dayStart = new Date(`${from}T00:00:00`);
      const dayEnd = new Date(`${to}T00:00:00`);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const { data, error } = await supabase
        .from("stock_movements")
        .select("product_id, delta_qty")
        .eq("org_id", orgId)
        .eq("branch_id", branchId)
        .eq("reason", "usage")
        .gte("occurred_at", dayStart.toISOString())
        .lt("occurred_at", dayEnd.toISOString());
      if (error) throw error;

      const map = new Map<string, number>();
      for (const r of data ?? []) {
        const delta = Number(r.delta_qty);
        if (!Number.isFinite(delta)) continue;
        const pid = r.product_id as string;
        // Usage is stored negative; report it as a positive "used" amount.
        map.set(pid, (map.get(pid) ?? 0) + Math.abs(delta));
      }
      return [...map.entries()].map(([productId, qtyUsed]) => ({ productId, qtyUsed }));
    },
    staleTime: 30_000,
    enabled: !!orgId && !!branchId,
  });

  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_movements", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["kitchen_usage", orgId, branchId, from, to] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId, from, to]);

  const byProductId = (pid: string) =>
    rows.find((r) => r.productId === pid)?.qtyUsed ?? 0;

  return { rows, byProductId, isLoading };
}

// ── useStockTake ──────────────────────────────────────────────────────────────
// Count physical stock, then finalize: the finalize_stock_take RPC snapshots the
// system qty and posts an 'adjustment' movement of (counted − on_hand) per line,
// so on-hand matches the count. The difference is the variance.

export interface StockTakeItemRow {
  productId: string;
  productName: string;
  unit: string;
  countedQty: number;
  systemQty: number | null;
}

export interface StockTakeRow {
  id: string;
  department: string | null;
  finalizedAt: string | null;
  createdAt: string;
  items: StockTakeItemRow[];
}

export function useStockTake() {
  const qc = useQueryClient();
  const orgId = getOrgId();
  const branchId = getBranchId();

  const { data: recent = [] } = useQuery({
    queryKey: ["stock_takes", orgId, branchId],
    queryFn: async (): Promise<StockTakeRow[]> => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase
        .from("stock_takes")
        .select(
          "id, department, finalized_at, created_at, stock_take_items(product_id, counted_qty, system_qty, products(name, unit))",
        )
        .eq("org_id", orgId)
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        const items: StockTakeItemRow[] = (
          (row.stock_take_items as Record<string, unknown>[]) ?? []
        ).map((i) => {
          const prod = i.products as { name?: string; unit?: string } | null;
          return {
            productId: i.product_id as string,
            productName: prod?.name ?? "(deleted product)",
            unit: prod?.unit ?? "",
            countedQty: Number(i.counted_qty),
            systemQty: i.system_qty != null ? Number(i.system_qty) : null,
          };
        });
        return {
          id: row.id as string,
          department: (row.department as string | null) ?? null,
          finalizedAt: (row.finalized_at as string | null) ?? null,
          createdAt: row.created_at as string,
          items,
        };
      });
    },
    staleTime: 30_000,
    enabled: !!orgId && !!branchId,
  });

  const finalizeMutation = useMutation({
    mutationFn: async (params: {
      department: Department;
      note?: string;
      items: { productId: string; countedQty: number }[];
    }) => {
      const { data: header, error: hErr } = await supabase
        .from("stock_takes")
        .insert({
          org_id: orgId,
          branch_id: branchId,
          department: params.department,
          status: "draft",
          note: params.note ?? null,
          taken_by: getProfileId(),
        })
        .select("id")
        .single();
      if (hErr) throw hErr;
      const takeId = (header as { id: string }).id;

      const { error: iErr } = await supabase.from("stock_take_items").insert(
        params.items.map((i) => ({
          stock_take_id: takeId,
          product_id: i.productId,
          counted_qty: i.countedQty,
        })),
      );
      if (iErr) throw iErr;

      const { error: fErr } = await supabase.rpc("finalize_stock_take", {
        p_stock_take_id: takeId,
      });
      if (fErr) throw fErr;
      return takeId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_takes", orgId, branchId] });
      qc.invalidateQueries({ queryKey: ["stock_on_hand", orgId, branchId] });
    },
  });

  return {
    recent,
    finalize: (params: {
      department: Department;
      note?: string;
      items: { productId: string; countedQty: number }[];
    }) => finalizeMutation.mutateAsync(params),
  };
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
  reason: "purchase" | "sale" | "waste" | "adjustment" | "opening" | "usage";
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_movements", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["stock_movements_log", orgId, branchId, limit] }),
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

export function useDailyStockReport(from: string = todayISO(), to: string = from) {
  const orgId = getOrgId();
  const branchId = getBranchId();
  const qc = useQueryClient();
  const chId = useRef(`daily_stock_report-${Math.random().toString(36).slice(2)}`);

  const { data, isLoading } = useQuery({
    queryKey: ["daily_stock_report", orgId, branchId, from, to],
    queryFn: async (): Promise<Map<string, DailyStockBreakdown>> => {
      const empty = new Map<string, DailyStockBreakdown>();
      if (!orgId || !branchId) return empty;

      // Window = [from 00:00 .. to+1day 00:00). For a single day from===to.
      // Movements before `from` roll into Opening; those inside the window are
      // Purchased/Sold — so Opening + Purchased − Sold = Remaining at range end.
      // Local midnight → UTC conversion is automatic, so no timezone drift.
      const dayStart = new Date(`${from}T00:00:00`);
      const dayEnd = new Date(`${to}T00:00:00`);
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
        // Defensive: if a malformed row ever reaches the client
        // (e.g. delta_qty IS NULL, or someone manually inserted a
        // non-numeric value), Number() returns NaN. NaN silently
        // poisons every running total because (NaN + x) === NaN and
        // (NaN ?? 0) === NaN. Skipping the row keeps the report
        // truthful and surfaces the underlying data bug elsewhere.
        if (!Number.isFinite(delta)) {
          console.warn(
            "[useDailyStockReport] skipping malformed stock_movement",
            { product_id: pid, delta_qty: r.delta_qty },
          );
          continue;
        }
        const reason = String(r.reason);
        const occurredAt = String(r.occurred_at);
        const agg = get(pid);

        if (occurredAt < dayStartIso) {
          // Anything that happened before today is part of the
          // running opening balance for today's report.
          agg.opening += delta;
        } else if (reason === "opening") {
          // "Opening stock" seed for a newly-created product. Even
          // though the INSERT happened today, semantically it
          // represents what the business STARTED the day with —
          // not a supplier purchase. Otherwise the Purchased column
          // would mirror Opening every time someone creates a new
          // product (which made Available look like a duplicate of
          // Purchased in the Daily Report).
          agg.opening += delta;
        } else if (delta >= 0) {
          // Real supplier purchase or a positive manual adjustment
          // made today (e.g. "received 10kg more from butcher").
          agg.purchased += delta;
        } else {
          // Sales, waste, or negative corrections — anything that
          // reduced stock today.
          agg.sold += Math.abs(delta);
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

  // Realtime: any new movement on this branch invalidates the
  // breakdown. Without this, the Daily Report's stock columns only
  // refresh on page reload. Critical for the "remote admin watches
  // sales as they happen" flow.
  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_movements", filter: `branch_id=eq.${branchId}` },
        () => qc.invalidateQueries({ queryKey: ["daily_stock_report", orgId, branchId, from, to] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId, from, to]);

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
  department: Department | null = null,
) {
  const orgId = getOrgId();
  const branchId = getBranchId();
  const qc = useQueryClient();
  const chId = useRef(`sales_by_category-${Math.random().toString(36).slice(2)}`);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["report_sales_by_category", orgId, branchId, from, to, department],
    queryFn: async (): Promise<SalesByCategoryRow[]> => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase.rpc("report_sales_by_category", {
        p_org_id: orgId,
        p_branch_id: branchId,
        p_from: from,
        p_to: to,
        p_department: department,
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

  // Realtime: every new sale_item changes these aggregates, so we
  // subscribe to sale_items inserts/updates/deletes and invalidate
  // the report. (Subscribing to `sales` alone misses item edits.)
  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, () =>
        qc.invalidateQueries({ queryKey: ["report_sales_by_category", orgId, branchId, from, to] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () =>
        qc.invalidateQueries({ queryKey: ["report_sales_by_category", orgId, branchId, from, to] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId, from, to]);

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
  department: Department | null = null,
) {
  const orgId = getOrgId();
  const branchId = getBranchId();
  const qc = useQueryClient();
  const chId = useRef(`top_food_groups-${Math.random().toString(36).slice(2)}`);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["report_top_food_groups", orgId, branchId, from, to, department],
    queryFn: async (): Promise<TopFoodGroupRow[]> => {
      if (!orgId || !branchId) return [];
      const { data, error } = await supabase.rpc("report_top_food_groups", {
        p_org_id: orgId,
        p_branch_id: branchId,
        p_from: from,
        p_to: to,
        p_department: department,
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

  // Realtime: keep the food-group pie/breakdown in sync with sale_items.
  useEffect(() => {
    if (!orgId || !branchId) return;
    const channel = supabase
      .channel(chId.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, () =>
        qc.invalidateQueries({ queryKey: ["report_top_food_groups", orgId, branchId, from, to] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () =>
        qc.invalidateQueries({ queryKey: ["report_top_food_groups", orgId, branchId, from, to] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, orgId, branchId, from, to]);

  return { rows, isLoading };
}
