import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FaArrowLeft, FaMoneyCheckAlt, FaTruck } from "react-icons/fa";
import { Button, Card, CardHeader, EmptyState, Field, Input, Modal, Page, PageHeader, Select } from "../../../components/ui";
import { pharmacyGet, pharmacyPost, errorText, money, toPaisa, dateText, newRequestId } from "../api";
import { usePharmacyAccess } from "../useAccess";

const METHOD = { cash: "Cash", bank: "Bank transfer", cheque: "Cheque", online: "Online" };

// What we owe one supplier: purchases (less what was paid at the time) and the
// payments since, oldest first with the running balance
const PharmacySupplier = () => {
  const { id } = useParams();
  const allowed = usePharmacyAccess();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await pharmacyGet(`/suppliers/${id}/statement`));
    } catch (e) {
      if (e?.response?.status === 404 || e?.response?.status === 400) setMissing(true);
      else toast.error(errorText(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (missing) return <Page narrow><EmptyState icon={<FaTruck />} title="Supplier not found" /></Page>;
  if (!data) return <Page narrow><p className="text-sm text-slate-500" role="status">Loading…</p></Page>;

  return (
    <Page narrow>
      <Link to="/pharmacy/suppliers" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <FaArrowLeft aria-hidden="true" /> Suppliers
      </Link>
      <PageHeader
        title={data.supplier.name}
        description={data.supplier.phone}
        actions={allowed("manageCredit") && <Button variant="primary" icon={<FaMoneyCheckAlt />} onClick={() => setPaying(true)}>Pay</Button>}
      />
      <Card className="mb-4 max-w-sm">
        <p className="text-sm text-slate-600">{data.balancePaisa >= 0 ? "We owe" : "Paid in advance"}</p>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${data.balancePaisa > 0 ? "text-amber-800" : "text-slate-900"}`} data-testid="supplier-balance">{money(Math.abs(data.balancePaisa))}</p>
      </Card>
      <Card padded={false}>
        <div className="px-5 pt-5"><CardHeader title="Account" description="Oldest first" /></div>
        {data.lines.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-600">No purchases or payments yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.lines.map((l) => (
              <li key={`${l.kind}-${l.id}`} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                <span>
                  {l.kind === "purchase" ? (
                    <>
                      <Link to={`/pharmacy/purchases/${l.id}`} className="font-medium text-primary-700 underline">Purchase #{l.no}</Link>
                      {l.invoiceNo && <span className="text-slate-600"> · invoice {l.invoiceNo}</span>}
                      <span className="block text-xs text-slate-500">{dateText(l.at)} · {money(l.totalPaisa)}{l.paidPaisa ? `, ${money(l.paidPaisa)} paid then` : ""}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-slate-900">Paid · {METHOD[l.method]}</span>
                      {l.reference && <span className="text-slate-600"> {l.reference}</span>}
                      {l.fromDrawer && <span className="text-slate-600"> (from the counter drawer)</span>}
                      <span className="block text-xs text-slate-500">{dateText(l.paidOn || l.at)}{l.by && ` · ${l.by}`}{l.note && ` · ${l.note}`}</span>
                    </>
                  )}
                </span>
                <span className="text-right tabular-nums">
                  <span className={l.changePaisa > 0 ? "text-amber-800" : "text-emerald-700"}>{l.changePaisa > 0 ? "+" : "−"}{money(Math.abs(l.changePaisa))}</span>
                  <span className="block text-xs text-slate-500">balance {money(l.balancePaisa)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {paying && <PaySupplier supplier={data.supplier} owed={data.balancePaisa} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); load(); }} />}
    </Page>
  );
};

const PaySupplier = ({ supplier, owed, onClose, onSaved }) => {
  const [form, setForm] = useState({ amount: owed > 0 ? String(owed / 100) : "", method: "cash", reference: "", note: "", fromDrawer: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const amountPaisa = toPaisa(form.amount);
    if (!amountPaisa) return setError("Enter the amount paid");
    setBusy(true);
    try {
      const data = await pharmacyPost(`/suppliers/${supplier._id}/payments`, {
        amountPaisa,
        method: form.method,
        reference: form.reference,
        note: form.note,
        fromDrawer: form.method === "cash" && form.fromDrawer,
        requestId: requestId.current,
      });
      toast.success(data.message);
      onSaved();
    } catch (err) {
      if (err?.response?.data?.code === "no_shift") setError("To pay from the drawer, open your shift at the counter first.");
      else toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Pay ${supplier.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="supplier-pay" loading={busy}>Save payment</Button>
        </>
      }
    >
      <form id="supplier-pay" onSubmit={save} noValidate className="space-y-3">
        <Field label="Amount (Rs)" htmlFor="sp-amount" required error={error}>
          <Input id="sp-amount" inputMode="decimal" value={form.amount} onChange={set("amount")} invalid={Boolean(error)} autoFocus />
        </Field>
        <Field label="Paid by" htmlFor="sp-method">
          <Select id="sp-method" value={form.method} onChange={set("method")}>
            {Object.entries(METHOD).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        {form.method !== "cash" && (
          <Field label="Cheque or transfer number" htmlFor="sp-ref">
            <Input id="sp-ref" value={form.reference} onChange={set("reference")} maxLength={60} />
          </Field>
        )}
        {form.method === "cash" && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.fromDrawer} onChange={set("fromDrawer")} className="h-4 w-4" />
            Paid from my counter’s cash drawer (taken off at closing)
          </label>
        )}
        <Field label="Note" htmlFor="sp-note">
          <Input id="sp-note" value={form.note} onChange={set("note")} maxLength={200} />
        </Field>
      </form>
    </Modal>
  );
};

export default PharmacySupplier;
