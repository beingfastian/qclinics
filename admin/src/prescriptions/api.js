import axios from "axios";
import { authHeaders, backendUrl } from "../lab/api";

// The hospital's prescriptions (doctor, reception, admin logins)
export const rxGet = (path, params) => axios.get(`${backendUrl}/api/prescriptions${path}`, { headers: authHeaders(), params, timeout: 20000 }).then((r) => r.data);
export const rxPost = (path, body) => axios.post(`${backendUrl}/api/prescriptions${path}`, body, { headers: authHeaders(), timeout: 20000 }).then((r) => r.data);

// How far the pharmacy got with it
export const PHARMACY_STATUS = {
  waiting: { label: "At the pharmacy", tone: "info" },
  partly: { label: "Partly dispensed", tone: "warning" },
  dispensed: { label: "Dispensed", tone: "success" },
  closed: { label: "Not bought", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

// "1+0+1" = 2 a day, "1+1+1+1" = 4. Anything else (spoons, "when needed") has no count.
export const dosesPerDay = (dose) => {
  const parts = String(dose || "").split("+").map((p) => p.trim());
  if (parts.length < 2 || !parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((sum, p) => sum + Number(p), 0);
};
const COUNTED = ["tablet", "capsule", "sachet"];
// How many to dispense: doses a day x days, for tablets and capsules
export const suggestedQty = (form, dose, days) => {
  const perDay = dosesPerDay(dose);
  return perDay && days && COUNTED.includes(form) ? Math.ceil(perDay * days) : null;
};

export const DOSES = ["1+0+1", "1+1+1", "1+0+0", "0+0+1", "0+1+0", "1+1+1+1", "When needed"];
export const INSTRUCTIONS = ["After food", "Before food", "At bedtime", "With water", "Apply on the skin", "When needed"];
