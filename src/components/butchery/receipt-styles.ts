/**
 * RECEIPT_CSS — the single source of truth for how a receipt looks, both
 * in the on-screen preview dialog AND in the printed output.
 *
 * Why a plain-CSS string instead of Tailwind?
 *   The receipt is printed by copying its DOM into a bare iframe that has NO
 *   Tailwind. Utility classes (flex, text-[11px], h-14…) are dead there, which
 *   is why the printout used to come out unstyled — giant logo, no alignment,
 *   spilling onto a 2nd A4 sheet. By styling the receipt with real class names
 *   defined here and injecting this exact CSS into both the preview and the
 *   print iframe, "what you see is what prints" — no drift, no surprises.
 *
 * Target: an 80mm thermal roll (the supermarket standard). Everything is sized
 * in mm/px that map cleanly to that width, and the whole thing is capped so it
 * always lands on a single continuous receipt.
 */
export const RECEIPT_CSS = `
.rcpt {
  --ink: #000;
  font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
  color: var(--ink);
  background: #fff;
  width: 72mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 3mm 2mm;
  font-size: 12px;
  line-height: 1.35;
  box-sizing: border-box;
}
.rcpt * { box-sizing: border-box; }

/* Header ---------------------------------------------------------------- */
.rcpt-logo {
  display: block;
  max-height: 46px;          /* the fix: cap the logo so it can't blow up */
  max-width: 55%;
  margin: 0 auto 4px;
  object-fit: contain;
}
.rcpt-name {
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .5px;
  margin: 0;
}
.rcpt-sub { text-align: center; font-size: 11px; margin: 0; }

/* Rules & meta ---------------------------------------------------------- */
.rcpt-hr { border: 0; border-top: 1px dashed var(--ink); margin: 6px 0; }
.rcpt-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}
.rcpt-row > span:last-child { text-align: right; white-space: nowrap; }
.rcpt-row.strong { font-weight: 700; }

/* Items ----------------------------------------------------------------- */
.rcpt-cols {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  padding-bottom: 3px;
  border-bottom: 1px dashed var(--ink);
}
.rcpt-line { margin-top: 4px; }
.rcpt-line-main {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-weight: 700;
}
.rcpt-line-name { overflow-wrap: anywhere; }
.rcpt-line-amt { text-align: right; white-space: nowrap; }
.rcpt-line-sub { font-size: 10px; padding-left: 2mm; }

/* Totals ---------------------------------------------------------------- */
.rcpt-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 15px;
  font-weight: 700;
  margin-top: 2px;
}
.rcpt-note { text-align: center; font-weight: 700; margin: 4px 0 0; }
.rcpt-foot { text-align: center; font-size: 10px; margin: 0; }

/* Print: keep it on one continuous receipt, edge to edge --------------- */
@media print {
  html, body { margin: 0; padding: 0; background: #fff; }
  .rcpt { width: 72mm; padding: 2mm; }
  .rcpt-line, .rcpt-total { break-inside: avoid; }
}
`;
