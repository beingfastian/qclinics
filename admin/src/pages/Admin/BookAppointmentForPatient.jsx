import { useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { FaWhatsapp, FaEnvelope, FaSearch, FaChevronLeft, FaChevronRight, FaUserPlus, FaCheck } from "react-icons/fa";
import { getDaySlots, toSlotDate } from "../../utils/slots";
import { AdminContext } from "../../context/AdminContext.jsx";
import { AppContext } from "../../context/AppContext.jsx";
import PrintSlipDialog from "../../components/PrintSlip";
import LanguageSelect from "../../components/LanguageSelect";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Skeleton } from "../../components/ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const emptyNewPatient = {
  name: "",
  email: "",
  phone: "",
  cnic: "",
  dob: "",
  gender: "Male",
  address: { line1: "", line2: "" },
  whatsappEnabled: false,
  whatsappNumber: "",
  language: "ur",
};

// What is still missing on the new-patient form (shown under each field)
const newPatientErrors = (p) => {
  const errors = {};
  if (!p.name.trim()) errors.name = "Enter the patient's name";
  if (!p.phone.trim()) errors.phone = "Enter a phone number";
  if (!/^\d{13}$/.test(p.cnic)) errors.cnic = "CNIC must be exactly 13 digits";
  if (!p.dob) errors.dob = "Enter the date of birth";
  if (!p.address.line1.trim()) errors.line1 = "Enter the address";
  if (p.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) errors.email = "This email doesn't look right";
  if (p.whatsappEnabled && !p.whatsappNumber.trim()) errors.whatsappNumber = "Enter the WhatsApp number";
  return errors;
};

// Search as you type, the same lookup the live queue uses (phone, name or CNIC)
const usePatientSearch = (query, backendUrl, aToken) => {
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults(null);
      setSearching(false);
      return undefined;
    }
    const request = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await axios.get(`${backendUrl}/api/queue/patients`, { headers: { atoken: aToken }, params: { q: text }, timeout: 15000 });
        if (request === latest.current) setResults(data.success ? data.patients : []);
      } catch {
        if (request === latest.current) setResults([]);
      } finally {
        if (request === latest.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, backendUrl, aToken]);
  return { results, searching };
};

// Start the new-patient form with what was typed in the search box
const prefillFrom = (query) => {
  const text = query.trim();
  const digits = text.replace(/\D/g, "");
  if (digits.length === 13 && digits === text.replace(/[-\s]/g, "")) return { ...emptyNewPatient, cnic: digits };
  if (digits.length >= 4 && digits.length >= text.replace(/[\s+()-]/g, "").length - 1) return { ...emptyNewPatient, phone: text };
  return { ...emptyNewPatient, name: text };
};

const SummaryRow = ({ label, children }) => (
  <div className="flex justify-between gap-3 py-2 text-sm">
    <dt className="text-slate-600">{label}</dt>
    <dd className="text-right font-medium text-slate-900">{children}</dd>
  </div>
);

