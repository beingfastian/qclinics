import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FaPlus, FaTruckLoading } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Page, PageHeader } from "../../../components/ui";
import { pharmacyGet, errorText, money, dateText } from "../api";

// Purchases entered, newest first
const PharmacyPurchases = () => {
  const [rows, setRows] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor) => {
    const data = await pharmacyGet(`/purchases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    setRows((r) => (cursor ? [...r, ...data.purchases] : data.purchases));
    setNextCursor(data.nextCursor);
  }, []);

  useEffect(() => {
    load().catch((e) => {
      toast.error(errorText(e));
      setRows([]);
    });
  }, [load]);

  const more = async () => {
    setLoadingMore(true);
    await load(nextCursor).catch((e) => toast.error(errorText(e)));
    setLoadingMore(false);
  };

  return (
    <Page narrow>
      <PageHeader
        title="Purchases"
        icon={<FaTruckLoading />}
        description="Stock received from suppliers. Each line becomes a batch with its expiry and cost."
        actions={
          <Link to="/pharmacy/purchases/new">
            <Button variant="primary" icon={<FaPlus />} tabIndex={-1}>New purchase</Button>
          </Link>
        }
      />
      <Card padded={false}>
        {rows === null ? (
          <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<FaTruckLoading />} title="No purchases yet" description="Enter the supplier's invoice to put stock on the shelf." />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((p) => {
                const due = p.totalPaisa - p.paidPaisa;
                return (
                  <li key={p._id}>
                    <Link to={`/pharmacy/purchases/${p._id}`} className="flex flex-col gap-1 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">
                          #{p.purchaseNo} · {p.supplierName}
                        </p>
                        <p className="text-sm text-slate-600">
                          {dateText(p.invoiceDate || p.createdAt)}
                          {p.invoiceNo && ` · Invoice ${p.invoiceNo}`}
                          {p.by?.name && ` · ${p.by.name}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-medium text-slate-900">{money(p.totalPaisa)}</span>
                        {due > 0 ? <Badge tone="warning">{money(due)} unpaid</Badge> : <Badge tone="success">Paid</Badge>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {nextCursor && (
              <div className="border-t border-slate-100 p-3 text-center">
                <Button size="sm" onClick={more} loading={loadingMore}>Show more</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </Page>
  );
};

export default PharmacyPurchases;
