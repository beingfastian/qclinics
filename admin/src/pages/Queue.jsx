import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "../components/ui/Dialog";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaBullhorn,
  FaCheck,
  FaUserClock,
  FaPrint,
  FaUndo,
  FaTimes,
  FaExclamationTriangle,
  FaPause,
  FaPlay,
  FaWhatsapp,
  FaTv,
  FaUserPlus,
  FaSignInAlt,
  FaSyncAlt,
  FaWifi,
  FaFlask,
  FaCalendarPlus,
  FaSearch,
  FaUserMd,
} from "react-icons/fa";
import { AdminContext } from "../context/AdminContext";
import { DoctorContext } from "../context/DoctorContext";
import { AppContext } from "../context/AppContext";
import LanguageSelect from "../components/LanguageSelect";
import { openPrintWindow, printTokenSlip } from "../components/PrintSlip";
import LabOrderModal from "../components/LabOrderModal";
import FollowUpModal from "../components/FollowUpModal";
import { useLabEnabled } from "../lab/api";

// Live OPD queue.
//   Reception (admin login): chooses the doctor, finds or registers the patient and
//   gives a token. Every token is a real visit on the patient's record, so the doctor
//   can complete it (earnings), book a follow-up and request lab tests.
//   Doctor: their own patients only: who is with them, call the next one, request
//   tests, book a follow-up. No reception forms.
// Polls every few seconds and keeps working through short internet drops.
const POLL_MS = 8000;
const DOCTOR_KEY = "queueDoctorId";
const AUTO_PRINT_KEY = "queueAutoPrint";

const readStorage = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: setting just isn't remembered */
  }
};

const timeOf = (value) =>
  value ? new Date(value).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }) : "";

// Short, at the bottom: reception issues tokens quickly and toasts must not cover controls
const TOAST = { autoClose: 3000, position: "bottom-right" };

const emptyNewPatient = { name: "", age: "", gender: "", phone: "", cnic: "" };
const emptyVisit = { notify: false, language: "ur", fee: "", urgent: false };

const Badge = ({ className, children, title }) => (
  <span title={title} className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}>
    {children}
  </span>
);

const tokenBadges = (t) => (
  <>
    {t.urgent && <Badge className="bg-red-100 text-red-700">Urgent</Badge>}
    {t.kind === "appointment" ? (
      <Badge className="bg-purple-100 text-purple-700" title="Had a booked appointment">Appointment</Badge>
    ) : (
      <Badge className="bg-gray-100 text-gray-600">Walk-in</Badge>
    )}
    {(t.age || t.gender) && <span className="text-xs text-gray-500">{[t.age, t.gender].filter(Boolean).join(", ")}</span>}
    {t.notify && (
      <span title="Gets WhatsApp updates" className="text-green-600">
        <FaWhatsapp />
      </span>
    )}
  </>
);