const BookAppointmentForPatient = () => {
  const { aToken, doctors, getAllDoctors, backendUrl } = useContext(AdminContext);
  const { slotDateFormat, currency } = useContext(AppContext);

  // Patient: "existing" (picked from search) or "new" (registered with this booking)
  const [patientSelectionMode, setPatientSelectionMode] = useState("existing");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [query, setQuery] = useState("");
  const [newPatientData, setNewPatientData] = useState(emptyNewPatient);
  const [showPatientErrors, setShowPatientErrors] = useState(false);
  const { results, searching } = usePatientSearch(query, backendUrl, aToken);

  // Doctor and time
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [month, setMonth] = useState(() => ({ m: new Date().getMonth(), y: new Date().getFullYear() }));
  const [slotIndex, setSlotIndex] = useState(0);
  const [slotTime, setSlotTime] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [isBooking, setIsBooking] = useState(false);
  // Set after a booking succeeds: printable slip details
  const [slip, setSlip] = useState(null);

  useEffect(() => {
    if (aToken) getAllDoctors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aToken]);

  // Days in the shown month (from today) with at least one free slot
  const docSlots = useMemo(() => {
    if (!selectedDoctor) return [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const first = new Date(month.y, month.m, 1);
    const last = new Date(month.y, month.m + 1, 0);
    const days = [];
    for (let date = new Date(first < startOfToday ? startOfToday : first); date <= last; date.setDate(date.getDate() + 1)) {
      const slots = getDaySlots(selectedDoctor, date, now);
      if (slots.length) days.push(slots);
    }
    return days;
  }, [selectedDoctor, month]);

  const now = new Date();
  const isCurrentMonth = month.y === now.getFullYear() && month.m === now.getMonth();
  const changeMonth = (delta) => {
    setMonth(({ m, y }) => {
      const d = new Date(y, m + delta, 1);
      return { m: d.getMonth(), y: d.getFullYear() };
    });
    setSlotIndex(0);
    setSlotTime("");
  };

  const chooseDoctor = (doctor) => {
    setSelectedDoctor(doctor);
    setMonth({ m: now.getMonth(), y: now.getFullYear() });
    setSlotIndex(0);
    setSlotTime("");
  };

  const handleNewPatientDataChange = (field, value) => {
    if (field === "cnic") {
      const clean = value.replace(/\D/g, "");
      if (clean.length <= 13) setNewPatientData((prev) => ({ ...prev, cnic: clean }));
      return;
    }
    if (field.includes(".")) {
      const [parent, child] = field.split(".");
      setNewPatientData((prev) => ({ ...prev, [parent]: { ...prev[parent], [child]: value } }));
    } else {
      setNewPatientData((prev) => ({ ...prev, [field]: value }));
    }
  };

  const startNewPatient = () => {
    setPatientSelectionMode("new");
    setSelectedPatient(null);
    setNewPatientData(prefillFrom(query));
    setShowPatientErrors(false);
  };

  const patientErrors = patientSelectionMode === "new" ? newPatientErrors(newPatientData) : {};
  const patientReady = patientSelectionMode === "existing" ? Boolean(selectedPatient) : Object.keys(patientErrors).length === 0;
  const patientData = patientSelectionMode === "existing" ? selectedPatient : newPatientData;

  const calculateDiscountedFee = () => {
    if (!selectedDoctor || !discountPercent) return selectedDoctor?.fee || 0;
    return selectedDoctor.fee - (selectedDoctor.fee * discountPercent) / 100;
  };

  const chosenDate = docSlots[slotIndex]?.[0]?.datetime;
  const missing = !patientReady ? "the patient" : !selectedDoctor ? "a doctor" : !slotTime ? "a time" : null;

  const resetForm = () => {
    setSelectedPatient(null);
    setNewPatientData(emptyNewPatient);
    setPatientSelectionMode("existing");
    setQuery("");
    setShowPatientErrors(false);
    setSelectedDoctor(null);
    setSlotIndex(0);
    setSlotTime("");
    setDiscountPercent(0);
  };

  const bookAppointment = async () => {
    if (!patientReady) {
      setShowPatientErrors(true);
      toast.error(patientSelectionMode === "existing" ? "Please select a patient" : "Please complete the patient's details");
      return;
    }
    if (!selectedDoctor || !slotTime || !chosenDate) {
      toast.error("Please select a doctor and time slot");
      return;
    }
    setIsBooking(true);
    try {
      const slotDate = toSlotDate(chosenDate);
      const finalFee = calculateDiscountedFee();
      const bookingData = {
        patientSelectionMode,
        selectedPatientId: patientSelectionMode === "existing" ? selectedPatient?._id || null : null,
        newPatientData: patientSelectionMode === "new" ? { ...newPatientData, email: newPatientData.email.trim() } : null,
        docId: selectedDoctor._id,
        slotDate,
        slotTime,
        discountPercent: discountPercent || 0,
        finalFee,
      };
      const { data } = await axios.post(backendUrl + "/api/admin/book-appointment-for-patient", bookingData, { headers: { aToken } });

      if (data.success) {
        toast.success(data.message);
        toast.info(patientData.whatsappEnabled ? "WhatsApp confirmation will be sent to patient!" : "Email confirmation will be sent to patient!");
        // The server's values, so the slip matches what was saved; the patient
        // leaves with the date and time on paper
        setSlip({
          patientName: data.appointment?.patientName || patientData.name,
          doctorName: selectedDoctor.name,
          speciality: selectedDoctor.speciality,
          dateText: slotDateFormat(data.appointment?.slotDate || slotDate),
          time: data.appointment?.slotTime || slotTime,
          fee: typeof data.appointment?.amount === "number" ? data.appointment.amount : finalFee,
        });
        resetForm();
        getAllDoctors(); // fresh booked slots
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to book appointment");
    } finally {
      setIsBooking(false);
    }
  };

  const errorFor = (key) => (showPatientErrors ? patientErrors[key] : undefined);
  const availableDoctors = doctors.filter((d) => d.available);

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Book appointment</h1>
          <p className="mt-1 text-sm text-slate-600">Find the patient, pick a doctor and a time.</p>
        </div>
        <Button onClick={resetForm}>Start over</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* 1. Patient */}
          <Card>
            <CardHeader title="1. Patient" description="Search first, so the same patient isn't registered twice." />

            {patientSelectionMode === "existing" && selectedPatient && (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={selectedPatient.name} className="h-10 w-10 shrink-0" textClass="text-sm" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{selectedPatient.name}</p>
                    <p className="text-sm text-slate-600">
                      {[selectedPatient.age, selectedPatient.gender, selectedPatient.phone, selectedPatient.cnicLast4 && `CNIC ••••${selectedPatient.cnicLast4}`]
                        .filter(Boolean)
                        .join(" · ") || "No other details on record"}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelectedPatient(null)}>
                  Change
                </Button>
              </div>
            )}

            {patientSelectionMode === "existing" && !selectedPatient && (
              <div className="space-y-3">
                <Field label="Find the patient" htmlFor="book-search">
                  <div className="relative">
                    <FaSearch aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="book-search"
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Phone number, name or CNIC"
                      autoComplete="off"
                      className="pl-9"
                      autoFocus
                    />
                  </div>
                </Field>

                {searching && <Skeleton className="h-12 w-full" />}
                {!searching && results && results.length > 0 && (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Matching patients">
                    {results.map((p) => (
                      <li key={p._id}>
                        <button
                          type="button"
                          onClick={() => setSelectedPatient(p)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <Avatar name={p.name} className="h-9 w-9 shrink-0" textClass="text-sm" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-900">{p.name}</span>
                              <span className="block truncate text-sm text-slate-600">
                                {[p.age, p.gender, p.phone, p.cnicLast4 && `CNIC ••••${p.cnicLast4}`].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </span>
                          {p.whatsappEnabled && <FaWhatsapp className="shrink-0 text-emerald-700" aria-label="WhatsApp messages on" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!searching && results && results.length === 0 && (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">No patient found for “{query.trim()}”.</p>
                )}
                {!results && query.trim().length < 2 && <p className="text-sm text-slate-500">Type at least 2 letters or digits.</p>}

                <Button icon={<FaUserPlus />} onClick={startNewPatient} variant={results && results.length === 0 ? "primary" : "secondary"}>
                  Register new patient
                </Button>
              </div>
            )}

            {patientSelectionMode === "new" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone="info" icon={<FaUserPlus />}>
                    New patient, registered with this booking
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => setPatientSelectionMode("existing")}>
                    Search instead
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Full name" htmlFor="np-name" required error={errorFor("name")}>
                    <Input id="np-name" value={newPatientData.name} onChange={(e) => handleNewPatientDataChange("name", e.target.value)} invalid={Boolean(errorFor("name"))} autoComplete="off" />
                  </Field>
                  <Field label="Phone" htmlFor="np-phone" required error={errorFor("phone")} hint="A family can share one number.">
                    <Input id="np-phone" type="tel" inputMode="tel" value={newPatientData.phone} onChange={(e) => handleNewPatientDataChange("phone", e.target.value)} placeholder="03xx xxxxxxx" invalid={Boolean(errorFor("phone"))} />
                  </Field>
                  <Field label="CNIC" htmlFor="np-cnic" required error={errorFor("cnic")} hint={`13 digits, no dashes (${newPatientData.cnic.length}/13)`}>
                    <Input id="np-cnic" inputMode="numeric" value={newPatientData.cnic} onChange={(e) => handleNewPatientDataChange("cnic", e.target.value)} placeholder="3520212345671" invalid={Boolean(errorFor("cnic"))} />
                  </Field>
                  <Field label="Date of birth" htmlFor="np-dob" required error={errorFor("dob")}>
                    <Input id="np-dob" type="date" value={newPatientData.dob} onChange={(e) => handleNewPatientDataChange("dob", e.target.value)} invalid={Boolean(errorFor("dob"))} />
                  </Field>
                  <Field label="Gender" htmlFor="np-gender">
                    <Select id="np-gender" value={newPatientData.gender} onChange={(e) => handleNewPatientDataChange("gender", e.target.value)}>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </Select>
                  </Field>
                  <Field label="Email (optional)" htmlFor="np-email" error={errorFor("email")}>
                    <Input id="np-email" type="email" value={newPatientData.email} onChange={(e) => handleNewPatientDataChange("email", e.target.value)} invalid={Boolean(errorFor("email"))} />
                  </Field>
                  <Field label="Address" htmlFor="np-line1" required error={errorFor("line1")} className="md:col-span-2">
                    <Input id="np-line1" value={newPatientData.address.line1} onChange={(e) => handleNewPatientDataChange("address.line1", e.target.value)} placeholder="House, street, village or area" invalid={Boolean(errorFor("line1"))} />
                  </Field>
                  <Field label="Address line 2" htmlFor="np-line2" className="md:col-span-2">
                    <Input id="np-line2" value={newPatientData.address.line2} onChange={(e) => handleNewPatientDataChange("address.line2", e.target.value)} placeholder="City / district" />
                  </Field>
                </div>

                <div className="rounded-lg border border-slate-200 p-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={newPatientData.whatsappEnabled}
                      onChange={(e) => handleNewPatientDataChange("whatsappEnabled", e.target.checked)}
                      className="mt-1 h-4 w-4 accent-primary-700"
                    />
                    <span>
                      <span className="flex items-center gap-2 font-medium text-slate-900">
                        <FaWhatsapp aria-hidden="true" className="text-emerald-700" /> Send confirmations and reminders on WhatsApp
                      </span>
                      <span className="block text-sm text-slate-600">Only if the patient agreed to receive messages.</span>
                    </span>
                  </label>
                  {newPatientData.whatsappEnabled && (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Field label="WhatsApp number" htmlFor="np-wa" required error={errorFor("whatsappNumber")} hint="With country code, e.g. +923001234567">
                        <Input id="np-wa" type="tel" value={newPatientData.whatsappNumber} onChange={(e) => handleNewPatientDataChange("whatsappNumber", e.target.value)} placeholder="+923001234567" invalid={Boolean(errorFor("whatsappNumber"))} />
                      </Field>
                      <LanguageSelect value={newPatientData.language} onChange={(value) => handleNewPatientDataChange("language", value)} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* 2. Doctor */}
          <Card>
            <CardHeader title="2. Doctor" description="Only doctors marked available are shown." />
            {availableDoctors.length ? (
              <div role="radiogroup" aria-label="Doctor" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {availableDoctors.map((doctor) => {
                  const chosen = selectedDoctor?._id === doctor._id;
                  return (
                    <button
                      key={doctor._id}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => chooseDoctor(doctor)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        chosen ? "border-primary bg-primary-50" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <Avatar src={doctor.image} name={doctor.name} className="h-11 w-11 shrink-0" textClass="text-sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-900">Dr. {doctor.name}</span>
                        <span className="block truncate text-sm text-slate-600">
                          {doctor.speciality}
                          {doctor.timings && ` · ${doctor.timings.start}–${doctor.timings.end}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">
                        {currency} {doctor.fee}
                      </span>
                      {chosen && <FaCheck aria-hidden="true" className="shrink-0 text-primary-700" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No doctors available" description="Mark a doctor available in Manage Doctors to book with them." />
            )}
          </Card>

          {/* 3. Date and time */}
          <Card>
            <CardHeader title="3. Date and time" description={selectedDoctor ? `Free times for Dr. ${selectedDoctor.name}` : "Pick a doctor first."} />
            {selectedDoctor && (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <Button size="sm" variant="ghost" icon={<FaChevronLeft />} onClick={() => changeMonth(-1)} disabled={isCurrentMonth}>
                    Previous
                  </Button>
                  <p className="font-medium text-slate-900">
                    {MONTHS[month.m]} {month.y}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => changeMonth(1)}>
                    Next <FaChevronRight aria-hidden="true" className="ml-1 inline" />
                  </Button>
                </div>

                {docSlots.length ? (
                  <>
                    <div role="radiogroup" aria-label="Day" className="flex gap-2 overflow-x-auto pb-1">
                      {docSlots.map((day, index) => {
                        const date = day[0].datetime;
                        const chosen = slotIndex === index;
                        return (
                          <button
                            key={toSlotDate(date)}
                            type="button"
                            role="radio"
                            aria-checked={chosen}
                            aria-label={date.toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long" })}
                            onClick={() => {
                              setSlotIndex(index);
                              setSlotTime("");
                            }}
                            className={`flex min-w-[64px] flex-col items-center rounded-lg border px-3 py-2 transition-colors ${
                              chosen ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                            }`}
                          >
                            <span className="text-xs font-medium uppercase">{date.toLocaleDateString("en-PK", { weekday: "short" })}</span>
                            <span className="font-display text-xl font-semibold tabular-nums">{date.getDate()}</span>
                            <span className={`text-xs ${chosen ? "text-primary-100" : "text-slate-500"}`}>{day.length} free</span>
                          </button>
                        );
                      })}
                    </div>
                    <div role="radiogroup" aria-label="Time" className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                      {docSlots[slotIndex]?.map((item) => (
                        <button
                          key={item.time}
                          type="button"
                          role="radio"
                          aria-checked={item.time === slotTime}
                          onClick={() => setSlotTime(item.time)}
                          className={`rounded-lg border px-2 py-2 text-sm tabular-nums transition-colors ${
                            item.time === slotTime ? "border-primary bg-primary text-white" : "border-slate-200 hover:border-primary-300 hover:bg-primary-50"
                          }`}
                        >
                          {item.time.toLowerCase()}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    No free times in {MONTHS[month.m]}.{" "}
                    <button type="button" onClick={() => changeMonth(1)} className="font-medium underline">
                      Try next month
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Summary and confirm */}
        <div className="lg:col-span-1">
          <Card className="lg:sticky lg:top-20">
            <CardHeader title="Booking summary" />
            <dl className="divide-y divide-slate-100">
              <SummaryRow label="Patient">
                {patientSelectionMode === "new" ? newPatientData.name || <span className="text-slate-500">New patient</span> : selectedPatient?.name || <span className="text-slate-500">Not chosen</span>}
              </SummaryRow>
              <SummaryRow label="Doctor">{selectedDoctor ? `Dr. ${selectedDoctor.name}` : <span className="text-slate-500">Not chosen</span>}</SummaryRow>
              <SummaryRow label="Date & time">
                {slotTime && chosenDate ? `${slotDateFormat(toSlotDate(chosenDate))}, ${slotTime}` : <span className="text-slate-500">Not chosen</span>}
              </SummaryRow>
              <SummaryRow label="Messages">
                {patientData?.whatsappEnabled ? (
                  <span className="inline-flex items-center gap-1">
                    <FaWhatsapp aria-hidden="true" className="text-emerald-700" /> WhatsApp & email
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <FaEnvelope aria-hidden="true" className="text-slate-500" /> Email only
                  </span>
                )}
              </SummaryRow>
            </dl>

            {selectedDoctor && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                <Field label="Discount %" htmlFor="book-discount">
                  <Input
                    id="book-discount"
                    type="number"
                    min="0"
                    max="100"
                    inputMode="numeric"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                  />
                </Field>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-700">Fee</p>
                  <p className="font-display text-2xl font-semibold tabular-nums text-slate-900">
                    {currency} {calculateDiscountedFee()}
                  </p>
                  {discountPercent > 0 && (
                    <p className="text-xs text-slate-500">
                      {currency} {((selectedDoctor.fee * discountPercent) / 100).toFixed(0)} off {currency} {selectedDoctor.fee}
                    </p>
                  )}
                </div>
              </div>
            )}

            <Button variant="primary" size="lg" className="mt-4 w-full" loading={isBooking} onClick={bookAppointment} disabled={Boolean(missing && missing !== "the patient") || isBooking}>
              {isBooking ? "Booking" : "Confirm booking"}
            </Button>
            {missing && (
              <p className="mt-2 text-center text-sm text-slate-600">
                {missing === "the patient" && patientSelectionMode === "new" ? "Complete the patient's details to continue." : `Choose ${missing} to continue.`}
              </p>
            )}
            {patientSelectionMode === "new" && <p className="mt-2 text-center text-xs text-slate-500">A new patient record will be created.</p>}
          </Card>
        </div>
      </div>

      {slip && <PrintSlipDialog title="Appointment booked" details={slip} onClose={() => setSlip(null)} />}
    </div>
  );
};

export default BookAppointmentForPatient;
