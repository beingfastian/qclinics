import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FaPlus, FaTruck } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Page, PageHeader } from "../../../components/ui";
import { pharmacyGet, pharmacyPost, pharmacyPut, errorText, money } from "../api";

// Suppliers (distributors) purchases are entered against. Turned-off suppliers stay
// on old purchases but can't be chosen for new ones.
const empty = { name: "", phone: "", address: "", notes: "" };

const SupplierForm = ({ supplier, onClose, onSaved }) => {
  const [form, setForm] = useState(() => ({ ...empty, ...supplier }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setErrors({ name: "Enter the supplier name" });
    setBusy(true);
    try {
      const body = { name: form.name, phone: form.phone, address: form.address, notes: form.notes };
      const data = supplier ? await pharmacyPut(`/suppliers/${supplier._id}`, body) : await pharmacyPost("/suppliers", body);
      toast.success(data.message);
      onSaved();
    } catch (error) {
      setErrors(error?.response?.data?.fields || {});
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={supplier ? `Edit ${supplier.name}` : "Add supplier"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="supplier-form" loading={busy}>{supplier ? "Save" : "Add supplier"}</Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={save} noValidate className="space-y-3">
        <Field label="Name" htmlFor="sup-name" required error={errors.name}>
          <Input id="sup-name" value={form.name} onChange={set("name")} invalid={Boolean(errors.name)} autoComplete="off" autoFocus />
        </Field>
        <Field label="Phone" htmlFor="sup-phone" error={errors.phone}>
          <Input id="sup-phone" value={form.phone} onChange={set("phone")} autoComplete="off" />
        </Field>
        <Field label="Address" htmlFor="sup-address" error={errors.address}>
          <Input id="sup-address" value={form.address} onChange={set("address")} autoComplete="off" />
        </Field>
        <Field label="Notes" htmlFor="sup-notes" hint="e.g. the salesman's name, order days" error={errors.notes}>
          <Input id="sup-notes" value={form.notes} onChange={set("notes")} autoComplete="off" />
        </Field>
      </form>
    </Modal>
  );
};

const PharmacySuppliers = () => {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null); // {} to add, a supplier to edit
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await pharmacyGet("/suppliers")).suppliers);
    } catch (e) {
      toast.error(errorText(e));
      setRows([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (s) => {
    setBusy(true);
    try {
      toast.success((await pharmacyPut(`/suppliers/${s._id}`, { active: !s.active })).message);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page narrow>
      <PageHeader
        title="Suppliers"
        icon={<FaTruck />}
        description="The distributors you buy from."
        actions={<Button variant="primary" icon={<FaPlus />} onClick={() => setEditing({})}>Add supplier</Button>}
      />
      <Card padded={false}>
        {rows === null ? (
          <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<FaTruck />} title="No suppliers yet" description="Add a supplier before entering a purchase." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((s) => (
              <li key={s._id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-slate-900">
                    <Link to={`/pharmacy/suppliers/${s._id}`} className="text-primary-700 underline">{s.name}</Link> {!s.active && <Badge>Turned off</Badge>}
                    {s.balancePaisa > 0 && <Badge tone="warning">We owe {money(s.balancePaisa)}</Badge>}
                  </p>
                  <p className="truncate text-sm text-slate-600">{[s.phone, s.address, s.notes].filter(Boolean).join(" · ") || " "}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setEditing(s)} disabled={busy}>Edit</Button>
                  <Button size="sm" onClick={() => toggle(s)} disabled={busy}>{s.active ? "Turn off" : "Turn on"}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <SupplierForm
          supplier={editing._id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </Page>
  );
};

export default PharmacySuppliers;
