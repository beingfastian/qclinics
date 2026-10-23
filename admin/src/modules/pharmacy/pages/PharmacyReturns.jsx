import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FaSearch, FaTrash, FaUndo } from "react-icons/fa";
import { Button, Card, Field, IconButton, Input, Page, PageHeader, Segmented } from "../../../components/ui";
import { useAppConfig } from "../../../appConfig";
import { pharmacyGet, pharmacyPost, errorText, money, toPaisa, toRupeesText, itemTitle, newRequestId } from "../api";
import { linePrice, refundFor } from "../pricing";
import { printReturnReceipt, shopNameOf } from "../receipt";
import { usePharmacyAccess } from "../useAccess";

// Returns, refunded in cash from your shift's drawer.
// With the bill: find it by number; refunds are what the customer paid (after any
// discount); never more than was sold. Without a bill (managers): choose the item
// and the refund, with a reason.
const PharmacyReturns = () => {
  const config = useAppConfig();
  const allowed = usePharmacyAccess();
  const [params] = useSearchParams();
  const [tab, setTab] = useState("bill");
  const [done, setDone] = useState(null);
  const [noShift, setNoShift] = useState(false);
  const shopName = shopNameOf(config);

  const saved = (ret) => {
    setDone(ret);
    toast.success(`Refund ${money(ret.totalRefundPaisa)}`);
  };
  const failed = (e) => {
    if (e?.response?.data?.code === "no_shift") setNoShift(true);
    toast.error(errorText(e));
  };

  return (
    <Page narrow>
      <PageHeader title="Returns" icon={<FaUndo />} description="Refunds are paid in cash from your shift's drawer." />
      {noShift && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Open your shift first: <Link to="/pharmacy/counter" className="underline">go to the counter</Link>.
        </p>
      )}
      {done ? (
        <Card className="max-w-md">
          <p className="text-lg font-semibold text-slate-900">Return {done.returnNo} saved</p>
          <p className="mt-1 text-3xl font-bold text-emerald-700" data-testid="refund-amount">Give back {money(done.totalRefundPaisa)}</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => printReturnReceipt(done, shopName) || toast.error("Allow pop-ups for this site to print")}>Print slip</Button>
            <Button variant="primary" onClick={() => setDone(null)}>Next return</Button>
          </div>
        </Card>
      ) : (
        <>
          {allowed("returnWithoutBill") && (
            <div className="mb-4">
              <Segmented label="Kind of return" value={tab} onChange={setTab} options={[{ value: "bill", label: "With the bill" }, { value: "nobill", label: "Without a bill" }]} />
            </div>
          )}
          {tab === "bill" ? <WithBill initialNo={params.get("bill") || ""} onSaved={saved} onFailed={failed} /> : <WithoutBill onSaved={saved} onFailed={failed} />}
        </>
      )}
    </Page>
  );
};

