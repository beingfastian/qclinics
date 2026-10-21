import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { FaUserPlus, FaUsersCog } from "react-icons/fa";
import { useDialog } from "../../../components/ui/Dialog";
import { Badge, Button, Card, EmptyState, Field, Input, Select } from "../../../components/ui";
import { pharmacyGet, pharmacyPost, pharmacyPut, errorText, ROLE_LABEL } from "../api";

// Owner: pharmacy staff logins. They sign in on the same login page and see only the
// pharmacy. Manager: runs the pharmacy (stock, prices, purchases, profit). Cashier:
// sells at the counter.
const emptyForm = { name: "", email: "", phone: "", password: "", role: "cashier" };

const PharmacyStaff = () => {
  const { confirm, prompt } = useDialog();
  const [staff, setStaff] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStaff((await pharmacyGet("/staff")).staff);
    } catch (e) {
      toast.error(errorText(e));
      setStaff([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // One change at a time; the server's message is shown either way
  const run = async (fn) => {
    if (busy) return false;
    setBusy(true);
    try {
      const data = await fn();
      toast.success(data.message);
      await load();
      return true;
    } catch (e) {
      setFieldErrors(e?.response?.data?.fields || {});
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    setFieldErrors({});
    if (await run(() => pharmacyPost("/staff", form))) setForm(emptyForm);
  };

  const changeRole = (s, role) => run(() => pharmacyPut(`/staff/${s._id}`, { role }));

  const toggleActive = async (s) => {
    if (s.active) {
      const ok = await confirm({
        title: `Turn off ${s.name}'s login?`,
        message: "They are signed out at once and can't sign in until you turn it back on.",
        confirmLabel: "Turn off",
        tone: "danger",
      });
      if (!ok) return;
    }
    await run(() => pharmacyPut(`/staff/${s._id}`, { active: !s.active }));
  };

  const resetPassword = async (s) => {
    const password = await prompt({
      title: `New password for ${s.name}`,
      message: "Give the new password to them in person. Their current password stops working.",
      label: "New password",
      inputType: "password",
      confirmLabel: "Set password",
      validate: (v) => (v.length < 8 ? "Use at least 8 characters" : ""),
    });
    if (password === null) return;
    await run(() => pharmacyPut(`/staff/${s._id}`, { password }));
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">Pharmacy staff</h1>
        <p className="mt-1 text-sm text-slate-600">
          Logins for the pharmacy. They sign in on the same page and only see the pharmacy.
        </p>
      </div>

      <Card className="mb-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
          <FaUserPlus aria-hidden="true" /> Add a pharmacy login
        </h2>
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
          <Field label="Name" htmlFor="ps-name" required error={fieldErrors.name}>
            <Input id="ps-name" value={form.name} onChange={set("name")} invalid={Boolean(fieldErrors.name)} autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="ps-email" required error={fieldErrors.email}>
            <Input id="ps-email" type="email" value={form.email} onChange={set("email")} invalid={Boolean(fieldErrors.email)} autoComplete="off" />
          </Field>
          <Field label="Password" htmlFor="ps-password" required hint="At least 8 characters" error={fieldErrors.password}>
            <Input id="ps-password" type="password" value={form.password} onChange={set("password")} invalid={Boolean(fieldErrors.password)} autoComplete="new-password" />
          </Field>
          <Field label="Phone" htmlFor="ps-phone" error={fieldErrors.phone}>
            <Input id="ps-phone" value={form.phone} onChange={set("phone")} autoComplete="off" />
          </Field>
          <Field label="Role" htmlFor="ps-role" required error={fieldErrors.role}>
            <Select id="ps-role" value={form.role} onChange={set("role")}>
              <option value="cashier">Cashier: sells at the counter</option>
              <option value="manager">Manager: stock, prices, purchases, profit</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Add login"}
            </Button>
          </div>
        </form>
      </Card>

      <Card padded={false}>
        {staff === null ? (
          <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
        ) : staff.length === 0 ? (
          <EmptyState icon={<FaUsersCog />} title="No pharmacy logins yet" description="Add the people who work at the pharmacy above." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {staff.map((s) => (
              <li key={s._id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-slate-900">
                    {s.name}
                    {!s.active && <Badge tone="neutral">Turned off</Badge>}
                  </p>
                  <p className="truncate text-sm text-slate-600">
                    {s.email}
                    {s.phone && ` · ${s.phone}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select aria-label={`Role of ${s.name}`} value={s.role} onChange={(e) => changeRole(s, e.target.value)} disabled={busy} className="w-48">
                    <option value="cashier">{ROLE_LABEL.cashier}</option>
                    <option value="manager">{ROLE_LABEL.manager}</option>
                  </Select>
                  <Button size="sm" onClick={() => resetPassword(s)} disabled={busy}>
                    New password
                  </Button>
                  <Button size="sm" onClick={() => toggleActive(s)} disabled={busy}>
                    {s.active ? "Turn off" : "Turn on"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default PharmacyStaff;
