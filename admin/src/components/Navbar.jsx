import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBars,
  FaBell,
  FaCalendarAlt,
  FaCalendarCheck,
  FaCheckCircle,
  FaTimesCircle,
  FaUserPlus,
  FaFlask,
  FaTrashAlt,
  FaUserMd,
  FaCog,
  FaSignOutAlt,
  FaChevronDown,
} from "react-icons/fa";
import { assets } from "../assets/assets";
import { HOSPITAL_LOGO, HOSPITAL_NAME, PRODUCT_NAME } from "../config";
import { AdminContext } from "../context/AdminContext";
import { DoctorContext } from "../context/DoctorContext";
import { LabContext } from "../context/LabContext";
import { PharmacyContext } from "../context/PharmacyContext";
import { ROLE_LABEL } from "../modules/pharmacy/api";
import { useNotifications } from "../context/NotificationContext";
import { Avatar, Menu } from "./ui";
import BrandLogo from "./ui/BrandLogo";

// Icon per notification type (same icon set as the rest of the app)
const NOTIFICATION_ICONS = {
  leave_request: FaCalendarCheck,
  leave_approved: FaCheckCircle,
  leave_rejected: FaTimesCircle,
  new_appointment: FaCalendarAlt,
  appointment_completed: FaCheckCircle,
  appointment_cancelled: FaTimesCircle,
  appointment_rescheduled: FaCalendarAlt,
  new_patient: FaUserPlus,
  lab_order: FaFlask,
  lab_report: FaFlask,
  lab_report_approved: FaFlask,
  lab_report_returned: FaFlask,
  lab_order_cancelled: FaFlask,
};

