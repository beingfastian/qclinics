import { useEffect, useMemo, useState } from "react";
import { getUpcomingSlots, toSlotDate } from "../utils/slots";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Pick a date and time from a doctor's free slots. Used for follow-ups and reschedules.
// doctor: { timings, sittingDays, slots_booked, leaves } or null while loading.
// onConfirm(slotDate, slotTime, reason) must return true when done (the dialog then closes).
const SlotPickerDialog = ({ title, subtitle, doctor, confirmVerb, showReason = false, onConfirm, onClose }) => {
  const [dayIndex, setDayIndex] = useState(0);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const days = useMemo(() => (doctor ? getUpcomingSlots(doctor, 60) : []), [doctor]);
  const selectedDay = days[dayIndex];

  const submit = async () => {
    if (!selectedDay || !time) return;
    setSaving(true);
    const ok = await onConfirm(toSlotDate(selectedDay.date), time, reason.trim());
    setSaving(false);
    if (ok) onClose();
  };

  const label = (day) =>
    `${DAY_SHORT[day.date.getDay()]} ${day.date.getDate()} ${MONTH_SHORT[day.date.getMonth()]}`;

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="slot-picker-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100">
          <h2 id="slot-picker-title" className="text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>

        <div className="p-5 overflow-y-auto">
          {!doctor ? (
            <p className="text-sm text-gray-500">Loading available times…</p>
          ) : days.length === 0 ? (
            <p className="text-sm text-gray-600">
              No free slots in the next 60 days. Check the doctor&apos;s timings, sitting days and leave.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700 mb-2">Date</p>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {days.map((day, index) => (
                  <button
                    key={day.date.toISOString()}
                    type="button"
                    onClick={() => { setDayIndex(index); setTime(""); }}
                    className={`flex-shrink-0 w-16 py-2 rounded-xl border text-center transition-colors ${
                      index === dayIndex
                        ? "bg-primary-700 border-primary-700 text-white"
                        : "border-gray-200 text-gray-700 hover:border-primary-300"
                    }`}
                  >
                    <span className="block text-xs">{DAY_SHORT[day.date.getDay()]}</span>
                    <span className="block text-lg font-semibold">{day.date.getDate()}</span>
                    <span className="block text-xs">{MONTH_SHORT[day.date.getMonth()]}</span>
                  </button>
                ))}
              </div>

              <p className="text-sm font-medium text-gray-700 mt-4 mb-2">Time</p>
              <div className="flex flex-wrap gap-2">
                {selectedDay.slots.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => setTime(slot.time)}
                    className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                      slot.time === time
                        ? "bg-primary-700 border-primary-700 text-white"
                        : "border-gray-200 text-gray-700 hover:border-primary-300"
                    }`}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>

              {showReason && (
                <div className="mt-4">
                  <label htmlFor="slot-picker-reason" className="text-sm font-medium text-gray-700">
                    Reason <span className="font-normal text-gray-400">(optional, kept in the history)</span>
                  </label>
                  <input
                    id="slot-picker-reason"
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Doctor in surgery, Patient requested"
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none text-sm"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!time || saving}
            className="px-4 py-2 rounded-lg bg-primary-700 text-white font-medium hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : time && selectedDay ? `${confirmVerb} ${label(selectedDay)}, ${time}` : "Pick a date and time"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SlotPickerDialog;
