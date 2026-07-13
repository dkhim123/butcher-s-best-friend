/**
 * RECEIPT_CSS — the single source of truth for how a receipt looks, both
 * in the on-screen preview dialog AND in the printed output.
 *
 * Why a plain-CSS string instead of Tailwind?
 *   The receipt is printed by copying its DOM into a bare iframe that has NO
 *   Tailwind. Utility classes (flex, text-[11px], h-14…) are dead there, which
 *   is why the printout used to come out unstyled. Defining real class names
 *   here and injecting this exact CSS into both preview and print iframe means
 *   "what you see is what prints" — no drift.
 *
 * Legibility: everything is BOLD and pure black. Thin, light-grey text prints
 * faint on thermal rolls and photocopies, so the body weight is 700, headings
 * 800, sizes bumped, and print-color-adjust forces true black (browsers/printers
 * can't lighten it to grey).
 *
 * Target: an 80mm thermal roll (the supermarket standard).
 */
export const RECEIPT_CSS = `
.rcpt {
  font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
  color: #000;
  background: #fff;
  width: 72mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 3mm 2mm;
  font-size: 13px;
  font-weight: 700;               /* bold body so print is dark & clear */
  line-height: 1.4;
  box-sizing: border-box;
  -webkit-font-smoothing: none;   /* crisper glyphs, no grey anti-alias */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;      /* render TRUE black, never a light grey */
}
.rcpt * { box-sizing: border-box; color: #000; }

/* Header ---------------------------------------------------------------- */
.rcpt-logo {
  display: block;
  max-height: 46px;
  max-width: 55%;
  margin: 0 auto 4px;
  object-fit: contain;
}
.rcpt-name {
  text-align: center;
  font-size: 18px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .5px;
  margin: 0;
}
.rcpt-sub { text-align: center; font-size: 12px; font-weight: 700; margin: 0; }

/* Rules & meta ---------------------------------------------------------- */
.rcpt-hr { border: 0; border-top: 2px dashed #000; margin: 6px 0; }
.rcpt-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 700;
}
.rcpt-row > span:last-child { text-align: right; white-space: nowrap; }
.rcpt-row.strong { font-weight: 800; }

/* Items ----------------------------------------------------------------- */
.rcpt-cols {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 800;
  padding-bottom: 3px;
  border-bottom: 2px dashed #000;
}
.rcpt-line { margin-top: 5px; }
.rcpt-line-main {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-weight: 800;
}
.rcpt-line-name { overflow-wrap: anywhere; }
.rcpt-line-amt { text-align: right; white-space: nowrap; }
.rcpt-line-sub { font-size: 11.5px; font-weight: 700; padding-left: 2mm; }

/* Totals ---------------------------------------------------------------- */
.rcpt-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 18px;
  font-weight: 800;
  margin-top: 2px;
}
.rcpt-note { text-align: center; font-weight: 800; margin: 4px 0 0; }
.rcpt-foot { text-align: center; font-size: 11.5px; font-weight: 700; margin: 0; }

/* Print: keep it on one continuous receipt, edge to edge --------------- */
@media print {
  html, body { margin: 0; padding: 0; background: #fff; }
  .rcpt {
    width: 72mm;
    padding: 2mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .rcpt-line, .rcpt-total { break-inside: avoid; }
}
`;