// "10:30 am" today, otherwise "9 Oct, 10:30 am"
const whenText = (value) => {
  const date = new Date(value);
  const time = date.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString("en-PK", { day: "numeric", month: "short" })}, ${time}`;
};

const Navbar = ({ onMenuClick }) => {
  const { isOwner, aToken, setAToken } = useContext(AdminContext);
  const { dToken, setDToken, doctorData } = useContext(DoctorContext);
  const { lToken, setLToken, labName } = useContext(LabContext);
  const { pToken, setPToken, pharmacyUser } = useContext(PharmacyContext);
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification } = useNotifications();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const bellButton = useRef(null);
  const panel = useRef(null);

  const role = aToken ? "admin" : dToken ? "doctor" : lToken ? "lab" : "pharmacy";
  const roleLabel = {
    admin: isOwner ? "Reception / Admin" : "Reception",
    doctor: "Doctor",
    lab: "Lab",
    pharmacy: ROLE_LABEL[pharmacyUser?.role] || "Pharmacy",
  }[role];
  const userName = aToken
    ? isOwner ? "Administrator" : "Reception"
    : dToken
      ? doctorData?.name ? `Dr. ${doctorData.name}` : "Doctor"
      : lToken
        ? labName || "Lab staff"
        : pharmacyUser?.name || "Pharmacy staff";

  // Close the notification panel on outside click or Escape
  useEffect(() => {
    if (!showNotifications) return undefined;
    const onDown = (e) => {
      if (!panel.current?.contains(e.target) && !bellButton.current?.contains(e.target)) setShowNotifications(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setShowNotifications(false);
        bellButton.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showNotifications]);

  const logout = () => {
    if (aToken) {
      setAToken("");
      localStorage.removeItem("aToken");
    }
    if (dToken) {
      setDToken("");
      localStorage.removeItem("dToken");
    }
    if (lToken) {
      setLToken("");
      localStorage.removeItem("lToken");
    }
    if (pToken) {
      setPToken("");
      localStorage.removeItem("pToken");
    }
    setTimeout(() => navigate("/"), 100);
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200">
      <div className="flex h-16 items-center justify-between gap-3 px-3 sm:px-6">
        {/* Left: menu (phones), logo, product and hospital */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <FaBars aria-hidden="true" />
          </button>
          <span className="sr-only">{PRODUCT_NAME}</span>
          <img src={assets.logo_mark} alt="" className="h-9 w-9 sm:hidden" />
          <BrandLogo size="sm" className="hidden sm:inline-flex" />
          <span aria-hidden="true" className="hidden h-8 w-px bg-slate-200 sm:block" />
          {HOSPITAL_LOGO && <img src={HOSPITAL_LOGO} alt="" className="hidden h-9 w-9 shrink-0 object-contain sm:block" />}
          <p className="min-w-0 truncate text-sm font-medium text-slate-700">{HOSPITAL_NAME}</p>
        </div>

        {/* Right: notifications and the user menu */}
        <div className="flex items-center gap-1 sm:gap-2">
          <div className="relative">
            <button
              ref={bellButton}
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-expanded={showNotifications}
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <FaBell aria-hidden="true" className="text-lg" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-[1.1rem] text-white tabular-nums">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div
                ref={panel}
                role="dialog"
                aria-label="Notifications"
                className="fixed left-3 right-3 top-16 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Notifications</h2>
                    <p className="text-xs text-slate-500">{unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}</p>
                  </div>
                  {unreadCount > 0 && (
                    <button type="button" onClick={() => markAllAsRead()} className="text-sm font-medium text-primary-700 hover:text-primary-900">
                      Mark all read
                    </button>
                  )}
                </div>
                <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length ? (
                    notifications.map((n) => {
                      const Icon = NOTIFICATION_ICONS[n.type] || FaBell;
                      return (
                        <li key={n._id} className={n.read ? "" : "bg-primary-50/50"}>
                          <div className="flex gap-3 px-4 py-3">
                            <span
                              aria-hidden="true"
                              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                                n.priority === "high" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              <Icon />
                            </span>
                            <button type="button" onClick={() => markAsRead(n._id)} className="min-w-0 flex-1 text-left">
                              <p className="text-sm font-medium text-slate-900">
                                {!n.read && <span className="sr-only">Unread: </span>}
                                {n.title}
                              </p>
                              <p className="mt-0.5 text-sm text-slate-600">{n.message}</p>
                              <p className="mt-1 text-xs text-slate-500">{whenText(n.createdAt)}</p>
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteNotification(n._id)}
                              aria-label="Delete notification"
                              title="Delete"
                              className="self-start rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                            >
                              <FaTrashAlt aria-hidden="true" className="text-xs" />
                            </button>
                          </div>
                        </li>
                      );
                    })
                  ) : (
                    <li className="px-4 py-10 text-center text-sm text-slate-500">No notifications yet</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <Menu
            label={`Account: ${userName}, ${roleLabel}`}
            align="right"
            buttonClassName="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100"
            trigger={
              <>
                <Avatar src={dToken ? doctorData?.image : undefined} name={userName} className="w-9 h-9" textClass="text-sm" />
                <span className="hidden md:block text-left leading-tight">
                  <span className="block text-sm font-medium text-slate-900">{userName}</span>
                  <span className="block text-xs text-slate-500">{roleLabel}</span>
                </span>
                <FaChevronDown aria-hidden="true" className="hidden md:block text-xs text-slate-400" />
              </>
            }
            items={[
              {
                header: (
                  <div className="md:hidden">
                    <p className="text-sm font-medium text-slate-900">{userName}</p>
                    <p className="text-xs text-slate-500">{roleLabel}</p>
                  </div>
                ),
              },
              { label: "My profile", icon: <FaUserMd />, onClick: () => navigate("/doctor/profile"), hidden: role !== "doctor" },
              { label: "Settings", icon: <FaCog />, onClick: () => navigate("/settings"), hidden: role !== "admin" },
              { divider: true, hidden: role === "lab" },
              { label: "Sign out", icon: <FaSignOutAlt />, onClick: logout, tone: "danger" },
            ]}
          />
        </div>
      </div>
    </header>
  );
};

export default Navbar;