const WithBill = ({ initialNo, onSaved, onFailed }) => {
  const [no, setNo] = useState(initialNo);
  const [sale, setSale] = useState(null);
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());

  const find = async (e) => {
    e?.preventDefault();
    if (!no.trim()) return;
    try {
      setSale((await pharmacyGet(`/sales/no/${encodeURIComponent(no.trim())}`)).sale);
      setQty({});
      requestId.current = newRequestId();
    } catch (err) {
      setSale(null);
      toast.error(errorText(err));
    }
  };
  useEffect(() => {
    if (initialNo) find();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = sale?.items.map((l) => ({ line: l, left: l.qtyUnits - l.returnedUnits, n: Math.min(Number(qty[l._id]) || 0, l.qtyUnits - l.returnedUnits) })) || [];
  const refund = lines.reduce((s, { line, n }) => s + (n > 0 ? refundFor(sale, line, line.returnedUnits, n) : 0), 0);
  const chosen = lines.filter((l) => l.n > 0);

  const save = async () => {
    setBusy(true);
    try {
      const data = await pharmacyPost("/returns", {
        saleId: sale._id,
        items: chosen.map(({ line, n }) => ({ saleItemId: line._id, qtyUnits: n })),
        reason,
        requestId: requestId.current,
      });
      requestId.current = newRequestId();
      setSale(null);
      setNo("");
      onSaved(data.return);
    } catch (e) {
      onFailed(e);
      if (e?.response?.data?.code === "over_return") find();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="mb-4">
        <form onSubmit={find} className="flex items-end gap-2">
          <Field label="Bill number" htmlFor="rt-no" className="flex-1">
            <Input id="rt-no" inputMode="numeric" value={no} onChange={(e) => setNo(e.target.value.replace(/\D/g, ""))} autoFocus autoComplete="off" />
          </Field>
          <Button type="submit" icon={<FaSearch />}>Find</Button>
        </form>
      </Card>
      {sale && (
        <Card>
          <p className="mb-3 text-sm text-slate-600">
            Bill {sale.saleNo} · {new Date(sale.createdAt).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · paid {money(sale.totalPaisa)}
            {sale.discountPaisa > 0 && ` (after ${money(sale.discountPaisa)} discount)`}
          </p>
          <ul className="divide-y divide-slate-100">
            {lines.map(({ line, left }) => (
              <li key={line._id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" aria-label={line.name}>
                <span>
                  <span className="font-medium text-slate-900">{line.name}</span>
                  <span className="block text-slate-600">
                    Sold {line.qtyUnits} {line.unitName}s{line.returnedUnits > 0 && `, ${line.returnedUnits} already returned`}
                  </span>
                </span>
                {left > 0 ? (
                  <span className="flex items-center gap-2">
                    <Input
                      aria-label={`${line.name}: how many returned`}
                      type="number"
                      min="0"
                      max={left}
                      inputMode="numeric"
                      value={qty[line._id] ?? ""}
                      onChange={(e) => setQty({ ...qty, [line._id]: e.target.value })}
                      className="w-20 text-center"
                    />
                    <Button size="sm" onClick={() => setQty({ ...qty, [line._id]: String(left) })}>All {left}</Button>
                  </span>
                ) : (
                  <span className="text-slate-500">All returned</span>
                )}
              </li>
            ))}
          </ul>
          <Field label="Reason" htmlFor="rt-reason" className="mt-3">
            <Input id="rt-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Doctor changed the medicine" />
          </Field>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-lg font-semibold text-slate-900" data-testid="refund-preview">Refund {money(refund)}</span>
            <Button variant="primary" onClick={save} loading={busy} disabled={!chosen.length}>Save return</Button>
          </div>
        </Card>
      )}
    </>
  );
};

const WithoutBill = ({ onSaved, onFailed }) => {
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());

  useEffect(() => {
    const text = q.trim();
    if (!text) return setFound([]);
    const timer = setTimeout(() => pharmacyGet(`/products?limit=8&q=${encodeURIComponent(text)}`).then((d) => setFound(d.products)).catch(() => {}), 200);
    return () => clearTimeout(timer);
  }, [q]);

  const add = (p) => {
    if (!lines.some((l) => l.product._id === p._id)) setLines([...lines, { product: p, qty: "1", refund: toRupeesText(linePrice(p, 1)) }]);
    setQ("");
    setFound([]);
  };
  const setLine = (id, patch) =>
    setLines(lines.map((l) => {
      if (l.product._id !== id) return l;
      const next = { ...l, ...patch };
      // Changing the quantity suggests the refund at today's price
      if (patch.qty !== undefined && Number(patch.qty) > 0) next.refund = toRupeesText(linePrice(l.product, Number(patch.qty)));
      return next;
    }));

  const parsed = useMemo(() => lines.map((l) => ({ ...l, n: Number(l.qty), paisa: toPaisa(l.refund) })), [lines]);
  const valid = parsed.length > 0 && parsed.every((l) => Number.isInteger(l.n) && l.n > 0 && l.paisa !== null) && reason.trim();
  const total = parsed.reduce((s, l) => s + (l.paisa || 0), 0);

  const save = async () => {
    setBusy(true);
    try {
      const data = await pharmacyPost("/returns", {
        items: parsed.map((l) => ({ productId: l.product._id, qtyUnits: l.n, refundPaisa: l.paisa })),
        reason: reason.trim(),
        requestId: requestId.current,
      });
      requestId.current = newRequestId();
      setLines([]);
      setReason("");
      onSaved(data.return);
    } catch (e) {
      onFailed(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="relative">
        <Input aria-label="Returned item" placeholder="Find the item: name, salt or barcode" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {found.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox" aria-label="Matching items">
            {found.map((p) => (
              <li key={p._id} role="option" aria-selected="false">
                <button type="button" onClick={() => add(p)} className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">{itemTitle(p)}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {lines.map((l) => (
            <li key={l.product._id} className="flex flex-wrap items-end justify-between gap-3 py-3 text-sm">
              <span className="font-medium text-slate-900">{itemTitle(l.product)}</span>
              <span className="flex items-end gap-2">
                <Field label={`${l.product.unitName}s`} htmlFor={`nb-q-${l.product._id}`}>
                  <Input id={`nb-q-${l.product._id}`} type="number" min="1" inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.product._id, { qty: e.target.value })} className="w-20" />
                </Field>
                <Field label="Refund (Rs)" htmlFor={`nb-r-${l.product._id}`}>
                  <Input id={`nb-r-${l.product._id}`} inputMode="decimal" value={l.refund} onChange={(e) => setLine(l.product._id, { refund: e.target.value })} className="w-28" />
                </Field>
                <IconButton label={`Remove ${l.product.name}`} icon={<FaTrash />} tone="danger" onClick={() => setLines(lines.filter((x) => x !== l))} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Field label="Reason" htmlFor="nb-reason" required className="mt-3" hint="Required for returns without a bill">
        <Input id="nb-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </Field>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-lg font-semibold text-slate-900">Refund {money(total)}</span>
        <Button variant="primary" onClick={save} loading={busy} disabled={!valid}>Save return</Button>
      </div>
    </Card>
  );
};

export default PharmacyReturns;
