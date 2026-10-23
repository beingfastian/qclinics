import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FaAddressBook, FaArrowLeft, FaEdit, FaMoneyBillWave } from "react-icons/fa";
import { Button, Card, CardHeader, EmptyState, Field, Input, Modal, Page, PageHeader, Segmented } from "../../../components/ui";
import { pharmacyGet, pharmacyPost, errorText, money, toPaisa, newRequestId } from "../api";
import CustomerForm from "../components/CustomerForm";

const ENTRY = { sale: "Bill on khata", payment: "Paid", return: "Returned items" };
const METHOD = { cash: "cash", card: "card", online: "online" };
const when = (d) => new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

// One customer's khata: what they owe, every bill and payment, and taking a payment
const PharmacyCustomer = () => {
  const { id } = useParams();
  const [customer, setCustomer] = useState(null);
  const [missing, setMissing] = useState(false);
  const [entries, setEntries] = useState({ entries: [], nextCursor: null });
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([pharmacyGet(`/customers/${id}`), pharmacyGet(`/customers/${id}/statement?limit=50`)]);
      setCustomer(c.customer);
      setEntries(s);
    } catch (e) {
      if (e?.response?.status === 404 || e?.response?.status === 400) setMissing(true);
      else toast.error(errorText(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const older = async () => {
    try {
      const s = await pharmacyGet(`/customers/${id}/statement?limit=50&cursor=${encodeURIComponent(entries.nextCursor)}`);
      setEntries((e) => ({ entries: [...e.entries, ...s.entries], nextCursor: s.nextCursor }));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (missing) return <Page narrow><EmptyState icon={<FaAddressBook />} title="Customer not found" /></Page>;
  if (!customer) return <Page narrow><p className="text-sm text-slate-500" role="status">Loading…</p></Page>;
  const limit = customer.creditLimitPaisa;

  return (
    <Page narrow>
      <Link to="/pharmacy/customers" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <FaArrowLeft aria-hidden="true" /> Customers
      </Link>
      <PageHeader
        title={customer.name}
        description={[customer.phone, customer.address, customer.notes].filter(Boolean).join(" · ")}
        actions={
          <>
            <Button icon={<FaEdit />} onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="primary" icon={<FaMoneyBillWave />} onClick={() => setPaying(true)}>Take payment</Button>
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-slate-600">{customer.balancePaisa >= 0 ? "Owes" : "Paid in advance"}</p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${customer.balancePaisa > 0 ? "text-amber-800" : "text-slate-900"}`} data-testid="customer-balance">
            {money(Math.abs(customer.balancePaisa))}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-600">Credit limit</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{limit === null ? "No limit" : money(limit)}</p>
          {limit !== null && <p className="text-sm text-slate-600">Room left {money(Math.max(0, limit - customer.balancePaisa))}</p>}
          {!customer.active && <p className="mt-1 text-sm text-red-700">Turned off: no new khata bills</p>}
        </Card>
      </div>
      <Card padded={false}>
        <div className="px-5 pt-5"><CardHeader title="Khata" description="Every bill and payment, newest first" /></div>
        {entries.entries.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-600">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.entries.map((e) => (
              <li key={e._id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-900">{ENTRY[e.type]}</span>
                  {e.method && <span className="text-slate-600"> ({METHOD[e.method]})</span>}
                  {e.ref?.kind === "sale" && <Link to={`/pharmacy/sales/${e.ref.id}`} className="ml-2 text-primary-700 underline">Bill {e.ref.no}</Link>}
                  {e.ref?.kind === "return" && <span className="ml-2 text-slate-600">Return {e.ref.no}</span>}
                  {e.note && <span className="ml-2 text-slate-600">“{e.note}”</span>}
                  <span className="block text-xs text-slate-500">{when(e.at)}{e.by?.name && ` · ${e.by.name}`}</span>
                </span>
                <span className="text-right tabular-nums">
                  <span className={e.amountPaisa > 0 ? "text-amber-800" : "text-emerald-700"}>{e.amountPaisa > 0 ? "+" : "−"}{money(Math.abs(e.amountPaisa))}</span>
                  <span className="block text-xs text-slate-500">balance {money(e.balanceAfterPaisa)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {entries.nextCursor && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button size="sm" onClick={older}>Show older</Button>
          </div>
        )}
      </Card>
      {editing && <CustomerForm customer={customer} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {paying && <TakePayment customer={customer} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); load(); }} />}
    </Page>
  );
};

// Money in at the counter: needs an open shift (cash counts in that drawer)
const TakePayment = ({ customer, onClose, onSaved }) => {
  const [amount, setAmount] = useState(customer.balancePaisa > 0 ? String(customer.balancePaisa / 100) : "");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());

  const save = async (e) => {
    e.preventDefault();
    const amountPaisa = toPaisa(amount);
    if (!amountPaisa) return setError("Enter the amount received");
    setBusy(true);
    try {
      const data = await pharmacyPost(`/customers/${customer._id}/payments`, { amountPaisa, method, note, requestId: requestId.current });
      toast.success(data.message);
      onSaved();
    } catch (err) {
      if (err?.response?.data?.code === "no_shift") setError("Open your shift at the counter first: the cash goes in your drawer.");
      else toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Payment from ${customer.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="pay-form" loading={busy}>Save payment</Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">Owes {money(Math.max(0, customer.balancePaisa))}</p>
      <form id="pay-form" onSubmit={save} noValidate className="space-y-3">
        <Field label="Amount received (Rs)" htmlFor="pay-amount" required error={error}>
          <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={Boolean(error)} autoFocus />
        </Field>
        <Segmented label="Paid by" value={method} onChange={setMethod} options={[{ value: "cash", label: "Cash" }, { value: "card", label: "Card" }, { value: "online", label: "Online" }]} />
        <Field label="Note" htmlFor="pay-note">
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
        {error.startsWith("Open your shift") && <Link to="/pharmacy/counter" className="text-sm text-primary-700 underline">Go to the counter</Link>}
      </form>
    </Modal>
  );
};

export default PharmacyCustomer;
