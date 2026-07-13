import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock, LogIn, LogOut } from "lucide-react";
import type { Shift } from "@/lib/butchery-store";
import { ksh } from "@/lib/format";
import { toast } from "sonner";

/**
 * ShiftBar — open a till session (with a cash float), see cash-so-far, and close
 * with a cash-up (expected vs counted). One open shift per cashier at a time.
 */
export function ShiftBar({
  shift,
  cashSoFar,
  onOpen,
  onClose,
}: {
  shift: Shift | null;
  cashSoFar: number;
  onOpen: (openingFloat: number) => Promise<void>;
  onClose: (countedCash: number) => Promise<void>;
}) {
  const [floatDraft, setFloatDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [closeOpen, setCloseOpen] = useState(false);

  const openShift = async () => {
    const f = Number(floatDraft || "0");
    if (!Number.isFinite(f) || f < 0) return toast.error("Enter a valid opening cash amount");
    setBusy(true);
    try {
      await onOpen(f);
      toast.success("Shift opened");
      setFloatDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open shift");
    } finally {
      setBusy(false);
    }
  };

  const expected = (shift?.openingFloat ?? 0) + cashSoFar;

  const closeShift = async () => {
    setBusy(true);
    try {
      // No manual cash count — record the expected amount so the shift closes
      // balanced. (The owner opted out of the count/reconcile step.)
      await onClose(expected);
      toast.success("Shift closed");
      setCloseOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to close shift");
    } finally {
      setBusy(false);
    }
  };

  if (!shift) {
    return (
      <Card className="p-3 shadow-soft border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20">
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Open your shift to start selling
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="Opening cash float (e.g. 1000)"
              value={floatDraft}
              onChange={(e) => setFloatDraft(e.target.value)}
              className="no-spinner"
            />
          </div>
          <Button onClick={openShift} disabled={busy} className="bg-gradient-primary gap-1.5">
            <LogIn className="h-4 w-4" /> Open shift
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-3 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-success/15 grid place-items-center shrink-0">
            <Clock className="h-4 w-4 text-success" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Shift open</p>
            <p className="text-[11px] text-muted-foreground">
              Since{" "}
              {new Date(shift.openedAt).toLocaleTimeString("en-KE", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · float {ksh(shift.openingFloat)}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] uppercase text-muted-foreground">Cash so far</p>
            <p className="font-bold text-primary tabular-nums leading-tight">{ksh(cashSoFar)}</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setCloseOpen(true)}>
            <LogOut className="h-4 w-4" /> Close
          </Button>
        </div>
      </Card>

      <Dialog open={closeOpen} onOpenChange={(o) => !o && setCloseOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Close shift</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
              <Row label="Opening float" value={ksh(shift.openingFloat)} />
              <Row label="Cash sales" value={ksh(cashSoFar)} />
              <div className="border-t pt-1">
                <Row label="Cash in drawer" value={ksh(expected)} bold />
              </div>
            </div>
            <Button onClick={closeShift} disabled={busy} className="w-full bg-gradient-primary">
              {busy ? "Closing…" : "Close shift"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}
