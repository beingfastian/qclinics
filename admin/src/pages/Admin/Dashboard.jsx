import { useContext, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaCalendarPlus, FaCalendarTimes, FaChevronRight, FaFlask, FaListOl, FaSearch, FaUserMd, FaUserPlus } from "react-icons/fa";
import { AdminContext } from "../../context/AdminContext.jsx";
import { HOSPITAL_NAME } from "../../config";
import { useLabCounts, useLabEnabled } from "../../lab/api";
import { Avatar, Badge, Button, Card, EmptyState, Skeleton } from "../../components/ui";

const REFRESH_MS = 60000; // queue numbers move all day; keep the screen current

// Hospital time (Pakistan), whatever the computer's clock is set to
const hospitalHour = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", hour: "numeric", hourCycle: "h23" }).format(new Date()));
const greeting = () => {
  const h = hospitalHour();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const todayText = () => new Date().toLocaleDateString("en-PK", { timeZone: "Asia/Karachi", weekday: "long", day: "numeric", month: "long" });

// The four things reception does all day
const TASKS = [
  { to: "/arrived", icon: <FaUserPlus />, title: "Patient arrived", text: "Check in or give a token", primary: true },
  { to: "/book-appointment", icon: <FaCalendarPlus />, title: "Book appointment", text: "For today or another day" },
  { to: "/queue", icon: <FaListOl />, title: "Today's queue", text: "Who is waiting, call next" },
  { to: "/patients", icon: <FaSearch />, title: "Find a patient", text: "By phone, name or CNIC" },
];

const TaskButton = ({ task }) => (
  <Link
    to={task.to}
    className={`group flex items-center gap-4 rounded-2xl border p-5 transition-colors sm:flex-col sm:items-start sm:gap-3 ${
      task.primary
        ? "border-primary bg-primary text-white hover:bg-primary-800"
        : "border-slate-200 bg-white text-slate-900 hover:border-primary-300 hover:bg-primary-50/40"
    }`}
  >
    <span
      aria-hidden="true"
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl ${task.primary ? "bg-white/15 text-white" : "bg-primary-50 text-primary-700"}`}
    >
      {task.icon}
    </span>
    <span className="min-w-0">
      <span className="block font-display text-lg font-bold">{task.title}</span>
      <span className={`block text-sm ${task.primary ? "text-primary-100" : "text-slate-600"}`}>{task.text}</span>
    </span>
  </Link>
);

const TodayNumber = ({ label, value, loading }) => (
  <Card className="min-w-0">
    <p className="text-sm text-slate-600">{label}</p>
    {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="font-display text-3xl font-bold tabular-nums text-slate-900">{value}</p>}
  </Card>
);

// One doctor's day: who is with them, who is waiting, who is still to come
const DoctorTodayRow = ({ row, onOpenQueue }) => (
  <li className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
    <div className="flex min-w-0 flex-1 items-center gap-3 basis-60">
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
    <dl className="grid grid-cols-3 gap-6">
      {[
        ["With doctor", row.nowServing ? `#${row.nowServing}` : "–"],
        ["Waiting", row.waiting],
        ["Still to see", row.toSee],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className="font-display text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
    <Button size="sm" icon={<FaListOl />} onClick={() => onOpenQueue(row.docId)}>
      Open queue
    </Button>
  </li>
);

// Reception home: what to do now. Earnings and totals live on the Reports page.
const Dashboard = () => {
  const navigate = useNavigate();
  const { aToken, getDashData, dashData } = useContext(AdminContext);
  const labEnabled = useLabEnabled();
  const labCounts = useLabCounts(labEnabled && Boolean(aToken));

  useEffect(() => {
    if (!aToken) return undefined;
    getDashData();
    const timer = setInterval(() => document.visibilityState === "visible" && getDashData({ silent: true }), REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aToken]);

  const loading = !dashData;
  const today = dashData?.todayDoctors;
  const totals = today?.totals;
  const openQueue = (docId) => navigate(`/queue?doc=${docId}`);

  // Things waiting for someone, shown only when there are any
  const attention = [
    labEnabled && labCounts.open > 0 && { to: "/lab-requests", icon: <FaFlask />, text: `${labCounts.open} lab request${labCounts.open === 1 ? "" : "s"} waiting for the lab` },
    dashData?.pendingLeave > 0 && { to: "/leave-management", icon: <FaCalendarTimes />, text: `${dashData.pendingLeave} leave request${dashData.pendingLeave === 1 ? "" : "s"} to review` },
  ].filter(Boolean);

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">{greeting()}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {todayText()} · {HOSPITAL_NAME}
        </p>
      </div>

      <nav aria-label="Quick actions" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TASKS.map((task) => (
          <TaskButton key={task.title} task={task} />
        ))}
      </nav>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TodayNumber label="Waiting now" value={totals?.waiting ?? 0} loading={loading} />
        <TodayNumber label="Still to see" value={totals?.toSee ?? 0} loading={loading} />
        <TodayNumber label="Seen today" value={totals?.seen ?? 0} loading={loading} />
        <TodayNumber label="No-shows" value={totals?.noShow ?? 0} loading={loading} />
      </div>

      {attention.length > 0 && (
        <ul className="mt-5 space-y-2">
          {attention.map((a) => (
            <li key={a.to}>
              <Link to={a.to} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 hover:bg-amber-100">
                <span className="flex items-center gap-3 font-medium">
                  <span aria-hidden="true">{a.icon}</span>
                  {a.text}
                </span>
                <FaChevronRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Card padded={false} className="mt-5 overflow-hidden">
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold text-slate-900">Doctors today</h2>
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
    </div>
  );
};

export default Dashboard;
