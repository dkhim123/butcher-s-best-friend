import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertCircle,
  Sparkles,
  Truck,
  ShoppingBag,
  History as HistoryIcon,
} from "lucide-react";
import { useStockMovements, StockMovementRow } from "@/lib/butchery-store";
import { qty } from "@/lib/format";

/**
 * StockMovementsLog — the inventory audit trail.
 *
 * Reads every row from `stock_movements` (newest first) so the user
 * can answer questions like:
 *   "Where did those 20 kg of beef come from?"
 *   "When did we last add Coca-Cola stock?"
 *   "Why is my pork count so low?"
 *
 * Each row is colour-coded by reason and shows a +/- delta so it's
 * unambiguous whether stock went up or down at that moment.
 */

const REASON_META: Record<
  StockMovementRow["reason"],
  {
    label: string;
    Icon: typeof Truck;
    tone: "in" | "out" | "neutral";
  }
> = {
  opening: { label: "Opening", Icon: Sparkles, tone: "in" },
  purchase: { label: "Purchase", Icon: Truck, tone: "in" },
  sale: { label: "Sale", Icon: ShoppingBag, tone: "out" },
  waste: { label: "Waste", Icon: AlertCircle, tone: "out" },
  adjustment: { label: "Adjustment", Icon: HistoryIcon, tone: "neutral" },
};

export const StockMovementsLog = () => {
  const { rows, isLoading } = useStockMovements(300);

  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<"all" | StockMovementRow["reason"]>("all");

  // In-memory filter. We don't filter in the DB because the result set
  // is small (capped at 300 rows) and client-side filtering is instant.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (reasonFilter !== "all" && r.reason !== reasonFilter) return false;
      if (term && !r.productName.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, reasonFilter, search]);

  // Roll-up at the top: total in, total out, net for the visible rows.
  // This is a quick "where is my stock going?" sanity check.
  const summary = useMemo(() => {
    let inQty = 0;
    let outQty = 0;
    for (const r of filtered) {
      if (r.deltaQty >= 0) inQty += r.deltaQty;
      else outQty += Math.abs(r.deltaQty);
    }
    return { inQty, outQty, net: inQty - outQty };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <Card className="p-5 shadow-soft">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h3 className="font-semibold flex items-center gap-2">
              <HistoryIcon className="h-4 w-4 text-primary" />
              Stock movements
            </h3>
            <p className="text-xs text-muted-foreground">
              Every change to inventory — purchases, sales, corrections.
              Newest first.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Search product
              </label>
              <Input
                placeholder="e.g. Beef"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full sm:w-44"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Reason
              </label>
              <Select
                value={reasonFilter}
                onValueChange={(v) =>
                  setReasonFilter(v as typeof reasonFilter)
                }
              >
                <SelectTrigger className="h-9 w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  <SelectItem value="opening">Opening</SelectItem>
                  <SelectItem value="purchase">Purchase</SelectItem>
                  <SelectItem value="sale">Sale</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                  <SelectItem value="waste">Waste</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Summary chips — quick sanity check across the visible window */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="rounded-md border bg-success/10 border-success/30 px-3 py-2.5">
            <p className="text-[10px] uppercase text-muted-foreground">
              Stock in
            </p>
            <p className="font-bold text-success flex items-center gap-1">
              <ArrowDownToLine className="h-3.5 w-3.5" />
              +{summary.inQty.toFixed(2)}
            </p>
          </div>
          <div className="rounded-md border bg-destructive/10 border-destructive/30 px-3 py-2.5">
            <p className="text-[10px] uppercase text-muted-foreground">
              Stock out
            </p>
            <p className="font-bold text-destructive flex items-center gap-1">
              <ArrowUpFromLine className="h-3.5 w-3.5" />
              −{summary.outQty.toFixed(2)}
            </p>
          </div>
          <div className="rounded-md border bg-muted px-3 py-2.5">
            <p className="text-[10px] uppercase text-muted-foreground">
              Net change
            </p>
            <p
              className={`font-bold ${
                summary.net >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {summary.net >= 0 ? "+" : ""}
              {summary.net.toFixed(2)}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-0 shadow-soft overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-sm text-muted-foreground text-center">
            Loading movements…
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-sm text-muted-foreground text-center">
            No stock movements match your filters.
            {rows.length === 0 && (
              <>
                <br />
                <span className="text-xs">
                  Record a purchase or set opening stock on a product to see
                  movements here.
                </span>
              </>
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground text-xs uppercase">
                <tr>
                  <th className="text-left p-3 font-semibold">When</th>
                  <th className="text-left p-3 font-semibold">Product</th>
                  <th className="text-left p-3 font-semibold">Reason</th>
                  <th className="text-right p-3 font-semibold">Change</th>
                  <th className="text-left p-3 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const meta = REASON_META[m.reason];
                  const Icon = meta.Icon;
                  const positive = m.deltaQty >= 0;
                  return (
                    <tr key={m.id} className="border-t hover:bg-muted/40">
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(m.occurredAt).toLocaleString("en-KE", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-3 font-medium">{m.productName}</td>
                      <td className="p-3">
                        <Badge
                          variant="secondary"
                          className="text-[10px] inline-flex items-center gap-1"
                        >
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </td>
                      <td
                        className={`p-3 text-right font-bold tabular-nums ${
                          positive ? "text-success" : "text-destructive"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {qty(m.deltaQty, m.unit)}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[280px] truncate">
                        {m.note ?? (m.refTable ? `from ${m.refTable}` : "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
