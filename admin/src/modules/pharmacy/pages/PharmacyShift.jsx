import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FaCashRegister } from "react-icons/fa";
import { Badge, Button, Card, CardHeader, Field, Input, Page, PageHeader, useDialog } from "../../../components/ui";
import { pharmacyGet, pharmacyPost, errorText, money, toPaisa } from "../api";

const METHOD = { cash: "Cash", card: "Card", online: "Online" };
const time = (d) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// The cashier's own shift: what was sold, what the drawer should hold, and the
// closing count. A shortage or extra is recorded with the shift.
const PharmacyShift = () => {
  const { confirm } = useDialog();
  const [shift, setShift] = useState(undefined);
  const [closed, setClosed] = useState(null);
  const [sales, setSales] = useState([]);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { shift: current } = await pharmacyGet("/shifts/current");
      setShift(current);
      if (current) setSales((await pharmacyGet("/sales?limit=200")).sales);
    } catch (e) {
      toast.error(errorText(e));
      setShift(null);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const close = async (e) => {
    e.preventDefault();
    const countedCashPaisa = toPaisa(counted);
    if (!counted.trim() || countedCashPaisa === null) return setError("Count the cash in the drawer and enter it");
    setError("");
    const diff = countedCashPaisa - shift.expectedCashPaisa;
    if (diff !== 0) {
      const ok = await confirm({
        title: diff < 0 ? `The drawer is ${money(-diff)} short` : `The drawer has ${money(diff)} extra`,
        message: "Count again if you're not sure. Closing records the difference with your shift.",
        confirmLabel: "Close shift",
        tone: diff < 0 ? "danger" : "default",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const data = await pharmacyPost("/shifts/close", { countedCashPaisa, note });
      toast.success(data.message);
      setClosed(data.shift);
      setShift(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (shift === undefined) return <Page narrow><p className="text-sm text-slate-500" role="status">Loading…</p></Page>;

  if (closed) {
    const d = closed.differencePaisa;
    return (
      <Page narrow>
        <PageHeader title={`Shift ${closed.shiftNo} closed`} icon={<FaCashRegister />} />
        <Card className="max-w-md">
          <Summary shift={closed} />
          <div className="mt-3 flex justify-between border-t border-slate-100 pt-3">
            <span className="text-slate-700">Counted</span>
            <span className="font-semibold">{money(closed.countedCashPaisa)}</span>
          </div>
          <p className={`mt-2 font-semibold ${d < 0 ? "text-red-700" : d > 0 ? "text-amber-800" : "text-emerald-700"}`} data-testid="shift-difference">
            {d === 0 ? "The drawer matches" : d < 0 ? `${money(-d)} short` : `${money(d)} extra`}
          </p>
          <Link to="/pharmacy/counter" className="mt-4 inline-block text-primary-700 underline">Open a new shift</Link>
        </Card>
      </Page>
    );
  }

  if (!shift) {
    return (
      <Page narrow>
        <PageHeader title="Your shift" icon={<FaCashRegister />} />
        <Card>
          <p className="text-sm text-slate-700">You don’t have an open shift.</p>
          <Link to="/pharmacy/counter" className="mt-2 inline-block text-primary-700 underline">Go to the counter to open one</Link>
        </Card>
      </Page>
    );
  }

  return (
    <Page narrow>
      <PageHeader
        title={`Shift ${shift.shiftNo}`}
        icon={<FaCashRegister />}
        description={`Opened ${new Date(shift.openedAt).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} by ${shift.openedBy?.name}`}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <Summary shift={shift} />
        </Card>
        <Card>
          <CardHeader title="Close the shift" description="Count the cash in the drawer." />
          <form onSubmit={close} noValidate className="space-y-3">
            <Field label="Cash counted (Rs)" htmlFor="sh-count" required error={error}>
              <Input id="sh-count" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} invalid={Boolean(error)} />
            </Field>
            <Field label="Note" htmlFor="sh-note" hint="e.g. why the drawer is short">
              <Input id="sh-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
            <Button type="submit" variant="primary" loading={busy}>Close shift</Button>
          </form>
        </Card>
      </div>

      <Card className="mt-4" padded={false}>
        <div className="px-5 pt-5"><CardHeader title="Bills in this shift" /></div>
        {sales.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-600">No bills yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sales.map((s) => (
              <li key={s._id}>
                <Link to={`/pharmacy/sales/${s._id}`} className="flex items-center justify-between gap-3 px-5 py-2 text-sm hover:bg-slate-50">
                  <span>
                    <span className="font-medium text-slate-900">Bill {s.saleNo}</span> · {time(s.createdAt)} · {s.items.length} items
                    {s.refundedPaisa > 0 && <Badge tone="warning" className="ml-2">{money(s.refundedPaisa)} returned</Badge>}
                  </span>
                  <span className="tabular-nums">{money(s.totalPaisa)} <span className="text-slate-500">{METHOD[s.paymentMethod]}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
};

const Summary = ({ shift }) => {
  const t = shift.totals || {};
  const rows = [
    ["Opening cash", shift.openingCashPaisa],
    [`Cash sales (${t.salesCount || 0} bills in all)`, t.cashSalesPaisa],
    ["Card", t.cardSalesPaisa],
    ["Online", t.onlineSalesPaisa],
    [`Refunds (${t.returnsCount || 0})`, -(t.refundsPaisa || 0)],
  ];
  return (
    <dl className="space-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between">
          <dt className="text-slate-600">{label}</dt>
          <dd className="tabular-nums">{money(value)}</dd>
        </div>
      ))}
      {t.profitPaisa !== undefined && (
        <div className="flex justify-between">
          <dt className="text-slate-600">Profit</dt>
          <dd className="tabular-nums">{money(t.profitPaisa)}</dd>
        </div>
      )}
      <div className="flex justify-between border-t border-slate-100 pt-2 text-base">
        <dt className="font-medium text-slate-900">Cash that should be in the drawer</dt>
        <dd className="font-semibold tabular-nums" data-testid="expected-cash">{money(shift.expectedCashPaisa)}</dd>
      </div>
    </dl>
  );
};

export default PharmacyShift;
