import { useEffect, useState } from "react";
import { isoToSlotDate, slotDateToIso, toIsoDate } from "../utils/slots";

// Move or cancel all of a doctor's appointments on one day.
// doctors: list to choose from (admin), or omit and pass doctorName (doctor's own panel).
// fetchDay(docId, slotDate) -> that day's appointments (loaded from the server)
// onMove(docId, fromSlotDate, toSlotDate, reason) -> { moved, notMoved } | null
// onCancelDay(docId, slotDate, reason) -> { cancelled } | null
const DayActionsDialog = ({
  doctors,
  doctorName,
  fetchDay,
  defaultDocId = "",
  defaultSlotDate,
  onMove,
  onCancelDay,
  onClose,
}) => {
  const today = toIsoDate(new Date());
  const [docId, setDocId] = useState(defaultDocId);
  const [fromIso, setFromIso] = useState(defaultSlotDate ? slotDateToIso(defaultSlotDate) : today);
  const [action, setAction] = useState("move");
  const [toIso, setToIso] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Active appointments for the chosen doctor and day
  const [onDay, setOnDay] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [dayError, setDayError] = useState("");
  useEffect(() => {
    let current = true;
    setOnDay([]);
    setDayError("");
    if (!fromIso || (doctors && !docId)) return;
    setLoadingDay(true);
    fetchDay(doctors ? docId : undefined, isoToSlotDate(fromIso))
      .then((list) => current && setOnDay(list.filter((a) => !a.cancelled && !a.isCompleted)))
      .catch((error) => current && setDayError(error.message || "Couldn't load this day"))
      .finally(() => current && setLoadingDay(false));
    return () => {
      current = false;
    };
    // fetchDay is a new function on every render of the parent; the day and doctor decide
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromIso, docId, doctors]);

  const canSubmit =
    (!doctors || docId) && fromIso && !loadingDay && onDay.length > 0 && (action === "cancel" || (toIso && toIso !== fromIso));

  const submit = async () => {
    setSaving(true);
    const from = isoToSlotDate(fromIso);
    const res =
      action === "move"
        ? await onMove(docId, from, isoToSlotDate(toIso), reason.trim())
        : await onCancelDay(docId, from, reason.trim());
    setSaving(false);
    if (res) setResult({ action, ...res });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-actions-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100">
          <h2 id="day-actions-title" className="text-lg font-semibold text-gray-900">Manage a Day</h2>
          <p className="text-sm text-gray-500 mt-1">
            Move or cancel all appointments on one day{doctorName ? ` for Dr. ${doctorName}` : ""}. Patients are told on WhatsApp.
          </p>
        </div>

        {result ? (
          <div className="p-5 overflow-y-auto space-y-3 text-sm">
            {result.action === "move" ? (
              <>
                <p className="font-medium text-green-700">{result.moved.length} appointment(s) moved.</p>
                {result.moved.length > 0 && (
                  <ul className="space-y-1 text-gray-700">
                    {result.moved.map((m) => (
                      <li key={m._id}>
                        {m.patient}: {m.from} → {m.to}
                        {m.from !== m.to && <span className="text-amber-600"> (time changed)</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {result.notMoved.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="font-medium text-amber-800">{result.notMoved.length} could not be moved:</p>
                    <ul className="mt-1 space-y-1 text-amber-800">
                      {result.notMoved.map((m) => (
                        <li key={m._id}>{m.patient} ({m.time}): {m.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="font-medium text-green-700">{result.cancelled.length} appointment(s) cancelled.</p>
            )}
          </div>
        ) : (
          <div className="p-5 overflow-y-auto space-y-4 text-sm">
            {doctors && (
              <div>
                <label htmlFor="day-doctor" className="font-medium text-gray-700">Doctor</label>
                <select
                  id="day-doctor"
                  value={docId}
                  onChange={(e) => setDocId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                >
                  <option value="">Select a doctor</option>
                  {doctors.map((d) => (
                    <option key={d._id} value={d._id}>Dr. {d.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="day-from" className="font-medium text-gray-700">Day</label>
              <input
                id="day-from"
                type="date"
                min={today}
                value={fromIso}
                onChange={(e) => setFromIso(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
              />
              <p className={`mt-1 ${dayError ? "text-red-600" : onDay.length ? "text-gray-700" : "text-gray-400"}`} role="status">
                {doctors && !docId
                  ? "Choose a doctor"
                  : loadingDay
                    ? "Checking this day…"
                    : dayError || `${onDay.length} booked appointment(s) on this day`}
              </p>
            </div>

            <fieldset>
              <legend className="font-medium text-gray-700">Action</legend>
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="day-action" checked={action === "move"} onChange={() => setAction("move")} />
                  Move to another day
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="day-action" checked={action === "cancel"} onChange={() => setAction("cancel")} />
                  Cancel all
                </label>
              </div>
            </fieldset>

            {action === "move" && (
              <div>
                <label htmlFor="day-to" className="font-medium text-gray-700">Move to</label>
                <input
                  id="day-to"
                  type="date"
                  min={today}
                  value={toIso}
                  onChange={(e) => setToIso(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                />
                <p className="mt-1 text-gray-500">Each patient keeps their time if it&apos;s free, otherwise gets the nearest free time.</p>
              </div>
            )}

            <div>
              <label htmlFor="day-reason" className="font-medium text-gray-700">
                Reason <span className="font-normal text-gray-400">(optional, kept in the history)</span>
              </label>
              <input
                id="day-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Doctor on leave, Emergency surgery"
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
              />
            </div>
          </div>
        )}

        <div className="p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            {result ? "Done" : "Close"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit || saving}
              className={`px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                action === "cancel" ? "bg-red-600 hover:bg-red-700" : "bg-primary-700 hover:bg-primary-800"
              }`}
            >
              {saving ? "Working…" : action === "cancel" ? `Cancel ${onDay.length} appointment(s)` : `Move ${onDay.length} appointment(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DayActionsDialog;
