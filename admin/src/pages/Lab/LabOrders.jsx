import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaSearch, FaSyncAlt, FaFlask, FaExclamationTriangle, FaWifi } from "react-icons/fa";
import { labGet, currentRole, STATUS, when, ageFrom } from "../../lab/api";
import { useBillingEnabled } from "../../billing/api";
import { PaidBadge } from "../../components/billing/PaidBadge";

// The list of lab requests, for all three logins:
//   lab    – work to do (new and returned first, urgent on top), plus history
//   doctor – their own requests: reports waiting for review first
//   admin  – everything, read-only overview
const TABS = {
  lab: [
    { key: "open", label: "To do" },
    { key: "report_uploaded", label: "Waiting for doctor" },
    { key: "approved", label: "Approved" },
    { key: "cancelled", label: "Cancelled" },
    { key: "all", label: "All" },
  ],
  doctor: [
    { key: "report_uploaded", label: "Reports to review" },
    { key: "open", label: "Waiting for lab" },
    { key: "approved", label: "Approved" },
    { key: "all", label: "All" },
  ],
  admin: [
    { key: "open", label: "Waiting for lab" },
    { key: "report_uploaded", label: "Waiting for doctor" },
    { key: "approved", label: "Approved" },
    { key: "all", label: "All" },
  ],
};
const DETAIL_PATH = { lab: "/lab/orders/", doctor: "/doctor/lab-reports/", admin: "/lab-requests/" };
const TITLE = { lab: "Lab Requests", doctor: "Lab Reports", admin: "Lab Requests" };
const POLL_MS = 10000;

// Short two-note chime for a new request (the lab desk may not be looking at the screen)
const chime = (ref) => {
  try {
    const ctx = ref.current || new (window.AudioContext || window.webkitAudioContext)();
    ref.current = ctx;
    const t = ctx.currentTime;
    [988, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.3, t + i * 0.25 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.25);
      osc.stop(t + i * 0.25 + 0.24);
    });
  } catch {
    /* no sound on this device */
  }
};

const LabOrders = () => {
  const role = currentRole() || "lab";
  const billingEnabled = useBillingEnabled();
  const tabs = TABS[role];
  const [tab, setTab] = useState(tabs[0].key);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(30);
  const [orders, setOrders] = useState(null);
  const [counts, setCounts] = useState({});
  const [offline, setOffline] = useState(false);
  const lastOrdered = useRef(null);
  const latestRequest = useRef(0); // ignore answers to older requests (tab/search changed)
  const audio = useRef(null);

  // Wait a moment after typing before searching
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const requestNumber = ++latestRequest.current;
    try {
      const data = await labGet("/orders", { status: tab, search: query || undefined, days });
      if (requestNumber !== latestRequest.current) return;
      setOffline(false);
      if (!data.success) return;
      setOrders(data.orders);
      setCounts(data.counts || {});
      // New request arrived since the last refresh: chime (lab desk only)
      if (role === "lab" && typeof data.counts?.ordered === "number") {
        if (lastOrdered.current !== null && data.counts.ordered > lastOrdered.current) chime(audio);
        lastOrdered.current = data.counts.ordered;
      }
    } catch {
      if (requestNumber === latestRequest.current) setOffline(true);
    }
  }, [tab, query, days, role]);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    window.addEventListener("lab-changed", load);
    window.addEventListener("online", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("lab-changed", load);
      window.removeEventListener("online", load);
    };
  }, [load]);

  const tabCount = (key) => {
    if (role === "doctor") return key === "report_uploaded" ? counts.toReview : undefined;
    if (key === "open") return counts.open;
    if (key === "report_uploaded") return counts.waitingForDoctor;
    return undefined;
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <FaFlask className="text-primary" /> {TITLE[role]}
          </h1>
          <p className="text-sm text-gray-500">
            {role === "lab"
              ? "New requests appear here by themselves, with a sound. Urgent ones are on top."
              : role === "doctor"
                ? "Tests you requested. Open a report to approve it or send it back to the lab."
                : "All lab requests in the hospital."}
          </p>
        </div>
        <button onClick={load} className="self-start p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50" title="Refresh">
          <FaSyncAlt />
        </button>
      </div>

      {offline && (
        <div className="mb-3 flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          <FaWifi /> No connection to the server. Retrying…
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3" role="tablist">
        {tabs.map((t) => {
          const count = tabCount(t.key);
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                tab === t.key ? "bg-primary text-white border-primary" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className={`ml-2 px-1.5 rounded-full text-xs ${tab === t.key ? "bg-white/25" : "bg-red-500 text-white"}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Patient name, phone, doctor or request number (L-12)"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg"
            aria-label="Search"
          />
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm" aria-label="Period">
          <option value={1}>Today</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {!orders ? (
        <p className="text-gray-500 p-4">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
          {tab === "open" && role === "lab" ? "Nothing waiting. New requests will appear here." : "No requests here."}
        </div>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => {
            const status = STATUS[o.status] || {};
            return (
              <li key={o._id}>
                <Link
                  to={DETAIL_PATH[role] + o._id}
                  className={`block bg-white rounded-xl border p-4 hover:shadow-md transition-shadow ${o.urgent && ["ordered", "returned"].includes(o.status) ? "border-red-300" : "border-gray-100"}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="sm:w-20 text-sm font-mono text-gray-500">L-{o.orderNumber}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">
                        {o.patient?.name}
                        <span className="ml-2 text-sm font-normal text-gray-500">
                          {[o.patient?.gender, ageFrom(o.patient?.dob) || o.patient?.age].filter(Boolean).join(", ")}
                        </span>
                      </p>
                      <p className="text-sm text-gray-600 truncate">{o.tests.map((t) => t.name).join(" · ")}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {role !== "doctor" && <>Dr. {o.doctor?.name} · </>}
                        {when(o.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {o.urgent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          <FaExclamationTriangle /> Urgent
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>{status.label}</span>
                      {billingEnabled && role !== "doctor" && <PaidBadge order={o} />}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default LabOrders;
