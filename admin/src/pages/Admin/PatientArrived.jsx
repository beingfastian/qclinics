import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { FaArrowLeft, FaCheckCircle, FaListOl, FaPrint, FaSearch, FaSignInAlt, FaUserPlus, FaWhatsapp } from "react-icons/fa";
import { AdminContext } from "../../context/AdminContext.jsx";
import { AppContext } from "../../context/AppContext.jsx";
import LanguageSelect from "../../components/LanguageSelect";
import { openPrintWindow, printTokenSlip } from "../../components/PrintSlip";
import { Avatar, Badge, Button, Card, Field, Input, Page, Select } from "../../components/ui";

// "Patient arrived": the one thing reception does most, as three plain steps.
//   1. Find the patient (phone, name or CNIC), or register a new one.
//   2. Booked for today? Check that appointment in. Otherwise pick the doctor.
//   3. The token number, big, with Print slip and Next patient.
// Uses the same token, check-in and WhatsApp rules as the Queue page.
const AUTO_PRINT_KEY = "queueAutoPrint"; // shared with the Queue page
const TOAST = { autoClose: 3000, position: "bottom-right" };
const emptyNewPatient = { name: "", age: "", gender: "", phone: "", cnic: "" };
const emptyVisit = { notify: false, language: "ur", fee: "", urgent: false };

const readAutoPrint = () => {
  try {
    return localStorage.getItem(AUTO_PRINT_KEY) !== "false";
  } catch {
    return true;
  }
};
const writeAutoPrint = (value) => {
  try {
    localStorage.setItem(AUTO_PRINT_KEY, String(value));
  } catch {
    /* private mode: setting just isn't remembered */
  }
};

const timeOf = (value) => (value ? new Date(value).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }) : "");
const details = (p) => [p.age, p.gender, p.phone, p.cnicLast4 && `CNIC ••••${p.cnicLast4}`].filter(Boolean).join(" · ");

const StepTitle = ({ number, children }) => (
  <h2 className="mb-3 flex items-center gap-3 text-lg font-semibold text-slate-900">
    <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
      {number}
    </span>
    {children}
  </h2>
);

