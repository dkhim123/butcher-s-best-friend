import { forwardRef } from "react";
import { Sale, Product } from "@/lib/butchery-types";
import { ksh, qty } from "@/lib/format";

const payLabel: Record<string, string> = {
  cash: "CASH",
  mpesa: "M-PESA",
  credit: "CREDIT",
  split: "SPLIT",
};

interface Props {
  sale: Sale;
  products: Product[];
  shopName?: string;
  logoUrl?: string | null;
  tagline?: string | null;
  phone?: string | null;
  mpesaPaybill?: string | null;
  mpesaTill?: string | null;
}

export const Receipt = forwardRef<HTMLDivElement, Props>(
  ({ sale, products, shopName = "Your Business", logoUrl, tagline, phone, mpesaPaybill, mpesaTill }, ref) => {
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
          {tagline && <p className="text-[10px]">{tagline}</p>}
          {phone && <p className="text-[10px]">Tel: {phone}</p>}
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
              // For bar pours the "unit" is the serving name (Tot / Glass).
              const unitLabel = it.servingName ?? p?.unit ?? "u";
              return (
                <tr key={i} className="align-top">
                  <td className="pt-1">
                    <div className="font-semibold">
                      {p?.name ?? "—"}
                      {it.servingName ? ` (${it.servingName})` : ""}
                    </div>
                    <div className="text-[10px]">
                      @ {ksh(it.unitPrice)}/{unitLabel}
                    </div>
                  </td>
                  <td className="text-right pt-1">
                    {qty(it.quantity, it.servingName ?? p?.unit ?? "")}
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
          {sale.payment === "split" &&
            (sale.payments ?? []).map((p, i) => (
              <div key={i} className="flex justify-between">
                <span>{p.method === "cash" ? "Cash" : "M-Pesa"}{p.ref ? ` (${p.ref})` : ""}</span>
                <span className="font-bold">{ksh(p.amount)}</span>
              </div>
            ))}
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

        {(mpesaPaybill || mpesaTill) && (
          <div className="mt-2 pt-2 border-t border-dashed border-black text-[10px]">
            <p className="text-center font-bold">PAY VIA M-PESA</p>
            {mpesaPaybill && (
              <div className="flex justify-between">
                <span>Paybill</span>
                <span className="font-bold">{mpesaPaybill}</span>
              </div>
            )}
            {mpesaTill && (
              <div className="flex justify-between">
                <span>Buy Goods (Till)</span>
                <span className="font-bold">{mpesaTill}</span>
              </div>
            )}
          </div>
        )}

        <div className="text-center mt-3 text-[10px] border-t border-dashed border-black pt-2">
          <p>Thank you — Karibu tena!</p>
        </div>
      </div>
    );
  },
);
Receipt.displayName = "Receipt";
