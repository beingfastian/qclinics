import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaArrowLeft, FaSearch, FaTrash } from "react-icons/fa";
import { Button, Card, Field, IconButton, Input, Page, PageHeader, Select, useDialog } from "../../../components/ui";
import { pharmacyGet, pharmacyPost, errorText, money, toPaisa, toRupeesText, itemTitle, newRequestId } from "../api";

// Enter a supplier's invoice. Each line: packs, loose units, free bonus units, the
// pack cost and any discount; the real cost of each unit is worked out (bonus makes
// it cheaper). The draft is kept on this computer until it's saved, so a reload or
// a dropped connection loses nothing, and saving twice never adds the stock twice.
const DRAFT_KEY = "pharmacy.purchaseDraft";
const today = () => new Date().toISOString().slice(0, 10);
const blankDraft = () => ({ supplierId: "", invoiceNo: "", invoiceDate: today(), paid: "", notes: "", lines: [], requestId: newRequestId() });

const readDraft = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return saved?.lines && saved.requestId ? saved : blankDraft();
  } catch {
    return blankDraft();
  }
};

// Expiry is printed as a month: it lasts to the end of that month
const monthEnd = (month) => {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return undefined;
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const whole = (text) => {
  if (String(text ?? "").trim() === "") return 0;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

// Same sums as the server (purchaseService.priceLine)
const priceLine = (line) => {
  const per = line.unitsPerPack || 1;
  const packs = whole(line.packs) ?? 0;
  const loose = whole(line.loose) ?? 0;
  const bonus = whole(line.bonus) ?? 0;
  const packCost = toPaisa(line.packCost) ?? 0;
  const discount = toPaisa(line.discount) ?? 0;
  const units = packs * per + loose + bonus;
  const total = Math.round(packs * packCost + (loose * packCost) / per - discount);
  return { units, bought: packs * per + loose, total, perUnit: units ? total / units : 0 };
};

const PharmacyPurchaseNew = () => {
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const [draft, setDraft] = useState(readDraft);
  const [suppliers, setSuppliers] = useState([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [problems, setProblems] = useState({});
  const [busy, setBusy] = useState(false);
  const search = useRef(null);
  const latest = useRef(0);

  useEffect(() => {
    pharmacyGet("/suppliers?active=true")
      .then((d) => setSuppliers(d.suppliers))
      .catch((e) => toast.error(errorText(e)));
  }, []);

  useEffect(() => {
    try {
      if (draft.lines.length || draft.supplierId || draft.invoiceNo) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // private window: the draft just isn't kept
    }
  }, [draft]);

  useEffect(() => {
    const text = q.trim();
    const id = ++latest.current;
    if (!text) return setFound([]);
    const timer = setTimeout(() => {
      pharmacyGet(`/products?active=true&limit=8&q=${encodeURIComponent(text)}`)
        .then((d) => id === latest.current && setFound(d.products))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setLine = (key, patch) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const addItem = (p) => {
    const lastPack = p.lastCostPerUnitPaisa ? Math.round(p.lastCostPerUnitPaisa * (p.unitsPerPack || 1)) : 0;
    setDraft((d) => ({
      ...d,
      lines: [
        ...d.lines,
        {
          key: `${p._id}-${Date.now()}`,
          productId: p._id,
          name: itemTitle(p),
          unitName: p.unitName,
          packName: p.packName || "pack",
          unitsPerPack: p.unitsPerPack || 1,
          trackExpiry: p.trackExpiry,
          batchNo: "",
          expiry: "",
          packs: "",
          loose: "",
          bonus: "",
          packCost: toRupeesText(lastPack),
          discount: "",
        },
      ],
    }));
    setQ("");
    setFound([]);
    search.current?.focus();
  };

  const onSearchKey = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exact = found.find((p) => p.barcodes?.includes(q.trim()));
    if (exact || found.length === 1) addItem(exact || found[0]);
  };

  const priced = useMemo(() => draft.lines.map(priceLine), [draft.lines]);
  const total = priced.reduce((s, l) => s + l.total, 0);
  const paidPaisa = toPaisa(draft.paid);

  const save = async () => {
    const issues = {};
    if (!draft.supplierId) issues.supplier = "Choose the supplier";
    if (!draft.lines.length) issues.lines = "Add at least one item";
    draft.lines.forEach((l, i) => {
      const p = priced[i];
      const bad = [];
      if ([l.packs, l.loose, l.bonus].some((v) => whole(v) === null)) bad.push("quantities must be whole numbers");
      else if (p.bought < 1) bad.push("enter how many were bought");
      if (toPaisa(l.packCost) === null || toPaisa(l.discount) === null) bad.push("check the amounts");
      if (l.trackExpiry && !monthEnd(l.expiry)) bad.push("enter the expiry");
      if (p.total < 0) bad.push("the discount is more than the line");
      if (bad.length) issues[l.key] = bad.join(", ");
    });
    if (paidPaisa === null) issues.paid = "Enter an amount like 5000";
    else if (paidPaisa > total) issues.paid = "Paid can't be more than the total";
    setProblems(issues);
    if (Object.keys(issues).length) return toast.error("Some lines need fixing");

    setBusy(true);
    try {
      const data = await pharmacyPost("/purchases", {
        supplierId: draft.supplierId,
        invoiceNo: draft.invoiceNo,
        ...(draft.invoiceDate && { invoiceDate: draft.invoiceDate }),
        paidPaisa,
        notes: draft.notes,
        requestId: draft.requestId,
        items: draft.lines.map((l) => ({
          productId: l.productId,
          batchNo: l.batchNo.trim(),
          ...(l.trackExpiry && { expiry: monthEnd(l.expiry) }),
          packs: whole(l.packs),
          looseUnits: whole(l.loose),
          bonusUnits: whole(l.bonus),
          packCostPaisa: toPaisa(l.packCost),
          discountPaisa: toPaisa(l.discount),
        })),
      });
      toast.success(data.message);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // nothing kept
      }
      navigate(`/pharmacy/purchases/${data.purchase._id}`, { replace: true });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (await confirm({ title: "Clear this purchase?", message: "Everything typed here is removed.", confirmLabel: "Clear", tone: "danger" })) setDraft(blankDraft());
  };

  return (
    <Page>
      <Link to="/pharmacy/purchases" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <FaArrowLeft aria-hidden="true" /> Purchases
      </Link>
      <PageHeader title="New purchase" description="Kept on this computer until you save it." actions={draft.lines.length > 0 && <Button onClick={clear}>Clear</Button>} />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Supplier" htmlFor="pu-supplier" required error={problems.supplier}>
            <Select id="pu-supplier" value={draft.supplierId} onChange={(e) => update({ supplierId: e.target.value })} invalid={Boolean(problems.supplier)}>
              <option value="">Choose…</option>
              {suppliers.map((s) => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </Select>
            {suppliers.length === 0 && <p className="mt-1 text-xs text-slate-500"><Link to="/pharmacy/suppliers" className="underline">Add a supplier</Link> first.</p>}
          </Field>
          <Field label="Invoice number" htmlFor="pu-invoice">
            <Input id="pu-invoice" value={draft.invoiceNo} onChange={(e) => update({ invoiceNo: e.target.value })} maxLength={60} autoComplete="off" />
          </Field>
          <Field label="Invoice date" htmlFor="pu-date">
            <Input id="pu-date" type="date" value={draft.invoiceDate} max={today()} onChange={(e) => update({ invoiceDate: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="relative">
          <FaSearch className="pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" />
          <Input
            ref={search}
            aria-label="Add an item"
            placeholder="Add an item: name, salt or scan its barcode"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            className="pl-9"
            autoComplete="off"
          />
          {found.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox" aria-label="Matching items">
              {found.map((p) => (
                <li key={p._id} role="option" aria-selected="false">
                  <button type="button" onClick={() => addItem(p)} className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="text-slate-900">{itemTitle(p)} <span className="text-slate-500">{p.manufacturer}</span></span>
                    <span className="text-slate-500">{p.stockUnits} in stock</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {problems.lines && <p className="mt-2 text-sm text-red-700" role="alert">{problems.lines}</p>}
      </Card>

      {draft.lines.map((l, i) => {
        const p = priced[i];
        return (
          <Card key={l.key} className="mb-3" aria-label={`Line ${i + 1}: ${l.name}`}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="font-medium text-slate-900">{i + 1}. {l.name}</p>
              <IconButton label={`Remove ${l.name}`} icon={<FaTrash />} tone="danger" onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) }))} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Field label="Batch" htmlFor={`b-${l.key}`}>
                <Input id={`b-${l.key}`} value={l.batchNo} onChange={(e) => setLine(l.key, { batchNo: e.target.value })} maxLength={40} autoComplete="off" />
              </Field>
              {l.trackExpiry ? (
                <Field label="Expiry" htmlFor={`e-${l.key}`} required>
                  <Input id={`e-${l.key}`} type="month" value={l.expiry} min={today().slice(0, 7)} onChange={(e) => setLine(l.key, { expiry: e.target.value })} />
                </Field>
              ) : (
                <Field label="Expiry"><p className="py-2 text-sm text-slate-500">None</p></Field>
              )}
              <Field label={`${l.packName}s`} htmlFor={`p-${l.key}`}>
                <Input id={`p-${l.key}`} type="number" min="0" inputMode="numeric" value={l.packs} onChange={(e) => setLine(l.key, { packs: e.target.value })} />
              </Field>
              {l.unitsPerPack > 1 && (
                <Field label={`Loose ${l.unitName}s`} htmlFor={`l-${l.key}`}>
                  <Input id={`l-${l.key}`} type="number" min="0" inputMode="numeric" value={l.loose} onChange={(e) => setLine(l.key, { loose: e.target.value })} />
                </Field>
              )}
              <Field label={`Bonus ${l.unitName}s`} htmlFor={`f-${l.key}`} hint="Free">
                <Input id={`f-${l.key}`} type="number" min="0" inputMode="numeric" value={l.bonus} onChange={(e) => setLine(l.key, { bonus: e.target.value })} />
              </Field>
              <Field label={`Cost per ${l.packName} (Rs)`} htmlFor={`c-${l.key}`}>
                <Input id={`c-${l.key}`} inputMode="decimal" value={l.packCost} onChange={(e) => setLine(l.key, { packCost: e.target.value })} />
              </Field>
              <Field label="Discount (Rs)" htmlFor={`d-${l.key}`}>
                <Input id={`d-${l.key}`} inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} />
              </Field>
              <div className="text-sm">
                <p className="mb-1 font-medium text-slate-700">Line</p>
                <p className="font-semibold text-slate-900">{money(p.total)}</p>
                <p className="text-xs text-slate-500">{p.units} {l.unitName}s · {money(p.perUnit)} each</p>
              </div>
            </div>
            {problems[l.key] && <p className="mt-2 text-sm text-red-700" role="alert">Line {i + 1}: {problems[l.key]}</p>}
          </Card>
        );
      })}

      <Card className="ml-auto max-w-md">
        <dl className="mb-3 flex justify-between text-base">
          <dt className="text-slate-700">Invoice total</dt>
          <dd className="font-semibold text-slate-900" data-testid="purchase-total">{money(total)}</dd>
        </dl>
        <Field label="Paid now (Rs)" htmlFor="pu-paid" hint={paidPaisa !== null && total - (paidPaisa || 0) > 0 ? `${money(total - (paidPaisa || 0))} left to pay` : undefined} error={problems.paid}>
          <Input id="pu-paid" inputMode="decimal" value={draft.paid} onChange={(e) => update({ paid: e.target.value })} invalid={Boolean(problems.paid)} />
        </Field>
        <Field label="Notes" htmlFor="pu-notes" className="mt-3">
          <Input id="pu-notes" value={draft.notes} onChange={(e) => update({ notes: e.target.value })} maxLength={300} />
        </Field>
        <Button variant="primary" size="lg" className="mt-4 w-full" onClick={save} loading={busy} disabled={!draft.lines.length}>
          Save purchase
        </Button>
      </Card>
    </Page>
  );
};

export default PharmacyPurchaseNew;