// Step 1: search as you type; today's bookings and tokens show on each result
const FindPatient = ({ headers, backendUrl, onPick, onNew }) => {
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

  const startNew = () => {
    // Carry what was typed into the new-patient form
    const text = query.trim();
    const digits = text.replace(/\D/g, "");
    onNew({ ...emptyNewPatient, ...(digits.length === 13 ? { cnic: digits } : digits.length >= 10 ? { phone: text } : { name: text }) });
  };

  return (
    <Card>
      <StepTitle number={1}>Find the patient</StepTitle>
      <div className="relative">
        <FaSearch aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          id="arrived-search"
          aria-label="Phone number, name or CNIC"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Phone number, name or CNIC"
          autoComplete="off"
          className="h-14 w-full rounded-xl border border-slate-300 pl-11 pr-4 text-lg text-slate-900 placeholder:text-slate-400 hover:border-slate-400"
        />
      </div>

      {results && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {results.length === 0 ? (
            <li className="p-4 text-slate-600">No patient found. Check the number, or register them as a new patient.</li>
          ) : (
            results.map((p) => (
              <li key={p._id}>
                <button type="button" onClick={() => onPick(p)} className="w-full p-4 text-left hover:bg-primary-50/50">
                  <span className="block font-semibold text-slate-900">{p.name}</span>
                  <span className="block text-sm text-slate-600">{details(p) || "No other details on record"}</span>
                  {(p.appointmentsToday?.length > 0 || p.tokensToday?.length > 0) && (
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {p.appointmentsToday?.map((a) => (
                        <Badge key={a._id} tone="info" className="whitespace-normal">Booked today {a.slotTime} · Dr. {a.doctorName}</Badge>
                      ))}
                      {p.tokensToday?.map((t) => (
                        <Badge key={`${t.docId}-${t.number}`} tone="warning" className="whitespace-normal">Has token #{t.number} · Dr. {t.doctorName}</Badge>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <Button variant="secondary" size="lg" icon={<FaUserPlus />} onClick={startNew} className="mt-4 w-full sm:w-auto">
        New patient (not registered yet)
      </Button>
    </Card>
  );
};

const NewPatientForm = ({ value, onChange }) => {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor="np-name" required className="sm:col-span-2">
        <Input id="np-name" autoFocus value={value.name} onChange={set("name")} maxLength={80} autoComplete="off" />
      </Field>
      <Field label="Phone" htmlFor="np-phone" hint="A family can share one number.">
        <Input id="np-phone" type="tel" inputMode="tel" value={value.phone} onChange={set("phone")} placeholder="03xx xxxxxxx" />
      </Field>
      <Field label="CNIC (optional)" htmlFor="np-cnic">
        <Input id="np-cnic" inputMode="numeric" value={value.cnic} onChange={set("cnic")} placeholder="13 digits" maxLength={15} />
      </Field>
      <Field label="Age" htmlFor="np-age">
        <Input id="np-age" inputMode="numeric" value={value.age} onChange={set("age")} placeholder="e.g. 45" maxLength={20} />
      </Field>
      <Field label="Gender" htmlFor="np-gender">
        <Select id="np-gender" value={value.gender} onChange={set("gender")}>
          <option value="">—</option>
          <option>Male</option>
          <option>Female</option>
          <option>Other</option>
        </Select>
      </Field>
    </div>
  );
};

const PatientArrived = () => {
  const { aToken, backendUrl, doctors, getAllDoctors, dashData, getDashData } = useContext(AdminContext);
  const { slotDateFormat } = useContext(AppContext);
  const headers = useMemo(() => ({ atoken: aToken }), [aToken]);

  const [patient, setPatient] = useState(null); // existing patient picked in step 1
  const [newPatient, setNewPatient] = useState(null); // form values when registering
  const [docId, setDocId] = useState("");
  const [visit, setVisit] = useState(emptyVisit);
  const [autoPrint, setAutoPrint] = useState(readAutoPrint);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null); // { token, estimate, doctorName, checkedIn, existing }

  useEffect(() => {
    if (!aToken) return;
    getAllDoctors();
    getDashData({ silent: true }); // waiting counts on the doctor tiles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aToken]);

  // A chosen patient's WhatsApp consent is already on record
  useEffect(() => {
    if (patient) setVisit((v) => ({ ...v, notify: Boolean(patient.whatsappEnabled), language: patient.language || v.language }));
  }, [patient]);

  const todayRows = useMemo(() => new Map((dashData?.todayDoctors?.doctors || []).map((r) => [String(r.docId), r])), [dashData]);
  const doctorName = (id) => doctors.find((d) => d._id === id)?.name || "";
  const chosenDoctor = doctors.find((d) => d._id === docId);

  const reset = () => {
    setPatient(null);
    setNewPatient(null);
    setDocId("");
    setVisit(emptyVisit);
    setResult(null);
    getDashData({ silent: true }); // waiting counts have changed
  };

  const slip = ({ token, estimate, doctorName: name }) => ({
    number: token.number,
    patientName: token.patientName,
    doctorName: name,
    dateText: slotDateFormat(token.day),
    issuedTime: timeOf(token.issuedAt),
    ahead: estimate?.ahead,
    waitMinutes: estimate?.waitMinutes,
    urgent: token.urgent,
    trackUrl: token.trackUrl,
  });

  // Same as the Queue page: the print window opens inside the click, and is filled
  // once the server has answered (so the browser doesn't block it as a popup)
  const issue = async (forDocId, body, key) => {
    if (busy) return;
    setBusy(key);
    const win = autoPrint ? openPrintWindow() : null;
    try {
      const { data } = await axios.post(`${backendUrl}/api/queue/issue`, { ...body, docId: forDocId }, { headers, timeout: 15000 });
      if (!data.success) {
        win?.close();
        toast.error(data.message, TOAST);
        return;
      }
      // Fresh queue: how many are ahead and the wait, for the screen and the slip
      const { data: fresh } = await axios
        .get(`${backendUrl}/api/queue`, { headers, params: { docId: forDocId }, timeout: 15000 })
        .catch(() => ({ data: null }));
      const done = {
        token: data.token,
        estimate: fresh?.queue?.tokens?.find((t) => t._id === data.token._id)?.estimate,
        doctorName: doctorName(forDocId),
        checkedIn: Boolean(body.appointmentId),
        existing: data.existing,
      };
      setResult(done);
      if (win) printTokenSlip(slip(done), win);
    } catch (error) {
      win?.close();
      toast.error(error.response?.data?.message || "No connection. Please try again.", TOAST);
    } finally {
      setBusy("");
    }
  };

  const giveToken = () => {
    if (!docId) return toast.error("Choose the doctor", TOAST);
    if (newPatient && !newPatient.name.trim()) return toast.error("Please enter the patient's name", TOAST);
    const phoneKnown = patient ? patient.phone : newPatient?.phone.trim();
    if (visit.notify && !phoneKnown) return toast.error("Enter a phone number for WhatsApp updates, or turn them off", TOAST);
    return issue(
      docId,
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
  };

  const reprint = () => {
    if (!printTokenSlip(slip(result))) toast.error("The print window was blocked. Allow pop-ups for this site.", TOAST);
  };

  // ---------- Step 3: the token ----------
  if (result) {
    const { token, estimate } = result;
    return (
      <Page narrow>
        <Card className="mx-auto max-w-xl text-center" aria-live="polite">
          <FaCheckCircle aria-hidden="true" className="mx-auto text-4xl text-green-600" />
          <p className="mt-2 text-slate-700">
            {result.existing ? "Already checked in. Same token:" : result.checkedIn ? "Checked in. Token:" : "Token given:"}
          </p>
          <p className="font-display text-8xl font-bold leading-none tabular-nums text-slate-900" data-testid="token-number">
            {token.number}
          </p>
          <p className="mt-3 text-lg font-semibold text-slate-900">{token.patientName}</p>
          <p className="text-slate-600">Dr. {result.doctorName}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {token.urgent && <Badge tone="danger">Urgent</Badge>}
            {estimate && (
              <Badge tone="neutral">
                {estimate.ahead === 0 ? "Next in line" : `${estimate.ahead} ahead`}
                {estimate.waitMinutes > 0 && ` · about ${estimate.waitMinutes} min`}
              </Badge>
            )}
            {token.notify && (
              <Badge tone="success" icon={<FaWhatsapp />}>
                Token sent on WhatsApp
              </Badge>
            )}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button variant="primary" size="lg" icon={<FaUserPlus />} onClick={reset} autoFocus>
              Next patient
            </Button>
            <Button size="lg" icon={<FaPrint />} onClick={reprint}>
              Print slip
            </Button>
          </div>
          <Link to={`/queue?doc=${token.docId}`} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:underline">
            <FaListOl aria-hidden="true" /> Open Dr. {result.doctorName}&apos;s queue
          </Link>
        </Card>
      </Page>
    );
  }

  // ---------- Step 1: find ----------
  if (!patient && !newPatient) {
    return (
      <Page narrow>
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-slate-900">Patient arrived</h1>
          <p className="mt-1 text-sm text-slate-600">Find the patient, then check in their appointment or give a token.</p>
        </div>
        <FindPatient headers={headers} backendUrl={backendUrl} onPick={setPatient} onNew={setNewPatient} />
      </Page>
    );
  }

  // ---------- Step 2: appointment or doctor ----------
  const booked = patient?.appointmentsToday || [];
  const holding = patient?.tokensToday || [];
  return (
    <Page narrow>
      <div className="mb-5 flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={<FaArrowLeft />} onClick={reset}>
          Back
        </Button>
        <h1 className="text-2xl font-semibold text-slate-900">Patient arrived</h1>
      </div>

      <Card className="mb-4">
        {patient ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold text-slate-900">{patient.name}</p>
              <p className="text-sm text-slate-600">{details(patient) || "No other details on record"}</p>
            </div>
            <Button size="sm" onClick={reset}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">New patient</h2>
              <Button size="sm" onClick={reset}>
                Search instead
              </Button>
            </div>
            <NewPatientForm value={newPatient} onChange={setNewPatient} />
          </>
        )}
      </Card>

      {holding.length > 0 && (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          {holding.map((t) => (
            <p key={`${t.docId}-${t.number}`}>
              Already has token <strong>#{t.number}</strong> for Dr. {t.doctorName} ({t.status === "called" ? "with the doctor now" : "waiting"}).
            </p>
          ))}
        </div>
      )}

      {booked.length > 0 && (
        <Card className="mb-4 border-primary-300">
          <StepTitle number={2}>Booked for today: check in</StepTitle>
          <div className="space-y-3">
            {booked.map((a) => (
              <Button
                key={a._id}
                variant="primary"
                size="lg"
                icon={<FaSignInAlt />}
                loading={busy === `checkin-${a._id}`}
                disabled={Boolean(busy)}
                onClick={() => issue(String(a.docId), { appointmentId: a._id }, `checkin-${a._id}`)}
                className="w-full !h-auto py-4 text-left"
              >
                Check in: Dr. {a.doctorName} at {a.slotTime}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-600">Came for a different doctor? Give a new token below.</p>
        </Card>
      )}

      <Card>
        <StepTitle number={booked.length ? 3 : 2}>{booked.length ? "Or give a token for another doctor" : "Which doctor?"}</StepTitle>
        <div role="radiogroup" aria-label="Doctor" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {doctors.map((d) => {
            const row = todayRows.get(String(d._id));
            const selected = d._id === docId;
            return (
              <button
                key={d._id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setDocId(d._id)}
                className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                  selected ? "border-primary bg-primary-50" : "border-slate-200 hover:border-primary-300"
                }`}
              >
                <Avatar src={d.image} name={d.name} className="h-11 w-11 shrink-0" textClass="text-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">Dr. {d.name}</span>
                  <span className="block truncate text-sm text-slate-600">
                    {d.speciality}
                    {d.fee != null && ` · Rs. ${d.fee}`}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="neutral">{row ? `${row.waiting} waiting` : "–"}</Badge>
                    {row?.paused && <Badge tone="warning">On a break</Badge>}
                    {d.available === false && <Badge tone="neutral">Not available</Badge>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {docId && (
          <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
            <Field label="Fee (Rs.)" htmlFor="arrived-fee" hint="Leave empty for the doctor's usual fee.">
              <Input
                id="arrived-fee"
                type="number"
                min="0"
                inputMode="numeric"
                value={visit.fee}
                onChange={(e) => setVisit({ ...visit, fee: e.target.value })}
                placeholder={chosenDoctor?.fee != null ? String(chosenDoctor.fee) : ""}
                className="sm:max-w-xs"
              />
            </Field>
            <label className="flex items-start gap-3 text-slate-800">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={visit.notify} onChange={(e) => setVisit({ ...visit, notify: e.target.checked })} />
              <span>
                Send the token on WhatsApp
                <span className="block text-sm text-slate-500">Only if the patient agreed. They also get a message when their turn is near.</span>
              </span>
            </label>
            {visit.notify && <LanguageSelect value={visit.language} onChange={(language) => setVisit({ ...visit, language })} />}
            <label className="flex items-start gap-3 text-slate-800">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={visit.urgent} onChange={(e) => setVisit({ ...visit, urgent: e.target.checked })} />
              <span>
                Urgent
                <span className="block text-sm text-slate-500">Emergency, very old, disabled or pregnant: seen before the regular line.</span>
              </span>
            </label>
            <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={autoPrint}
                  onChange={(e) => {
                    setAutoPrint(e.target.checked);
                    writeAutoPrint(e.target.checked);
                  }}
                />
                Print token slip
              </label>
              <Button variant="primary" size="lg" loading={busy === "walkin"} disabled={Boolean(busy)} onClick={giveToken} className="w-full sm:w-auto">
                Give token for Dr. {chosenDoctor?.name}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
};

export default PatientArrived;
