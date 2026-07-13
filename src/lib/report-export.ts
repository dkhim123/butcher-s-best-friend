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

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    setTimeout(() => iframe.remove(), 300);
  };
  cw.addEventListener("afterprint", cleanup);
  setTimeout(() => {
    try {
      cw.focus();
      cw.print();
    } finally {
      cleanup();
    }
  }, 250);
}

/** Shared print stylesheet for tabular reports (A4, readable, dashed rules). */
export const REPORT_PRINT_CSS = `
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; color: #000; margin: 0; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 1px solid #000; padding-bottom: 2px; }
  .sub { font-size: 11px; color: #333; margin: 2px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .kv td { padding: 2px 0; }
  .kv td:last-child { text-align: right; font-weight: 700; white-space: nowrap; }
  .grid th, .grid td { border: 1px solid #999; padding: 4px 6px; text-align: right; }
  .grid th:first-child, .grid td:first-child { text-align: left; }
  .grid th { background: #eee; }
  .grid tfoot td { font-weight: 700; background: #f4f4f4; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .empty { font-size: 11px; color: #666; margin: 2px 0 8px; }
  .grand { width: 100%; margin-top: 14px; border-collapse: collapse; }
  .grand td { border-top: 3px double #000; padding: 8px 6px; font-size: 15px; font-weight: 700; }
  .grand td:last-child { text-align: right; }
  .foot { margin-top: 14px; font-size: 10px; color: #666; text-align: center; }
`;
