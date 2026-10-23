import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { FaTimes, FaUserPlus } from "react-icons/fa";
import { Button, Field, Input, Modal } from "../../../components/ui";
import { pharmacyGet, pharmacyPost, errorText, money } from "../api";

// Who the bill is for: find a khata customer by name or phone, or add one on the
// spot. Shows what they owe and how much room is left under their limit.
export const khataText = (c) => {
  const owes = c.balancePaisa > 0 ? `owes ${money(c.balancePaisa)}` : c.balancePaisa < 0 ? `${money(-c.balancePaisa)} in advance` : "owes nothing";
  const room = c.creditLimitPaisa === null || c.creditLimitPaisa === undefined ? "" : ` · room ${money(Math.max(0, c.creditLimitPaisa - c.balancePaisa))}`;
  return owes + room;
};

const CustomerPicker = ({ value, onChange }) => {
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [adding, setAdding] = useState(null);
  const latest = useRef(0);

  useEffect(() => {
    const text = q.trim();
    const id = ++latest.current;
    if (!text) return setFound([]);
    const timer = setTimeout(() => {
      pharmacyGet(`/customers?limit=8&q=${encodeURIComponent(text)}`)
        .then((d) => id === latest.current && setFound(d.customers.filter((c) => c.active)))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const pick = (c) => {
    onChange(c);
    setQ("");
    setFound([]);
  };

  if (value) {
    return (
      <div className="flex items-start justify-between gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm" data-testid="picked-customer">
        <span>
          <span className="font-medium text-slate-900">{value.name}</span>
          {value.phone && <span className="text-slate-600"> · {value.phone}</span>}
          <span className="block text-xs text-slate-600">{khataText(value)}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="p-1 text-slate-500 hover:text-slate-900" aria-label={`Remove ${value.name} from the bill`}>
          <FaTimes />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input aria-label="Customer" placeholder="Customer: name or phone (optional)" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {q.trim() && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox" aria-label="Matching customers">
          {found.map((c) => (
            <li key={c._id} role="option" aria-selected="false">
              <button type="button" onClick={() => pick(c)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="font-medium text-slate-900">{c.name}</span> <span className="text-slate-500">{c.phone}</span>
                <span className="block text-xs text-slate-500">{khataText(c)}</span>
              </button>
            </li>
          ))}
          <li role="option" aria-selected="false">
            <button type="button" onClick={() => setAdding(/\d{3,}/.test(q) ? { name: "", phone: q.trim() } : { name: q.trim(), phone: "" })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary-700 hover:bg-slate-50">
              <FaUserPlus aria-hidden="true" /> Add a new customer
            </button>
          </li>
        </ul>
      )}
      {adding && <QuickAdd initial={adding} onClose={() => setAdding(null)} onAdded={(c) => { setAdding(null); pick(c); }} />}
    </div>
  );
};

const QuickAdd = ({ initial, onClose, onAdded }) => {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setErrors({ name: "Enter the customer's name" });
    setBusy(true);
    try {
      const data = await pharmacyPost("/customers", { name: form.name.trim(), phone: form.phone.trim() });
      toast.success(data.message);
      onAdded(data.customer);
    } catch (err) {
      setErrors(err?.response?.data?.fields || {});
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New customer"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="quick-customer" loading={busy}>Add customer</Button>
        </>
      }
    >
      <form id="quick-customer" onSubmit={save} noValidate className="space-y-3">
        <Field label="Name" htmlFor="qc-name" required error={errors.name}>
          <Input id="qc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={Boolean(errors.name)} autoFocus autoComplete="off" />
        </Field>
        <Field label="Phone" htmlFor="qc-phone" error={errors.phone}>
          <Input id="qc-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" autoComplete="off" />
        </Field>
        <p className="text-xs text-slate-500">The manager can set a credit limit later.</p>
      </form>
    </Modal>
  );
};

export default CustomerPicker;
