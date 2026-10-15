import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { FaChartBar, FaTable, FaExclamationTriangle } from "react-icons/fa";
import { rupees } from "./ShareField";

// Profit report: how each consultation fee was split between the hospital and the
// doctor, by day / week / month, for a preset or custom date range.
//   mode="admin":  all doctors or one doctor; hospital profit first
//   mode="doctor": the logged-in doctor's own visits; their earnings first
// Numbers come from the server (services/profitService.js), which uses the split
// saved on each visit when it was completed.

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const TZ = "Asia/Karachi"; // the hospital's days

// Chart colours (validated pair: categorical slots 1 and 2, light surface)
const COLOR = { hospital: "#2a78d6", doctor: "#eb6834" };

const isoInTz = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date); // yyyy-mm-dd
const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayIndex = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
};

// Preset ranges, in hospital days
const rangeFor = (preset) => {
  const today = isoInTz(new Date());
  if (preset === "today") return { from: today, to: today, groupBy: "day" };
  if (preset === "week") return { from: addDays(today, -weekdayIndex(today)), to: today, groupBy: "day" };
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today, groupBy: "day" };
  if (preset === "year") return { from: `${today.slice(0, 5)}01-01`, to: today, groupBy: "month" };
  return null;
};

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
];

const shortRupees = (n) => {
  const v = Math.abs(n);
  if (v >= 1e7) return `${(n / 1e7).toFixed(v >= 1e8 ? 0 : 1)} cr`;
  if (v >= 1e5) return `${(n / 1e5).toFixed(v >= 1e6 ? 0 : 1)} lac`;
  if (v >= 1e3) return `${(n / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
};

// 0, step, 2*step... covering max, with "nice" steps
const niceTicks = (max) => {
  if (max <= 0) return [0];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
};

// Stacked columns: hospital part at the base, doctor part on top, 2px surface gap between
const StackedBars = ({ series, mode }) => {
  const wrap = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null); // index

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 260;
  const pad = { top: 16, right: 12, bottom: 36, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...series.map((p) => p.hospital + p.doctor), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const y = (v) => pad.top + innerH - (v / top) * innerH;
  const band = innerW / series.length;
  const barW = Math.max(3, Math.min(24, band * 0.6));
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.floor(innerW / 56)));
  const order = mode === "doctor" ? ["doctor", "hospital"] : ["hospital", "doctor"];

  // Rounded data-end (top), square at the baseline
  const topRounded = (x, yTop, w, h) => {
    const r = Math.min(4, w / 2, h);
    return `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yTop + h} Z`;
  };

  const tip = hover !== null ? series[hover] : null;

  return (
    <div ref={wrap} className="relative w-full" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label="Fees by period, split between hospital and doctor" className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="#e7e6e2" strokeWidth="1" />
            <text x={pad.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#6b6a66">
              {shortRupees(t)}
            </text>
          </g>
        ))}
        {series.map((p, i) => {
          const x = pad.left + band * i + (band - barW) / 2;
          let base = 0;
          const total = p.hospital + p.doctor;
          const parts = order.filter((k) => p[k] > 0);
          return (
            <g key={p.key}>
              {parts.map((k, j) => {
                const y0 = y(base);
                const y1 = y(base + p[k]);
                base += p[k];
                const isTop = j === parts.length - 1;
                const gap = j > 0 ? 2 : 0; // surface gap between stacked segments
                const h = Math.max(0, y0 - y1 - gap);
                return isTop ? (
                  <path key={k} d={topRounded(x, y1, barW, h)} fill={COLOR[k]} opacity={hover === null || hover === i ? 1 : 0.45} />
                ) : (
                  <rect key={k} x={x} y={y1 + 0} width={barW} height={h} fill={COLOR[k]} opacity={hover === null || hover === i ? 1 : 0.45} />
                );
              })}
              {total === 0 && <line x1={x} x2={x + barW} y1={y(0)} y2={y(0)} stroke="#c9c8c3" strokeWidth="1" />}
              {/* Hit target: the whole band, bigger than the bar */}
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${p.label}: fees ${rupees(total)}, hospital ${rupees(p.hospital)}, doctor ${rupees(p.doctor)}, ${p.visits} visits`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {i % labelEvery === 0 && (
                <text x={pad.left + band * i + band / 2} y={height - pad.bottom + 16} textAnchor="middle" fontSize="11" fill="#6b6a66">
                  {p.label.replace(/^Week of /, "")}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#c9c8c3" strokeWidth="1" />
      </svg>
      {tip && (
        <div
          className="absolute pointer-events-none bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs text-gray-700 z-10 min-w-[11rem]"
          style={{
            left: Math.min(Math.max(pad.left + band * hover + band / 2 - 88, 0), width - 180),
            top: 4,
          }}
        >
          <p className="font-semibold text-gray-900 mb-1">{tip.label}</p>
          <p className="flex justify-between gap-4"><span>Fees</span><span className="font-medium">{rupees(tip.fees)}</span></p>
          <p className="flex justify-between gap-4">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: COLOR.hospital }} />Hospital</span>
            <span className="font-medium">{rupees(tip.hospital)}</span>
          </p>
          <p className="flex justify-between gap-4">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: COLOR.doctor }} />Doctor{mode === "admin" ? "s" : ""}</span>
            <span className="font-medium">{rupees(tip.doctor)}</span>
          </p>
          <p className="flex justify-between gap-4 text-gray-500"><span>Visits</span><span>{tip.visits}</span></p>
        </div>
      )}
    </div>
  );
};

