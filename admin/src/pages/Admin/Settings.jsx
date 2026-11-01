import { useContext, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { FaWhatsapp, FaEnvelope, FaCheck, FaTimes, FaClock, FaFileAlt, FaHospital, FaSyncAlt } from "react-icons/fa";
import { AdminContext } from "../../context/AdminContext";
import { HOSPITAL_ADDRESS, HOSPITAL_LOGO, HOSPITAL_NAME, HOSPITAL_NAME_URDU, HOSPITAL_PHONE, PRODUCT_NAME } from "../../config";
import { Badge, Button, Card, Skeleton } from "../../components/ui";

// Which services are connected for this hospital, in plain language.
// (Services are configured on the server; see backend/.env.example.)

const providerLabels = { kapso: "Kapso", meta: "Meta Cloud API", twilio: "Twilio" };

// Readable names for the WhatsApp message types (whatsapp/templates.js)
const TEMPLATE_LABELS = {
  appointment_confirmation: "Booking confirmation (patient)",
  appointment_confirmation_doctor: "New booking (doctor)",
  appointment_reminder: "Appointment reminder (patient)",
  appointment_reminder_doctor: "Appointment reminder (doctor)",
  appointment_rescheduled: "Appointment moved (patient)",
  appointment_cancelled: "Appointment cancelled (patient)",
  queue_token: "Queue token number (patient)",
  queue_turn_near: "Your turn is near (patient)",
};
const TEMPLATE_STATUS = {
  APPROVED: { label: "Approved", tone: "success" },
  PENDING: { label: "In review", tone: "warning" },
  REJECTED: { label: "Rejected", tone: "danger" },
  MISSING: { label: "Not submitted", tone: "neutral" },
  PAUSED: { label: "Paused", tone: "warning" },
  DISABLED: { label: "Disabled", tone: "danger" },
};

const Connected = ({ on, onText = "Connected", offText = "Not connected" }) =>
  on ? (
    <Badge tone="success" icon={<FaCheck />}>
      {onText}
    </Badge>
  ) : (
    <Badge tone="danger" icon={<FaTimes />}>
      {offText}
    </Badge>
  );

const Section = ({ icon, title, description, status, children }) => (
  <Card>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description && <p className="text-sm text-slate-600">{description}</p>}
        </div>
      </div>
      {status}
    </div>
    {children}
  </Card>
);

