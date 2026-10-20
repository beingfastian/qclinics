import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaWhatsapp, FaEnvelope, FaSearch, FaExchangeAlt, FaTimes, FaCalendarDay, FaUserSlash, FaPrint, FaSignInAlt, FaListOl, FaCalendarPlus } from "react-icons/fa";
import { AdminContext } from "../../context/AdminContext.jsx";
import { AppContext } from "../../context/AppContext.jsx";
import { printAppointmentSlip } from "../../components/PrintSlip";
import { hasStarted, hospitalSlotDate } from "../../utils/slots";
import useAppointmentPages, { fetchDayAppointments } from "../../utils/useAppointmentPages";
import { AdminRescheduleModal } from "../../components/RescheduleModal";
import DayActionsDialog from "../../components/DayActionsDialog";
import { AppointmentStatus, Avatar, Badge, Button, Card, EmptyState, Input, Menu, Segmented, Select, useDialog } from "../../components/ui";

const isOpen = (item) => !item.cancelled && !item.isCompleted && item.status !== "no_show";
const checkedIn = (item) => item.type === "walk_in" || (item.history || []).some((h) => h.action === "checked_in");

const TypeBadge = ({ item }) =>
  item.type === "walk_in" ? (
    <Badge tone="neutral" title="Came without an appointment (live queue)">Walk-in</Badge>
  ) : item.type === "follow_up" ? (
    <Badge tone="followup" title={item.createdBy?.role === "doctor" ? "Scheduled by the doctor" : "Follow-up visit"}>
      Follow-up
    </Badge>
  ) : null;

