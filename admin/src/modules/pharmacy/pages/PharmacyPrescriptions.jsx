import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaPrescriptionBottleAlt, FaSearch } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Input, Page, PageHeader, Segmented, useDialog } from "../../../components/ui";
import { pharmacyGet, pharmacyPost, errorText } from "../api";

const STATUS = {
  waiting: { label: "Waiting", tone: "info" },
  partly: { label: "Partly dispensed", tone: "warning" },
  dispensed: { label: "Dispensed", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
  cancelled: { label: "Cancelled by the doctor", tone: "neutral" },
};
const when = (d) => new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Prescriptions from the hospital's doctors. The queue (oldest first) is worked at
// the counter: "Dispense" loads the prescription into a bill. One the patient
// didn't buy is closed with a note (the doctor sees it).
const PharmacyPrescriptions = () => {
  const navigate = useNavigate();
  const { prompt } = useDialog();
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status, limit: "100" });
      if (q.trim()) params.set("q", q.trim());
      setRows((await pharmacyGet(`/prescriptions?${params}`)).prescriptions);
    } catch (e) {
      toast.error(errorText(e));
      setRows([]);
    }
  }, [status, q]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    // New prescriptions arrive while the page is open
    const poll = setInterval(load, 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [load]);

  const close = async (rx) => {
    const note = await prompt({ title: `Close Rx-${rx.rxNo}?`, message: "It leaves the queue. The doctor sees your note.", label: "Why", placeholder: "e.g. Patient will buy later", confirmLabel: "Close", validate: (v) => (v.trim() ? "" : "Write why") });
    if (note === null) return;
    try {
      toast.success((await pharmacyPost(`/prescriptions/${rx._id}/close`, { note })).message);
      load();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <Page narrow>
      <PageHeader title="Prescriptions" icon={<FaPrescriptionBottleAlt />} description="From the hospital's doctors. Dispense them at the counter." />
      <Card className="mb-4" padded={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input aria-label="Search prescriptions" placeholder="Patient name or Rx number" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Segmented label="Show" value={status} onChange={setStatus} options={[{ value: "open", label: "Waiting" }, { value: "all", label: "All" }]} />
        </div>
      </Card>
      <Card padded={false}>
        {rows === null ? (
          <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<FaPrescriptionBottleAlt />} title={status === "open" ? "No prescriptions waiting" : "No prescriptions"} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((rx) => {
              const open = rx.status === "waiting" || rx.status === "partly";
              return (
                <li key={rx._id} className="px-5 py-3 text-sm" aria-label={`Rx-${rx.rxNo}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        Rx-{rx.rxNo} · {rx.patient?.name} <Badge tone={STATUS[rx.status].tone}>{STATUS[rx.status].label}</Badge>
                      </p>
                      <p className="text-xs text-slate-500">
                        Dr. {rx.doctor?.name} · {when(rx.createdAt)}
                        {rx.patient?.phone && ` · ${rx.patient.phone}`}
                      </p>
                      <ul className="mt-1 text-slate-700">
                        {rx.items.map((m, i) => (
                          <li key={i}>
                            {[m.name, m.strength].filter(Boolean).join(" ")}
                            <span className="text-slate-500">
                              {[m.dose, m.days && `${m.days} days`, m.qtyUnits && `give ${m.qtyUnits}`].filter(Boolean).map((t) => ` · ${t}`).join("")}
                              {!m.productId && " · written in"}
                              {m.dispensedUnits > 0 && ` · ${m.dispensedUnits} given`}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {rx.note && <p className="mt-1 text-xs text-slate-600">“{rx.note}”</p>}
                      {rx.closedNote && <p className="mt-1 text-xs text-slate-600">Closed: {rx.closedNote}</p>}
                    </div>
                    {open && (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" variant="primary" onClick={() => navigate(`/pharmacy/counter?rx=${rx._id}`)}>Dispense</Button>
                        <Button size="sm" onClick={() => close(rx)}>Close</Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Page>
  );
};

export default PharmacyPrescriptions;
