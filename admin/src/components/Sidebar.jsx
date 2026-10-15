import { useContext, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AdminContext } from "../context/AdminContext";
import { DoctorContext } from "../context/DoctorContext.jsx";
import { LabContext } from "../context/LabContext.jsx";
import { useLabEnabled, useLabCounts } from "../lab/api";
import {
  FaCog,
  FaUserPlus,
  FaUsers,
  FaUserMd,
  FaCalendarCheck,
  FaChartBar,
  FaHome,
  FaEllipsisH,
  FaChevronDown,
  FaCalendarAlt,
  FaAngleDoubleLeft,
  FaAngleDoubleRight,
  FaTimes,
  FaListOl,
  FaFlask,
  FaVials,
  FaUsersCog,
} from "react-icons/fa";

// Reception/admin menu: the six things used every day, the rest under "More".
// `also` marks pages that belong to an item (e.g. Add doctor under Doctors).
const adminSections = [
  {
    key: "main",
    items: [
      { path: "/", icon: <FaHome />, label: "Home", end: true },
      { path: "/queue", icon: <FaListOl />, label: "Queue", also: ["/arrived"] },
      { path: "/all-appointments", icon: <FaCalendarAlt />, label: "Appointments", also: ["/book-appointment"] },
      { path: "/patients", icon: <FaUsers />, label: "Patients", also: ["/add-patient"] },
      { path: "/doctors", icon: <FaUserMd />, label: "Doctors", also: ["/add-doctor", "/leave-management"], badge: "pendingLeave" },
      { path: "/reports", icon: <FaChartBar />, label: "Reports" },
    ],
  },
  {
    key: "more",
    title: "More",
    collapsible: true,
    items: [
      { path: "/lab-requests", icon: <FaFlask />, label: "Lab Requests", badge: "labOpen", lab: true },
      { path: "/lab-tests", icon: <FaVials />, label: "Lab Tests", lab: true },
      { path: "/lab-staff", icon: <FaUsersCog />, label: "Lab Staff", lab: true },
      { path: "/settings", icon: <FaCog />, label: "Settings" },
    ],
  },
];

const doctorSections = [
  {
    key: "overview",
    title: "Overview",
    items: [{ path: "/doctor", icon: <FaChartBar />, label: "Dashboard", end: true }],
  },
  {
    key: "work",
    title: "My Work",
    items: [
      { path: "/doctor/queue", icon: <FaListOl />, label: "Live Queue" },
      { path: "/doctor/appointments", icon: <FaCalendarAlt />, label: "Appointments" },
      { path: "/doctor/lab-reports", icon: <FaFlask />, label: "Lab Reports", badge: "labReview", lab: true },
      { path: "/doctor/leave-requests", icon: <FaCalendarCheck />, label: "Leave Requests" },
      { path: "/doctor/profile", icon: <FaUserMd />, label: "Profile" },
    ],
  },
];

const labSections = [
  {
    key: "lab",
    title: "Lab",
    items: [
      { path: "/lab", icon: <FaFlask />, label: "Lab Requests", end: true, badge: "labOpen" },
      { path: "/lab/tests", icon: <FaVials />, label: "Test List" },
    ],
  },
];

const COLLAPSE_KEY = "sidebarCollapsed";

