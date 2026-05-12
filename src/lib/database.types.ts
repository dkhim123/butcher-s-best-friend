export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type UserRole = "admin" | "manager" | "cashier" | "pending";

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
}

export interface Database {
  public: {
    Tables: {
      organisations: {
        Row: {
          id: string;
          name: string;
          logo_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          logo_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          logo_url?: string | null;
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
          track_stock: boolean;
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
          track_stock?: boolean;
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
          track_stock?: boolean;
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
          reason: "purchase" | "sale" | "waste" | "adjustment" | "opening";
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
          reason: "purchase" | "sale" | "waste" | "adjustment" | "opening";
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
          product_id: string | null;
          supplier: string;
          quantity: number;
          cost_per_unit: number;
          total_cost: number;
          notes: string | null;
          received: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id: string;
          date: string;
          product_id?: string | null;
          supplier: string;
          quantity: number;
          cost_per_unit: number;
          total_cost: number;
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
          product_id?: string | null;
          supplier?: string;
          quantity?: number;
          cost_per_unit?: number;
          total_cost?: number;
          notes?: string | null;
          received?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
      };
      sales: {
        Row: {
          id: string;
          org_id: string;
          branch_id: string;
          receipt_no: string;
          date: string;
          payment: "cash" | "mpesa" | "credit";
          subtotal: number;
          cash_given: number | null;
          change_amount: number | null;
          mpesa_ref: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          paid: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          branch_id: string;
          receipt_no: string;
          date: string;
          payment: "cash" | "mpesa" | "credit";
          subtotal: number;
          cash_given?: number | null;
          change_amount?: number | null;
          mpesa_ref?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          paid?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          branch_id?: string;
          receipt_no?: string;
          date?: string;
          payment?: "cash" | "mpesa" | "credit";
          subtotal?: number;
          cash_given?: number | null;
          change_amount?: number | null;
          mpesa_ref?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          paid?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
      };
      sale_items: {
        Row: {
          id: string;
          sale_id: string;
          product_id: string | null;
          quantity: number;
          unit_price: number;
          amount: number;
        };
        Insert: {
          id?: string;
          sale_id: string;
          product_id?: string | null;
          quantity: number;
          unit_price: number;
          amount: number;
        };
        Update: {
          id?: string;
          sale_id?: string;
          product_id?: string | null;
          quantity?: number;
          unit_price?: number;
          amount?: number;
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
      register_first_admin: {
        Args: {
          p_email: string;
          p_password: string;
          p_full_name: string;
          p_business_name: string;
        };
        Returns: {
          profile: Database["public"]["Tables"]["profiles"]["Row"];
          org: Database["public"]["Tables"]["organisations"]["Row"];
          branch: Database["public"]["Tables"]["branches"]["Row"] | null;
        } | null;
      };
      report_sales_by_category: {
        Args: {
          p_org_id: string;
          p_branch_id?: string | null;
          p_from?: string;
          p_to?: string;
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
