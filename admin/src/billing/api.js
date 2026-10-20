import axios from "axios";
import { useEffect, useState } from "react";

// Shared helpers for billing (reception and owner). Money records live on the
// server; this browser only remembers which counter it is and who is at it.
export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

const read = (key) => {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};
const write = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage unavailable (private window); the screen asks again next time
  }
};

// Role inside the front-desk token: "admin" (owner) or "reception"
export const deskRole = (token = read("aToken")) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "reception" ? "reception" : "admin";
  } catch {
    return "admin";
  }
};
export const isOwnerToken = (token) => Boolean(token) && deskRole(token) === "admin";

// This computer's counter (cash drawer) and the person at it
const COUNTER_KEY = "billingCounterId";
const STAFF_KEY = "billingStaffName";
export const getDesk = () => ({ counterId: read(COUNTER_KEY), staffName: read(STAFF_KEY) });
export const setDesk = ({ counterId, staffName }) => {
  write(COUNTER_KEY, counterId);
  write(STAFF_KEY, staffName);
  window.dispatchEvent(new Event("billing-desk-changed"));
};

const headers = () => ({ atoken: read("aToken") });
export const billingGet = (path, params) =>
  axios.get(`${backendUrl}/api/billing${path}`, { headers: headers(), params, timeout: 20000 }).then((r) => r.data);
export const billingPost = (path, body) =>
  axios.post(`${backendUrl}/api/billing${path}`, body, { headers: headers(), timeout: 20000 }).then((r) => r.data);
export const billingPut = (path, body) =>
  axios.put(`${backendUrl}/api/billing${path}`, body, { headers: headers(), timeout: 20000 }).then((r) => r.data);
export const errorText = (error) => error?.response?.data?.message || "No connection. Please try again.";

// One id per "Collect" press, so a retry can't make a second receipt
export const newRequestId = () =>
  (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Is billing turned on for this hospital? (checked once per page load)
let enabledPromise = null;
export const useBillingEnabled = () => {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    enabledPromise ??= axios
      .get(`${backendUrl}/api/billing/status`, { timeout: 10000 })
      .then((r) => r.data?.enabled === true)
      .catch(() => false);
    let alive = true;
    enabledPromise.then((value) => alive && setEnabled(value));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
};

// Counters and names, plus this computer's choice (kept in sync across screens)
export const useDesk = (active = true) => {
  const [settings, setSettings] = useState(null);
  const [desk, setDeskState] = useState(getDesk);
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    billingGet("/settings")
      .then((data) => alive && data.success && setSettings(data.settings))
      .catch(() => {});
    const onChange = () => setDeskState(getDesk());
    window.addEventListener("billing-desk-changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("billing-desk-changed", onChange);
    };
  }, [active]);
  const counter = settings?.counters.find((c) => c.id === desk.counterId && c.active) || null;
  return { settings, desk, counter, ready: Boolean(counter) };
};

export const METHOD_LABEL = { cash: "Cash", bank_transfer: "Bank transfer" };
export const rs = (value) => `Rs ${Number(value || 0).toLocaleString("en-PK")}`;
export const time = (value) =>
  value ? new Date(value).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" }) : "";
export const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "";
// Today as "yyyy-mm-dd" on this computer (Pakistan hospitals: same as hospital time)
export const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
