export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type UserRole = "super_admin" | "admin" | "manager" | "cashier" | "room_manager" | "pending";

export type Department = "restaurant" | "bar" | "rooms";

export type FoodGroup =
  | "meat"
  | "prepared_food"
  | "drinks"
  | "raw_material"
  | "sides"
  | "groceries";

export interface UserPermissions {
  can_create_purchase_orders?: boolean;
  can_receive_purchases?: boolean;
  can_view_reports?: boolean;
  can_view_transactions?: boolean;
  can_view_products?: boolean;
  can_view_stock?: boolean;
  can_manage_credit?: boolean;
  /** Room manager: sees ONLY the Rooms page (hotel front desk), no POS. */
  can_manage_rooms?: boolean;
  /**
   * Which departments a cashier is allowed to work in. Empty/undefined for
   * admin & manager, who implicitly see every department. A Bar cashier is
   * {"departments": ["bar"]} and only ever sees Bar products/reports.
   */
  departments?: Department[];
}

export interface Database {
  public: {
    Tables: {
      organisations: {
        Row: {
          id: string;
          name: string;
          logo_url: string | null;
          tagline: string | null;
          phone: string | null;
          address: string | null;
          mpesa_paybill: string | null;
          mpesa_paybill_account: string | null;
          mpesa_till: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          logo_url?: string | null;
          tagline?: string | null;
          phone?: string | null;
          address?: string | null;
          mpesa_paybill?: string | null;
          mpesa_paybill_account?: string | null;
          mpesa_till?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          logo_url?: string | null;
          tagline?: string | null;
          phone?: string | null;
          address?: string | null;
          mpesa_paybill?: string | null;
          mpesa_paybill_account?: string | null;
          mpesa_till?: string | null;
          active?: boolean;
          created_at?: string;
        };
      };
      branches: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          password_hash: string;
          full_name: string | null;
          role: UserRole;
          org_id: string | null;
          branch_id: string | null;
          permissions: UserPermissions;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          password_hash: string;
          full_name?: string | null;
          role?: UserRole;
          org_id?: string | null;
          branch_id?: string | null;
          permissions?: UserPermissions;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          password_hash?: string;
          full_name?: string | null;
          role?: UserRole;
          org_id?: string | null;
          branch_id?: string | null;
          permissions?: UserPermissions;
          created_at?: string;
        };
      };
      products: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          type: "per_kg" | "fixed" | "meal";
          price: number;
          unit: string;
          category: string | null;
          food_group: FoodGroup | null;
          department: Department;
          track_stock: boolean;
          container_ml: number | null;
          cost_price: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          type: "per_kg" | "fixed" | "meal";
          price: number;
          unit: string;
          category?: string | null;
          food_group?: FoodGroup | null;
          department?: Department;
          track_stock?: boolean;
          container_ml?: number | null;
          cost_price?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          type?: "per_kg" | "fixed" | "meal";
          price?: number;
          unit?: string;
          category?: string | null;
          food_group?: FoodGroup | null;
          department?: Department;
          track_stock?: boolean;
          container_ml?: number | null;
          cost_price?: number | null;
          created_at?: string;
        };
      };
      product_servings: {
        Row: {
          id: string;
          org_id: string;
          product_id: string;
          name: string;
          volume_ml: number;
          price: number;
          sort: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          product_id: string;
          name: string;
          volume_ml: number;
          price: number;
          sort?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          product_id?: string;
          name?: string;
          volume_ml?: number;
          price?: number;
          sort?: number;
          created_at?: string;
        };
      };
      stock_movements: {
        Row: {
          id: string;
          org_id: string;
          branch_id: string;
          product_id: string;
          delta_qty: number;
          reason: "purchase" | "sale" | "waste" | "adjustment" | "opening" | "usage";
          ref_table: string | null;
          ref_id: string | null;
          note: string | null;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id: string;
          product_id: string;
          delta_qty: number;
          reason: "purchase" | "sale" | "waste" | "adjustment" | "opening" | "usage";
          ref_table?: string | null;
          ref_id?: string | null;
          note?: string | null;
          occurred_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          branch_id?: string;
          product_id?: string;
          delta_qty?: number;
          reason?: "purchase" | "sale" | "waste" | "adjustment" | "opening";
          ref_table?: string | null;
          ref_id?: string | null;
          note?: string | null;
          occurred_at?: string;
          created_at?: string;
        };
      };
      stock_entries: {
        Row: {
          id: string;
          org_id: string;
          branch_id: string;
          product_id: string;
          date: string;
          opening_qty: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id: string;
          product_id: string;
          date: string;
          opening_qty: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          branch_id?: string;
          product_id?: string;
          date?: string;
          opening_qty?: number;
          created_at?: string;
        };
      };
      purchase_orders: {
        Row: {
          id: string;
          org_id: string;
          branch_id: string;
          date: string;
          department: string | null;
          product_id: string | null;
          supplier: string;
          quantity: number | null;
          cost_per_unit: number | null;
          total_cost: number | null;
          notes: string | null;
          received: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id: string;
          date?: string;
          department?: string | null;
          product_id?: string | null;
          supplier: string;
          quantity?: number | null;
          cost_per_unit?: number | null;
          total_cost?: number | null;
          notes?: string | null;
          received?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          branch_id?: string;
          date?: string;
          department?: string | null;
          product_id?: string | null;
          supplier?: string;
          quantity?: number | null;
          cost_per_unit?: number | null;
          total_cost?: number | null;
          notes?: string | null;
          received?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
      };
      purchase_order_items: {
        Row: {
          id: string;
          po_id: string;
          product_id: string | null;
          quantity: number;
          cost_per_unit: number;
          amount: number;
        };
        Insert: {
          id?: string;
          po_id: string;
          product_id?: string | null;
          quantity: number;
          cost_per_unit: number;
          amount?: number;
        };
        Update: {
          id?: string;
          po_id?: string;
          product_id?: string | null;
          quantity?: number;
          cost_per_unit?: number;
          amount?: number;
        };
      };
      stock_takes: {
        Row: {
          id: string;
          org_id: string;
          branch_id: string;
          department: string | null;
          status: "draft" | "final";
          note: string | null;
          taken_by: string | null;
          created_at: string;
          finalized_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id: string;
          department?: string | null;
          status?: "draft" | "final";
          note?: string | null;
          taken_by?: string | null;
          created_at?: string;
          finalized_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          branch_id?: string;
          department?: string | null;
          status?: "draft" | "final";
          note?: string | null;
          taken_by?: string | null;
          created_at?: string;
          finalized_at?: string | null;
        };
      };
      stock_take_items: {
        Row: {
          id: string;
          stock_take_id: string;
          product_id: string;
          counted_qty: number;
          system_qty: number | null;
        };
        Insert: {
          id?: string;
          stock_take_id: string;
          product_id: string;
          counted_qty: number;
          system_qty?: number | null;
        };
        Update: {
          id?: string;
          stock_take_id?: string;
          product_id?: string;
          counted_qty?: number;
          system_qty?: number | null;
        };
      };
      shifts: {
        Row: {
          id: string;
          org_id: string;
          branch_id: string;
          cashier_id: string;
          opened_at: string;
          closed_at: string | null;
          opening_float: number;
          expected_cash: number | null;
          counted_cash: number | null;
          status: "open" | "closed";
          note: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id: string;
          cashier_id: string;
          opened_at?: string;
          closed_at?: string | null;
          opening_float?: number;
          expected_cash?: number | null;
          counted_cash?: number | null;
          status?: "open" | "closed";
          note?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          branch_id?: string;
          cashier_id?: string;
          opened_at?: string;
          closed_at?: string | null;
          opening_float?: number;
          expected_cash?: number | null;
          counted_cash?: number | null;
          status?: "open" | "closed";
          note?: string | null;
        };
      };
      sales: {
        Row: {
          id: string;
          org_id: string;
          branch_id: string;
          receipt_no: string;
          date: string;
          payment: "cash" | "mpesa" | "credit" | "split";
          payments: Json;
          subtotal: number;
          cash_given: number | null;
          change_amount: number | null;
          mpesa_ref: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          customer_id: string | null;
          paid: boolean;
          created_by: string | null;
          shift_id: string | null;
          cancel_state: "none" | "requested" | "cancelled" | "rejected";
          cancel_reason: string | null;
          cancel_by: string | null;
          cancel_approved_by: string | null;
          cancelled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id: string;
          receipt_no: string;
          date: string;
          payment: "cash" | "mpesa" | "credit" | "split";
          payments?: Json;
          subtotal: number;
          cash_given?: number | null;
          change_amount?: number | null;
          mpesa_ref?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          customer_id?: string | null;
          paid?: boolean;
          created_by?: string | null;
          shift_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          branch_id?: string;
          receipt_no?: string;
          date?: string;
          payment?: "cash" | "mpesa" | "credit" | "split";
          payments?: Json;
          subtotal?: number;
          cash_given?: number | null;
          change_amount?: number | null;
          mpesa_ref?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          customer_id?: string | null;
          paid?: boolean;
          created_by?: string | null;
          shift_id?: string | null;
          created_at?: string;
        };
      };
      customers: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          phone: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          phone?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          phone?: string | null;
          note?: string | null;
          created_at?: string;
        };
      };
      customer_payments: {
        Row: {
          id: string;
          org_id: string;
          branch_id: string | null;
          customer_id: string;
          amount: number;
          method: "cash" | "mpesa" | "other";
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id?: string | null;
          customer_id: string;
          amount: number;
          method?: "cash" | "mpesa" | "other";
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          branch_id?: string | null;
          customer_id?: string;
          amount?: number;
          method?: "cash" | "mpesa" | "other";
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
      };
      v_customer_balances: {
        Row: {
          customer_id: string;
          org_id: string;
          name: string;
          phone: string | null;
          owed: number;
          repaid: number;
          balance: number;
        };
        Insert: never;
        Update: never;
      };
      sale_items: {
        Row: {
          id: string;
          sale_id: string;
          product_id: string | null;
          quantity: number;
          unit_price: number;
          amount: number;
          serving_name: string | null;
          serving_ml: number | null;
        };
        Insert: {
          id?: string;
          sale_id: string;
          product_id?: string | null;
          quantity: number;
          unit_price: number;
          amount: number;
          serving_name?: string | null;
          serving_ml?: number | null;
        };
        Update: {
          id?: string;
          sale_id?: string;
          product_id?: string | null;
          quantity?: number;
          unit_price?: number;
          amount?: number;
          serving_name?: string | null;
          serving_ml?: number | null;
        };
      };
      receipt_counter: {
        Row: { org_id: string; counter: number };
        Insert: { org_id: string; counter?: number };
        Update: { org_id?: string; counter?: number };
      };
    };
    Functions: {
      next_receipt_no: { Args: { p_org_id: string }; Returns: string };
      verify_login: {
        Args: { p_email: string; p_password: string };
        Returns: {
          profile: Database["public"]["Tables"]["profiles"]["Row"];
          org: Database["public"]["Tables"]["organisations"]["Row"];
          branch: Database["public"]["Tables"]["branches"]["Row"] | null;
        } | null;
      };
      register_business: {
        Args: {
          p_actor_id: string;
          p_email: string;
          p_password: string;
          p_full_name: string;
          p_business_name: string;
          p_tagline?: string | null;
          p_phone?: string | null;
          p_address?: string | null;
          p_mpesa_paybill?: string | null;
          p_mpesa_till?: string | null;
          p_mpesa_paybill_account?: string | null;
        };
        Returns: {
          org: Database["public"]["Tables"]["organisations"]["Row"];
          admin: { id: string; email: string; full_name: string | null; role: UserRole };
        } | null;
      };
      set_business_active: {
        Args: { p_actor_id: string; p_org_id: string; p_active: boolean };
        Returns: null;
      };
      reset_staff_password: {
        Args: { p_actor_id: string; p_email: string; p_password: string };
        Returns: null;
      };
      request_cancel: {
        Args: { p_actor_id: string; p_sale_id: string; p_reason?: string | null };
        Returns: null;
      };
      approve_cancel: {
        Args: { p_actor_id: string; p_sale_id: string };
        Returns: null;
      };
      reject_cancel: {
        Args: { p_actor_id: string; p_sale_id: string };
        Returns: null;
      };
      finalize_stock_take: {
        Args: { p_stock_take_id: string };
        Returns: null;
      };
      open_shift: {
        Args: {
          p_org_id: string;
          p_branch_id: string;
          p_cashier_id: string;
          p_opening_float?: number;
        };
        Returns: Database["public"]["Tables"]["shifts"]["Row"];
      };
      close_shift: {
        Args: { p_shift_id: string; p_counted_cash?: number | null; p_note?: string | null };
        Returns: Database["public"]["Tables"]["shifts"]["Row"];
      };
      report_sales_by_category: {
        Args: {
          p_org_id: string;
          p_branch_id?: string | null;
          p_from?: string;
          p_to?: string;
          p_department?: string | null;
        };
        Returns: Array<{
          category: string;
          food_group: string;
          qty_sold: number;
          revenue: number;
          txn_count: number;
        }>;
      };
      report_top_food_groups: {
        Args: {
          p_org_id: string;
          p_branch_id?: string | null;
          p_from?: string;
          p_to?: string;
          p_department?: string | null;
        };
        Returns: Array<{
          food_group: string;
          revenue: number;
          txn_count: number;
          share_pct: number;
        }>;
      };
    };
  };
}