const Settings = () => {
  const { aToken, backendUrl } = useContext(AdminContext);
  const [status, setStatus] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [testingWhatsApp, setTestingWhatsApp] = useState(false);

  const loadStatus = async () => {
    setLoadFailed(false);
    try {
      const { data } = await axios.get(backendUrl + "/api/admin/system-status", { headers: { aToken } });
      if (data.success) setStatus(data.status);
      else setLoadFailed(true);
    } catch (error) {
      console.error("Error loading system status:", error);
      setLoadFailed(true);
    }
  };

  const testWhatsApp = async () => {
    setTestingWhatsApp(true);
    try {
      const { data } = await axios.post(backendUrl + "/api/whatsapp/test", {}, { headers: { aToken } });
      if (data.success) toast.success("Test WhatsApp message sent successfully!");
      else toast.error(data.message);
    } catch (error) {
      toast.error(error.response?.data?.message || "WhatsApp test failed");
    } finally {
      setTestingWhatsApp(false);
    }
  };

  useEffect(() => {
    if (aToken) loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aToken]);

  const loading = !status && !loadFailed;

  return (
    <div className="w-full p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Your hospital&apos;s details and the messaging services patients receive.</p>
      </div>

      <div className="space-y-4">
        <Section icon={<FaHospital />} title="Hospital" description="Printed on slips and shown in the app">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Name</dt>
              {HOSPITAL_LOGO && (
                <dd>
                  <img src={HOSPITAL_LOGO} alt={`${HOSPITAL_NAME} logo`} className="my-1 h-16 w-16 object-contain" />
                </dd>
              )}
              <dd className="font-medium text-slate-900">{HOSPITAL_NAME}</dd>
              {HOSPITAL_NAME_URDU && (
                <dd lang="ur" dir="rtl" className="text-left text-slate-900">
                  {HOSPITAL_NAME_URDU}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-slate-500">Phone</dt>
              <dd className="font-medium tabular-nums text-slate-900">{HOSPITAL_PHONE}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Address</dt>
              <dd className="font-medium text-slate-900">{HOSPITAL_ADDRESS || <span className="font-normal text-slate-500">Not set</span>}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">To change these details, contact {PRODUCT_NAME} support.</p>
        </Section>

        {loadFailed && (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-800">Couldn&apos;t check the messaging services. Check the internet connection.</p>
            <Button size="sm" icon={<FaSyncAlt />} onClick={loadStatus}>
              Try again
            </Button>
          </Card>
        )}

        {loading && (
          <>
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </>
        )}

        {status && (
          <>
            <Section
              icon={<FaWhatsapp />}
              title="WhatsApp messages"
              description={`Confirmations, reminders and cancellations${status.whatsappProvider ? ` via ${providerLabels[status.whatsappProvider] || status.whatsappProvider}` : ""}`}
              status={<Connected on={status.whatsappConfigured} />}
            >
              {status.whatsappConfigured ? (
                <Button icon={<FaWhatsapp />} loading={testingWhatsApp} onClick={testWhatsApp}>
                  {testingWhatsApp ? "Sending" : "Send a test message"}
                </Button>
              ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  WhatsApp isn&apos;t connected yet, so patients don&apos;t get confirmations or reminders. Contact {PRODUCT_NAME} support to connect it. Booking and the
                  queue work without it.
                </p>
              )}
            </Section>

            {status.whatsappConfigured && (
              <Section
                icon={<FaClock />}
                title="Automatic reminders"
                description="Sent on WhatsApp before each appointment"
                status={<Connected on={status.remindersEnabled} onText="On" offText="Off" />}
              >
                {status.remindersEnabled ? (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {status.reminderDayBeforeAt && (
                      <li>
                        Patient: the evening before at <strong>{status.reminderDayBeforeAt}</strong>
                      </li>
                    )}
                    {status.reminderMinutesBefore > 0 && (
                      <li>
                        Patient and doctor: <strong>{status.reminderMinutesBefore} minutes</strong> before
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-700">Reminders are turned off for this hospital.</p>
                )}
                <p className="mt-3 text-xs text-slate-500">To change these times, contact {PRODUCT_NAME} support.</p>
              </Section>
            )}

            {(status.templates || status.templatesError) && (
              <Section
                icon={<FaFileAlt />}
                title="WhatsApp message formats"
                description="Each message type is reviewed by WhatsApp (Meta) before it can be sent"
                status={!status.templatesError && <Connected on={status.templates?.every((t) => t.status === "APPROVED")} onText="All approved" offText="Some not approved" />}
              >
                {status.templatesError ? (
                  <p className="text-sm text-red-700">Could not load the message formats: {status.templatesError}</p>
                ) : (
                  <>
                    <ul className="divide-y divide-slate-100">
                      {status.templates.map((t) => {
                        const s = TEMPLATE_STATUS[t.status] || { label: t.status, tone: "neutral" };
                        return (
                          <li key={`${t.name}-${t.language}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                            <span className="text-slate-700">
                              {TEMPLATE_LABELS[t.name] || t.name}
                              {t.language && <span className="ml-2 text-xs text-slate-500">{t.language === "ur" ? "Urdu" : "English"}</span>}
                            </span>
                            <Badge tone={s.tone}>{s.label}</Badge>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-3 text-xs text-slate-500">
                      Review usually takes a few hours. Until an Urdu version is approved, Urdu patients get the English one.
                    </p>
                  </>
                )}
              </Section>
            )}

            <Section
              icon={<FaEnvelope />}
              title="Email"
              description="Appointment and password-reset emails"
              status={<Connected on={status.emailConfigured} />}
            >
              {status.emailConfigured ? (
                <p className="text-sm text-slate-700">Patients with an email address and doctors receive appointment confirmations by email.</p>
              ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Email isn&apos;t connected yet. Contact {PRODUCT_NAME} support to connect it. Doctors need it to reset a forgotten password.
                </p>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;
