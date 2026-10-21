import axios from "axios";
import { loadAppConfig } from "../appConfig";
import { useEffect, useState } from "react";

// Shared helpers for the lab screens, used by admin, doctor and lab logins.
export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

const read = (key) => {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

// Header for whoever is logged in on this browser
export const authHeaders = () => {
  const a = read("aToken");
  if (a) return { atoken: a };
  const d = read("dToken");
  if (d) return { dtoken: d };
  const l = read("lToken");
  return l ? { ltoken: l } : {};
};

export const currentRole = () => (read("aToken") ? "admin" : read("dToken") ? "doctor" : read("lToken") ? "lab" : null);

export const labGet = (path, params) =>
  axios.get(`${backendUrl}/api/lab${path}`, { headers: authHeaders(), params, timeout: 20000 }).then((r) => r.data);

export const labPost = (path, body, config = {}) =>
  axios.post(`${backendUrl}/api/lab${path}`, body, { headers: authHeaders(), timeout: 60000, ...config }).then((r) => r.data);

export const labPut = (path, body) =>
  axios.put(`${backendUrl}/api/lab${path}`, body, { headers: authHeaders(), timeout: 20000 }).then((r) => r.data);

export const errorText = (error) => error?.response?.data?.message || "No connection. Please try again.";

// Opens a report in a new tab. The tab is opened inside the click (so it isn't
// blocked as a popup) and pointed at the short-lived file link once we have it.
export const openReport = async (orderId, reportId) => {
  const win = window.open("", "_blank");
  try {
    const data = await labGet(`/orders/${orderId}/report-link${reportId ? `/${reportId}` : ""}`);
    if (!data.success) throw new Error(data.message);
    // Popup blocked: say so rather than leaving the app for the file
    if (!win) return "The browser blocked the new tab. Allow pop-ups for this site and try again.";
    win.location.href = backendUrl + data.url;
    return null;
  } catch (error) {
    win?.close();
    return error.message || "Could not open the report";
  }
};

// Short-lived link for showing a report inside the page
export const reportUrl = async (orderId, reportId) => {
  const data = await labGet(`/orders/${orderId}/report-link${reportId ? `/${reportId}` : ""}`);
  if (!data.success) throw new Error(data.message);
  return backendUrl + data.url;
};

// Is the lab module turned on for this hospital? (checked once per page load)
let enabledPromise = null;
export const useLabEnabled = () => {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    // The app config says first whether this deployment has a lab at all
    enabledPromise ??= loadAppConfig().then((config) =>
      !config.modules.lab
        ? false
        : axios
            .get(`${backendUrl}/api/lab/status`, { timeout: 10000 })
            .then((r) => r.data?.enabled !== false)
            .catch(() => true)
    );
    let alive = true;
    enabledPromise.then((value) => alive && setEnabled(value));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
};

// Badge numbers for the sidebar (lab: work waiting; doctor: reports to review), refreshed every 30s
export const useLabCounts = (active) => {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const load = () =>
      labGet("/orders/counts")
        .then((data) => alive && data.success && setCounts(data.counts))
        .catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener("lab-changed", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("lab-changed", load);
    };
  }, [active]);
  return counts;
};

// Tell badges/lists that something changed on this screen
export const labChanged = () => window.dispatchEvent(new Event("lab-changed"));

export const STATUS = {
  ordered: { label: "Waiting for lab", className: "bg-amber-100 text-amber-800" },
  returned: { label: "Returned to lab", className: "bg-red-100 text-red-700" },
  report_uploaded: { label: "Report ready – doctor to review", className: "bg-primary-100 text-primary-800" },
  approved: { label: "Approved", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-500" },
};

export const ageFrom = (dob) => {
  const date = dob ? new Date(dob) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  if (now < new Date(now.getFullYear(), date.getMonth(), date.getDate())) age--;
  return age >= 0 && age < 130 ? `${age} y` : "";
};

export const when = (value) =>
  value
    ? new Date(value).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
