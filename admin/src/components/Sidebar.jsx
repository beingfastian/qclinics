import React, { useContext, useEffect, useState } from "react";
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
  FaStethoscope,
  FaUserInjured,
  FaCalendarAlt,
  FaAngleDoubleLeft,
  FaAngleDoubleRight,
  FaTimes,
  FaListOl,
  FaFlask,
  FaVials,
  FaUsersCog,
} from "react-icons/fa";

const adminSections = [
  {
    title: "Overview",
    items: [{ path: "/", icon: <FaChartBar />, label: "Dashboard", end: true }],
  },
  {
    title: "Appointments",
    items: [
      { path: "/queue", icon: <FaListOl />, label: "Live Queue" },
      { path: "/all-appointments", icon: <FaCalendarAlt />, label: "All Appointments" },
      { path: "/book-appointment", icon: <FaUserPlus />, label: "Book Appointment" },
    ],
  },
  {
    title: "Doctors",
    items: [
      { path: "/doctors", icon: <FaUserMd />, label: "Manage Doctors" },
      { path: "/add-doctor", icon: <FaStethoscope />, label: "Add Doctor" },
      { path: "/leave-management", icon: <FaCalendarCheck />, label: "Leave Requests", badge: "pendingLeave" },
    ],
  },
  {
    title: "Patients",
    items: [
      { path: "/patients", icon: <FaUsers />, label: "Manage Patients" },
      { path: "/add-patient", icon: <FaUserInjured />, label: "Add Patient" },
    ],
  },
  {
    title: "Lab",
    items: [
      { path: "/lab-requests", icon: <FaFlask />, label: "Lab Requests", badge: "labOpen", lab: true },
      { path: "/lab-tests", icon: <FaVials />, label: "Lab Tests", lab: true },
      { path: "/lab-staff", icon: <FaUsersCog />, label: "Lab Staff", lab: true },
    ],
  },
  {
    title: "System",
    items: [{ path: "/settings", icon: <FaCog />, label: "Settings" }],
  },
];

const doctorSections = [
  {
    title: "Overview",
    items: [{ path: "/doctor", icon: <FaChartBar />, label: "Dashboard", end: true }],
  },
  {
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
      {sections.map((section) => (
        <div key={section.title} className="mb-4">
          {isCollapsed ? (
            <div className="mx-4 mb-2 border-t border-gray-100" />
          ) : (
            <p className="px-5 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {section.title}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const count = item.badge ? badges[item.badge] : 0;
              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.end}
                    title={isCollapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 mx-2 rounded-lg text-sm font-medium transition-colors ${
                        isCollapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"
                      } ${
                        isActive
                          ? "bg-primary-50 text-primary-800"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
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
        </div>
      ))}
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
          <span className="font-semibold text-gray-900">{aToken ? "Admin Menu" : "Doctor Menu"}</span>
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

export default Sidebar;
