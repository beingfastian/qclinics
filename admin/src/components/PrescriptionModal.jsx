import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { FaCheckCircle, FaPrescriptionBottleAlt, FaPrint, FaTimes, FaTrash } from "react-icons/fa";
import { Button, Field, IconButton, Input, Textarea } from "./ui";
import { rxGet, rxPost, suggestedQty, DOSES, INSTRUCTIONS } from "../prescriptions/api";
import { errorText } from "../lab/api";
import { printPrescriptionSlip } from "./PrintSlip";

// The doctor writes a prescription for the patient in front of them. With the
// hospital pharmacy on, medicines come from its list (in stock or not) and the
// prescription goes to the pharmacy; any medicine can also be written in.
// source: { appointmentId } or { queueTokenId }.
const blankLine = (m) => ({
  key: `${m.productId || m.name}-${Date.now()}-${Math.random()}`,
  productId: m.productId,
  name: m.name,
  strength: m.strength || "",
  form: m.form || "",
  inStock: m.inStock,
  dose: ["tablet", "capsule"].includes(m.form) ? "1+0+1" : "",
  days: "5",
  qty: String(suggestedQty(m.form, ["tablet", "capsule"].includes(m.form) ? "1+0+1" : "", 5) || ""),
  qtyTouched: false,
  instructions: "",
});

const PrescriptionModal = ({ source, patientName, onClose }) => {
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const search = useRef(null);
  const latest = useRef(0);

  useEffect(() => {
    search.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const text = q.trim();
    const id = ++latest.current;
    if (!text) return setFound([]);
    const timer = setTimeout(() => {
      rxGet("/medicines", { q: text })
        .then((d) => id === latest.current && setFound(d.medicines || []))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const add = (m) => {
    setLines((l) => [...l, blankLine(m)]);
    setQ("");
    setFound([]);
    search.current?.focus();
  };
  const setLine = (key, patch) =>
    setLines((all) =>
      all.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // The quantity follows dose x days until the doctor types one
        if (!next.qtyTouched) next.qty = String(suggestedQty(next.form, next.dose, Number(next.days)) || "");
        return next;
      })
    );

  const save = async () => {
    if (!lines.length) return toast.error("Add at least one medicine");
    setBusy(true);
    try {
      const data = await rxPost("", {
        ...source,
        items: lines.map((l) => ({
          ...(l.productId && { productId: l.productId }),
          name: l.name,
          strength: l.strength,
          form: l.form,
          dose: l.dose.trim(),
          ...(Number(l.days) > 0 && { days: Math.floor(Number(l.days)) }),
          ...(Number(l.qty) > 0 && { qtyUnits: Math.floor(Number(l.qty)) }),
          instructions: l.instructions.trim(),
        })),
        note: note.trim(),
      });
      toast.success(data.message);
      setSaved(data.prescription);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const print = () => printPrescriptionSlip(saved) || toast.error("Allow pop-ups for this site to print");

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Prescription" className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <FaPrescriptionBottleAlt className="text-primary-700" aria-hidden="true" /> Prescription{patientName ? ` for ${patientName}` : ""}
          </h2>
          <button type="button" onClick={onClose} className="-mr-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <FaTimes />
          </button>
        </div>

        {saved ? (
          <div className="space-y-4 p-6 text-center">
            <FaCheckCircle className="mx-auto text-4xl text-emerald-600" aria-hidden="true" />
            <p className="text-lg font-semibold text-slate-900">Rx-{saved.rxNo} {saved.sentToPharmacy ? "sent to the pharmacy" : "saved"}</p>
            <p className="text-sm text-slate-600">{saved.items.length} medicines for {saved.patient?.name}</p>
            <div className="flex justify-center gap-2">
              <Button icon={<FaPrint />} onClick={print}>Print for the patient</Button>
              <Button variant="primary" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4 overflow-y-auto p-5">
              <div className="relative">
                <Input ref={search} aria-label="Add a medicine" placeholder="Add a medicine: name or salt" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && q.trim()) {
                      e.preventDefault();
                      add(found[0] || { name: q.trim() });
                    }
                  }}
                />
                {q.trim() && (
                  <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox" aria-label="Medicines">
                    {found.map((m) => (
                      <li key={m.productId} role="option" aria-selected="false">
                        <button type="button" onClick={() => add(m)} className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50">
                          <span>
                            <span className="font-medium text-slate-900">{[m.name, m.strength].filter(Boolean).join(" ")}</span>{" "}
                            <span className="text-slate-500">{[m.form, m.salt].filter(Boolean).join(" · ")}</span>
                          </span>
                          <span className={m.inStock ? "text-emerald-700" : "text-amber-800"}>{m.inStock ? "In stock" : "Not in stock"}</span>
                        </button>
                      </li>
                    ))}
                    <li role="option" aria-selected="false">
                      <button type="button" onClick={() => add({ name: q.trim() })} className="w-full px-4 py-2 text-left text-sm text-primary-700 hover:bg-slate-50">
                        Write in “{q.trim()}”
                      </button>
                    </li>
                  </ul>
                )}
              </div>

              {lines.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Search the medicines above, or write one in.</p>
              ) : (
                <ol className="space-y-3">
                  {lines.map((l, i) => (
                    <li key={l.key} className="rounded-lg border border-slate-200 p-3" aria-label={l.name}>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          {i + 1}. {[l.name, l.strength].filter(Boolean).join(" ")}
                          {l.productId ? (
                            <span className={`ml-2 text-xs ${l.inStock ? "text-emerald-700" : "text-amber-800"}`}>{l.inStock ? "in stock" : "not in stock"}</span>
                          ) : (
                            <span className="ml-2 text-xs text-slate-500">written in</span>
                          )}
                        </p>
                        <IconButton label={`Remove ${l.name}`} icon={<FaTrash />} tone="danger" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label="Dose" htmlFor={`dose-${l.key}`} hint="morning+noon+night">
                          <Input id={`dose-${l.key}`} list="rx-doses" value={l.dose} onChange={(e) => setLine(l.key, { dose: e.target.value })} />
                        </Field>
                        <Field label="Days" htmlFor={`days-${l.key}`}>
                          <Input id={`days-${l.key}`} type="number" min="1" inputMode="numeric" value={l.days} onChange={(e) => setLine(l.key, { days: e.target.value })} />
                        </Field>
                        <Field label="Quantity" htmlFor={`qty-${l.key}`} hint="To give in all">
                          <Input id={`qty-${l.key}`} type="number" min="1" inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value, qtyTouched: true })} />
                        </Field>
                        <Field label="How to take" htmlFor={`how-${l.key}`}>
                          <Input id={`how-${l.key}`} list="rx-instructions" value={l.instructions} onChange={(e) => setLine(l.key, { instructions: e.target.value })} />
                        </Field>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <datalist id="rx-doses">{DOSES.map((d) => <option key={d} value={d} />)}</datalist>
              <datalist id="rx-instructions">{INSTRUCTIONS.map((d) => <option key={d} value={d} />)}</datalist>

              <Field label="Advice" htmlFor="rx-note">
                <Textarea id="rx-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Plenty of fluids. Come back in a week." />
              </Field>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={save} loading={busy} disabled={!lines.length}>Save prescription</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PrescriptionModal;
