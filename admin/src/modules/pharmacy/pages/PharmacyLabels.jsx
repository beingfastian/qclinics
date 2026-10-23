import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import JsBarcode from "jsbarcode";
import { FaBarcode, FaPrint, FaTrash } from "react-icons/fa";
import { Button, Card, EmptyState, Field, IconButton, Input, Page, PageHeader, Select } from "../../../components/ui";
import { useAppConfig } from "../../../appConfig";
import { pharmacyGet, pharmacyPost, errorText, money, itemTitle } from "../api";
import { shopNameOf } from "../receipt";

// Price and barcode labels for the shelf or the pack. Items without a maker's
// barcode can get one of the shop's own, so they scan at the counter too.
// Printed on a label printer (one 38 x 25 mm sticker each) or an A4 sheet of 24.
const LAYOUTS = {
  sticker: { name: "Sticker 38 × 25 mm (label printer)", page: "@page { size: 38mm 25mm; margin: 0; }", sheet: "", label: "width:38mm;height:25mm;page-break-after:always;" },
  a4: {
    name: "A4 sheet, 3 × 8",
    page: "@page { size: A4; margin: 8mm 6mm; }",
    sheet: "display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:35mm;",
    label: "border:1px dashed #bbb;",
  },
};

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// The barcode as an SVG: EAN-13 when it is one, otherwise Code 128 (any text)
const barcodeSvg = (code) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const ean = /^\d{13}$/.test(code);
  try {
    JsBarcode(svg, code, { format: ean ? "EAN13" : "CODE128", height: 34, width: 1.4, fontSize: 11, margin: 0, displayValue: true, flat: !ean });
  } catch {
    JsBarcode(svg, code, { format: "CODE128", height: 34, width: 1.4, fontSize: 11, margin: 0 });
  }
  svg.setAttribute("style", "max-width:100%;height:12mm;");
  return svg.outerHTML;
};

const PharmacyLabels = () => {
  const config = useAppConfig();
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [lines, setLines] = useState([]);
  const [layout, setLayout] = useState("sticker");
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    const text = q.trim();
    if (!text) return setFound([]);
    const timer = setTimeout(() => pharmacyGet(`/products?active=true&limit=8&q=${encodeURIComponent(text)}`).then((d) => setFound(d.products)).catch(() => {}), 200);
    return () => clearTimeout(timer);
  }, [q]);

  const add = (p) => {
    if (!lines.some((l) => l.product._id === p._id)) setLines([...lines, { product: p, copies: "1" }]);
    setQ("");
    setFound([]);
  };
  const setLine = (id, patch) => setLines(lines.map((l) => (l.product._id === id ? { ...l, ...patch } : l)));

  const giveBarcode = async (p) => {
    setBusy(p._id);
    try {
      const data = await pharmacyPost(`/products/${p._id}/shop-barcode`);
      toast.success(data.message);
      setLine(p._id, { product: data.product });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const total = lines.reduce((s, l) => s + (Math.max(0, Math.floor(Number(l.copies) || 0))), 0);

  const print = () => {
    const win = window.open("", "_blank", "width=600,height=700");
    if (!win) return toast.error("Allow pop-ups for this site to print");
    const shop = shopNameOf(config);
    const L = LAYOUTS[layout];
    const labels = lines
      .flatMap((l) => {
        const p = l.product;
        const code = p.barcodes?.[0];
        const html = `<div class="label" style="${L.label}">
          <div class="shop">${esc(shop)}</div>
          <div class="name">${esc(itemTitle(p))}</div>
          <div class="price">${esc(money(p.unitPricePaisa))} / ${esc(p.unitName)}${p.packName && p.unitsPerPack > 1 ? ` · ${esc(money(p.packPricePaisa))} / ${esc(p.packName)}` : ""}</div>
          ${code ? barcodeSvg(code) : ""}
        </div>`;
        return Array.from({ length: Math.max(0, Math.min(500, Math.floor(Number(l.copies) || 0))) }, () => html);
      })
      .join("");
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
      ${L.page}
      body { margin: 0; font-family: Arial, sans-serif; color: #000; }
      .sheet { ${L.sheet} }
      .label { box-sizing: border-box; padding: 1.5mm 2mm; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
      .shop { font-size: 7px; text-transform: uppercase; }
      .name { font-size: 10px; font-weight: bold; line-height: 1.1; max-height: 2.2em; overflow: hidden; }
      .price { font-size: 9px; }
    </style></head><body><div class="sheet">${labels}</div></body></html>`);
    win.document.close();
    win.focus();
    win.onafterprint = () => win.close();
    win.print();
  };

  return (
    <Page narrow>
      <PageHeader title="Labels" icon={<FaBarcode />} description="Price and barcode labels for the shelf or the pack." />
      <Card className="mb-4">
        <div className="relative">
          <Input aria-label="Add an item to print" placeholder="Add an item: name, salt or barcode" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoFocus />
          {found.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox" aria-label="Matching items">
              {found.map((p) => (
                <li key={p._id} role="option" aria-selected="false">
                  <button type="button" onClick={() => add(p)} className="flex w-full justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50">
                    <span>{itemTitle(p)}</span>
                    <span className="text-slate-500">{p.barcodes?.[0] || "no barcode"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card padded={false} className="mb-4">
        {lines.length === 0 ? (
          <EmptyState icon={<FaBarcode />} title="No items yet" description="Add the items you want labels for." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {lines.map((l) => {
              const p = l.product;
              return (
                <li key={p._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm" aria-label={p.name}>
                  <span>
                    <span className="font-medium text-slate-900">{itemTitle(p)}</span>
                    <span className="block text-slate-600">
                      {money(p.unitPricePaisa)} / {p.unitName} ·{" "}
                      {p.barcodes?.[0] ? <span data-testid="label-barcode">{p.barcodes[0]}</span> : <span className="text-amber-800">no barcode</span>}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {!p.barcodes?.length && (
                      <Button size="sm" onClick={() => giveBarcode(p)} loading={busy === p._id}>Give a shop barcode</Button>
                    )}
                    <Input aria-label={`Copies of ${p.name}`} type="number" min="0" max="500" inputMode="numeric" value={l.copies} onChange={(e) => setLine(p._id, { copies: e.target.value })} className="w-20 text-center" />
                    <IconButton label={`Remove ${p.name}`} icon={<FaTrash />} tone="danger" onClick={() => setLines(lines.filter((x) => x !== l))} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Print on" htmlFor="lb-layout">
          <Select id="lb-layout" value={layout} onChange={(e) => setLayout(e.target.value)} className="w-72">
            {Object.entries(LAYOUTS).map(([value, l]) => (
              <option key={value} value={value}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" icon={<FaPrint />} onClick={print} disabled={!total}>Print {total} labels</Button>
      </Card>
    </Page>
  );
};

export default PharmacyLabels;
