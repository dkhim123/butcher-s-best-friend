/**
 * report-export — download a report as CSV, or print it.
 *
 * Both are pure browser-side: no data leaves the device except to the printer.
 */

/** RFC-4180-ish CSV escaping: quote a cell if it holds a comma, quote or newline. */
const escapeCell = (v: string | number | null | undefined): string => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Turn a 2-D array into a CSV string and trigger a download. The ﻿ BOM
 *  makes Excel open UTF-8 (and "Ksh") correctly. */
export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Print an HTML document via a hidden iframe. Same technique as the receipt:
 * the print dialog anchors to the current tab (visible + focused) and the app
 * never freezes, unlike a popup window.
 */
export function printHtml(title: string, bodyHtml: string, css = "") {
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
  doc.write(
    `<html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`,
  );
  doc.close();

  // Remove the iframe ONLY after the print dialog is dismissed (afterprint).
  // Removing it right after calling print() — as we used to — yanked the print
  // source while Chrome's preview was still rendering (slow thermal drivers +
  // bigger reports), causing "Print preview failed". A long fallback prevents a
  // leak if afterprint never fires.
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    iframe.remove();
  };
  cw.addEventListener("afterprint", cleanup);
  const fallback = window.setTimeout(cleanup, 120000);

  // Give the layout (and any images) a moment, then open the print dialog.
  window.setTimeout(() => {
    try {
      cw.focus();
      cw.print();
    } catch {
      window.clearTimeout(fallback);
      cleanup();
    }
  }, 300);
}

/**
 * Report print stylesheet for an 80mm THERMAL roll (the printer our users
 * actually have) — the report prints like a long receipt, not an A4 page.
 * Same @page trick as the receipt, so it also works if someone picks
 * "Save as PDF" (they get an 80mm-wide PDF). Bold + true-black for clear
 * thermal output. Uses the SAME class names the report body already emits.
 */
export const REPORT_PRINT_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
    color: #000;
    width: 72mm;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.4;
    -webkit-font-smoothing: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 19px; font-weight: 800; text-align: center; text-transform: uppercase; margin: 0; }
  h2 { font-size: 15px; font-weight: 800; margin: 10px 0 4px; border-bottom: 2px dashed #000; padding-bottom: 2px; }
  .sub { font-size: 12.5px; font-weight: 700; text-align: center; margin: 2px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .kv td { padding: 2px 0; }
  .kv td:last-child { text-align: right; font-weight: 800; white-space: nowrap; }
  .grid th, .grid td { padding: 3px 0; text-align: right; vertical-align: top; font-weight: 700; }
  .grid th:first-child, .grid td:first-child { text-align: left; overflow-wrap: anywhere; padding-right: 4px; }
  .grid thead th { border-bottom: 2px dashed #000; font-weight: 800; font-size: 12.5px; }
  .grid tfoot td { border-top: 2px dashed #000; font-weight: 800; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .empty { font-size: 12.5px; margin: 2px 0 6px; }
  .grand { width: 100%; margin-top: 10px; border-collapse: collapse; }
  .grand td { border-top: 3px solid #000; padding: 6px 0; font-size: 17px; font-weight: 800; }
  .grand td:last-child { text-align: right; }
  .foot { margin-top: 12px; font-size: 12px; font-weight: 700; text-align: center; }
`;
