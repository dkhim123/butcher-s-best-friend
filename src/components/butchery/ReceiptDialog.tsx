import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { Receipt } from "./Receipt";
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
  mpesaTill?: string | null;
}

export const ReceiptDialog = ({ sale, products, open, onClose, autoPrint, shopName, logoUrl, tagline, phone, mpesaPaybill, mpesaTill }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [printedFor, setPrintedFor] = useState<string | null>(null);

  const doPrint = () => {
    const node = ref.current;
    if (!node) return;
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return;
    w.document.write(`
      <html>
        <head>
          <title>Receipt ${sale?.receiptNo ?? ""}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: ui-monospace, Menlo, monospace; margin: 0; color: #000; background: #fff; }
            .receipt { width: 72mm; padding: 4mm 2mm; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 2px 0; vertical-align: top; }
            .b { border-top: 1px dashed #000; border-bottom: 1px dashed #000; }
            .bt { border-top: 1px dashed #000; }
            .center { text-align: center; }
            .right { text-align: right; }
            .bold { font-weight: 700; }
            .lg { font-size: 14px; }
            .sm { font-size: 10px; }
          </style>
        </head>
        <body>${node.outerHTML}</body>
      </html>
    `);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
      w.close();
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
          {sale && <Receipt ref={ref} sale={sale} products={products} shopName={shopName} logoUrl={logoUrl} tagline={tagline} phone={phone} mpesaPaybill={mpesaPaybill} mpesaTill={mpesaTill} />}
        </div>
      </DialogContent>
    </Dialog>
  );
};
