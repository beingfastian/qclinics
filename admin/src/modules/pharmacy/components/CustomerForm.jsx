import { useState } from "react";
import { toast } from "react-toastify";
import { Button, Field, Input, Modal } from "../../../components/ui";
import { pharmacyPost, pharmacyPut, errorText, toPaisa, toRupeesText } from "../api";
import { usePharmacyAccess } from "../useAccess";

// Add or edit a khata customer. The credit limit is the manager's to set; empty
// means no limit.
const CustomerForm = ({ customer, onClose, onSaved }) => {
  const allowed = usePharmacyAccess();
  const canLimit = allowed("manageCredit");
  const [form, setForm] = useState({
    name: customer?.name || "",
    phone: customer?.phone || "",
    address: customer?.address || "",
    notes: customer?.notes || "",
    limit: customer?.creditLimitPaisa === null || customer?.creditLimitPaisa === undefined ? "" : toRupeesText(customer.creditLimitPaisa) || "0",
    active: customer?.active ?? true,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const limit = form.limit.trim() === "" ? null : toPaisa(form.limit);
    const problems = {};
    if (!form.name.trim()) problems.name = "Enter the customer's name";
    if (limit === null && form.limit.trim() !== "") problems.creditLimitPaisa = "Enter an amount like 5000, or leave it empty";
    setErrors(problems);
    if (Object.keys(problems).length) return;
    const body = {
      name: form.name.trim(),
      phone: form.phone,
      address: form.address,
      notes: form.notes,
      ...(canLimit && { creditLimitPaisa: limit }),
      ...(customer && { active: form.active }),
    };
    setBusy(true);
    try {
      const data = customer ? await pharmacyPut(`/customers/${customer._id}`, body) : await pharmacyPost("/customers", body);
      toast.success(data.message);
      onSaved(data.customer);
    } catch (err) {
      setErrors(err?.response?.data?.fields || {});
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={customer ? `Edit ${customer.name}` : "Add customer"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="customer-form" loading={busy}>{customer ? "Save" : "Add customer"}</Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={save} noValidate className="space-y-3">
        <Field label="Name" htmlFor="cu-name" required error={errors.name}>
          <Input id="cu-name" value={form.name} onChange={set("name")} invalid={Boolean(errors.name)} autoFocus autoComplete="off" />
        </Field>
        <Field label="Phone" htmlFor="cu-phone" error={errors.phone}>
          <Input id="cu-phone" value={form.phone} onChange={set("phone")} inputMode="tel" autoComplete="off" />
        </Field>
        <Field label="Address" htmlFor="cu-address">
          <Input id="cu-address" value={form.address} onChange={set("address")} autoComplete="off" />
        </Field>
        <Field label="Notes" htmlFor="cu-notes">
          <Input id="cu-notes" value={form.notes} onChange={set("notes")} autoComplete="off" />
        </Field>
        {canLimit && (
          <Field label="Credit limit (Rs)" htmlFor="cu-limit" hint="The most they may owe. Empty: no limit." error={errors.creditLimitPaisa}>
            <Input id="cu-limit" inputMode="decimal" value={form.limit} onChange={set("limit")} invalid={Boolean(errors.creditLimitPaisa)} />
          </Field>
        )}
        {customer && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.active} onChange={set("active")} className="h-4 w-4" />
            Can buy on khata (turned off: no new khata bills)
          </label>
        )}
      </form>
    </Modal>
  );
};

export default CustomerForm;
