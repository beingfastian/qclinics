import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { FaPrescriptionBottleAlt, FaPrint } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Page, PageHeader, useDialog } from "../components/ui";
import { rxGet, rxPost, PHARMACY_STATUS } from "../prescriptions/api";
import { errorText, currentRole } from "../lab/api";
import { printPrescriptionSlip } from "../components/PrintSlip";

const when = (d) => new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Prescriptions, newest first. Doctors see their own (and what the pharmacy did
// with each); reception and the admin see all, to print one again.
const Prescriptions = () => {
  const { confirm } = useDialog();
  const doctor = currentRole() === "doctor";
  const [rows, setRows] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async (cursor) => {
    const data = await rxGet("", { limit: 30, ...(cursor && { cursor }) });
    setRows((r) => (cursor ? [...r, ...data.prescriptions] : data.prescriptions));
    setNextCursor(data.nextCursor);
  }, []);
  useEffect(() => {
    load().catch((e) => {
      toast.error(errorText(e));
      setRows([]);
    });
  }, [load]);

  const act = async (rx, action) => {
    if (action === "cancel" && !(await confirm({ title: `Cancel Rx-${rx.rxNo}?`, message: "The pharmacy won't dispense it.", confirmLabel: "Cancel prescription", tone: "danger" }))) return;
    setBusy(rx._id);
    try {
      const data = await rxPost(`/${rx._id}/${action}`);
      toast.success(data.message);
      setRows((all) => all.map((r) => (r._id === rx._id ? data.prescription : r)));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page narrow>
      <PageHeader title="Prescriptions" icon={<FaPrescriptionBottleAlt />} description={doctor ? "Your prescriptions and what the pharmacy did with them." : "Every prescription, to look up or print again."} />
      <Card padded={false}>
        {rows === null ? (
          <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<FaPrescriptionBottleAlt />} title="No prescriptions yet" description={doctor ? "Write one from an appointment or the live queue." : undefined} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((rx) => {
              const ph = rx.pharmacy && PHARMACY_STATUS[rx.pharmacy.status];
              return (
                <li key={rx._id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" aria-label={`Rx-${rx.rxNo}`}>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      Rx-{rx.rxNo} · {rx.patient?.name}
                      {rx.status === "cancelled" ? (
                        <Badge className="ml-2">Cancelled</Badge>
                      ) : ph ? (
                        <Badge tone={ph.tone} className="ml-2">{ph.label}</Badge>
                      ) : rx.sentToPharmacy === false && rx.pharmacy === null ? (
                        <Badge tone="warning" className="ml-2">Not sent to the pharmacy</Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-slate-600">{rx.items.map((m) => [m.name, m.strength].filter(Boolean).join(" ")).join(", ")}</p>
                    <p className="text-xs text-slate-500">
                      {when(rx.createdAt)}
                      {!doctor && ` · Dr. ${rx.doctor?.name}`}
                      {rx.pharmacy?.closedNote && ` · pharmacy: “${rx.pharmacy.closedNote}”`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" icon={<FaPrint />} onClick={() => printPrescriptionSlip(rx) || toast.error("Allow pop-ups for this site to print")}>Print</Button>
                    {doctor && rx.status === "issued" && rx.pharmacy === null && rx.sentToPharmacy === false && (
                      <Button size="sm" onClick={() => act(rx, "send")} loading={busy === rx._id}>Send to pharmacy</Button>
                    )}
                    {doctor && rx.status === "issued" && (!rx.pharmacy || rx.pharmacy.status === "waiting") && (
                      <Button size="sm" variant="danger-outline" onClick={() => act(rx, "cancel")} disabled={busy === rx._id}>Cancel</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button size="sm" onClick={() => load(nextCursor).catch((e) => toast.error(errorText(e)))}>Show older</Button>
          </div>
        )}
      </Card>
    </Page>
  );
};

export default Prescriptions;