const Tile = ({ label, value, sub, accent }) => (
  <div className="bg-white rounded-xl border border-gray-100 p-4">
    <p className="text-sm text-gray-500 flex items-center gap-2">
      {accent && <span className="w-2.5 h-2.5 rounded-sm" style={{ background: accent }} />}
      {label}
    </p>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
  </div>
);

const ProfitReport = ({ mode = "admin", headers: headersProp, doctors = [] }) => {
  // Callers pass a new object each render; only reload when the login itself changes
  const headerKey = JSON.stringify(headersProp || {});
  const headers = useMemo(() => JSON.parse(headerKey), [headerKey]);
  const [preset, setPreset] = useState("month");
  const [custom, setCustom] = useState(() => {
    const r = rangeFor("month");
    return { from: r.from, to: r.to };
  });
  const [groupBy, setGroupBy] = useState("day");
  const [docId, setDocId] = useState("");
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const latest = useRef(0);

  const range = preset === "custom" ? custom : rangeFor(preset);

  // A preset picks a sensible grouping; the admin can still change it
  const choosePreset = (key) => {
    setPreset(key);
    if (key !== "custom") setGroupBy(rangeFor(key).groupBy);
  };

  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const url = mode === "admin" ? "/api/admin/profit" : "/api/doctor/earnings";
      const { data } = await axios.get(backendUrl + url, {
        headers,
        params: { from: range.from, to: range.to, groupBy, ...(mode === "admin" && docId && { docId }) },
        timeout: 20000,
      });
      if (request !== latest.current) return;
      if (data.success) setReport(data.report);
      else setError(data.message);
    } catch {
      if (request === latest.current) setError("Could not load the report. Check the connection and try again.");
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [mode, headers, range.from, range.to, groupBy, docId]);

  useEffect(() => {
    load();
  }, [load]);

  const doctorName = useMemo(() => doctors.find((d) => d._id === docId)?.name, [doctors, docId]);
  const t = report?.totals;
  const singlePeriod = report && report.series.length <= 1;

  return (
    <section className="bg-white/60 rounded-2xl border border-gray-100 p-4 sm:p-6" aria-labelledby="profit-title">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div>
          <h2 id="profit-title" className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FaChartBar className="text-primary" />
            {mode === "admin" ? `Hospital profit${doctorName ? `: Dr. ${doctorName}` : " (all doctors)"}` : "My earnings"}
          </h2>
          <p className="text-sm text-gray-500">
            {mode === "admin"
              ? "Each completed visit's fee, split by the doctor's agreed share."
              : "Your part of each completed visit's fee, after the hospital's share."}
          </p>
        </div>
        <button
          onClick={() => setShowTable(!showTable)}
          className="self-start inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50"
        >
          {showTable ? <FaChartBar /> : <FaTable />} {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {/* Filters: one row above the chart */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => choosePreset(p.key)}
              aria-pressed={preset === p.key}
              className={`px-3 py-1.5 text-sm ${preset === p.key ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-50"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-end gap-2">
            <label className="text-xs text-gray-600">
              From
              <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="block px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="text-xs text-gray-600">
              To
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="block px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>
        )}
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden" role="group" aria-label="Show by">
          {["day", "week", "month"].map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              aria-pressed={groupBy === g}
              className={`px-3 py-1.5 text-sm capitalize ${groupBy === g ? "bg-gray-800 text-white" : "text-gray-700 hover:bg-gray-50"}`}
            >
              {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
        {mode === "admin" && (
          <select value={docId} onChange={(e) => setDocId(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-sm" aria-label="Doctor">
            <option value="">All doctors</option>
            {doctors.map((d) => (
              <option key={d._id} value={d._id}>Dr. {d.name}</option>
            ))}
          </select>
        )}
        {loading && <span className="text-xs text-gray-400">Updating…</span>}
      </div>

      {error && <p className="mb-3 p-3 rounded-lg bg-red-50 text-sm text-red-700">{error}</p>}

      {report && (
        <>
          {mode === "admin" && report.doctorsWithoutShare?.length > 0 && (
            <p className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-start gap-2">
              <FaExclamationTriangle className="mt-0.5 shrink-0" />
              No hospital share set for: {report.doctorsWithoutShare.map((n) => `Dr. ${n}`).join(", ")}. Their visits count as 0 profit until you set it in Manage Doctors.
            </p>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {mode === "admin" ? (
              <>
                <Tile label="Hospital profit" value={rupees(t.hospital)} accent={COLOR.hospital} sub={t.fees ? `${Math.round((t.hospital / t.fees) * 1000) / 10}% of fees` : undefined} />
                <Tile label="Doctors' share" value={rupees(t.doctor)} accent={COLOR.doctor} />
                <Tile label="Total fees" value={rupees(t.fees)} />
                <Tile label="Completed visits" value={t.visits.toLocaleString("en-PK")} />
              </>
            ) : (
              <>
                <Tile label="My earnings" value={rupees(t.doctor)} accent={COLOR.doctor} />
                <Tile label="Hospital's share" value={rupees(t.hospital)} accent={COLOR.hospital} />
                <Tile label="Total fees" value={rupees(t.fees)} />
                <Tile label="Completed visits" value={t.visits.toLocaleString("en-PK")} />
              </>
            )}
          </div>

          {showTable || singlePeriod ? (
            <div className="overflow-x-auto bg-white rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">{groupBy === "day" ? "Day" : groupBy === "week" ? "Week" : "Month"}</th>
                    <th className="px-4 py-2 font-medium text-right">Visits</th>
                    <th className="px-4 py-2 font-medium text-right">Fees</th>
                    <th className="px-4 py-2 font-medium text-right">Hospital</th>
                    <th className="px-4 py-2 font-medium text-right">{mode === "admin" ? "Doctors" : "Me"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.series.map((p) => (
                    <tr key={p.key}>
                      <td className="px-4 py-2 text-gray-900">{p.label}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{p.visits}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{rupees(p.fees)}</td>
                      <td className="px-4 py-2 text-right text-gray-900">{rupees(p.hospital)}</td>
                      <td className="px-4 py-2 text-right text-gray-900">{rupees(p.doctor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 p-3">
              {/* Legend in the same order as the stack, bottom part first */}
              <div className={`flex flex-wrap gap-4 text-xs text-gray-700 mb-2 px-1 ${mode === "doctor" ? "flex-row-reverse justify-end" : ""}`} aria-hidden="true">
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: COLOR.hospital }} /> Hospital</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: COLOR.doctor }} /> {mode === "admin" ? "Doctors" : "Me"}</span>
              </div>
              <StackedBars series={report.series} mode={mode} />
            </div>
          )}

          {mode === "admin" && !docId && (
            <div className="mt-4 overflow-x-auto bg-white rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <caption className="text-left px-4 pt-3 pb-1 font-semibold text-gray-900">By doctor</caption>
                <thead className="text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Doctor</th>
                    <th className="px-4 py-2 font-medium text-right">Share now</th>
                    <th className="px-4 py-2 font-medium text-right">Visits</th>
                    <th className="px-4 py-2 font-medium text-right">Fees</th>
                    <th className="px-4 py-2 font-medium text-right">Hospital profit</th>
                    <th className="px-4 py-2 font-medium text-right">Doctor&apos;s share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.byDoctor.map((d) => (
                    <tr key={d.docId} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        {doctors.some((x) => x._id === d.docId) ? (
                          <button onClick={() => setDocId(d.docId)} className="text-primary hover:underline text-left">Dr. {d.name}</button>
                        ) : (
                          <span className="text-gray-700">Dr. {d.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700">{d.currentPercent === null ? "—" : `${d.currentPercent}%`}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{d.visits}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{rupees(d.fees)}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{rupees(d.hospital)}</td>
                      <td className="px-4 py-2 text-right text-gray-900">{rupees(d.doctor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-semibold text-gray-900">
                    <td className="px-4 py-2">All doctors</td>
                    <td />
                    <td className="px-4 py-2 text-right">{t.visits}</td>
                    <td className="px-4 py-2 text-right">{rupees(t.fees)}</td>
                    <td className="px-4 py-2 text-right">{rupees(t.hospital)}</td>
                    <td className="px-4 py-2 text-right">{rupees(t.doctor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-gray-400">
            {report.from === report.to ? report.from : `${report.from} to ${report.to}`} (Pakistan time). A visit counts on the day it took place, once the doctor completes it.
            {report.estimatedVisits > 0 && ` ${report.estimatedVisits} older visit(s) were completed before shares were recorded and use the doctor's current share.`}
          </p>
        </>
      )}
    </section>
  );
};

export default ProfitReport;