const AllAppointments = () => {
  const { confirm, alert } = useDialog();
  const navigate = useNavigate();
  const { aToken, backendUrl, appointmentsVersion, doctors, getAllDoctors, cancelAppointment, rescheduleDay, cancelDay, markNoShow } =
    useContext(AdminContext);
  const { calculateAge, slotDateFormat, currency } = useContext(AppContext);
  const [rescheduleFor, setRescheduleFor] = useState(null);
  const [showDayActions, setShowDayActions] = useState(false);
  const [range, setRange] = useState("today");
  const [filterDoctor, setFilterDoctor] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterNotification, setFilterNotification] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [search, setSearch] = useState(""); // what is sent: the search box, once typing pauses

  useEffect(() => {
    if (aToken) getAllDoctors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aToken]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Filtered, sorted and paged by the server (today and upcoming soonest first,
  // past and all newest first), with the tab counts and the status summary
  const { items: visible, counts, summary: totals, hasMore, loading, loadMore } = useAppointmentPages({
    url: `${backendUrl}/api/admin/appointments`,
    headers: { atoken: aToken },
    filters: { range, docId: filterDoctor, status: filterStatus, notify: filterNotification, q: search },
    refreshKey: appointmentsVersion,
    enabled: Boolean(aToken),
  });
  const summary = totals || { total: 0, open: 0, completed: 0, noShow: 0, cancelled: 0 };
  const today = hospitalSlotDate();
  const fetchDay = (docId, slotDate) => fetchDayAppointments(`${backendUrl}/api/admin/appointments`, { atoken: aToken }, docId, slotDate);

  // The patient's slip again (lost slip, or booked by phone and collected at the counter)
  const printSlip = (item) => {
    const ok = printAppointmentSlip({
      patientName: item.userData?.name,
      doctorName: item.docData?.name,
      speciality: item.docData?.speciality,
      dateText: slotDateFormat(item.slotDate),
      time: item.slotTime,
      fee: typeof item.amount === "number" ? item.amount : undefined,
    });
    if (!ok) alert({ title: "Couldn't open the print window", message: "The browser blocked it. Allow pop-ups for this site, then try again." });
  };

  const askNoShow = async (item) =>
    (await confirm({
      title: `Mark ${item.userData.name} as no-show?`,
      message: "Use this when the patient didn't come. If they arrive late, you can still complete the visit.",
      confirmLabel: "Mark no-show",
    })) && markNoShow(item._id);

  const askCancel = async (item) =>
    (await confirm({
      title: `Cancel ${item.userData.name}'s appointment?`,
      message: "The time slot is freed and the patient is told on WhatsApp (if they agreed to messages).",
      confirmLabel: "Cancel appointment",
      tone: "danger",
    })) && cancelAppointment(item._id);

  const openQueue = (item) => navigate(`/queue?doc=${item.docId}`);

  // One labelled action for what reception does next with this row
  const primaryAction = (item) => {
    if (!isOpen(item)) return null;
    const isToday = item.slotDate === today;
    if (isToday && !checkedIn(item)) return { key: "checkin", label: "Check in", icon: <FaSignInAlt />, onClick: () => openQueue(item), title: `Opens Dr. ${item.docData.name}'s queue to give a token` };
    if (isToday) return { key: "queue", label: "Open queue", icon: <FaListOl />, onClick: () => openQueue(item) };
    if (hasStarted(item)) return { key: "noshow", label: "Mark no-show", icon: <FaUserSlash />, onClick: () => askNoShow(item) };
    if (item.type !== "walk_in") return { key: "reschedule", label: "Reschedule", icon: <FaExchangeAlt />, onClick: () => setRescheduleFor(item) };
    return null;
  };

  const rowActions = (item) => {
    const primary = primaryAction(item);
    const active = !item.cancelled && !item.isCompleted;
    const items = [
      { label: "Print slip", icon: <FaPrint />, onClick: () => printSlip(item), hidden: !active },
      { label: "Reschedule", icon: <FaExchangeAlt />, onClick: () => setRescheduleFor(item), hidden: !active || item.type === "walk_in" || primary?.key === "reschedule" },
      { label: "Mark no-show", icon: <FaUserSlash />, onClick: () => askNoShow(item), hidden: !isOpen(item) || !hasStarted(item) || primary?.key === "noshow" },
      { divider: true, hidden: !active },
      { label: "Cancel appointment", icon: <FaTimes />, onClick: () => askCancel(item), tone: "danger", hidden: !active },
    ];
    return (
      <div className="flex items-center justify-end gap-1">
        {primary && (
          <Button size="sm" variant={primary.key === "checkin" ? "primary" : "secondary"} icon={primary.icon} onClick={primary.onClick} title={primary.title}>
            {primary.label}
          </Button>
        )}
        <Menu label={`More actions for ${item.userData.name}`} items={items} />
      </div>
    );
  };

  const filtersOn = searchTerm || filterDoctor !== "all" || filterStatus !== "all" || filterNotification !== "all";
  const rangeTitle = { today: "today", upcoming: "coming up", past: "in the past", all: "yet" }[range];

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900">Appointments</h1>
          <p className="mt-1 text-sm text-slate-600">Check patients in, reschedule or cancel. Today first.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<FaCalendarDay />} onClick={() => setShowDayActions(true)}>
            Manage a day
          </Button>
          <Button variant="primary" icon={<FaCalendarPlus />} onClick={() => navigate("/book-appointment")}>
            Book appointment
          </Button>
        </div>
      </div>

      {/* Range, search and filters */}
      <Card className="mb-4 space-y-3">
        <Segmented
          label="Which appointments"
          value={range}
          onChange={setRange}
          options={[
            { value: "today", label: "Today", count: counts?.today },
            { value: "upcoming", label: "Upcoming", count: counts?.upcoming },
            { value: "past", label: "Past", count: counts?.past },
            { value: "all", label: "All", count: counts?.all },
          ]}
        />
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <FaSearch aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              aria-label="Search appointments"
              placeholder="Search by patient, phone or doctor"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex">
            <Select aria-label="Doctor" value={filterDoctor} onChange={(e) => setFilterDoctor(e.target.value)} className="lg:w-48">
              <option value="all">All doctors</option>
              {doctors.map((d) => (
                <option key={d._id} value={d._id}>
                  Dr. {d.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="lg:w-40">
              <option value="all">Any status</option>
              <option value="pending">Booked / in queue</option>
              <option value="completed">Completed</option>
              <option value="no_show">No-show</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Select aria-label="Messages" value={filterNotification} onChange={(e) => setFilterNotification(e.target.value)} className="lg:w-40">
              <option value="all">Any messages</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email only</option>
            </Select>
          </div>
        </div>
        <p className="text-sm text-slate-600 tabular-nums">
          {summary.total} shown · {summary.open} booked or in queue · {summary.completed} completed · {summary.noShow} no-show ·{" "}
          {summary.cancelled} cancelled
        </p>
      </Card>

      {/* Appointments (no overflow-hidden: the "More" menus must not be clipped) */}
      <Card padded={false}>
        <div className="hidden lg:grid grid-cols-12 gap-4 rounded-t-xl border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm font-medium text-slate-700">
          <div className="col-span-2">{range === "today" ? "Time" : "Date & time"}</div>
          <div className="col-span-3">Patient</div>
          <div className="col-span-2">Doctor</div>
          <div className="col-span-1">Fee</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {visible.length === 0 && loading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500" role="status">Loading appointments…</p>
        ) : visible.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {visible.map((item) => (
              <li key={item._id} className="px-5 py-3">
                {/* Desktop */}
                <div className="hidden lg:grid grid-cols-12 items-center gap-4">
                  <div className="col-span-2 text-sm">
                    {range !== "today" && <p className="font-medium text-slate-900">{slotDateFormat(item.slotDate)}</p>}
                    <p className={range === "today" ? "font-medium tabular-nums text-slate-900" : "tabular-nums text-slate-600"}>{item.slotTime}</p>
                  </div>
                  <div className="col-span-3 flex min-w-0 items-center gap-3">
                    <Avatar src={item.userData.image} name={item.userData.name} className="h-9 w-9 shrink-0" textClass="text-sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{item.userData.name}</p>
                      <p className="flex items-center gap-1.5 truncate text-sm text-slate-600">
                        {item.userData.whatsappEnabled ? (
                          <FaWhatsapp className="shrink-0 text-emerald-700" title="WhatsApp messages on" aria-label="WhatsApp messages on" />
                        ) : (
                          <FaEnvelope className="shrink-0 text-slate-500" title="Email only" aria-label="Email only" />
                        )}
                        <span className="truncate">
                          {item.userData.whatsappNumber || item.userData.phone || ""}
                          {calculateAge(item.userData.dob) !== "—" ? ` · ${calculateAge(item.userData.dob)} yrs` : ""}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="col-span-2 truncate text-sm text-slate-900">Dr. {item.docData.name}</div>
                  <div className="col-span-1 text-sm tabular-nums text-slate-900">
                    {currency} {item.amount ?? item.docData.fee}
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center gap-1">
                    <AppointmentStatus item={item} />
                    <TypeBadge item={item} />
                  </div>
                  <div className="col-span-2">{rowActions(item)}</div>
                </div>

                {/* Phone and tablet */}
                <div className="space-y-2 lg:hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar src={item.userData.image} name={item.userData.name} className="h-10 w-10 shrink-0" textClass="text-sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{item.userData.name}</p>
                        <p className="text-sm text-slate-600">
                          {range !== "today" && `${slotDateFormat(item.slotDate)}, `}
                          {item.slotTime} · Dr. {item.docData.name}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <AppointmentStatus item={item} />
                      <TypeBadge item={item} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-sm text-slate-600">
                      {item.userData.whatsappEnabled ? (
                        <FaWhatsapp className="text-emerald-700" aria-label="WhatsApp messages on" />
                      ) : (
                        <FaEnvelope className="text-slate-500" aria-label="Email only" />
                      )}
                      <span className="tabular-nums">
                        {currency} {item.amount ?? item.docData.fee}
                      </span>
                    </span>
                    {rowActions(item)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<FaSearch />}
            title={filtersOn ? "No matching appointments" : `No appointments ${rangeTitle}`}
            description={filtersOn ? "Try a different name, doctor or status." : "Booked visits and walk-ins will appear here."}
            action={
              filtersOn ? (
                <Button
                  onClick={() => {
                    setSearchTerm("");
                    setFilterDoctor("all");
                    setFilterStatus("all");
                    setFilterNotification("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" icon={<FaCalendarPlus />} onClick={() => navigate("/book-appointment")}>
                  Book appointment
                </Button>
              )
            }
          />
        )}

        {hasMore && (
          <div className="border-t border-slate-100 p-4 text-center">
            <Button onClick={loadMore} disabled={loading}>
              {loading ? "Loading…" : `Show more (${Math.max(0, summary.total - visible.length)} left)`}
            </Button>
          </div>
        )}
      </Card>

      {rescheduleFor && <AdminRescheduleModal appointment={rescheduleFor} onClose={() => setRescheduleFor(null)} />}
      {showDayActions && (
        <DayActionsDialog
          doctors={doctors}
          fetchDay={fetchDay}
          onMove={rescheduleDay}
          onCancelDay={cancelDay}
          onClose={() => setShowDayActions(false)}
        />
      )}
    </div>
  );
};

export default AllAppointments;
