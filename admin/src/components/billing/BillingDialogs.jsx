import { useEffect, useMemo, useRef, useState } from "react";
import { FaMoneyBillWave, FaUniversity, FaCheckCircle, FaPrint, FaTimes } from "react-icons/fa";
import { Button, Field, Input, Select, Segmented } from "../ui";
import { openPrintWindow } from "../PrintSlip";
import { billingGet, billingPost, errorText, newRequestId, rs, setDesk, useDesk } from "../../billing/api";

// A simple modal frame for the billing dialogs (Escape and the backdrop close it)
export const Modal = ({ title, onClose, children, footer, wide = false }) => {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-xl" : "max-w-md"} max-h-[92vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
            <FaTimes />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

// Which counter this computer is, and who is at it. Saved on this computer only.
export const DeskFields = ({ settings, value, onChange }) => {
  const counters = settings?.counters?.filter((c) => c.active) || [];
  const names = settings?.staff.filter((s) => s.active) || [];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Counter" htmlFor="desk-counter" hint="The cash drawer at this computer">
        <Select id="desk-counter" value={value.counterId} onChange={(e) => onChange({ ...value, counterId: e.target.value })}>
          <option value="">Choose…</option>
          {counters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Your name" htmlFor="desk-name" hint="Printed on receipts">
        {names.length ? (
          <Select id="desk-name" value={value.staffName} onChange={(e) => onChange({ ...value, staffName: e.target.value })}>
            <option value="">Choose…</option>
            {names.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </Select>
        ) : (
          <Input id="desk-name" value={value.staffName} maxLength={40} onChange={(e) => onChange({ ...value, staffName: e.target.value })} placeholder="e.g. Ayesha" />
        )}
      </Field>
    </div>
  );
};

export const DeskDialog = ({ onClose }) => {
  const { settings, desk } = useDesk();
  const [value, setValue] = useState(desk);
  const save = () => {
    setDesk(value);
    onClose();
  };
  return (
    <Modal
      title="Who's at this counter?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!value.counterId || !value.staffName.trim()} onClick={save}>Save</Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">Pick these once on this computer. Change them when someone else takes over the counter.</p>
      {settings ? <DeskFields settings={settings} value={value} onChange={setValue} /> : <p className="text-sm text-slate-500">Loading…</p>}
    </Modal>
  );
};

// Collect the fee for a visit ({ appointmentId }) or the charges of a lab request
// ({ labOrderId }). onPaid(payment, printWindow) is called after the receipt is
// saved; onLater(printWindow) when reception chooses "Collect later".
// print: open a print window inside the button click (so it isn't blocked).
export const CollectDialog = ({ target, doctors = [], print = true, onPaid, onLater, onClose, laterLabel = "Collect later" }) => {
  const { settings, desk, ready } = useDesk();
  const [deskValue, setDeskValue] = useState(desk);
  const [due, setDue] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [prices, setPrices] = useState([]);
  const [discount, setDiscount] = useState("");
  const [allowedBy, setAllowedBy] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(null);
  // Same id for every retry of this dialog, so a slow connection can't make two receipts
  const requestId = useRef(newRequestId());

  useEffect(() => {
    let alive = true;
    billingGet("/due-for", target)
      .then((data) => {
        if (!alive) return;
        if (!data.success) return setLoadError(data.message);
        setDue(data.due);
        setAllowedBy(data.due.docId || "");
        if (data.due.kind === "lab") setPrices(data.due.items.map((i) => (typeof i.price === "number" ? String(i.price) : "")));
      })
      .catch((e) => alive && setLoadError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [target.appointmentId, target.labOrderId]);

  useEffect(() => setDeskValue(desk), [desk.counterId, desk.staffName]);

  const gross = useMemo(() => {
    if (!due) return 0;
    if (due.kind === "lab") return prices.reduce((s, p) => s + (Number(p) || 0), 0);
    return due.amount || 0;
  }, [due, prices]);
  const discountRs = Math.max(0, Math.round(Number(discount) || 0));
  const net = Math.max(0, gross - discountRs);
  const deskOk = ready || (deskValue.counterId && deskValue.staffName.trim());
  const pricesOk = due?.kind !== "lab" || prices.every((p) => p !== "" && Number(p) >= 0);

  const submit = async () => {
    setError("");
    if (!deskOk) return setError("Choose the counter and your name");
    if (!pricesOk) return setError("Enter a price for every test");
    if (discountRs > gross) return setError("The discount can't be more than the amount");
    if (discountRs > 0 && !allowedBy) return setError("Choose the doctor who allowed the discount");
    if (!ready) setDesk(deskValue);
    const win = print ? openPrintWindow() : null;
    setBusy(true);
    try {
      const data = await billingPost("/collect", {
        ...target,
        ...(due.kind === "lab" && { items: due.items.map((i, index) => ({ label: i.label, amount: Number(prices[index]) })) }),
        discount: discountRs,
        ...(discountRs > 0 && { discountAllowedBy: allowedBy, discountReason: reason }),
        method,
        reference: method === "bank_transfer" ? reference : "",
        counterId: deskValue.counterId,
        staffName: deskValue.staffName.trim(),
        requestId: requestId.current,
      });
      if (data.success) {
        onPaid(data.payment, win);
        return;
      }
      win?.close();
      if (data.code === "already_paid") setAlreadyPaid(data.payment || null);
      setError(data.message);
    } catch (e) {
      win?.close();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const later = () => onLater?.(print ? openPrintWindow() : null);
  const title = due?.kind === "lab" ? `Lab charges · L-${due.orderNumber}` : "Collect fee";

  if (loadError) {
    return (
      <Modal title="Collect" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
        <p className="text-sm text-red-700">{loadError}</p>
      </Modal>
    );
  }
  if (!due) {
    return (
      <Modal title="Collect" onClose={onClose}>
        <p className="text-sm text-slate-500">Loading…</p>
      </Modal>
    );
  }

  // Paid already (e.g. by the other receptionist): offer the receipt, not a second charge
  const paid = alreadyPaid || (due.paid && { receiptNo: due.paid.receiptNo, net: due.paid.net, collectedBy: { name: due.paid.by } });
  if (paid || due.cancelled) {
    return (
      <Modal
        title={title}
        onClose={onClose}
        footer={
          <>
            {onLater && <Button onClick={later}>{paid ? "Print token only" : laterLabel}</Button>}
            <Button variant="primary" onClick={onClose}>Done</Button>
          </>
        }
      >
        {paid ? (
          <p className="flex items-start gap-2 text-sm text-emerald-800">
            <FaCheckCircle className="mt-0.5 shrink-0" />
            <span>
              Already paid: receipt {paid.receiptNo} ({rs(paid.net)}){paid.collectedBy?.name ? ` by ${paid.collectedBy.name}` : ""}. Nothing more to collect.
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate-700">This was cancelled, so nothing is due.</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {onLater && <Button onClick={later} disabled={busy}>{laterLabel}</Button>}
          <Button variant="primary" icon={<FaPrint />} loading={busy} onClick={submit}>
            Collect {rs(net)}{print ? " & print" : ""}
          </Button>
        </>
      }
    >
      <div className="text-sm">
        <p className="font-medium text-slate-900">{due.patientName}</p>
        {due.doctorName && <p className="text-slate-600">Dr. {due.doctorName}</p>}
      </div>

      {due.kind === "lab" ? (
        <div className="space-y-2">
          {due.items.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex items-center justify-between gap-3">
              <label htmlFor={`price-${index}`} className="text-sm text-slate-700">{item.label}</label>
              <div className="flex items-center gap-1 w-32">
                <span className="text-sm text-slate-500">Rs</span>
                <Input
                  id={`price-${index}`}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={prices[index]}
                  onChange={(e) => setPrices(prices.map((p, i) => (i === index ? e.target.value : p)))}
                  placeholder="Price"
                />
              </div>
            </div>
          ))}
          {due.items.some((i) => typeof i.price !== "number") && (
            <p className="text-xs text-amber-800">Some tests have no price in the test list. Enter what the patient pays.</p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">Consultation fee</span>
          <span className="font-semibold text-slate-900">{rs(gross)}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Discount (Rs)" htmlFor="pay-discount" hint="Only if the doctor allowed it">
          <Input id="pay-discount" type="number" min="0" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
        </Field>
        {discountRs > 0 && (
          <Field label="Allowed by" htmlFor="pay-allowed" required>
            <Select id="pay-allowed" value={allowedBy} onChange={(e) => setAllowedBy(e.target.value)}>
              <option value="">Choose doctor…</option>
              {doctors.map((d) => (
                <option key={d._id} value={d._id}>Dr. {d.name}</option>
              ))}
            </Select>
          </Field>
        )}
        {discountRs > 0 && (
          <Field label="Reason (optional)" htmlFor="pay-reason" className="sm:col-span-2">
            <Input id="pay-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. staff family" />
          </Field>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700 mb-1">Payment</p>
        <Segmented
          label="Payment method"
          value={method}
          onChange={setMethod}
          options={[
            { value: "cash", label: "Cash" },
            { value: "bank_transfer", label: "Bank transfer" },
          ]}
        />
        {method === "bank_transfer" && (
          <Field label="Transaction ID" htmlFor="pay-ref" hint="From the patient's banking app (recommended)" className="mt-3">
            <Input id="pay-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
      </div>

      {!ready && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-sm text-amber-900">First time on this computer: choose the counter and your name.</p>
          {settings ? <DeskFields settings={settings} value={deskValue} onChange={setDeskValue} /> : <p className="text-sm">Loading…</p>}
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
        <span className="text-sm text-slate-600 flex items-center gap-2">
          {method === "cash" ? <FaMoneyBillWave aria-hidden="true" /> : <FaUniversity aria-hidden="true" />} To collect
        </span>
        <span className="text-xl font-semibold text-slate-900 tabular-nums">{rs(net)}</span>
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </Modal>
  );
};
