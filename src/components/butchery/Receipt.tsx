import { forwardRef } from "react";
import { Sale, Product } from "@/lib/butchery-types";
import { useOrgUsers } from "@/lib/butchery-store";
import { ksh, qty } from "@/lib/format";
import { RECEIPT_CSS } from "./receipt-styles";

const payLabel: Record<string, string> = {
  cash: "CASH",
  mpesa: "M-PESA",
  card: "CARD",
  credit: "CREDIT",
  split: "SPLIT",
};

// Plain number for line amounts (currency shown once, on the TOTAL row) —
// this is the standard supermarket look: columns of numbers, not "Ksh 250"
// repeated on every line.
const num = (n: number) => Math.round(n).toLocaleString("en-KE");

interface Props {
  sale: Sale;
  products: Product[];
  shopName?: string;
  logoUrl?: string | null;
  tagline?: string | null;
  phone?: string | null;
  mpesaPaybill?: string | null;
  mpesaPaybillAccount?: string | null;
  mpesaTill?: string | null;
}

export const Receipt = forwardRef<HTMLDivElement, Props>(
  ({ sale, products, shopName = "Your Business", logoUrl, tagline, phone, mpesaPaybill, mpesaPaybillAccount, mpesaTill }, ref) => {
    const productOf = (id: string) => products.find((p) => p.id === id);
    const dt = new Date(sale.timestamp);
    // Who rang up this sale (the cashier), for accountability on the printout.
    const { nameById } = useOrgUsers();
    const cashierName = nameById(sale.createdBy);

    return (
      <>
        {/* Sibling <style>, NOT inside the ref'd node — so it isn't duplicated
            when doPrint() copies the receipt's outerHTML into the iframe. The
            print iframe injects the same RECEIPT_CSS into its <head>. */}
        <style dangerouslySetInnerHTML={{ __html: RECEIPT_CSS }} />

        <div ref={ref} className="rcpt">
          {/* Header */}
          {logoUrl && <img src={logoUrl} alt={shopName} className="rcpt-logo" />}
          <p className="rcpt-name">{shopName}</p>
          {tagline && <p className="rcpt-sub">{tagline}</p>}
          {phone && <p className="rcpt-sub">Tel: {phone}</p>}

          <hr className="rcpt-hr" />

          {/* Meta */}
          <div className="rcpt-row">
            <span>Receipt</span>
            <span>{sale.receiptNo}</span>
          </div>
          <div className="rcpt-row">
            <span>Date</span>
            <span>{dt.toLocaleString("en-KE")}</span>
          </div>
          <div className="rcpt-row">
            <span>Pay</span>
            <span>{payLabel[sale.payment]}</span>
          </div>
          {cashierName && (
            <div className="rcpt-row">
              <span>Served by</span>
              <span>{cashierName}</span>
            </div>
          )}

          <hr className="rcpt-hr" />

          {/* Items */}
          <div className="rcpt-cols">
            <span>ITEM</span>
            <span>AMOUNT</span>
          </div>
          {sale.items.map((it, i) => {
            const p = productOf(it.productId);
            // A product line shows the product name (+ pour); a product-less line
            // (e.g. a room stay) shows its description instead.
            const name = p?.name ?? it.description ?? "Item";
            const unitLabel = it.servingName ?? p?.unit ?? "";
            return (
              <div key={i} className="rcpt-line">
                <div className="rcpt-line-main">
                  <span className="rcpt-line-name">
                    {name}
                    {p && it.servingName ? ` (${it.servingName})` : ""}
                  </span>
                  <span className="rcpt-line-amt">{num(it.amount)}</span>
                </div>
                <div className="rcpt-line-sub">
                  {qty(it.quantity, unitLabel)} × {num(it.unitPrice)}
                  {unitLabel ? ` / ${unitLabel}` : ""}
                </div>
              </div>
            );
          })}

          <hr className="rcpt-hr" />

          {/* Totals */}
          <div className="rcpt-total">
            <span>TOTAL</span>
            <span>{ksh(sale.subtotal)}</span>
          </div>

          {sale.payment === "cash" && sale.cashGiven != null && (
            <>
              <div className="rcpt-row">
                <span>Cash</span>
                <span>{ksh(sale.cashGiven)}</span>
              </div>
              <div className="rcpt-row strong">
                <span>Change</span>
                <span>{ksh(sale.change ?? 0)}</span>
              </div>
            </>
          )}
          {sale.payment === "mpesa" && sale.mpesaRef && (
            <div className="rcpt-row">
              <span>M-Pesa Ref</span>
              <span>{sale.mpesaRef}</span>
            </div>
          )}
          {sale.payment === "split" &&
            (sale.payments ?? []).map((p, i) => (
              <div key={i} className="rcpt-row">
                <span>
                  {p.method === "cash" ? "Cash" : "M-Pesa"}
                  {p.ref ? ` (${p.ref})` : ""}
                </span>
                <span>{ksh(p.amount)}</span>
              </div>
            ))}
          {sale.payment === "credit" && (
            <>
              <div className="rcpt-row">
                <span>Customer</span>
                <span>{sale.customerName}</span>
              </div>
              {sale.customerPhone && (
                <div className="rcpt-row">
                  <span>Phone</span>
                  <span>{sale.customerPhone}</span>
                </div>
              )}
              <p className="rcpt-note">** UNPAID — CREDIT **</p>
            </>
          )}

          {(mpesaPaybill || mpesaTill) && (
            <>
              <hr className="rcpt-hr" />
              <p className="rcpt-note">PAY VIA M-PESA</p>
              {mpesaPaybill && (
                <>
                  <div className="rcpt-row">
                    <span>Paybill</span>
                    <span>{mpesaPaybill}</span>
                  </div>
                  {mpesaPaybillAccount && (
                    <div className="rcpt-row">
                      <span>Account</span>
                      <span>{mpesaPaybillAccount}</span>
                    </div>
                  )}
                </>
              )}
              {mpesaTill && (
                <div className="rcpt-row">
                  <span>Buy Goods (Till)</span>
                  <span>{mpesaTill}</span>
                </div>
              )}
            </>
          )}

          <hr className="rcpt-hr" />
          <p className="rcpt-foot">Thank you — Karibu tena!</p>
        </div>
      </>
    );
  },
);
Receipt.displayName = "Receipt";
