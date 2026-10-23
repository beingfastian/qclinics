import { money } from "./api";

// The customer's copy on 80mm thermal paper (or any printer the browser offers).
// Opened at once inside the click (so the browser doesn't block the popup), then
// filled when the bill is saved. Returns null when popups are blocked.
export const openReceiptWindow = () => window.open("", "_blank", "width=380,height=680");

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const STYLE = `
  @page { margin: 4mm; }
  body { width: 66mm; margin: 0; font-family: "Courier New", monospace; font-size: 12px; color: #000; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 4px; text-transform: uppercase; }
  .c { text-align: center; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; margin: 2px 0; }
  .item { margin: 4px 0; }
  .sub { font-size: 11px; color: #222; }
  .big { font-size: 15px; font-weight: bold; }
  .foot { text-align: center; font-size: 10px; margin-top: 8px; }
`;

const row = (k, v, cls = "") => `<div class="row ${cls}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
const when = (d) => new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const qtyText = (line) => {
  const per = line.unitsPerPack || 1;
  if (per > 1 && line.packName && line.qtyUnits >= per) {
    const packs = Math.floor(line.qtyUnits / per);
    const loose = line.qtyUnits - packs * per;
    return `${packs} ${line.packName}${loose ? ` + ${loose}` : ""}`;
  }
  return `${line.qtyUnits} ${line.unitName || ""}`;
};
const METHOD = { cash: "Cash", card: "Card", online: "Online" };

const print = (win, title, body) => {
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`);
  win.document.close();
  win.focus();
  win.onafterprint = () => win.close();
  win.print();
};

export const printSaleReceipt = (sale, shopName, win = openReceiptWindow()) => {
  if (!win || win.closed) return false;
  const lines = sale.items
    .map((l) => `<div class="item">${esc([l.name, l.strength].filter(Boolean).join(" "))}${row(qtyText(l), money(l.lineTotalPaisa), "sub")}</div>`)
    .join("");
  print(
    win,
    `Bill ${sale.saleNo}`,
    `<h1>${esc(shopName)}</h1>
    <div class="c">Bill ${esc(sale.saleNo)}</div>
    <div class="c sub">${esc(when(sale.createdAt))} · ${esc(sale.by?.name || "")}</div>
    ${sale.customerName ? `<div class="c sub">${esc(sale.customerName)}</div>` : ""}
    <hr>${lines}<hr>
    ${sale.discountPaisa ? row("Subtotal", money(sale.subtotalPaisa)) + row("Discount", `- ${money(sale.discountPaisa)}`) : ""}
    ${row("Total", money(sale.totalPaisa), "big")}
    ${row(METHOD[sale.paymentMethod] || "Paid", money(sale.cashReceivedPaisa))}
    ${sale.changePaisa ? row("Change", money(sale.changePaisa)) : ""}
    <hr>
    <div class="foot">Thank you. Keep this bill for returns.</div>`
  );
  return true;
};

export const printReturnReceipt = (ret, shopName, win = openReceiptWindow()) => {
  if (!win || win.closed) return false;
  const lines = ret.items.map((l) => row(`${l.name} x ${l.qtyUnits}`, money(l.refundPaisa), "sub")).join("");
  print(
    win,
    `Return ${ret.returnNo}`,
    `<h1>${esc(shopName)}</h1>
    <div class="c">Return ${esc(ret.returnNo)}${ret.saleNo ? ` · bill ${esc(ret.saleNo)}` : ""}</div>
    <div class="c sub">${esc(when(ret.createdAt))} · ${esc(ret.by?.name || "")}</div>
    <hr>${lines}<hr>
    ${row("Refund", money(ret.totalRefundPaisa), "big")}`
  );
  return true;
};

// The name at the top of bills: the pharmacy's own name, or the hospital's pharmacy
export const shopNameOf = (config) => (config?.mode === "pharmacy" ? config.name || "Pharmacy" : `${config?.name || ""} Pharmacy`.trim());
