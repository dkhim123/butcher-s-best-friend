import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { Receipt } from "./Receipt";
import { RECEIPT_CSS } from "./receipt-styles";
import { Sale, Product } from "@/lib/butchery-types";

interface Props {
  sale: Sale | null;
  products: Product[];
  open: boolean;
  onClose: () => void;
  autoPrint?: boolean;
  shopName?: string;
  logoUrl?: string | null;
  tagline?: string | null;
  phone?: string | null;
  mpesaPaybill?: string | null;
  mpesaPaybillAccount?: string | null;
  mpesaTill?: string | null;
}

export const ReceiptDialog = ({ sale, products, open, onClose, autoPrint, shopName, logoUrl, tagline, phone, mpesaPaybill, mpesaPaybillAccount, mpesaTill }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [printedFor, setPrintedFor] = useState<string | null>(null);

  const doPrint = () => {
    const node = ref.current;
    if (!node) return;

    // Print through a hidden IFRAME rather than a popup window.
    //
    // Why not window.open()? A popup's print() runs on the opener's main
    // thread and BLOCKS it synchronously until the print dialog is dismissed —
    // but the popup's dialog often opens unfocused/behind the main window, so
    // the cashier never sees it and the whole app appears frozen. Popup
    // blockers made it worse (null window = nothing prints). An in-page iframe
    // anchors the print dialog to the current tab: visible, focused, and it
    // unblocks the app the moment it's confirmed or cancelled.
    // Inject the SAME stylesheet the on-screen receipt uses, so the printout
    // matches the preview exactly (no dead Tailwind classes, capped logo,
    // single 80mm receipt instead of a sprawling A4 page).
    const html = `
      <html>
        <head>
          <title>Receipt ${sale?.receiptNo ?? ""}</title>
          <style>
            @page { size: 80mm auto; margin: 3mm; }
            html, body { margin: 0; padding: 0; background: #fff; }
            ${RECEIPT_CSS}
          </style>
        </head>
        <body>${node.outerHTML}</body>
      </html>
    `;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const cw = iframe.contentWindow;
    const doc = cw?.document;
    if (!cw || !doc) {
      iframe.remove();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Remove the iframe ONLY after the print dialog closes (afterprint). Yanking
    // it right after calling print() destroyed the print source while the
    // preview was still rendering ("Print preview failed" on slow thermal
    // drivers). A long fallback prevents a leak if afterprint never fires.
    let removed = false;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      iframe.remove();
    };
    cw.addEventListener("afterprint", cleanup);
    const fallback = window.setTimeout(cleanup, 120000);

    // Give the logo image a moment to load before printing.
    setTimeout(() => {
      try {
        cw.focus();
        cw.print();
      } catch {
        window.clearTimeout(fallback);
        cleanup();
      }
    }, 250);
  };

  useEffect(() => {
    if (open && autoPrint && sale && printedFor !== sale.id) {
      setPrintedFor(sale.id);
      setTimeout(doPrint, 200);
    }
    if (!open) setPrintedFor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoPrint, sale]);

  // Safety net: when the receipt closes, make sure the page is clickable again.
  // Printing steals focus, and in that scenario Radix's dialog can occasionally
  // fail to restore `pointer-events` on <body>, leaving the whole app "frozen".
  // Clearing it after close guarantees the cashier can keep ringing up sales.
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        if (document.body.style.pointerEvents === "none") {
          document.body.style.pointerEvents = "";
        }
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* <DialogContent> already renders a built-in X close button in
          the top-right corner via shadcn. So we DON'T add another one
          in the header — only the title + Print button live there.
          The pr-14 reserves room for that built-in X so it doesn't
          visually overlap the Print button. */}
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 p-3 pr-14 border-b bg-gradient-surface">
          <p className="font-semibold text-sm truncate">Receipt {sale?.receiptNo}</p>
          <Button size="sm" variant="outline" onClick={doPrint}>
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </div>
        <div className="bg-muted/40 py-4 max-h-[70vh] overflow-auto">
          {sale && <Receipt ref={ref} sale={sale} products={products} shopName={shopName} logoUrl={logoUrl} tagline={tagline} phone={phone} mpesaPaybill={mpesaPaybill} mpesaPaybillAccount={mpesaPaybillAccount} mpesaTill={mpesaTill} />}
        </div>
      </DialogContent>
    </Dialog>
  );
};
