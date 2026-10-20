import { useCallback, useContext, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { FaCashRegister, FaFlask, FaPrint, FaSearch, FaSyncAlt, FaUndo, FaUserEdit, FaListOl } from "react-icons/fa";
import { AdminContext } from "../context/AdminContext";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Page, PageHeader, Segmented, Select, Skeleton, Textarea } from "../components/ui";
import { CollectDialog, DeskDialog, Modal } from "../components/billing/BillingDialogs";
import { openPrintWindow, printReceiptSlip } from "../components/PrintSlip";
import { METHOD_LABEL, billingGet, billingPost, dateTime, errorText, rs, time, useDesk } from "../billing/api";

// Billing at reception: collect what's due, find and reprint receipts, and close
// (count) this counter's drawer. The owner also refunds from here.
const NOTE_VALUES = [5000, 1000, 500, 100, 50, 20, 10];
const TOAST = { autoClose: 3000, position: "bottom-right" };

const DueTab = ({ doctors, onChanged }) => {
  const [due, setDue] = useState(null);
  const [error, setError] = useState("");
  const [collect, setCollect] = useState(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await billingGet("/due");
      if (data.success) {
        setDue(data.due);
        setError("");
      } else setError(data.message);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  const match = (row) => {
    const text = query.trim().toLowerCase();
    if (!text) return true;
    const digits = text.replace(/\D/g, "");
    return (
      row.patientName.toLowerCase().includes(text) ||
      (digits.length >= 4 && (row.phone || "").replace(/\D/g, "").includes(digits)) ||
      (row.orderNumber && `l-${row.orderNumber}` === text.replace(/\s/g, "")) ||
      (row.tokenNumber && String(row.tokenNumber) === text)
    );
  };

  const visits = (due?.visits || []).filter(match);
  const lab = (due?.lab || []).filter(match);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Patient name, phone, token or L-number" className="pl-9" aria-label="Search what's due" />
        </div>
        <Button icon={<FaSyncAlt />} onClick={load}>Refresh</Button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Lab charges" description="Tests the doctors requested. Collect after the patient gives samples." />
        </div>
        {!due ? (
          <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div>
        ) : lab.length ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {lab.map((o) => (
              <li key={o.labOrderId} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <span className="font-mono text-sm text-slate-500 sm:w-16">L-{o.orderNumber}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{o.patientName} {o.urgent && <Badge tone="danger">Urgent</Badge>}</p>
                  <p className="text-sm text-slate-600 truncate">{o.items.map((i) => i.label).join(" · ")}</p>
                  <p className="text-xs text-slate-500">Dr. {o.doctorName} · {dateTime(o.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <span className="font-semibold tabular-nums text-slate-900">{o.total === null ? "Price needed" : rs(o.total)}</span>
                  <Button variant="primary" size="sm" onClick={() => setCollect({ labOrderId: o.labOrderId })}>Collect</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<FaFlask />} title="No lab charges due" description="Requests from doctors appear here until they're paid." />
        )}
      </Card>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Consultation fees not collected" description="Patients in today's queue whose fee wasn't collected at the token" />
        </div>
        {!due ? (
          <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div>
        ) : visits.length ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {visits.map((v) => (
              <li key={v.appointmentId} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <span className="text-2xl font-bold text-slate-900 sm:w-16">{v.tokenNumber}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{v.patientName}</p>
                  <p className="text-xs text-slate-500">Dr. {v.doctorName} · token at {time(v.issuedAt)}</p>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <span className="font-semibold tabular-nums text-slate-900">{rs(v.amount)}</span>
                  <Button variant="primary" size="sm" onClick={() => setCollect({ appointmentId: v.appointmentId })}>Collect</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<FaListOl />} title="Nothing to collect" description="Every patient in today's queue has paid." />
        )}
      </Card>

      {collect && (
        <CollectDialog
          target={collect}
          doctors={doctors}
          onPaid={(payment, win) => {
            setCollect(null);
            toast.success(`Receipt ${payment.receiptNo} saved`, TOAST);
            if (win) printReceiptSlip(payment, win);
            load();
            onChanged();
          }}
          onClose={() => setCollect(null)}
        />
      )}
    </div>
  );
};

const RefundDialog = ({ payment, counters, onDone, onClose }) => {
  const left = payment.net - (payment.refunded || 0);
  const [amount, setAmount] = useState(String(left));
  const [reason, setReason] = useState("");
  const [counterId, setCounterId] = useState(payment.counterId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await billingPost(`/payments/${payment._id}/refund`, { amount: Number(amount), reason, counterId });
      if (data.success) {
        toast.success(data.message, TOAST);
        onDone();
      } else setError(data.message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Refund receipt ${payment.receiptNo}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim() || !(Number(amount) > 0)} onClick={submit}>Refund {rs(Number(amount) || 0)}</Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {payment.patient?.name} · paid {rs(payment.net)} by {METHOD_LABEL[payment.method]}
        {payment.refunded ? ` · ${rs(payment.refunded)} already refunded` : ""}
      </p>
      <Field label="Amount (Rs)" htmlFor="refund-amount" hint={`At most ${rs(left)}`}>
        <Input id="refund-amount" type="number" min="1" max={left} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Reason" htmlFor="refund-reason" required>
        <Input id="refund-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong doctor, test not done" />
      </Field>
      {payment.method === "cash" && (
        <Field label="Cash given back from" htmlFor="refund-counter">
          <Select id="refund-counter" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
            {counters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      )}
      <p className="text-xs text-slate-500">The receipt stays on record with the refund and its reason. The visit itself is not changed.</p>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </Modal>
  );
};

const STATUS_BADGE = {
  paid: null,
  partly_refunded: <Badge tone="warning">Partly refunded</Badge>,
  refunded: <Badge tone="danger">Refunded</Badge>,
};

const ReceiptsTab = ({ owner, counters, refreshKey }) => {
  const [list, setList] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refundFor, setRefundFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await billingGet("/receipts", { q: query || undefined });
      if (data.success) {
        setList(data.receipts);
        setError("");
      } else setError(data.message);
    } catch (e) {
      setError(errorText(e));
    }
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const reprint = (payment) => {
    if (!printReceiptSlip(payment, openPrintWindow())) toast.error("The print window was blocked. Allow pop-ups for this site.");
  };

  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader
          title="Today's receipts"
          description={owner ? "Refund a receipt with a reason. Older days are on the Money page." : "Print a receipt again. Only the owner can refund."}
          actions={
            <div className="relative w-64 max-w-full">
              <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Receipt no., name or phone" className="pl-9" aria-label="Search receipts" />
            </div>
          }
        />
      </div>
      {error && <p className="px-5 pb-3 text-sm text-red-700">{error}</p>}
      {!list ? (
        <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div>
      ) : list.length ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {list.map((p) => (
            <li key={p._id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="sm:w-32">
                <p className="font-mono text-sm text-slate-900">{p.receiptNo}</p>
                <p className="text-xs text-slate-500">{time(p.collectedAt)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 truncate">
                  {p.patient?.name} {STATUS_BADGE[p.status]}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {p.kind === "lab" ? `Lab L-${p.labOrderNumber}` : `Dr. ${p.doctorName}`} · {METHOD_LABEL[p.method]} · {p.counterName} · {p.collectedBy?.name}
                  {p.discount > 0 ? ` · discount ${rs(p.discount)} (Dr. ${p.discountAllowedBy?.name})` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="font-semibold tabular-nums text-slate-900">{rs(p.net)}</span>
                <Button size="sm" icon={<FaPrint />} onClick={() => reprint(p)}>Print</Button>
                {owner && p.status !== "refunded" && (
                  <Button size="sm" variant="danger-outline" icon={<FaUndo />} onClick={() => setRefundFor(p)}>Refund</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<FaCashRegister />} title={query ? "No receipts match" : "No receipts yet today"} />
      )}
      {refundFor && (
        <RefundDialog
          payment={refundFor}
          counters={counters}
          onClose={() => setRefundFor(null)}
          onDone={() => {
            setRefundFor(null);
            load();
          }}
        />
      )}
    </Card>
  );
};

const CloseTab = ({ counter, staffName, onChangeDesk }) => {
  const [preview, setPreview] = useState(null);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState({});
  const [useNotes, setUseNotes] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    if (!counter) return;
    try {
      const data = await billingGet("/close-preview", { counterId: counter.id });
      if (data.success) setPreview(data.preview);
      else setError(data.message);
    } catch (e) {
      setError(errorText(e));
    }
  }, [counter]);

  useEffect(() => {
    load();
  }, [load]);

  const notesTotal = NOTE_VALUES.reduce((s, v) => s + v * (Number(notes[v]) || 0), 0);
  const countedValue = useNotes ? notesTotal : Number(counted);
  const hasCount = useNotes || counted !== "";
  const difference = preview && hasCount ? countedValue - preview.expected : null;

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const data = await billingPost("/close", {
        counterId: counter.id,
        countedCash: countedValue,
        ...(useNotes && { notes: Object.fromEntries(Object.entries(notes).filter(([, n]) => Number(n) > 0)) }),
        note,
        staffName,
      });
      if (data.success) {
        setDone(data.close);
        setCounted("");
        setNotes({});
        setNote("");
        load();
      } else {
        setError(data.message);
        load();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!counter) {
    return (
      <Card>
        <EmptyState
          icon={<FaCashRegister />}
          title="Choose this computer's counter"
          description="Closing counts the cash drawer of one counter."
          action={<Button variant="primary" onClick={onChangeDesk}>Choose counter</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader
          title={`Close ${counter.name}`}
          description={preview?.from ? `Everything since the last close at ${dateTime(preview.from)}` : "Everything since this counter started"}
          actions={<Button size="sm" icon={<FaSyncAlt />} onClick={load}>Refresh</Button>}
        />
        {!preview ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Receipts</dt><dd className="tabular-nums">{preview.receipts}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Cash collected</dt><dd className="tabular-nums">{rs(preview.cashIn)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Cash refunded</dt><dd className="tabular-nums">− {rs(preview.cashRefunds)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold"><dt>Should be in the drawer</dt><dd className="tabular-nums">{rs(preview.expected)}</dd></div>
            <div className="flex justify-between text-slate-500"><dt>Bank transfers (not in the drawer)</dt><dd className="tabular-nums">{rs(preview.bankTransfers)}</dd></div>
          </dl>
        )}
      </Card>

      <Card>
        <CardHeader title="Count the drawer" description="Count the cash, enter it and save. The owner then verifies it." />
        <div className="space-y-3">
          <Segmented
            label="How to count"
            value={useNotes ? "notes" : "total"}
            onChange={(v) => setUseNotes(v === "notes")}
            options={[
              { value: "total", label: "Enter total" },
              { value: "notes", label: "Count notes" },
            ]}
          />
          {useNotes ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {NOTE_VALUES.map((v) => (
                <Field key={v} label={`Rs ${v} ×`} htmlFor={`note-${v}`}>
                  <Input id={`note-${v}`} type="number" min="0" inputMode="numeric" value={notes[v] || ""} onChange={(e) => setNotes({ ...notes, [v]: e.target.value })} />
                </Field>
              ))}
              <p className="col-span-full text-sm text-slate-700">Total counted: <span className="font-semibold">{rs(notesTotal)}</span></p>
            </div>
          ) : (
            <Field label="Cash counted (Rs)" htmlFor="close-counted">
              <Input id="close-counted" type="number" min="0" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
            </Field>
          )}
          {difference !== null && difference !== 0 && (
            <p className={`text-sm font-medium ${difference < 0 ? "text-red-700" : "text-amber-800"}`}>
              {difference < 0 ? `Short by ${rs(-difference)}` : `Extra ${rs(difference)}`}. Write a note to explain.
            </p>
          )}
          <Field label={difference ? "Note (required)" : "Note (optional)"} htmlFor="close-note">
            <Textarea id="close-note" rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Rs 500 change given wrongly" />
          </Field>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          <Button
            variant="primary"
            loading={busy}
            disabled={!preview || (!useNotes && counted === "") || (Boolean(difference) && !note.trim())}
            onClick={submit}
          >
            Close counter
          </Button>
        </div>
      </Card>

      {done && (
        <Modal title="Counter closed" onClose={() => setDone(null)} footer={<Button variant="primary" onClick={() => setDone(null)}>Done</Button>}>
          <p className="text-sm text-slate-700">
            {done.counterName}: expected {rs(done.expected)}, counted {rs(done.countedCash)}.{" "}
            {done.difference === 0 ? "The drawer matches." : `Difference ${rs(done.difference)}.`}
          </p>
          <p className="text-sm text-slate-600">Hand the cash to the owner. They&apos;ll mark it verified.</p>
        </Modal>
      )}
    </div>
  );
};

const Billing = () => {
  const { doctors, getAllDoctors, isOwner } = useContext(AdminContext);
  const { settings, desk, counter } = useDesk();
  const [tab, setTab] = useState("due");
  const [deskOpen, setDeskOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    getAllDoctors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Page>
      <PageHeader
        title="Billing"
        icon={<FaCashRegister />}
        description="Collect fees and lab charges, print receipts and close the counter"
        actions={
          <Button icon={<FaUserEdit />} onClick={() => setDeskOpen(true)}>
            {counter ? `${counter.name} · ${desk.staffName || "?"}` : "Choose counter"}
          </Button>
        }
      />
      <div className="mb-4">
        <Segmented
          label="Billing sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: "due", label: "To collect" },
            { value: "receipts", label: "Receipts" },
            { value: "close", label: "Close counter" },
          ]}
        />
      </div>
      {tab === "due" && <DueTab doctors={doctors} onChanged={() => setRefreshKey((k) => k + 1)} />}
      {tab === "receipts" && <ReceiptsTab owner={isOwner} counters={settings?.counters.filter((c) => c.active) || []} refreshKey={refreshKey} />}
      {tab === "close" && <CloseTab counter={counter} staffName={desk.staffName} onChangeDesk={() => setDeskOpen(true)} />}
      {deskOpen && <DeskDialog onClose={() => setDeskOpen(false)} />}
    </Page>
  );
};

export default Billing;
