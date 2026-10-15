import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  FaWhatsapp,
  FaEnvelope,
  FaUserMd,
  FaCalendarCheck,
  FaCalendarPlus,
  FaUsers,
  FaUserSlash,
  FaListOl,
  FaFlask,
  FaCalendarTimes,
  FaUserClock,
  FaCheckCircle,
  FaTimes,
} from "react-icons/fa";
import { AdminContext } from "../../context/AdminContext.jsx";
import { AppContext } from "../../context/AppContext.jsx";
import ProfitReport from "../../components/ProfitReport";
import { useLabCounts, useLabEnabled } from "../../lab/api";
import {
  AppointmentStatus,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  Skeleton,
  StatTile,
  useDialog,
} from "../../components/ui";

const REFRESH_MS = 60000; // queue numbers move all day; keep the screen current

const todayText = () => new Date().toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long" });

// One doctor's day: who is with them, who is waiting, who is still to come
const DoctorTodayRow = ({ row, onOpenQueue }) => {
  const numbers = [
    { label: "With doctor", value: row.nowServing ? `#${row.nowServing}` : "–" },
    { label: "Waiting", value: row.waiting },
    { label: "Still to see", value: row.toSee },
    { label: "Seen", value: row.seen },
    { label: "No-shows", value: row.noShow },
  ];
  return (
    <li className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 items-center gap-3 lg:w-72">
        <Avatar src={row.image} name={row.name} className="h-10 w-10 shrink-0" textClass="text-sm" />
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">Dr. {row.name}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm text-slate-600">{row.speciality}</span>
            {row.paused && <Badge tone="warning">On a break</Badge>}
            {!row.available && <Badge tone="neutral">Not available</Badge>}
          </div>
        </div>
      </div>
      <dl className="grid flex-1 grid-cols-5 gap-2">
        {numbers.map((n) => (
          <div key={n.label} className="min-w-0">
            <dt className="truncate text-xs text-slate-500">{n.label}</dt>
            <dd className="font-display text-lg font-semibold tabular-nums text-slate-900">{n.value}</dd>
          </div>
        ))}
      </dl>
      <Button size="sm" icon={<FaListOl />} onClick={() => onOpenQueue(row.docId)} className="lg:w-auto">
        Open queue
      </Button>
    </li>
  );
};

