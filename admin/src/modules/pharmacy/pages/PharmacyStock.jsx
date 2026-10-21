import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FaExclamationTriangle } from "react-icons/fa";
import { Badge, Card, EmptyState, Page, PageHeader, Segmented, Select } from "../../../components/ui";
import { pharmacyGet, errorText, money, expiryText } from "../api";

// Stock alerts: batches expiring soon (to sell first or return to the supplier) and
// items at or below their reorder level
const PharmacyStock = () => {
  const [tab, setTab] = useState("expiring");
  const [days, setDays] = useState("90");
  const [batches, setBatches] = useState(null);
  const [low, setLow] = useState(null);

  useEffect(() => {
    setBatches(null);
    pharmacyGet(`/stock/expiring?days=${days}`)
      .then((d) => setBatches(d.batches))
      .catch((e) => {
        toast.error(errorText(e));
        setBatches([]);
      });
  }, [days]);

  useEffect(() => {
    pharmacyGet("/stock/low")
      .then((d) => setLow(d.products))
      .catch((e) => {
        toast.error(errorText(e));
        setLow([]);
      });
  }, []);

  const value = batches?.reduce((s, b) => s + (b.valuePaisa || 0), 0) || 0;
  return (
    <Page narrow>
      <PageHeader title="Stock alerts" icon={<FaExclamationTriangle />} description="What's expiring and what to reorder." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="Alerts"
          value={tab}
          onChange={setTab}
          options={[
            { value: "expiring", label: "Expiring", count: batches?.length || 0 },
            { value: "low", label: "Low stock", count: low?.length || 0 },
          ]}
        />
        {tab === "expiring" && (
          <Select aria-label="Expiring within" value={days} onChange={(e) => setDays(e.target.value)} className="w-44">
            <option value="30">Within 1 month</option>
            <option value="90">Within 3 months</option>
            <option value="180">Within 6 months</option>
          </Select>
        )}
      </div>

      {tab === "expiring" ? (
        <Card padded={false}>
          {batches === null ? (
            <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
          ) : batches.length === 0 ? (
            <EmptyState icon={<FaExclamationTriangle />} title="Nothing expiring in this time" />
          ) : (
            <>
              {value > 0 && <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-700">Worth {money(value)} at cost</p>}
              <ul className="divide-y divide-slate-100">
                {batches.map((b) => (
                  <li key={b.batchId}>
                    <Link to={`/pharmacy/items/${b.productId}`} className="flex flex-col gap-1 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{[b.name, b.strength].filter(Boolean).join(" ")}</p>
                        <p className="text-sm text-slate-600">Batch {b.batchNo || "—"} · {b.qtyUnits} {b.unitName}s</p>
                      </div>
                      {b.expired ? (
                        <Badge tone="danger">Expired {expiryText(b.expiry)}</Badge>
                      ) : (
                        <Badge tone={b.daysLeft <= 30 ? "danger" : "warning"}>{expiryText(b.expiry)} · {b.daysLeft} days</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      ) : (
        <Card padded={false}>
          {low === null ? (
            <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
          ) : low.length === 0 ? (
            <EmptyState icon={<FaExclamationTriangle />} title="Nothing is low on stock" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {low.map((p) => (
                <li key={p.productId}>
                  <Link to={`/pharmacy/items/${p.productId}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="font-medium text-slate-900">{[p.name, p.strength].filter(Boolean).join(" ")}</span>
                    {p.stockUnits <= 0 ? (
                      <Badge tone="danger">Out of stock</Badge>
                    ) : (
                      <Badge tone="warning">{p.stockUnits} {p.unitName}s (reorder at {p.reorderLevelUnits})</Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Page>
  );
};

export default PharmacyStock;
