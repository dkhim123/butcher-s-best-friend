import { forwardRef } from "react";
import { Sale, Product, PaymentMethod } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";

const payLabel: Record<PaymentMethod, string> = {
  cash: "CASH",
  mpesa: "M-PESA",
  credit: "CREDIT",
};

interface Props {
  sale: Sale;
  products: Product[];
  shopName?: string;
  logoUrl?: string | null;
}

export const Receipt = forwardRef<HTMLDivElement, Props>(
  ({ sale, products, shopName = "Spot Butchery", logoUrl }, ref) => {
    const productOf = (id: string) => products.find((p) => p.id === id);
    const dt = new Date(sale.timestamp);

    return (
      <div
        ref={ref}
        className="receipt-print bg-white text-black font-mono text-[12px] leading-tight w-[300px] p-4 mx-auto"
      >
        <div className="text-center mb-2">
          {logoUrl && (
            <img
              src={logoUrl}
              alt={shopName}
              className="h-14 w-14 object-contain mx-auto mb-1"
            />
          )}
          <p className="text-base font-bold uppercase tracking-wide">{shopName}</p>
          <p className="text-[10px]">Quality Meat &amp; Meals</p>
          <p className="text-[10px]">Tel: 0700 000 000</p>
        </div>
        <div className="border-t border-b border-dashed border-black py-1 mb-2 text-[11px]">
          <div className="flex justify-between">
            <span>Receipt:</span>
            <span className="font-bold">{sale.receiptNo}</span>
          </div>
          <div className="flex justify-between">
            <span>Date:</span>
            <span>{dt.toLocaleString("en-KE")}</span>
          </div>
          <div className="flex justify-between">
            <span>Pay:</span>
            <span className="font-bold">{payLabel[sale.payment]}</span>
          </div>
        </div>

        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-dashed border-black">
              <th className="text-left font-semibold pb-1">Item</th>
              <th className="text-right font-semibold pb-1">Qty</th>
              <th className="text-right font-semibold pb-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((it, i) => {
              const p = productOf(it.productId);
              return (
                <tr key={i} className="align-top">
                  <td className="pt-1">
                    <div className="font-semibold">{p?.name ?? "—"}</div>
                    <div className="text-[10px]">
                      @ {ksh(it.unitPrice)}/{p?.unit ?? "u"}
                    </div>
                  </td>
                  <td className="text-right pt-1">
                    {qty(it.quantity, p?.unit ?? "")}
                  </td>
                  <td className="text-right pt-1 font-semibold">
                    {ksh(it.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="border-t border-dashed border-black mt-2 pt-2 text-[12px]">
          <div className="flex justify-between font-bold text-[14px]">
            <span>TOTAL</span>
            <span>{ksh(sale.subtotal)}</span>
          </div>
          {sale.payment === "cash" && sale.cashGiven != null && (
            <>
              <div className="flex justify-between">
                <span>Cash given</span>
                <span>{ksh(sale.cashGiven)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Change</span>
                <span>{ksh(sale.change ?? 0)}</span>
              </div>
            </>
          )}
          {sale.payment === "mpesa" && sale.mpesaRef && (
            <div className="flex justify-between">
              <span>M-Pesa ref</span>
              <span className="font-bold">{sale.mpesaRef}</span>
            </div>
          )}
          {sale.payment === "credit" && (
            <>
              <div className="flex justify-between">
                <span>Customer</span>
                <span className="font-bold">{sale.customerName}</span>
              </div>
              {sale.customerPhone && (
                <div className="flex justify-between">
                  <span>Phone</span>
                  <span>{sale.customerPhone}</span>
                </div>
              )}
              <p className="text-center mt-1 font-bold">** UNPAID — CREDIT **</p>
            </>
          )}
        </div>

        <div className="text-center mt-3 text-[10px] border-t border-dashed border-black pt-2">
          <p>Thank you — Karibu tena!</p>
        </div>
      </div>
    );
  },
);
Receipt.displayName = "Receipt";
