import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { FaCheck, FaCoins, FaExclamationTriangle, FaFlask, FaHandHoldingUsd, FaPercent, FaPlus, FaSyncAlt, FaUndo, FaUserMd } from "react-icons/fa";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Page, PageHeader, Segmented, Skeleton, StatTile } from "../components/ui";
import { billingGet, billingPost, billingPut, dateTime, errorText, isoToday, rs } from "../billing/api";

// The owner's view of the money: what came in, through which counter and person,
// per doctor (with the hospital/doctor split), discounts, refunds, counter closes
// to verify, and what's still unpaid. Also where counters and names are set up.
const TOAST = { autoClose: 3000, position: "bottom-right" };

const shift = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const periodRange = (period) => {
  const today = isoToday();
  if (period === "yesterday") return { from: shift(today, -1), to: shift(today, -1) };
  if (period === "week") {
    const day = new Date(`${today}T12:00:00`).getDay(); // 0 = Sunday
    return { from: shift(today, -((day + 6) % 7)), to: today }; // from Monday
  }
  if (period === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: today, to: today };
};

const Table = ({ head, rows, empty }) =>
  rows.length ? (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-slate-100 bg-slate-50 text-left text-slate-600">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((c, i) => (
                <td key={i} className={`px-4 py-2 ${i ? "text-right tabular-nums" : "text-slate-900"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="px-5 pb-5 text-sm text-slate-500">{empty}</p>
  );

// Counters (cash drawers) and the receptionists' names for the "who's at the counter" list
const SetupCard = () => {
  const [settings, setSettings] = useState(null);
  const [newCounter, setNewCounter] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    billingGet("/settings").then((data) => data.success && setSettings(data.settings)).catch(() => {});
  }, []);

  const save = async (next) => {
    setBusy(true);
    try {
      const data = await billingPut("/settings", next);
      if (data.success) {
        setSettings(data.settings);
        toast.success("Saved", TOAST);
        return true;
      }
      toast.error(data.message, TOAST);
    } catch (e) {
      toast.error(errorText(e), TOAST);
    } finally {
      setBusy(false);
    }
    return false;
  };
  const toggle = (list, id) => save({ ...settings, [list]: settings[list].map((x) => (x.id === id ? { ...x, active: !x.active } : x)) });
  const add = async (list, name, clear) => {
    if (!name.trim()) return;
    if (await save({ ...settings, [list]: [...settings[list], { name: name.trim(), active: true }] })) clear("");
  };

  if (!settings) return <Card><Skeleton className="h-24 w-full" /></Card>;
  const section = (list, title, hint, value, setValue, placeholder) => (
    <div>
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="text-xs text-slate-500 mb-2">{hint}</p>
      <ul className="flex flex-wrap gap-2 mb-2">
        {settings[list].map((x) => (
          <li key={x.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => toggle(list, x.id)}
              title={x.active ? "Turn off" : "Turn on"}
              className={`px-3 py-1 rounded-lg border text-sm ${x.active ? "border-primary-600 bg-primary-50 text-primary-800" : "border-slate-200 text-slate-400 line-through"}`}
            >
              {x.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} aria-label={`New ${title.toLowerCase()}`} />
        <Button icon={<FaPlus />} disabled={busy || !value.trim()} onClick={() => add(list, value, setValue)}>Add</Button>
      </div>
    </div>
  );
  return (
    <Card>
      <CardHeader title="Counters and staff" description="Tap a name to turn it off or on. Nothing is deleted, so old receipts keep their counter." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {section("counters", "Counters (cash drawers)", "One per cash drawer at reception", newCounter, setNewCounter, "e.g. Counter 2")}
        {section("staff", "Receptionists", "Shown in the “Your name” list at the counter", newName, setNewName, "e.g. Ayesha")}
      </div>
    </Card>
  );
};

const Money = () => {
  const [period, setPeriod] = useState("today");
  const [range, setRange] = useState(periodRange("today"));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await billingGet("/summary", range);
      if (res.success) {
        setData(res.summary);
        setError("");
      } else setError(res.message);
    } catch (e) {
      setError(errorText(e));
    }
  }, [range]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const choose = (value) => {
    setPeriod(value);
    if (value !== "custom") setRange(periodRange(value));
  };

  const verify = async (id) => {
    setBusy(id);
    try {
      const res = await billingPost(`/closes/${id}/verify`, {});
      if (res.success) toast.success("Verified", TOAST);
      else toast.error(res.message, TOAST);
      load();
    } catch (e) {
      toast.error(errorText(e), TOAST);
    } finally {
      setBusy("");
    }
  };

  const t = data?.totals;
  const loading = !data;
  const single = range.from === range.to;
  const unverified = data?.closes.filter((c) => !c.verifiedAt).length || 0;

  return (
    <Page>
      <PageHeader
        title="Money"
        icon={<FaCoins />}
        description={single ? `For ${range.from}` : `From ${range.from} to ${range.to}`}
        actions={<Button icon={<FaSyncAlt />} onClick={load}>Refresh</Button>}
      />
      <div className="mb-5 flex flex-col sm:flex-row sm:items-end gap-3">
        <Segmented
          label="Period"
          value={period}
          onChange={choose}
          options={[
            { value: "today", label: "Today" },
            { value: "yesterday", label: "Yesterday" },
            { value: "week", label: "This week" },
            { value: "month", label: "This month" },
            { value: "custom", label: "Dates" },
          ]}
        />
        {period === "custom" && (
          <div className="flex gap-2">
            <Field label="From" htmlFor="money-from">
              <Input id="money-from" type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
            </Field>
            <Field label="To" htmlFor="money-to">
              <Input id="money-to" type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
            </Field>
          </div>
        )}
      </div>
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatTile label="Collected" value={rs(t?.net)} hint={t ? `Cash ${rs(t.cash)} · Bank ${rs(t.bankTransfer)}` : ""} icon={<FaCoins />} loading={loading} />
        <StatTile label="Consultations" value={rs(t?.consultation)} icon={<FaUserMd />} loading={loading} />
        <StatTile label="Lab" value={rs(t?.lab)} icon={<FaFlask />} loading={loading} />
        <StatTile label="Discounts" value={rs(t?.discounts)} hint={data ? `${data.discounts.length} receipt${data.discounts.length === 1 ? "" : "s"}` : ""} icon={<FaPercent />} loading={loading} />
        <StatTile label="Refunds" value={rs(t?.refunds)} hint={data ? `${data.refunds.length} refund${data.refunds.length === 1 ? "" : "s"}` : ""} icon={<FaUndo />} loading={loading} tone={t?.refunds ? "warning" : undefined} />
      </div>

      {data?.receiptGaps?.length > 0 && (
        <Card className="mb-6 border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-900 flex items-start gap-2">
            <FaExclamationTriangle className="mt-0.5 shrink-0" />
            <span>
              Receipt numbers with no receipt:{" "}
              {data.receiptGaps.map((g) => `${g.day}: ${g.numbers.join(", ")}`).join(" · ")}. Usually a lost connection while saving; ask the counter.
            </span>
          </p>
        </Card>
      )}

      <Card padded={false} className="mb-6">
        <div className="px-5 pt-5">
          <CardHeader
            title="Counter closes"
            description={unverified ? `${unverified} to verify when you receive the cash` : "Each close counts one drawer"}
          />
        </div>
        {loading ? (
          <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div>
        ) : data.closes.length ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {data.closes.map((c) => (
              <li key={c._id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900">
                    {c.counterName} · {c.closedBy?.name}{" "}
                    {c.difference === 0 ? <Badge tone="success">Matches</Badge> : <Badge tone={c.difference < 0 ? "danger" : "warning"}>{c.difference < 0 ? `Short ${rs(-c.difference)}` : `Extra ${rs(c.difference)}`}</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {dateTime(c.closedAt)} · expected {rs(c.expected)} · counted {rs(c.countedCash)} · bank {rs(c.bankTransfers)} · {c.receipts} receipts
                  </p>
                  {c.note && <p className="text-xs text-slate-700 mt-0.5">Note: {c.note}</p>}
                </div>
                {c.verifiedAt ? (
                  <Badge tone="success" icon={<FaCheck />}>Verified {dateTime(c.verifiedAt)}</Badge>
                ) : (
                  <Button size="sm" variant="primary" loading={busy === c._id} onClick={() => verify(c._id)}>Verify cash received</Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-5 text-sm text-slate-500">No counter was closed in this period.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="By counter" description="Cash not counted yet is since that counter's last close" /></div>
          {loading ? <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div> : (
            <Table
              head={["Counter", "Cash", "Bank", "Refunds", "Not counted yet"]}
              rows={data.byCounter.map((c) => [c.name, rs(c.cash), rs(c.bankTransfer), rs(c.refunds), rs(c.notCountedCash)])}
              empty="No money through any counter in this period."
            />
          )}
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="By person at the counter" description="The name picked on the counter's computer" /></div>
          {loading ? <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div> : (
            <Table head={["Name", "Receipts", "Collected"]} rows={data.byStaff.map((s) => [s.name, s.receipts, rs(s.collected)])} empty="No receipts in this period." />
          )}
        </Card>
      </div>

      <Card padded={false} className="mb-6">
        <div className="px-5 pt-5">
          <CardHeader
            title="By doctor"
            description="From money actually collected (after refunds). Doctor's share is what you owe them for this period; pay them as you do now."
          />
        </div>
        {loading ? <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div> : (
          <Table
            head={["Doctor", "Visits", "Consultations", "Lab", "Discounts allowed", "Hospital share", "Doctor's share"]}
            rows={data.byDoctor.map((d) => [`Dr. ${d.name}`, d.visits, rs(d.consultation), rs(d.lab), rs(d.discountsAllowed), rs(d.hospitalShare), rs(d.doctorShare)])}
            empty="No doctor's patients paid in this period."
          />
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Discounts" description="Who allowed each one" /></div>
          {loading ? <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div> : (
            <Table
              head={["Patient", "Allowed by", "Amount"]}
              rows={data.discounts.map((d) => [
                <span key="p">{d.patientName}<span className="block text-xs text-slate-500">{d.receiptNo} · {d.collectedBy}{d.reason ? ` · ${d.reason}` : ""}</span></span>,
                `Dr. ${d.allowedBy}`,
                rs(d.amount),
              ])}
              empty="No discounts in this period."
            />
          )}
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Refunds" description="Only the owner login can refund" /></div>
          {loading ? <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div> : (
            <Table
              head={["Receipt", "Reason", "Amount"]}
              rows={data.refunds.map((r) => [
                <span key="r">{r.receiptNo}<span className="block text-xs text-slate-500">{dateTime(r.at)} · {r.counterName}</span></span>,
                r.reason,
                rs(r.amount),
              ])}
              empty="No refunds in this period."
            />
          )}
        </Card>
      </div>

      {data?.unpaid && (
        <Card padded={false} className="mb-6">
          <div className="px-5 pt-5">
            <CardHeader title="Not paid yet" description="Today's queue patients without a receipt, and lab requests of the last 7 days" />
          </div>
          {data.unpaid.visits.length + data.unpaid.lab.length === 0 ? (
            <EmptyState icon={<FaHandHoldingUsd />} title="Everything is paid" />
          ) : (
            <Table
              head={["Patient", "For", "Amount"]}
              rows={[
                ...data.unpaid.visits.map((v) => [v.patientName, `Dr. ${v.doctorName} (token ${v.tokenNumber})`, rs(v.amount)]),
                ...data.unpaid.lab.map((o) => [o.patientName, `Lab L-${o.orderNumber}`, o.total === null ? "Price needed" : rs(o.total)]),
              ]}
              empty=""
            />
          )}
        </Card>
      )}

      <SetupCard />
    </Page>
  );
};

export default Money;
