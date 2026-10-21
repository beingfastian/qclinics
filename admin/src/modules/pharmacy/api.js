import axios from "axios";

// The pharmacy module's API (backend modules/pharmacy). Pharmacy staff send their
// own login (ptoken); the owner uses the admin login (atoken).
export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

const headers = () => {
  try {
    const pToken = localStorage.getItem("pToken");
    if (pToken) return { ptoken: pToken };
    const aToken = localStorage.getItem("aToken");
    return aToken ? { atoken: aToken } : {};
  } catch {
    return {};
  }
};

// The server answers business errors with a status and { message }; show that
const request = async (method, path, data) => {
  const response = await axios({ method, url: `${backendUrl}/api/pharmacy${path}`, data, headers: headers(), timeout: 20000 });
  return response.data;
};

export const pharmacyGet = (path) => request("get", path);
export const pharmacyPost = (path, data) => request("post", path, data);
export const pharmacyPut = (path, data) => request("put", path, data);

export const errorText = (error) =>
  error?.response?.data?.message || (error?.request ? "Couldn't reach the server. Check the internet connection and try again." : error?.message || "Something went wrong");

export const ROLE_LABEL = { owner: "Owner", manager: "Pharmacy manager", cashier: "Cashier" };

// --- Money and quantities ---
// The server keeps money in paisa (whole numbers): Rs 12.50 is 1250
export const money = (paisa) => {
  const rupees = Math.round(Number(paisa) || 0) / 100;
  return `Rs ${rupees.toLocaleString("en-PK", { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
// What staff type (rupees, "12.5") to paisa; null when it isn't a valid amount
export const toPaisa = (text) => {
  const value = String(text ?? "").replace(/,/g, "").trim();
  if (value === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
};
export const toRupeesText = (paisa) => (paisa ? String(Math.round(paisa) / 100) : "");

const plural = (n, word) => `${n} ${word}${n === 1 || /s$/.test(word) ? "" : "s"}`;
// Stock in packs and loose units: "4 strips 3 tablets", or just units
export const stockText = (units, product) => {
  const n = Number(units) || 0;
  const unit = product?.unitName || "unit";
  const per = product?.unitsPerPack || 1;
  if (per <= 1 || !product?.packName || Math.abs(n) < per) return plural(n, unit);
  const packs = Math.trunc(n / per);
  const loose = n - packs * per;
  return `${plural(packs, product.packName)}${loose ? ` ${plural(Math.abs(loose), unit)}` : ""}`;
};

export const itemTitle = (p) => [p?.name, p?.strength, p?.variant].filter(Boolean).join(" ");

export const dateText = (value) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
// Expiry is a month on most packs: show "Mar 2027"
export const expiryText = (value) => (value ? new Date(value).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "No expiry");

export const newRequestId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