// mobileOpen/onClose control the slide-in drawer on screens below lg.
const Sidebar = ({ mobileOpen, onClose }) => {
  const { aToken, leaveStats, getLeaveStats } = useContext(AdminContext);
  const { dToken } = useContext(DoctorContext);
  const { lToken } = useContext(LabContext);
  const labEnabled = useLabEnabled();
  const labCounts = useLabCounts(labEnabled && Boolean(aToken || dToken || lToken));
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, String(!prev));
      } catch {
        // storage unavailable; keep the in-memory state
      }
      return !prev;
    });
  };

  // "More" opens by itself when the current page is inside it
  const inMore = (path) => adminSections[1].items.some((item) => path.startsWith(item.path));
  const [moreOpen, setMoreOpen] = useState(() => inMore(location.pathname));
  useEffect(() => {
    if (inMore(location.pathname)) setMoreOpen(true);
  }, [location.pathname]);
  const belongsHere = (item) => (item.also || []).some((path) => location.pathname.startsWith(path));

  // Pending leave count for the badge
  useEffect(() => {
    if (aToken) getLeaveStats();
  }, [aToken]);

  // Close the mobile drawer after navigating
  useEffect(() => {
    onClose();
  }, [location.pathname]);

  // Close the mobile drawer with Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Lab items are hidden when the hospital has the lab module turned off
  const sections = (aToken ? adminSections : dToken ? doctorSections : lToken ? labSections : [])
    .map((section) => ({ ...section, items: section.items.filter((item) => labEnabled || !item.lab) }))
    .filter((section) => section.items.length);
  const badges = {
    pendingLeave: leaveStats?.pending || 0,
    labOpen: labCounts.open || 0,
    labReview: labCounts.toReview || 0,
  };

  // The drawer on mobile is always shown expanded
  const renderNav = (isCollapsed) => (
    <nav className="flex-1 overflow-y-auto py-4">
      {sections.map((section) => {
        const sectionCount = section.items.reduce((sum, item) => sum + (item.badge ? badges[item.badge] : 0), 0);
        const showItems = !section.collapsible || moreOpen || isCollapsed;
        let heading = null;
        if (section.collapsible && !isCollapsed) {
          heading = (
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              aria-expanded={moreOpen}
              className="mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              <span className="flex h-5 w-5 items-center justify-center text-base">
                <FaEllipsisH />
              </span>
              <span className="flex-1 text-left">{section.title}</span>
              {!moreOpen && sectionCount > 0 && <span className="h-2 w-2 rounded-full bg-red-500" aria-label="Has items waiting" />}
              <FaChevronDown aria-hidden="true" className={`text-xs transition-transform ${moreOpen ? "rotate-180" : ""}`} />
            </button>
          );
        } else if (section.title && isCollapsed) {
          heading = <div className="mx-4 mb-2 border-t border-gray-100" />;
        } else if (section.title) {
          heading = <p className="px-5 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{section.title}</p>;
        }
        return (
          <div key={section.key} className={`mb-4 ${section.collapsible ? "border-t border-gray-100 pt-3" : ""}`}>
            {heading}
            {showItems && (
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const count = item.badge ? badges[item.badge] : 0;
                  const size = isCollapsed ? "justify-center px-0 py-2.5 text-sm" : section.collapsible ? "px-3 py-2 text-sm" : "px-3 py-2.5 text-[15px]";
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        end={item.end}
                        title={isCollapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          `relative flex items-center gap-3 mx-2 rounded-lg font-medium transition-colors ${size} ${
                            isActive || belongsHere(item)
                              ? "bg-primary-50 text-primary-800"
                              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {(isActive || belongsHere(item)) && (
                              <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-primary-700" />
                            )}
                            <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-base">
                              {item.icon}
                            </span>
                            {!isCollapsed && <span className="truncate flex-1">{item.label}</span>}
                            {count > 0 &&
                              (isCollapsed ? (
                                <span className="absolute top-1.5 right-3 w-2 h-2 rounded-full bg-red-500" />
                              ) : (
                                <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
                                  {count > 99 ? "99+" : count}
                                </span>
                              ))}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar: sticky under the 64px navbar */}
      <aside
        className={`hidden lg:flex flex-col flex-shrink-0 sticky top-16 h-[calc(100vh-4rem)] bg-white border-r border-gray-200 transition-[width] duration-200 ${
          collapsed ? "w-[72px]" : "w-60"
        }`}
      >
        {renderNav(collapsed)}
        <div className="border-t border-gray-100 p-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800 ${
              collapsed ? "justify-center" : ""
            }`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : undefined}
          >
            {collapsed ? <FaAngleDoubleRight /> : <FaAngleDoubleLeft />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Mobile / tablet drawer */}
      <div
        className={`lg:hidden fixed inset-0 z-[60] bg-black/30 transition-opacity ${
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-[70] w-64 max-w-[80vw] flex flex-col bg-white shadow-xl transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-100">
          <span className="font-semibold text-gray-900">Menu</span>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Close menu"
          >
            <FaTimes />
          </button>
        </div>
        {renderNav(false)}
      </aside>
    </>
  );
};

// Phones and tablets (reception): the most used places one tap away; "More" opens the full menu
export const AdminBottomNav = ({ onMore }) => {
  const { pathname } = useLocation();
  const item = (active) => `flex flex-col items-center gap-0.5 py-1 text-[11px] ${active ? "font-semibold text-primary-800" : "text-gray-600"}`;
  return (
    <nav
      aria-label="Quick navigation"
      className="lg:hidden fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-gray-200 bg-white px-1 pt-1"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      <NavLink to="/" end className={item(pathname === "/")}>
        <FaHome aria-hidden="true" className="text-lg" />
        Home
      </NavLink>
      <NavLink to="/queue" className={item(pathname.startsWith("/queue"))}>
        <FaListOl aria-hidden="true" className="text-lg" />
        Queue
      </NavLink>
      <NavLink to="/arrived" className="flex flex-col items-center gap-0.5 text-[11px] font-medium text-gray-700">
        <span aria-hidden="true" className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-md">
          <FaUserPlus />
        </span>
        Arrived
      </NavLink>
      <NavLink to="/all-appointments" className={item(pathname.startsWith("/all-appointments") || pathname.startsWith("/book-appointment"))}>
        <FaCalendarAlt aria-hidden="true" className="text-lg" />
        Appointments
      </NavLink>
      <button type="button" onClick={onMore} className={item(false)}>
        <FaEllipsisH aria-hidden="true" className="text-lg" />
        More
      </button>
    </nav>
  );
};

export default Sidebar;
