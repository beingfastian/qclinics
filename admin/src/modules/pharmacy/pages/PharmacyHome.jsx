import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FaCashRegister, FaExclamationTriangle, FaPause, FaPrescriptionBottleAlt } from "react-icons/fa";
import { PharmacyContext } from "../../../context/PharmacyContext";
import { AdminContext } from "../../../context/AdminContext";
import { Badge, Card, CardHeader, Page, StatTile } from "../../../components/ui";
import { pharmacyGet, errorText, money, ROLE_LABEL } from "../api";

const time = (d) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Pharmacy home. Everyone: their shift, held bills, stock alerts. Managers and the
// owner also see today's takings and profit, open shifts, shortages at closing,
// best sellers and what the stock is worth.
const PharmacyHome = () => {
  const { pharmacyUser } = useContext(PharmacyContext);
  const { aToken } = useContext(AdminContext);
  const [d, setD] = useState(null);
  const role = pharmacyUser?.role || (aToken ? "owner" : "");

  useEffect(() => {
    pharmacyGet("/dashboard")
      .then((data) => setD(data.dashboard))
      .catch((e) => toast.error(errorText(e)));
  }, []);

  const loading = !d;
  const t = d?.totals;
  const a = d?.alerts || {};
  return (
    <Page>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            <FaPrescriptionBottleAlt aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Pharmacy</h1>
            <p className="text-sm text-slate-600">
              {pharmacyUser?.name || (aToken ? "Owner" : "")}
              {role && ` · ${ROLE_LABEL[role] || role}`}
            </p>
          </div>
        </div>
        <Link to="/pharmacy/counter" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800">
          <FaCashRegister aria-hidden="true" /> Open the counter
        </Link>
      </div>

      {t && (
        <section aria-label="Today" className="mb-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">Today</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Net sales" value={money(t.netSalesPaisa)} hint={`${t.bills} bills${t.refundsPaisa ? ` · ${money(t.refundsPaisa)} refunded` : ""}`} to="/pharmacy/reports" />
            {t.profitPaisa !== undefined && <StatTile label="Profit" value={money(t.profitPaisa)} hint={t.netSalesPaisa ? `${Math.round((t.profitPaisa / t.netSalesPaisa) * 100)}% of sales` : " "} />}
            <StatTile label="Cash" value={money(t.cashPaisa)} hint={`Card ${money(t.cardPaisa)} · Online ${money(t.onlinePaisa)}`} />
            <StatTile label="Discounts given" value={money(t.discountPaisa)} hint={t.oversoldBills ? `${t.oversoldBills} bills sold beyond stock` : " "} tone={t.oversoldBills ? "warning" : undefined} />
          </div>
        </section>
      )}

      <section aria-label="Your counter and stock" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Your shift"
          loading={loading}
          value={d?.myShift ? money(d.myShift.totals?.salesPaisa) : "Not open"}
          hint={d?.myShift ? `Shift ${d.myShift.shiftNo} · ${d.myShift.totals?.salesCount || 0} bills` : "Open it at the counter"}
          to={d?.myShift ? "/pharmacy/shift" : "/pharmacy/counter"}
        />
        <StatTile label="Held bills" loading={loading} value={d?.heldBills ?? 0} icon={<FaPause />} hint="Waiting at the counter" to="/pharmacy/counter" />
        <StatTile label="Low stock" loading={loading} value={a.lowStock ?? 0} tone={a.lowStock ? "warning" : undefined} hint="At or below reorder level" to="/pharmacy/stock" />
        <StatTile
          label="Expiring in 30 days"
          loading={loading}
          value={a.expiringSoon ?? 0}
          icon={<FaExclamationTriangle />}
          tone={a.expiredOnShelf ? "danger" : a.expiringSoon ? "warning" : undefined}
          hint={a.expiredOnShelf ? `${a.expiredOnShelf} expired batches still on the shelf` : "Batches"}
          to="/pharmacy/stock"
        />
      </section>

      {t && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Best sellers today" />
            {d.topItems.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing sold yet today.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {d.topItems.map((i) => (
                  <li key={i.productId} className="flex justify-between gap-3 py-2">
                    <span className="text-slate-900">{[i.name, i.strength].filter(Boolean).join(" ")} <span className="text-slate-500">· {i.netUnits} {i.unitName}s</span></span>
                    <span className="tabular-nums">{money(i.netPaisa)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Counters" description="Open shifts, and shifts closed short or over in the last 7 days" />
            {d.openShifts.length === 0 && d.shortages.length === 0 && <p className="text-sm text-slate-600">No open shifts.</p>}
            <ul className="divide-y divide-slate-100 text-sm">
              {d.openShifts.map((s) => (
                <li key={s._id} className="flex justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium text-slate-900">{s.name}</span> <Badge tone="success">Open since {time(s.openedAt)}</Badge>
                  </span>
                  <span className="tabular-nums">{s.bills} bills · {money(s.salesPaisa)}</span>
                </li>
              ))}
              {d.shortages.map((s) => (
                <li key={s._id} className="flex justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium text-slate-900">{s.name}</span>{" "}
                    <span className="text-slate-500">shift {s.shiftNo}, {new Date(s.closedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                    {s.closeNote && <span className="block text-xs text-slate-500">“{s.closeNote}”</span>}
                  </span>
                  <Badge tone={s.differencePaisa < 0 ? "danger" : "warning"}>{s.differencePaisa < 0 ? `${money(-s.differencePaisa)} short` : `${money(s.differencePaisa)} over`}</Badge>
                </li>
              ))}
            </ul>
            <Link to="/pharmacy/shifts" className="mt-3 inline-block text-sm text-primary-700 underline">All shifts</Link>
          </Card>
          {d.stockValue && (
            <Card>
              <CardHeader title="Stock on the shelf" description="At cost" />
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{money(d.stockValue.valuePaisa)}</p>
              {d.stockValue.expiredPaisa > 0 && <p className="mt-1 text-sm text-red-700">{money(d.stockValue.expiredPaisa)} of it has expired</p>}
            </Card>
          )}
        </div>
      )}
    </Page>
  );
};

export default PharmacyHome;