const Dashboard = () => {
  const { confirm } = useDialog();
  const navigate = useNavigate();
  const { aToken, getDashData, dashData, cancelAppointment, backendUrl, doctors, getAllDoctors } = useContext(AdminContext);
  const { slotDateFormat } = useContext(AppContext);
  const labEnabled = useLabEnabled();
  const labCounts = useLabCounts(labEnabled && Boolean(aToken));
  const [whatsappStats, setWhatsappStats] = useState({ enabledUsers: 0, todayNotifications: 0 });

  const getWhatsAppStats = async () => {
    try {
      const { data } = await axios.get(backendUrl + "/api/admin/whatsapp-stats", { headers: { aToken } });
      if (data.success) setWhatsappStats(data.data);
    } catch (error) {
      console.error("Error fetching WhatsApp stats:", error);
    }
  };

  useEffect(() => {
    if (!aToken) return undefined;
    getAllDoctors(); // for the profit report's doctor filter
    getDashData();
    getWhatsAppStats();
    const timer = setInterval(() => document.visibilityState === "visible" && getDashData({ silent: true }), REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aToken]);

  const loading = !dashData;
  const today = dashData?.todayDoctors;
  const totals = today?.totals;
  const last30 = dashData?.last30Days;
  const openQueue = (docId) => navigate(`/queue?doc=${docId}`);

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Today</h1>
          <p className="mt-1 text-sm text-slate-600">{todayText()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<FaListOl />} onClick={() => navigate("/queue")}>
            Add to queue
          </Button>
          <Button variant="primary" icon={<FaCalendarPlus />} onClick={() => navigate("/book-appointment")}>
            Book appointment
          </Button>
        </div>
      </div>

      {/* What needs attention today */}
      <div className={`grid grid-cols-2 gap-4 mb-6 ${labEnabled ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <StatTile
          label="Still to see"
          value={totals?.toSee ?? 0}
          hint={totals ? `${totals.waiting} waiting in the queue` : undefined}
          icon={<FaUserClock />}
          loading={loading}
          to="/all-appointments"
        />
        <StatTile label="Seen today" value={totals?.seen ?? 0} icon={<FaCheckCircle />} loading={loading} />
        <StatTile
          label="No-shows today"
          value={totals?.noShow ?? 0}
          hint={totals ? `${totals.cancelled} cancelled` : undefined}
          icon={<FaUserSlash />}
          loading={loading}
        />
        {labEnabled && (
          <StatTile
            label="Lab requests open"
            value={labCounts.open ?? 0}
            hint={labCounts.waitingForDoctor ? `${labCounts.waitingForDoctor} reports waiting for doctors` : "Waiting for the lab"}
            icon={<FaFlask />}
            loading={loading}
            to="/lab-requests"
          />
        )}
        <StatTile
          label="Leave to review"
          value={dashData?.pendingLeave ?? 0}
          tone={dashData?.pendingLeave ? "warning" : undefined}
          hint="Doctors' leave requests"
          icon={<FaCalendarTimes />}
          loading={loading}
          to="/leave-management"
        />
      </div>

      {/* Each doctor's day */}
      <Card padded={false} className="mb-6 overflow-hidden">
        <div className="px-5 pt-5">
          <CardHeader title="Doctors today" description="Updates every minute. Open a doctor's queue to check patients in." />
        </div>
        {loading ? (
          <div className="space-y-3 px-5 pb-5">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : today?.doctors?.length ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {today.doctors.map((row) => (
              <DoctorTodayRow key={row.docId} row={row} onOpenQueue={openQueue} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<FaUserMd />}
            title="No doctors yet"
            description="Add your doctors to start booking appointments and running the queue."
            action={<Button variant="primary" onClick={() => navigate("/add-doctor")}>Add doctor</Button>}
          />
        )}
      </Card>

      {/* Hospital profit by day / week / month, per doctor or all */}
      <div className="mb-6">
        <ProfitReport mode="admin" headers={{ atoken: aToken }} doctors={doctors} />
      </div>

      {/* Latest bookings */}
      <Card padded={false} className="mb-6 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <CardHeader title="Latest bookings" description="The most recent appointments, newest first" />
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <FaWhatsapp aria-hidden="true" className="text-emerald-700" /> WhatsApp
            </span>
            <span className="flex items-center gap-1">
              <FaEnvelope aria-hidden="true" className="text-primary-700" /> Email
            </span>
          </div>
        </div>
        {loading ? (
          <div className="space-y-3 px-5 pb-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : dashData.latestAppointments.length ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {dashData.latestAppointments.map((item) => {
              const pending = !item.cancelled && !item.isCompleted && item.status !== "no_show";
              return (
                <li key={item._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar src={item.docData.image} name={item.docData.name} className="h-10 w-10 shrink-0" textClass="text-sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{item.userData.name}</p>
                      <p className="truncate text-sm text-slate-600">
                        Dr. {item.docData.name} · {slotDateFormat(item.slotDate)}, {item.slotTime}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.userData.whatsappEnabled ? (
                      <FaWhatsapp className="text-emerald-700" title="WhatsApp messages on" aria-label="WhatsApp messages on" />
                    ) : (
                      <FaEnvelope className="text-primary-700" title="Email only" aria-label="Email only" />
                    )}
                    <AppointmentStatus item={item} />
                    {pending && (
                      <IconButton
                        label={`Cancel ${item.userData?.name || "this patient"}'s appointment`}
                        tone="danger"
                        icon={<FaTimes />}
                        onClick={async () =>
                          (await confirm({
                            title: `Cancel ${item.userData?.name || "this patient"}'s appointment?`,
                            message: "The time slot is freed and the patient is told on WhatsApp (if they agreed to messages).",
                            confirmLabel: "Cancel appointment",
                            tone: "danger",
                          })) && cancelAppointment(item._id)
                        }
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<FaCalendarCheck />}
            title="No appointments yet"
            description="New bookings will appear here."
            action={<Button variant="primary" onClick={() => navigate("/book-appointment")}>Book appointment</Button>}
          />
        )}
      </Card>

      {/* All-time numbers */}
      <h2 className="mb-3 text-lg font-semibold text-slate-900">All time</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Doctors" value={dashData?.doctors} icon={<FaUserMd />} loading={loading} to="/doctors" />
        <StatTile label="Patients" value={dashData?.patients} icon={<FaUsers />} loading={loading} to="/patients" />
        <StatTile label="Appointments" value={dashData?.appointments} icon={<FaCalendarCheck />} loading={loading} />
        <StatTile
          label="WhatsApp enabled"
          value={whatsappStats.enabledUsers}
          hint={`${whatsappStats.todayNotifications} message${whatsappStats.todayNotifications === 1 ? "" : "s"} sent today`}
          icon={<FaWhatsapp />}
          loading={loading}
        />
        {/* Of patients who should have come (and didn't cancel ahead), how many never showed */}
        <StatTile
          label="No-shows (30 days)"
          value={last30 ? last30.noShow : 0}
          hint={last30 ? `${last30.noShowRate}% missed · ${last30.cancelled} cancelled ahead` : undefined}
          icon={<FaUserSlash />}
          loading={loading}
        />
      </div>
    </div>
  );
};

export default Dashboard;
