import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { FaChartBar, FaDownload } from "react-icons/fa";
import { Button, Card, EmptyState, Field, Input, Page, PageHeader, Segmented, Select, StatTile } from "../../../components/ui";
import { pharmacyGet, errorText, money, downloadCsv, rupees } from "../api";

// Sales reports for a period, in the shop's local days: totals, each day, each
// item and each person. Every table downloads as a CSV for Excel. Cost and profit
// only for those who may see them (the server leaves them out otherwise).
const PK_OFFSET = 5 * 60; // the shop's time: Pakistan (matches the server)
const localToday = () => new Date(Date.now() + PK_OFFSET * 60000).toISOString().slice(0, 10);
const shift = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;

const PRESETS = {
  today: () => [localToday(), localToday()],
  yesterday: () => [shift(localToday(), -1), shift(localToday(), -1)],
  week: () => [shift(localToday(), -6), localToday()],
  month: () => [monthStart(localToday()), localToday()],
  lastMonth: () => {
    const end = shift(monthStart(localToday()), -1);
    return [monthStart(end), end];
  },
};
const dayText = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const PharmacyReports = () => {
  const [preset, setPreset] = useState("today");
  const [range, setRange] = useState(PRESETS.today);
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState(null);
  const [sort, setSort] = useState("revenue");

  const choose = (value) => {
    setPreset(value);
    if (PRESETS[value]) setRange(PRESETS[value]());
  };

  useEffect(() => {
    const [from, to] = range;
    if (!from || !to) return;
    let alive = true;
    setSummary(null);
    setItems(null);
    Promise.all([pharmacyGet(`/reports/summary?from=${from}&to=${to}`), pharmacyGet(`/reports/items?from=${from}&to=${to}&sort=${sort}&limit=1000`)])
      .then(([s, i]) => {
        if (!alive) return;
        setSummary(s);
        setItems(i);
      })
      .catch((e) => alive && toast.error(errorText(e)));
    return () => {
      alive = false;
    };
  }, [range, sort]);

  const [from, to] = range;
  const t = summary?.totals;
  const showProfit = t?.profitPaisa !== undefined;
  const period = from === to ? from : `${from}_to_${to}`;

  const downloadDays = () =>
    downloadCsv(`pharmacy-sales-${period}.csv`, summary.days, [
      ["Date", (d) => d.date],
      ["Bills", (d) => d.bills],
      ["Sales (Rs)", (d) => rupees(d.salesPaisa)],
      ["Refunds (Rs)", (d) => rupees(d.refundsPaisa)],
      ["Net sales (Rs)", (d) => rupees(d.netSalesPaisa)],
      ...(showProfit ? [["Cost (Rs)", (d) => rupees(d.costPaisa)], ["Profit (Rs)", (d) => rupees(d.profitPaisa)]] : []),
    ]);
  const downloadItems = () =>
    downloadCsv(`pharmacy-items-${period}.csv`, items.items, [
      ["Item", (i) => [i.name, i.strength].filter(Boolean).join(" ")],
      ["Unit", (i) => i.unitName],
      ["Sold", (i) => i.unitsSold],
      ["Returned", (i) => i.unitsReturned],
      ["Net units", (i) => i.netUnits],
      ["Net sales (Rs)", (i) => rupees(i.netPaisa)],
      ...(showProfit ? [["Cost (Rs)", (i) => rupees(i.costPaisa)], ["Profit (Rs)", (i) => rupees(i.profitPaisa)]] : []),
    ]);
  const downloadStaff = () =>
    downloadCsv(`pharmacy-staff-${period}.csv`, summary.staff, [
      ["Name", (s) => s.name],
      ["Bills", (s) => s.bills],
      ["Sales (Rs)", (s) => rupees(s.salesPaisa)],
      ["Discounts (Rs)", (s) => rupees(s.discountPaisa)],
      ["Sold beyond stock", (s) => s.oversoldBills],
    ]);

  return (
    <Page>
      <PageHeader title="Reports" icon={<FaChartBar />} description="Sales, refunds and profit by day, item and person. Days are Pakistan time." />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Period" htmlFor="rp-preset">
            <Select id="rp-preset" value={preset} onChange={(e) => choose(e.target.value)} className="w-44">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">Last 7 days</option>
              <option value="month">This month</option>
              <option value="lastMonth">Last month</option>
              <option value="custom">Choose dates</option>
            </Select>
          </Field>
          <Field label="From" htmlFor="rp-from">
            <Input id="rp-from" type="date" value={from} max={to} onChange={(e) => { setPreset("custom"); setRange([e.target.value, to]); }} />
          </Field>
          <Field label="To" htmlFor="rp-to">
            <Input id="rp-to" type="date" value={to} min={from} max={localToday()} onChange={(e) => { setPreset("custom"); setRange([from, e.target.value]); }} />
          </Field>
        </div>
      </Card>

      {!summary ? (
        <p className="text-sm text-slate-500" role="status">Loading…</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Net sales" value={money(t.netSalesPaisa)} hint={`${t.bills} bills · ${money(t.refundsPaisa)} refunded`} />
            {showProfit && <StatTile label="Profit" value={money(t.profitPaisa)} hint={`Cost ${money(t.costPaisa)}`} />}
            <StatTile label="Cash" value={money(t.cashPaisa)} hint={`Card ${money(t.cardPaisa)} · Online ${money(t.onlinePaisa)}`} />
            <StatTile label="Discounts" value={money(t.discountPaisa)} hint={t.oversoldBills ? `${t.oversoldBills} bills sold beyond stock` : `${t.returns} returns`} />
          </div>

          <div className="mb-3">
            <Segmented
              label="Report"
              value={tab}
              onChange={setTab}
              options={[
                { value: "overview", label: "By day" },
                { value: "items", label: "By item" },
                { value: "staff", label: "By person" },
              ]}
            />
          </div>

          {tab === "overview" && (
            <Table
              title="Sales by day"
              onDownload={downloadDays}
              head={["Day", "Bills", "Sales", "Refunds", "Net sales", ...(showProfit ? ["Profit"] : [])]}
              rows={summary.days.map((d) => [dayText(d.date), d.bills, money(d.salesPaisa), money(d.refundsPaisa), money(d.netSalesPaisa), ...(showProfit ? [money(d.profitPaisa)] : [])])}
              keys={summary.days.map((d) => d.date)}
            />
          )}
          {tab === "items" && items && (
            <Table
              title={`${items.count} items sold`}
              onDownload={downloadItems}
              extra={
                <Select aria-label="Sort items by" value={sort} onChange={(e) => setSort(e.target.value)} className="w-44">
                  <option value="revenue">Most sales (Rs)</option>
                  <option value="units">Most units</option>
                  {showProfit && <option value="profit">Most profit</option>}
                </Select>
              }
              head={["Item", "Sold", "Returned", "Net sales", ...(showProfit ? ["Profit"] : [])]}
              rows={items.items.map((i) => [[i.name, i.strength].filter(Boolean).join(" "), `${i.unitsSold} ${i.unitName}s`, i.unitsReturned || "", money(i.netPaisa), ...(showProfit ? [money(i.profitPaisa)] : [])])}
              keys={items.items.map((i) => i.productId)}
            />
          )}
          {tab === "staff" && (
            <Table
              title="Sales by person"
              onDownload={downloadStaff}
              head={["Name", "Bills", "Sales", "Discounts", "Sold beyond stock"]}
              rows={summary.staff.map((s) => [s.name, s.bills, money(s.salesPaisa), money(s.discountPaisa), s.oversoldBills || ""])}
              keys={summary.staff.map((s) => `${s.role}-${s.name}`)}
            />
          )}
        </>
      )}
    </Page>
  );
};

// A report table: first column left, numbers right; scrolls sideways on phones
const Table = ({ title, head, rows, keys, onDownload, extra }) => (
  <Card padded={false}>
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <div className="flex items-center gap-2">
        {extra}
        <Button size="sm" icon={<FaDownload />} onClick={onDownload} disabled={!rows.length}>Download CSV</Button>
      </div>
    </div>
    {rows.length === 0 ? (
      <EmptyState icon={<FaChartBar />} title="Nothing in this period" />
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, r) => (
              <tr key={keys[r]}>
                {row.map((cell, i) => (
                  <td key={i} className={`px-4 py-2 ${i ? "text-right tabular-nums" : "text-slate-900"}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);

export default PharmacyReports;
