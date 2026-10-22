import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FaArrowLeft, FaEdit, FaPills } from "react-icons/fa";
import { Badge, Button, Card, CardHeader, EmptyState, Page, PageHeader } from "../../../components/ui";
import { pharmacyGet, errorText, money, stockText, itemTitle, expiryText, dateText } from "../api";
import { usePharmacyAccess } from "../useAccess";
import ItemForm from "../components/ItemForm";
import AdjustDialog from "../components/AdjustDialog";

const MOVEMENT_LABEL = {
  purchase: "Purchase",
  sale: "Sale",
  sale_return: "Return",
  adjustment: "Count correction",
  expired: "Expired",
  damaged: "Damaged",
};

// One item: prices, stock by batch (soonest expiry first, as it is sold),
// substitutes, and for managers the cost and full stock history
const PharmacyItem = () => {
  const { id } = useParams();
  const allowed = usePharmacyAccess();
  const canManage = allowed("manageStock");
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [subs, setSubs] = useState([]);
  const [history, setHistory] = useState({ movements: [], nextCursor: null });
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(null);

  const loadHistory = useCallback(
    async (cursor) => {
      if (!canManage) return;
      const params = new URLSearchParams({ productId: id, limit: "30", ...(cursor && { cursor }) });
      const page = await pharmacyGet(`/stock/movements?${params}`);
      setHistory((h) => ({ movements: cursor ? [...h.movements, ...page.movements] : page.movements, nextCursor: page.nextCursor }));
    },
    [id, canManage]
  );

  const load = useCallback(async () => {
    try {
      const [item, substitutes] = await Promise.all([pharmacyGet(`/products/${id}`), pharmacyGet(`/products/${id}/substitutes`)]);
      setData(item);
      setSubs(substitutes.substitutes);
      await loadHistory();
    } catch (e) {
      if (e?.response?.status === 404 || e?.response?.status === 400) setMissing(true);
      else toast.error(errorText(e));
    }
  }, [id, loadHistory]);

  useEffect(() => {
    setData(null);
    setMissing(false);
    load();
  }, [load]);

  if (missing) {
    return (
      <Page narrow>
        <EmptyState icon={<FaPills />} title="Item not found" action={<Link to="/pharmacy/items" className="text-primary-700 underline">Back to items</Link>} />
      </Page>
    );
  }
  if (!data) return <Page narrow><p className="text-sm text-slate-500" role="status">Loading…</p></Page>;

  const { product: p, batches } = data;
  const showCost = p.lastCostPerUnitPaisa !== undefined;
  return (
    <Page narrow>
      <Link to="/pharmacy/items" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <FaArrowLeft aria-hidden="true" /> Items
      </Link>
      <PageHeader
        title={itemTitle(p)}
        description={[p.salt, p.manufacturer, p.barcodes.length ? `Barcode ${p.barcodes.join(", ")}` : ""].filter(Boolean).join(" · ")}
        actions={canManage && <Button icon={<FaEdit />} onClick={() => setEditing(true)}>Edit</Button>}
      />
      {!p.active && <p className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700">This item is turned off: it doesn’t show at the counter.</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-600">In stock</p>
          <p className={`mt-1 text-xl font-semibold ${p.stockUnits <= 0 ? "text-red-700" : "text-slate-900"}`}>{stockText(p.stockUnits, p)}</p>
          {p.unitsPerPack > 1 && p.packName && <p className="text-xs text-slate-500">{p.stockUnits} {p.unitName}s in all</p>}
          {p.stockUnits <= p.reorderLevelUnits && <Badge tone="warning" className="mt-2">At or below {p.reorderLevelUnits}: reorder</Badge>}
        </Card>
        <Card>
          <p className="text-sm text-slate-600">Selling price</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{money(p.unitPricePaisa)} <span className="text-sm font-normal text-slate-500">/ {p.unitName}</span></p>
          {p.packName && p.unitsPerPack > 1 && <p className="text-sm text-slate-600">{money(p.packPricePaisa)} / {p.packName} of {p.unitsPerPack}</p>}
        </Card>
        {showCost && (
          <Card>
            <p className="text-sm text-slate-600">Last cost</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{money(p.lastCostPerUnitPaisa)} <span className="text-sm font-normal text-slate-500">/ {p.unitName}</span></p>
            {p.lastCostPerUnitPaisa > 0 && (
              <p className="text-sm text-slate-600">Margin {Math.round(((p.unitPricePaisa - p.lastCostPerUnitPaisa) / p.unitPricePaisa) * 100)}%</p>
            )}
          </Card>
        )}
      </div>

      <Card className="mb-4" padded={false}>
        <div className="px-5 pt-5"><CardHeader title="Stock by batch" description="Sold in this order: the batch expiring first goes first. Expired stock is never sold." /></div>
        {batches.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-600">No stock. {canManage ? "Enter a purchase to add some." : ""}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-5 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 font-medium">Expiry</th>
                  <th className="px-3 py-2 font-medium">Quantity</th>
                  {showCost && <th className="px-3 py-2 font-medium">Cost / {p.unitName}</th>}
                  {canManage && <th className="px-5 py-2"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => (
                  <tr key={b._id}>
                    <td className="px-5 py-2 text-slate-900">{b.batchNo || "—"}</td>
                    <td className="px-3 py-2">
                      {expiryText(b.expiry)} {b.expired && <Badge tone="danger">Expired</Badge>}
                    </td>
                    <td className="px-3 py-2 text-slate-900">{stockText(b.qtyUnits, p)}</td>
                    {showCost && <td className="px-3 py-2">{money(b.costPerUnitPaisa)}</td>}
                    {canManage && (
                      <td className="px-5 py-2 text-right">
                        <Button size="sm" onClick={() => setAdjusting(b)}>Correct</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader title="Substitutes" description={p.salt ? `Same salt and strength: ${[p.salt, p.strength].filter(Boolean).join(" ")}` : "Add the salt to this item to see substitutes"} />
        {subs.length === 0 ? (
          <p className="text-sm text-slate-600">None found.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {subs.map((s) => (
              <li key={s._id}>
                <Link to={`/pharmacy/items/${s._id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                  <span className="text-slate-900">{itemTitle(s)} <span className="text-slate-500">{s.manufacturer}</span></span>
                  <span className="text-sm text-slate-700">{money(s.unitPricePaisa)} · {s.stockUnits > 0 ? stockText(s.stockUnits, s) : "out of stock"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage && (
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Stock history" description="Every change, newest first. Nothing here is ever edited or deleted." /></div>
          {history.movements.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-slate-600">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {history.movements.map((m) => (
                <li key={m._id} className="flex flex-col gap-1 px-5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-medium text-slate-900">{MOVEMENT_LABEL[m.type] || m.type}</span>
                    {m.ref?.kind === "purchase" && m.ref.no && (
                      <Link to={`/pharmacy/purchases/${m.ref.id}`} className="ml-2 text-primary-700 underline">#{m.ref.no}</Link>
                    )}
                    {m.negativeOverride && <Badge tone="warning" className="ml-2">Sold before stock was entered</Badge>}
                    {m.reason && <span className="ml-2 text-slate-600">“{m.reason}”</span>}
                    <span className="block text-xs text-slate-500">{dateText(m.at)} {new Date(m.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}{m.by?.name && ` · ${m.by.name}`}</span>
                  </div>
                  <span className={`font-medium tabular-nums ${m.qtyUnits < 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {m.qtyUnits > 0 ? "+" : "−"}{stockText(Math.abs(m.qtyUnits), p)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {history.nextCursor && (
            <div className="border-t border-slate-100 p-3 text-center">
              <Button size="sm" onClick={() => loadHistory(history.nextCursor).catch((e) => toast.error(errorText(e)))}>Show older</Button>
            </div>
          )}
        </Card>
      )}

      {editing && (
        <ItemForm
          product={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
      {adjusting && (
        <AdjustDialog
          product={p}
          batch={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            load();
          }}
        />
      )}
    </Page>
  );
};

export default PharmacyItem;
