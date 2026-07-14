/**
 * order-tickets — one combined kitchen/bar "prep ticket" (KOT/BOT) per order.
 *
 * When a waiter fires an order, the kitchen and the bar each need to know what
 * to MAKE — not what it costs. To keep paper use low (our users are
 * deliberately conservative with thermal rolls), we print a SINGLE short slip
 * per order with a KITCHEN section and a BAR section stacked on one continuous
 * strip — one feed, one cut — instead of a separate page per station. The
 * waiter tears the one slip and routes it.
 *
 * Deliberately price-free and compact-but-legible. Prints on the same 80mm
 * thermal roll as receipts. The customer's priced receipt is printed
 * separately, at payment time.
 */
import { printHtml } from "./report-export";

export interface TicketLine {
  name: string;
  qty: number;
  /** Bar pour (Tot / Glass / Bottle) shown after the name, when present. */
  serving?: string | null;
}

export interface TicketGroup {
  /** Big banner, e.g. "KITCHEN" or "BAR". */
  title: string;
  /** Who the copy is for, e.g. "Chef" or "Barman". */
  station: string;
  lines: TicketLine[];
}

export interface OrderTicketParams {
  orgName: string;
  orderNo: number | string;
  note?: string | null;
  createdAt?: Date;
  /** New round or first fire — printed on the ticket so the kitchen knows. */
  roundLabel?: string;
  /** Only stations that actually have items in this round. */
  groups: TicketGroup[];
}

const TICKET_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
    color: #000;
    width: 72mm;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.3;
    -webkit-font-smoothing: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ord { text-align: center; font-size: 19px; font-weight: 800; letter-spacing: .5px; margin: 0; }
  .biz { text-align: center; font-size: 12px; font-weight: 700; margin: 0; }
  .meta { text-align: center; font-size: 12px; font-weight: 700; margin: 1px 0 0; }
  .note { text-align: center; font-size: 14px; font-weight: 800; margin: 3px 0 0; }
  .hr { border: 0; border-top: 2px dashed #000; margin: 5px 0; }
  .stn { font-size: 15px; font-weight: 800; text-transform: uppercase; margin: 0 0 2px; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 2px 0; font-weight: 800; }
  td.q { width: 10mm; font-size: 16px; white-space: nowrap; }
  td.n { font-size: 15px; overflow-wrap: anywhere; }
  .srv { font-size: 12px; font-weight: 700; }
  .count { font-size: 12px; font-weight: 800; text-align: right; margin: 4px 0 0; }
`;

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));

const qn = (n: number) => Number(n.toFixed(3));

/**
 * Print ONE combined prep slip for the order: a shared header, then a section
 * per station (KITCHEN / BAR) stacked on a single strip. Does nothing if there
 * are no groups with items — so a drinks-only order won't print a blank kitchen
 * section, and nothing prints if the round is empty.
 */
export function printOrderTickets(params: OrderTicketParams) {
  const groups = params.groups.filter((g) => g.lines.length > 0);
  if (groups.length === 0) return;

  const when = (params.createdAt ?? new Date()).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const grandCount = groups.reduce(
    (a, g) => a + g.lines.reduce((b, l) => b + l.qty, 0),
    0,
  );

  // Shared header — printed once, not per station (saves paper).
  let body =
    `<p class="ord">ORDER #${esc(String(params.orderNo))}</p>` +
    `<p class="biz">${esc(params.orgName)}</p>` +
    `<p class="meta">${esc(when)}` +
    (params.roundLabel ? ` · ${esc(params.roundLabel)}` : "") +
    `</p>` +
    (params.note ? `<p class="note">Note: ${esc(params.note)}</p>` : "");

  // One section per station, divided by a dashed rule the waiter can tear at.
  for (const g of groups) {
    const rows = g.lines
      .map(
        (l) =>
          `<tr><td class="q">${qn(l.qty)}×</td><td class="n">${esc(l.name)}` +
          (l.serving ? ` <span class="srv">(${esc(l.serving)})</span>` : "") +
          `</td></tr>`,
      )
      .join("");
    body +=
      `<hr class="hr">` +
      `<p class="stn">${esc(g.title)} — ${esc(g.station)}</p>` +
      `<table><tbody>${rows}</tbody></table>`;
  }

  body += `<hr class="hr"><p class="count">Total items: ${qn(grandCount)}</p>`;

  printHtml(`Order #${params.orderNo} ticket`, body, TICKET_CSS);
}
