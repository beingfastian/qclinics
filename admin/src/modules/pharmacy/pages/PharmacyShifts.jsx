import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { FaClock } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Page, PageHeader } from "../../../components/ui";
import { pharmacyGet, errorText, money } from "../api";

const when = (d) => new Date(d).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Managers: every shift, newest first. Who, when, what was sold, and whether the
// drawer matched at closing.
const PharmacyShifts = () => {
  const [rows, setRows] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor) => {
    const data = await pharmacyGet(`/shifts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    setRows((r) => (cursor ? [...r, ...data.shifts] : data.shifts));
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
      <PageHeader title="Shifts" icon={<FaClock />} description="Every counter shift, and whether the cash matched at closing." />
      <Card padded={false}>
        {rows === null ? (
          <p className="p-6 text-sm text-slate-500" role="status">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<FaClock />} title="No shifts yet" />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((s) => {
                const t = s.totals || {};
                const d = s.differencePaisa;
                return (
                  <li key={s._id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" aria-label={`Shift ${s.shiftNo}`}>
                    <div>
                      <p className="font-medium text-slate-900">
                        Shift {s.shiftNo} · {s.openedBy?.name}
                      </p>
                      <p className="text-slate-600">
                        {when(s.openedAt)}
                        {s.closedAt && ` – ${when(s.closedAt)}`}
                        {` · ${t.salesCount || 0} bills · ${money(t.salesPaisa)}`}
                        {t.refundsPaisa > 0 && ` · ${money(t.refundsPaisa)} refunded`}
                      </p>
                      {s.closeNote && <p className="text-xs text-slate-500">“{s.closeNote}”</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {s.status === "open" ? (
                        <Badge tone="success">Open</Badge>
                      ) : d === 0 ? (
                        <Badge tone="success">Cash matched</Badge>
                      ) : (
                        <Badge tone={d < 0 ? "danger" : "warning"}>{d < 0 ? `${money(-d)} short` : `${money(d)} over`}</Badge>
                      )}
                      {s.status === "closed" && <span className="text-slate-500">counted {money(s.countedCashPaisa)} of {money(s.expectedCashPaisa)}</span>}
                    </div>
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

export default PharmacyShifts;