// Reception: find the patient first (by phone, name or CNIC), or register a new one
const PatientPicker = ({ headers, backendUrl, selected, onSelect, newPatient, setNewPatient, mode, setMode }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults(null);
      return undefined;
    }
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const { data } = await axios.get(`${backendUrl}/api/queue/patients`, { headers, params: { q: text }, timeout: 15000 });
        if (request === latest.current) setResults(data.success ? data.patients : []);
      } catch {
        if (request === latest.current) setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, headers, backendUrl]);

  if (selected) {
    return (
      <div className="p-3 rounded-lg border border-primary/40 bg-primary/5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">{selected.name}</p>
          <p className="text-sm text-gray-600">
            {[selected.age, selected.gender, selected.phone, selected.cnicLast4 && `CNIC ••••${selected.cnicLast4}`].filter(Boolean).join(" · ") || "No other details on record"}
          </p>
        </div>
        <button type="button" onClick={() => onSelect(null)} className="text-sm text-primary shrink-0">Change</button>
      </div>
    );
  }

  if (mode === "new") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">New patient</p>
          <button type="button" onClick={() => setMode("search")} className="text-sm text-primary">Search instead</button>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="q-name">Name *</label>
          <input id="q-name" value={newPatient.name} onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })} maxLength={80} autoComplete="off" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="q-age">Age</label>
            <input id="q-age" inputMode="numeric" value={newPatient.age} onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })} placeholder="e.g. 45" maxLength={20} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="q-gender">Gender</label>
            <select id="q-gender" value={newPatient.gender} onChange={(e) => setNewPatient({ ...newPatient, gender: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
              <option value="">—</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="q-phone">Phone</label>
            <input id="q-phone" type="tel" inputMode="tel" value={newPatient.phone} onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })} placeholder="03xx xxxxxxx" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="q-cnic">CNIC (optional)</label>
            <input id="q-cnic" inputMode="numeric" value={newPatient.cnic} onChange={(e) => setNewPatient({ ...newPatient, cnic: e.target.value })} placeholder="13 digits" maxLength={15} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>
        <p className="text-xs text-gray-500">A family can share one phone number. Patients without a phone can be registered too.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700" htmlFor="q-search">Find the patient</label>
      <div className="relative">
        <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          id="q-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Phone number, name or CNIC"
          autoComplete="off"
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg"
        />
      </div>
      {results && (
        <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {results.length === 0 ? (
            <li className="p-3 text-sm text-gray-500">No patient found.</li>
          ) : (
            results.map((p) => (
              <li key={p._id}>
                <button type="button" onClick={() => onSelect(p)} className="w-full text-left p-3 hover:bg-gray-50">
                  <p className="font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500">
                    {[p.age, p.gender, p.phone, p.cnicLast4 && `CNIC ••••${p.cnicLast4}`].filter(Boolean).join(" · ")}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <button
        type="button"
        onClick={() => {
          // Carry what was typed into the new-patient form
          const text = query.trim();
          const digits = text.replace(/\D/g, "");
          setNewPatient({
            ...emptyNewPatient,
            ...(digits.length === 13 ? { cnic: digits } : digits.length >= 10 ? { phone: text } : { name: text }),
          });
          setMode("new");
        }}
        className="inline-flex items-center gap-2 text-sm text-primary font-medium"
      >
        <FaUserPlus /> New patient (not registered yet)
      </button>
    </div>
  );
};

const Queue = () => {
  const { confirm, prompt } = useDialog();
  const { aToken, doctors, getAllDoctors } = useContext(AdminContext);
  const { dToken, profileData, getProfileData } = useContext(DoctorContext);
  const { slotDateFormat } = useContext(AppContext);
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
  const publicSite = (import.meta.env.VITE_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  const isAdmin = Boolean(aToken);
  const headers = useMemo(() => (aToken ? { atoken: aToken } : { dtoken: dToken }), [aToken, dToken]);

  // Admin: a doctor picked on the dashboard (?doc=) wins over the remembered one
  const [searchParams] = useSearchParams();
  const [docId, setDocId] = useState(() => (isAdmin ? searchParams.get("doc") || readStorage(DOCTOR_KEY, "") : ""));
  const [queue, setQueue] = useState(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(""); // which action is running, to disable double clicks
  const [patient, setPatient] = useState(null); // existing patient chosen at reception
  const [pickerMode, setPickerMode] = useState("search");
  const [newPatient, setNewPatient] = useState(emptyNewPatient);
  const [visit, setVisit] = useState(emptyVisit);
  const [autoPrint, setAutoPrint] = useState(() => readStorage(AUTO_PRINT_KEY, "true") === "true");
  const [showFinished, setShowFinished] = useState(false);
  const [labFor, setLabFor] = useState(null);
  const [followUpFor, setFollowUpFor] = useState(null);
  const labEnabled = useLabEnabled();

  useEffect(() => {
    if (isAdmin) getAllDoctors();
    else getProfileData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Admin: default to the first doctor, also when the remembered one no longer exists
  useEffect(() => {
    if (isAdmin && doctors.length && !doctors.some((d) => d._id === docId)) setDocId(doctors[0]._id);
  }, [isAdmin, docId, doctors]);
  useEffect(() => {
    if (isAdmin && docId) writeStorage(DOCTOR_KEY, docId);
  }, [isAdmin, docId]);

  // A chosen patient's WhatsApp consent is already on record
  useEffect(() => {
    if (patient) setVisit((v) => ({ ...v, notify: Boolean(patient.whatsappEnabled), language: patient.language || v.language }));
  }, [patient]);

  const doctor = isAdmin ? doctors.find((d) => d._id === docId) : profileData || null;
  const doctorName = doctor?.name || "";

  // The doctor whose queue is on screen, so a late answer for another doctor is ignored
  const shownDoctor = useRef(docId);
  shownDoctor.current = docId;

  const load = useCallback(async () => {
    if (isAdmin && !docId) return;
    try {
      const { data } = await axios.get(`${backendUrl}/api/queue`, { headers, params: isAdmin ? { docId } : {}, timeout: 15000 });
      if (shownDoctor.current !== docId) return;
      setOffline(false);
      if (data.success) setQueue(data.queue);
      else toast.error(data.message);
    } catch {
      setOffline(true);
    }
  }, [backendUrl, headers, isAdmin, docId]);

  useEffect(() => {
    setQueue(null);
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", load);
    };
  }, [load]);

  const post = async (path, body, key) => {
    if (busy) return null;
    setBusy(key);
    try {
      const { data } = await axios.post(`${backendUrl}/api/queue/${path}`, { ...body, ...(isAdmin && { docId }) }, { headers, timeout: 15000 });
      if (!data.success) toast.error(data.message, TOAST);
      await load();
      return data.success ? data : null;
    } catch (error) {
      toast.error(error.response?.data?.message || "No connection. Please try again.", TOAST);
      return null;
    } finally {
      setBusy("");
    }
  };

  const slipDetails = (token, estimate) => ({
    number: token.number,
    patientName: token.patientName,
    doctorName,
    dateText: slotDateFormat(token.day),
    issuedTime: timeOf(token.issuedAt),
    ahead: estimate?.ahead,
    waitMinutes: estimate?.waitMinutes,
    urgent: token.urgent,
    trackUrl: token.trackUrl,
  });

  const reprint = (token) => {
    if (!printTokenSlip(slipDetails(token, token.estimate))) toast.error("The print window was blocked. Allow pop-ups for this site.");
  };

  // Issue a token. The print window opens now (inside the click) and is filled
  // after the server answers, so the browser doesn't block it as a popup.
  const issue = async (body, key) => {
    const forDoctor = doctorName;
    const win = autoPrint ? openPrintWindow() : null;
    const data = await post("issue", body, key);
    if (!data) {
      win?.close();
      return null;
    }
    toast.success(
      data.existing ? `Already checked in: token ${data.token.number} for Dr. ${forDoctor}` : `Token ${data.token.number} for Dr. ${forDoctor}`,
      TOAST
    );
    if (win) {
      const { data: fresh } = await axios.get(`${backendUrl}/api/queue`, { headers, params: isAdmin ? { docId } : {} }).catch(() => ({ data: null }));
      const latest = fresh?.queue?.tokens?.find((t) => t._id === data.token._id);
      printTokenSlip(slipDetails(data.token, latest?.estimate), win);
    }
    return data;
  };

  const submitWalkIn = async (e) => {
    e.preventDefault();
    if (!patient && pickerMode !== "new") return toast.error("Find the patient, or choose “New patient”", TOAST);
    if (!patient && !newPatient.name.trim()) return toast.error("Please enter the patient's name", TOAST);
    const phoneKnown = patient ? patient.phone : newPatient.phone.trim();
    if (visit.notify && !phoneKnown) return toast.error("Enter a phone number for WhatsApp updates, or turn them off", TOAST);
    const data = await issue(
      {
        ...(patient
          ? { userId: patient._id }
          : { patientName: newPatient.name, age: newPatient.age, gender: newPatient.gender, phone: newPatient.phone, cnic: newPatient.cnic }),
        notify: visit.notify,
        language: visit.language,
        fee: visit.fee,
        urgent: visit.urgent,
      },
      "walkin"
    );
    if (data) {
      setPatient(null);
      setNewPatient(emptyNewPatient);
      setVisit(emptyVisit);
      setPickerMode("search");
    }
    return data;
  };

  // Sends who this screen shows with the doctor, so a screen that is a few seconds
  // out of date can't finish a patient someone else just called
  const callNext = (tokenId) =>
    post("call", { ...(tokenId && { tokenId }), expectedCurrentId: queue?.current?._id || "" }, tokenId ? `call-${tokenId}` : "next");
  const act = (tokenId, action) => post("action", { tokenId, action }, `${action}-${tokenId}`);

  const togglePause = async () => {
    if (queue?.paused) return post("pause", { paused: false }, "pause");
    const note = await prompt({
      title: "Pause the queue?",
      message: "The waiting-room screen and patients' token pages show that the doctor is on a break.",
      label: "Reason shown to patients (optional)",
      defaultValue: "Break",
      placeholder: "e.g. Namaz break, Ward round",
      confirmLabel: "Pause queue",
    });
    if (note === null) return null;
    return post("pause", { paused: true, note }, "pause");
  };

  const current = queue?.current;
  const waitingCount = queue?.waiting?.length || 0;
  const finished = (queue?.tokens || []).filter((t) => t.status === "done" || t.status === "left");
  const skipped = (queue?.tokens || []).filter((t) => t.status === "skipped");

  if (isAdmin && !doctors.length) {
    return <div className="p-6 text-gray-500">No doctors yet. Add a doctor first, then their queue appears here.</div>;
  }

  // --- Building blocks shared by both layouts ---

  const currentCard = (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="text-center sm:text-left">
          <p className="text-xs uppercase tracking-wide text-gray-500">With the doctor</p>
          <p className={`font-bold text-primary leading-none mt-1 ${isAdmin ? "text-5xl" : "text-7xl"}`}>{current ? current.number : "—"}</p>
        </div>
        <div className="flex-1 min-w-0">
          {current ? (
            <>
              <p className={`font-semibold text-gray-900 truncate ${isAdmin ? "text-lg" : "text-2xl"}`}>{current.patientName}</p>
              <div className="flex flex-wrap items-center gap-2 mt-1">{tokenBadges(current)}</div>
              <p className="text-xs text-gray-500 mt-1">Called at {timeOf(current.calledAt)}</p>
            </>
          ) : (
            <p className="text-gray-500">{waitingCount ? "No one is with the doctor. Call the first patient." : "No one is waiting."}</p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:w-60">
          <button
            onClick={() => callNext()}
            disabled={Boolean(busy) || (!waitingCount && !current)}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-white font-semibold text-base disabled:opacity-50"
          >
            <FaBullhorn />
            {current ? "Done & call next" : "Call next"}
          </button>
          {current && (
            <div className="flex gap-2">
              <button onClick={() => act(current._id, "skip")} disabled={Boolean(busy)} className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50" title="Called but not here; can be put back in line later">
                <FaUserClock /> Not here
              </button>
              <button onClick={() => act(current._id, "done")} disabled={Boolean(busy)} className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50" title="Finish without calling anyone">
                <FaCheck /> Done
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Doctor's actions for the patient in front of them */}
      {current && !isAdmin && current.appointmentId && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-2">
          {labEnabled && (
            <button onClick={() => setLabFor(current)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-teal-200 text-sm font-medium text-teal-700 hover:bg-teal-50">
              <FaFlask /> Request lab tests
            </button>
          )}
          <button
            onClick={() => setFollowUpFor({ _id: current.appointmentId, userData: { name: current.patientName } })}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-purple-200 text-sm font-medium text-purple-700 hover:bg-purple-50"
          >
            <FaCalendarPlus /> Book next visit
          </button>
        </div>
      )}
    </div>
  );

  const stats = (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 grid grid-cols-2 gap-3 text-sm">
      <div>
        <p className="text-gray-500">Waiting</p>
        <p className="text-2xl font-bold text-gray-900">{queue?.counts.waiting}</p>
      </div>
      <div>
        <p className="text-gray-500">Seen today</p>
        <p className="text-2xl font-bold text-gray-900">{queue?.counts.done}</p>
      </div>
      <div>
        <p className="text-gray-500">Walk-ins today</p>
        <p className="text-2xl font-bold text-gray-900">{queue?.counts.walkIns}</p>
      </div>
      <div>
        <p className="text-gray-500">Walk-in fees</p>
        <p className="text-2xl font-bold text-gray-900">Rs. {queue?.counts.walkInFees}</p>
      </div>
      <p className="col-span-2 text-xs text-gray-400">
        About {queue?.avgMinutes} min per patient{queue?.started ? " (from today's visits)" : " (default until the doctor starts)"}.
      </p>
    </div>
  );

  const waitingList = (
    <div className="bg-white rounded-2xl border border-gray-100">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Waiting ({queue?.waiting.length})</h2>
        <span className="text-xs text-gray-400">In calling order</span>
      </div>
      {!queue?.waiting.length ? (
        <p className="p-5 text-sm text-gray-500">No one is waiting.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {queue.waiting.map((t, index) => (
            <li key={t._id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className={`w-12 text-center text-2xl font-bold ${t.urgent ? "text-red-600" : "text-gray-900"}`}>{t.number}</span>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{t.patientName}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    {tokenBadges(t)}
                    <span className="text-xs text-gray-500">
                      {index === 0 ? "Next" : `${index} ahead`}
                      {t.estimate ? ` · ~${t.estimate.waitMinutes} min` : ""}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:justify-end">
                <button onClick={() => callNext(t._id)} disabled={Boolean(busy)} className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary hover:text-white" title="Call this patient now">
                  Call
                </button>
                <button onClick={() => act(t._id, "urgent")} disabled={Boolean(busy)} className={`p-2 rounded-lg hover:bg-red-50 ${t.urgent ? "text-red-600" : "text-gray-400"}`} title={t.urgent ? "Remove urgent" : "Mark urgent"}>
                  <FaExclamationTriangle />
                </button>
                {isAdmin && (
                  <>
                    <button onClick={() => reprint(t)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-50" title="Print slip again">
                      <FaPrint />
                    </button>
                    <button
                      onClick={async () =>
                        (await confirm({
                          title: `Remove token ${t.number} from the line?`,
                          message: `${t.patientName} is taken out of the queue and their visit is cancelled. No message is sent.`,
                          confirmLabel: "Remove from line",
                          tone: "danger",
                        })) && act(t._id, "left")
                      }
                      disabled={Boolean(busy)}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="Left / remove from line"
                    >
                      <FaTimes />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const skippedList = skipped.length > 0 && (
    <div className="bg-white rounded-2xl border border-amber-200">
      <div className="px-5 py-3 border-b border-amber-100">
        <h2 className="font-semibold text-amber-900">Not here when called ({skipped.length})</h2>
        <p className="text-xs text-amber-700">When they come back, put them back in line: they go to the front.</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {skipped.map((t) => (
          <li key={t._id} className="px-5 py-2 flex items-center gap-3">
            <span className="w-12 text-center text-xl font-bold text-gray-500">{t.number}</span>
            <span className="flex-1 truncate text-gray-800">{t.patientName}</span>
            <button onClick={() => act(t._id, "back_in_line")} disabled={Boolean(busy)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">
              <FaUndo /> Back in line
            </button>
            <button onClick={() => act(t._id, "left")} disabled={Boolean(busy)} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Left / remove">
              <FaTimes />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  // Seen patients stay visible (open by default for doctors, so the screen never looks empty)
  const finishedOpen = showFinished || (!isAdmin && !current && !queue?.waiting.length);
  const finishedList = finished.length > 0 && (
    <div className="bg-white rounded-2xl border border-gray-100">
      <button onClick={() => setShowFinished(!finishedOpen)} className="w-full px-5 py-3 text-left font-semibold text-gray-700 flex justify-between">
        <span>Seen / left today ({finished.length})</span>
        <span className="text-sm text-gray-400">{finishedOpen ? "Hide" : "Show"}</span>
      </button>
      {finishedOpen && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {finished.slice().reverse().map((t) => (
            <li key={t._id} className="px-5 py-2 flex flex-wrap items-center gap-3 text-sm">
              <span className="w-12 text-center font-bold text-gray-400">{t.number}</span>
              <span className="flex-1 min-w-[8rem] truncate text-gray-700">{t.patientName}</span>
              {t.status === "done" ? (
                <Badge className="bg-green-100 text-green-700">Seen {timeOf(t.doneAt)}</Badge>
              ) : (
                <Badge className="bg-gray-100 text-gray-500">Left</Badge>
              )}
              {!isAdmin && t.status === "done" && t.appointmentId && (
                <span className="flex gap-2">
                  {labEnabled && (
                    <button onClick={() => setLabFor(t)} className="text-teal-700 text-xs inline-flex items-center gap-1"><FaFlask /> Tests</button>
                  )}
                  <button onClick={() => setFollowUpFor({ _id: t.appointmentId, userData: { name: t.patientName } })} className="text-purple-700 text-xs inline-flex items-center gap-1">
                    <FaCalendarPlus /> Next visit
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const banners = (
    <>
      {offline && (
        <div className="mb-4 flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          <FaWifi /> No connection to the server. Showing the last known queue and retrying. Keep giving paper tokens until it is back.
        </div>
      )}
      {queue?.paused && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
          The doctor is on a break{queue.pauseNote ? `: ${queue.pauseNote}` : ""}. The waiting-room screen shows this.
        </div>
      )}
    </>
  );

  const headerButtons = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={togglePause}
        disabled={!queue || Boolean(busy)}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border ${queue?.paused ? "bg-amber-50 border-amber-300 text-amber-800" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}
      >
        {queue?.paused ? <FaPlay /> : <FaPause />}
        {queue?.paused ? "Resume" : "Pause (break)"}
      </button>
      {publicSite && (
        <a href={`${publicSite}/queue`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50" title="Open on the waiting-room TV">
          <FaTv /> Waiting-room screen
        </a>
      )}
      <button onClick={load} className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50" title="Refresh">
        <FaSyncAlt />
      </button>
    </div>
  );

  const modals = (
    <>
      {labFor && <LabOrderModal source={{ queueTokenId: labFor._id }} patientName={labFor.patientName} doctorName={doctorName} onClose={() => setLabFor(null)} />}
      {followUpFor && <FollowUpModal appointment={followUpFor} onClose={() => setFollowUpFor(null)} />}
    </>
  );

  // --- Doctor: only what the doctor does ---
  if (!isAdmin) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">My patients today</h1>
            <p className="text-sm text-gray-500">{queue ? slotDateFormat(queue.day) : "Today"} · reception adds patients; they appear here by themselves</p>
          </div>
          {headerButtons}
        </div>
        {banners}
        {!queue ? (
          <div className="p-6 text-gray-500">Loading…</div>
        ) : (
          <div className="space-y-4">
            {currentCard}
            {waitingList}
            {skippedList}
            {finishedList}
            {stats}
          </div>
        )}
        {modals}
      </div>
    );
  }

  // --- Reception ---
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Live Queue</h1>
          <p className="text-sm text-gray-500">{queue ? slotDateFormat(queue.day) : "Today"} · tokens restart at 1 every day</p>
        </div>
        {headerButtons}
      </div>

      {/* Which doctor: big and obvious, so a patient never goes into the wrong line */}
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Doctor</p>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Doctor">
          {doctors.map((d) => (
            <button
              key={d._id}
              role="tab"
              aria-selected={d._id === docId}
              onClick={() => setDocId(d._id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-left ${
                d._id === docId ? "bg-primary text-white border-primary shadow" : "bg-white text-gray-700 border-gray-200 hover:border-primary/50"
              }`}
            >
              <FaUserMd />
              <span>
                <span className="block font-semibold leading-tight">Dr. {d.name}</span>
                <span className={`block text-xs ${d._id === docId ? "text-white/80" : "text-gray-500"}`}>
                  {d.speciality}
                  {d.available ? "" : " · unavailable"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {banners}

      {!queue ? (
        <div className="p-6 text-gray-500">Loading queue…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
            <div className="lg:col-span-2">{currentCard}</div>
            {stats}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <form onSubmit={submitWalkIn} className="bg-white rounded-2xl border-2 border-primary/30 p-5 space-y-3">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  <FaUserPlus className="text-primary" /> New token for Dr. {doctorName}
                </h2>
                <PatientPicker
                  headers={headers}
                  backendUrl={backendUrl}
                  selected={patient}
                  onSelect={(p) => {
                    setPatient(p);
                    if (!p) setPickerMode("search");
                  }}
                  newPatient={newPatient}
                  setNewPatient={setNewPatient}
                  mode={pickerMode}
                  setMode={setPickerMode}
                />
                {patient && queue.appointmentsToCheckIn.some((a) => a.userId === patient._id) && (() => {
                  // Already booked for today: check that appointment in, don't make a second visit
                  const booked = queue.appointmentsToCheckIn.find((a) => a.userId === patient._id);
                  return (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 space-y-2">
                      <p>
                        {patient.name} has an appointment with Dr. {doctorName} today at {booked.slotTime}. Check that appointment in instead of making a new visit.
                      </p>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={async () => {
                          if (await issue({ appointmentId: booked._id }, `checkin-${booked._id}`)) {
                            setPatient(null);
                            setPickerMode("search");
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium"
                      >
                        Check in the {booked.slotTime} appointment
                      </button>
                    </div>
                  );
                })()}
                {(patient || pickerMode === "new") && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="q-fee">Fee (Rs.)</label>
                      <input id="q-fee" type="number" min="0" inputMode="numeric" value={visit.fee} onChange={(e) => setVisit({ ...visit, fee: e.target.value })} placeholder={doctor?.fee != null ? String(doctor.fee) : ""} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="mt-1" checked={visit.notify} onChange={(e) => setVisit({ ...visit, notify: e.target.checked })} />
                      <span>
                        Send WhatsApp updates to the patient&apos;s number
                        <span className="block text-xs text-gray-500">Only if the patient agreed. They get the token number and a message when their turn is near.</span>
                      </span>
                    </label>
                    {visit.notify && <LanguageSelect value={visit.language} onChange={(language) => setVisit({ ...visit, language })} />}
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="mt-1" checked={visit.urgent} onChange={(e) => setVisit({ ...visit, urgent: e.target.checked })} />
                      <span>
                        Urgent
                        <span className="block text-xs text-gray-500">Emergency, very old, disabled or pregnant: seen before the regular line.</span>
                      </span>
                    </label>
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={autoPrint}
                          onChange={(e) => {
                            setAutoPrint(e.target.checked);
                            writeStorage(AUTO_PRINT_KEY, String(e.target.checked));
                          }}
                        />
                        Print token slip
                      </label>
                      <button type="submit" disabled={Boolean(busy)} className="px-5 py-2 rounded-lg bg-primary text-white font-medium disabled:opacity-50">
                        {busy === "walkin" ? "Issuing…" : "Give token"}
                      </button>
                    </div>
                  </>
                )}
              </form>

              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
                  <FaSignInAlt className="text-primary" /> Today&apos;s appointments: check in on arrival
                </h2>
                {queue.appointmentsToCheckIn.length === 0 ? (
                  <p className="text-sm text-gray-500">Everyone with an appointment today has been checked in.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {queue.appointmentsToCheckIn.map((a) => (
                      <li key={a._id} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{a.patientName}</p>
                          <p className="text-xs text-gray-500">
                            {a.slotTime}
                            {a.noShow && <span className="ml-2 text-orange-600">marked no-show (arrived late?)</span>}
                          </p>
                        </div>
                        <button onClick={() => issue({ appointmentId: a._id }, `checkin-${a._id}`)} disabled={Boolean(busy)} className="px-3 py-1.5 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary hover:text-white disabled:opacity-50">
                          Check in
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4">
              {waitingList}
              {skippedList}
              {finishedList}
            </div>
          </div>
        </>
      )}
      {modals}
    </div>
  );
};

export default Queue;
