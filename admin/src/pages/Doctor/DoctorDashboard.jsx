import { useContext, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarCheck, FaCheckCircle, FaFlask, FaListOl, FaMoneyBillWave, FaUserClock, FaUsers, FaUserSlash, FaWhatsapp } from "react-icons/fa";
import { DoctorContext } from "../../context/DoctorContext";
import { AppContext } from "../../context/AppContext";
import ProfitReport from "../../components/ProfitReport";
import { useLabCounts, useLabEnabled } from "../../lab/api";
import useAppointmentPages from "../../utils/useAppointmentPages";
import { AppointmentStatus, Avatar, Badge, Button, Card, CardHeader, EmptyState, Skeleton, StatTile } from "../../components/ui";

const REFRESH_MS = 60000;

const todayText = () => new Date().toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long" });

const DoctorDashboard = () => {
  const navigate = useNavigate();
  const { getDashData, dashData, dToken, backendUrl, appointmentsVersion } = useContext(DoctorContext);
  const { currency } = useContext(AppContext);
  const labEnabled = useLabEnabled();
  const labCounts = useLabCounts(labEnabled && Boolean(dToken));

  useEffect(() => {
    if (!dToken) return undefined;
    getDashData();
    const timer = setInterval(() => document.visibilityState === "visible" && getDashData({ silent: true }), REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dToken]);

  const loading = !dashData;
  const today = dashData?.today;

  // Today's appointments, in time order (cancelled ones left out); one page holds a whole day
  const { items: todayItems } = useAppointmentPages({
    url: `${backendUrl}/api/doctor/appointments`,
    headers: { dToken },
    filters: { range: "today", counts: "0" },
    refreshKey: appointmentsVersion,
    enabled: Boolean(dToken),
    pageSize: 200,
  });
  const todays = useMemo(() => todayItems.filter((a) => !a.cancelled), [todayItems]);

  const queueHint = !today
    ? undefined
    : today.paused
      ? "You are on a break"
      : today.nowServing
        ? `Token #${today.nowServing} is with you`
        : "Nobody called in yet";

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Today</h1>
          <p className="mt-1 text-sm text-slate-600">{todayText()}</p>
        </div>
        <Button variant="primary" icon={<FaListOl />} onClick={() => navigate("/doctor/queue")}>
          Open my queue
        </Button>
      </div>

      <div className={`grid grid-cols-2 gap-4 mb-6 ${labEnabled ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <StatTile label="Waiting in your queue" value={today?.waiting ?? 0} hint={queueHint} icon={<FaUserClock />} loading={loading} to="/doctor/queue" />
        <StatTile
          label="Still to see"
          value={today?.toSee ?? 0}
          hint={today ? `${today.noShow} no-show${today.noShow === 1 ? "" : "s"} so far` : undefined}
          icon={<FaCalendarCheck />}
          loading={loading}
        />
        <StatTile label="Seen today" value={today?.seen ?? 0} icon={<FaCheckCircle />} loading={loading} />
        {labEnabled && (
          <StatTile
            label="Lab reports to review"
            value={labCounts.toReview ?? 0}
            tone={labCounts.toReview ? "warning" : undefined}
            hint="Approve or send back to the lab"
            icon={<FaFlask />}
            loading={loading}
            to="/doctor/lab-reports"
          />
        )}
      </div>

      {/* Today's list */}
      <Card padded={false} className="mb-6 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <CardHeader title="Today's appointments" description="Booked visits and walk-ins, in time order" />
          <Button size="sm" onClick={() => navigate("/doctor/appointments")}>
            All appointments
          </Button>
        </div>
        {loading ? (
          <div className="space-y-3 px-5 pb-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : todays.length ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {todays.map((item) => (
              <li key={item._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-20 shrink-0 text-sm font-medium tabular-nums text-slate-700">{item.slotTime}</span>
                  <Avatar src={item.userData?.image} name={item.userData?.name} className="h-9 w-9 shrink-0" textClass="text-sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{item.userData?.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                      {item.type === "walk_in" && <Badge tone="neutral">Walk-in</Badge>}
                      {item.type === "follow_up" && <Badge tone="followup">Follow-up</Badge>}
                      {item.userData?.whatsappEnabled && (
                        <FaWhatsapp className="text-emerald-700" title="WhatsApp messages on" aria-label="WhatsApp messages on" />
                      )}
                    </div>
                  </div>
                </div>
                <AppointmentStatus item={item} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<FaCalendarCheck />} title="No appointments today" description="Walk-ins added by reception will appear in your queue." />
        )}
      </Card>

      {/* The doctor's earnings by day / week / month */}
      <div className="mb-6">
        <ProfitReport mode="doctor" headers={{ dtoken: dToken }} />
      </div>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">All time</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="My earnings"
          value={`${currency} ${Number(dashData?.earnings || 0).toLocaleString("en-PK")}`}
          hint={dashData?.hospitalSharePercent > 0 ? `After the hospital's ${dashData.hospitalSharePercent}% share` : undefined}
          icon={<FaMoneyBillWave />}
          loading={loading}
        />
        <StatTile label="Appointments" value={dashData?.appointments} icon={<FaCalendarCheck />} loading={loading} to="/doctor/appointments" />
        <StatTile label="Patients" value={dashData?.patients} icon={<FaUsers />} loading={loading} />
        <StatTile label="No-shows" value={dashData?.noShow ?? 0} icon={<FaUserSlash />} loading={loading} />
      </div>
    </div>
  );
};

export default DoctorDashboard;
