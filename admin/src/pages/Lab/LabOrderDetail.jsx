import { useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "../../components/ui/Dialog";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArrowLeft,
  FaExclamationTriangle,
  FaFileUpload,
  FaExternalLinkAlt,
  FaCheck,
  FaUndo,
  FaTimes,
  FaPrint,
} from "react-icons/fa";
import { labGet, labPost, currentRole, STATUS, when, ageFrom, errorText, openReport, reportUrl, labChanged } from "../../lab/api";
import { printLabRequestSlip } from "../../components/PrintSlip";
import { deskRole, useBillingEnabled } from "../../billing/api";
import { PaidBadge } from "../../components/billing/PaidBadge";

const BACK = { lab: "/lab", doctor: "/doctor/lab-reports", admin: "/lab-requests" };
const ACTION_TEXT = {
  ordered: "Requested",
  report_uploaded: "Report uploaded",
  report_replaced: "Report replaced",
  returned: "Returned to lab",
  approved: "Approved",
  cancelled: "Cancelled",
};

const Field = ({ label, children }) => (
  <div>
    <p className="text-xs text-gray-500">{label}</p>
    <p className="text-sm font-medium text-gray-900 break-words">{children || "—"}</p>
  </div>
);

const LabOrderDetail = () => {
  const { prompt } = useDialog();
  const { id } = useParams();
  const role = currentRole() || "lab";
  const billingEnabled = useBillingEnabled();
  const [order, setOrder] = useState(null);
  const [patient, setPatient] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [labNote, setLabNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [preview, setPreview] = useState(null); // { url, mimeType } of the newest report
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await labGet(`/orders/${id}`);
      if (!data.success) {
        setError(data.message);
        return;
      }
      setOrder(data.order);
      setPatient(data.patient);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Show the newest report inside the page (doctor reviewing, or lab checking its upload)
  const newest = order?.reports?.[order.reports.length - 1];
  useEffect(() => {
    if (!newest) {
      setPreview(null);
      return;
    }
    let alive = true;
    reportUrl(id, newest._id)
      .then((url) => alive && setPreview({ url, mimeType: newest.mimeType }))
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [id, newest?._id]);

  const run = async (fn, success) => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await fn();
      if (!data.success) {
        toast.error(data.message);
        await load(); // e.g. the lab uploaded a newer report: show it
      } else {
        toast.success(success || data.message);
        labChanged();
        await load();
      }
      return data.success;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error("Please choose the report file (PDF or photo)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("The file is bigger than 10 MB. Please upload a smaller PDF or photo.");
      return;
    }
    const form = new FormData();
    form.append("report", file);
    if (labNote.trim()) form.append("note", labNote.trim());
    const ok = await run(() => labPost(`/orders/${id}/report`, form), "Report sent to the doctor");
    if (ok) {
      setFile(null);
      setLabNote("");
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const review = (decision) => {
    if (decision === "return" && !reviewNote.trim()) {
      toast.error("Write what the lab should check or redo");
      return;
    }
    run(() => labPost(`/orders/${id}/review`, { decision, note: reviewNote.trim(), reportId: newest?._id })).then(
      (ok) => ok && setReviewNote("")
    );
  };

  const cancel = async () => {
    const note = await prompt({
      title: "Cancel this lab request?",
      message: "The lab is told it is no longer needed.",
      label: "Reason (optional)",
      placeholder: "e.g. Ordered by mistake",
      confirmLabel: "Cancel request",
      cancelLabel: "Keep request",
      tone: "danger",
    });
    if (note === null) return;
    run(() => labPost(`/orders/${id}/cancel`, { note }));
  };

  const view = async (reportId) => {
    const problem = await openReport(id, reportId);
    if (problem) toast.error(problem);
  };

  if (error) {
    return (
      <div className="p-6">
        <Link to={BACK[role]} className="text-primary inline-flex items-center gap-2 mb-4"><FaArrowLeft /> Back</Link>
        <p className="text-red-700">{error}</p>
      </div>
    );
  }
  if (!order) return <div className="p-6 text-gray-500">Loading…</div>;

  const status = STATUS[order.status] || {};
  const canUpload = role === "lab" && ["ordered", "returned", "report_uploaded"].includes(order.status);
  const canReview = role === "doctor" && order.status === "report_uploaded";
  // The shared reception login can't cancel requests (the doctor or the owner can)
  const canCancel =
    (role === "doctor" || (role === "admin" && deskRole() === "admin")) && ["ordered", "returned", "report_uploaded"].includes(order.status);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <Link to={BACK[role]} className="text-primary inline-flex items-center gap-2 mb-4 text-sm"><FaArrowLeft /> All requests</Link>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-2xl font-semibold text-slate-900">Lab request L-{order.orderNumber}</h1>
        <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${status.className}`}>{status.label}</span>
        {billingEnabled && role !== "doctor" && <PaidBadge order={order} />}
        {order.urgent && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-semibold bg-red-100 text-red-700">
            <FaExclamationTriangle /> Urgent
          </span>
        )}
        <button
          onClick={() =>
            !printLabRequestSlip({
              orderNumber: order.orderNumber,
              patientName: order.patient?.name,
              doctorName: order.doctor?.name,
              tests: order.tests,
              urgent: order.urgent,
              when: when(order.createdAt),
            }) && toast.error("The print window was blocked. Allow pop-ups for this site.")
          }
          className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
        >
          <FaPrint /> Print request slip
        </button>
      </div>

      {order.status === "returned" && order.review?.note && (
        <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-800">The doctor sent this back:</p>
          <p className="text-red-900 mt-1 whitespace-pre-wrap">{order.review.note}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <section className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Patient</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Field label="Name">{patient?.name}</Field></div>
              <Field label="Age">{ageFrom(patient?.dob) || patient?.age}</Field>
              <Field label="Gender">{patient?.gender}</Field>
              <Field label="Phone">{patient?.phone}</Field>
              <Field label="CNIC (last 4)">{patient?.cnicLast4 ? `••••${patient.cnicLast4}` : ""}</Field>
              <div className="col-span-2"><Field label="Address">{patient?.address}</Field></div>
            </div>
            {patient?.walkIn && <p className="mt-3 text-xs text-gray-500">Walk-in patient (no patient record): details as given at reception.</p>}
            {patient?.removed && <p className="mt-3 text-xs text-amber-700">The patient record was deleted; details as they were when the tests were requested.</p>}
          </section>

          <section className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Requested by</h2>
            <Field label="Doctor">Dr. {order.doctor?.name}{order.doctor?.speciality ? ` (${order.doctor.speciality})` : ""}</Field>
            <div className="mt-3"><Field label="Requested at">{when(order.createdAt)}</Field></div>
            {order.doctorNote && (
              <div className="mt-3 p-3 rounded-lg bg-gray-50">
                <p className="text-xs text-gray-500">Doctor&apos;s note</p>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{order.doctorNote}</p>
              </div>
            )}
          </section>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <section className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Tests ({order.tests.length})</h2>
            <ul className="divide-y divide-gray-100">
              {order.tests.map((t) => (
                <li key={t.name} className="py-2 flex justify-between gap-3 text-sm">
                  <span className="text-gray-900">{t.name}</span>
                  <span className="text-gray-500">{t.sampleType}</span>
                </li>
              ))}
            </ul>
          </section>

          {canUpload && (
            <form onSubmit={upload} className="bg-white rounded-2xl border border-primary/30 p-5 space-y-3">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <FaFileUpload className="text-primary" />
                {order.status === "report_uploaded" ? "Replace the report (before the doctor reviews it)" : "Upload the report"}
              </h2>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-700 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary"
                aria-label="Report file"
              />
              <p className="text-xs text-gray-500">PDF from the lab machine/software, or a clear photo of the printed report. Up to 10 MB.</p>
              <textarea
                value={labNote}
                onChange={(e) => setLabNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Note for the doctor (optional), e.g. sample slightly haemolysed"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <div className="flex justify-end">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-primary text-white font-medium disabled:opacity-50">
                  {busy ? "Uploading…" : "Send report to doctor"}
                </button>
              </div>
            </form>
          )}

          {newest && (
            <section className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="font-semibold text-gray-900">Report</h2>
                <button onClick={() => view(newest._id)} className="inline-flex items-center gap-2 text-sm text-primary">
                  <FaExternalLinkAlt /> Open in new tab
                </button>
              </div>
              {newest.note && (
                <div className="mb-3 p-3 rounded-lg bg-gray-50 text-sm">
                  <span className="text-gray-500">Lab note: </span>
                  <span className="text-gray-900 whitespace-pre-wrap">{newest.note}</span>
                </div>
              )}
              {preview ? (
                preview.mimeType === "application/pdf" ? (
                  <iframe src={preview.url} title="Lab report" className="w-full h-[70vh] rounded-lg border border-gray-200" />
                ) : (
                  <img src={preview.url} alt="Lab report" className="max-w-full rounded-lg border border-gray-200" />
                )
              ) : (
                <p className="text-sm text-gray-500">Loading the report…</p>
              )}
              <p className="text-xs text-gray-400 mt-2">
                Uploaded {when(newest.uploadedAt)} by {newest.uploadedBy?.name || "lab"}
              </p>

              {canReview && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                  <textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder="Note to the lab (needed if you send it back), e.g. please repeat platelet count"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                    <button
                      onClick={() => review("return")}
                      disabled={busy}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <FaUndo /> Send back to lab
                    </button>
                    <button
                      onClick={() => review("approve")}
                      disabled={busy}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      <FaCheck /> Approve report
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {order.reports.length > 1 && (
            <section className="bg-white rounded-2xl border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-900 mb-2">Earlier uploads</h2>
              <ul className="divide-y divide-gray-100">
                {order.reports.slice(0, -1).reverse().map((r) => (
                  <li key={r._id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-700 truncate">{r.fileName} · {when(r.uploadedAt)}</span>
                    <button onClick={() => view(r._id)} className="text-primary shrink-0">Open</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-900">History</h2>
              {canCancel && (
                <button onClick={cancel} disabled={busy} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-red-600">
                  <FaTimes /> Cancel request
                </button>
              )}
            </div>
            <ol className="space-y-2">
              {(order.history || []).map((h, i) => (
                <li key={i} className="text-sm">
                  <span className="text-gray-400">{when(h.at)}</span>{" "}
                  <span className="font-medium text-gray-900">{ACTION_TEXT[h.action] || h.action}</span>{" "}
                  <span className="text-gray-600">
                    by {h.by?.role === "doctor" ? `Dr. ${h.by?.name}` : h.by?.name || h.by?.role}
                  </span>
                  {h.note && <p className="text-gray-600 ml-4 whitespace-pre-wrap">“{h.note}”</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
};

export default LabOrderDetail;
