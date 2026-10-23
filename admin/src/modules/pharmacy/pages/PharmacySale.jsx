import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FaArrowLeft, FaPrint, FaReceipt, FaUndo } from "react-icons/fa";
import { Badge, Button, Card, EmptyState, Page, PageHeader } from "../../../components/ui";
import { useAppConfig } from "../../../appConfig";
import { pharmacyGet, errorText, money, stockText } from "../api";
import { printSaleReceipt, shopNameOf } from "../receipt";
import { usePharmacyAccess } from "../useAccess";

const METHOD = { cash: "Cash", card: "Card", online: "Online" };

// One bill: lines, payment, what was returned; print it again or take a return
const PharmacySale = () => {
  const { id } = useParams();
  const config = useAppConfig();
  const allowed = usePharmacyAccess();
  const [sale, setSale] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    pharmacyGet(`/sales/${id}`)
      .then((d) => setSale(d.sale))
      .catch((e) => (e?.response?.status === 404 || e?.response?.status === 400 ? setMissing(true) : toast.error(errorText(e))));
  }, [id]);

  if (missing) return <Page narrow><EmptyState icon={<FaReceipt />} title="Bill not found" /></Page>;
  if (!sale) return <Page narrow><p className="text-sm text-slate-500" role="status">Loading…</p></Page>;
  const anyLeft = sale.items.some((l) => l.returnedUnits < l.qtyUnits);

  return (
    <Page narrow>
      <Link to="/pharmacy/shift" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <FaArrowLeft aria-hidden="true" /> Shift
      </Link>
      <PageHeader
        title={`Bill ${sale.saleNo}`}
        description={`${new Date(sale.createdAt).toLocaleString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} · ${sale.by?.name}${sale.customerName ? ` · ${sale.customerName}` : ""}`}
        actions={
          <>
            <Button icon={<FaPrint />} onClick={() => printSaleReceipt(sale, shopNameOf(config)) || toast.error("Allow pop-ups for this site to print")}>Print</Button>
            {allowed("returnWithBill") && anyLeft && (
              <Link to={`/pharmacy/returns?bill=${sale.saleNo}`}>
                <Button icon={<FaUndo />} tabIndex={-1}>Return items</Button>
              </Link>
            )}
          </>
        }
      />
      {sale.negativeOverride && (
        <p className="mb-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">Sold beyond the stock entered, allowed by {sale.approvedBy?.name}.</p>
      )}
      <Card padded={false} className="mb-4">
        <ul className="divide-y divide-slate-100">
          {sale.items.map((l) => (
            <li key={l._id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span>
                <span className="font-medium text-slate-900">{[l.name, l.strength].filter(Boolean).join(" ")}</span>
                <span className="block text-slate-600">{stockText(l.qtyUnits, l)}</span>
                {l.returnedUnits > 0 && <Badge tone="warning">{l.returnedUnits} returned</Badge>}
              </span>
              <span className="tabular-nums">{money(l.lineTotalPaisa)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="ml-auto max-w-sm">
        <dl className="space-y-1 text-sm">
          {sale.discountPaisa > 0 && (
            <>
              <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{money(sale.subtotalPaisa)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>- {money(sale.discountPaisa)}</dd></div>
            </>
          )}
          <div className="flex justify-between text-base"><dt className="font-medium">Total</dt><dd className="font-semibold">{money(sale.totalPaisa)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">{METHOD[sale.paymentMethod]}</dt><dd>{money(sale.cashReceivedPaisa)}</dd></div>
          {sale.changePaisa > 0 && <div className="flex justify-between"><dt className="text-slate-600">Change</dt><dd>{money(sale.changePaisa)}</dd></div>}
          {sale.refundedPaisa > 0 && <div className="flex justify-between"><dt className="text-slate-600">Refunded</dt><dd>- {money(sale.refundedPaisa)}</dd></div>}
          {sale.costPaisa !== undefined && <div className="flex justify-between"><dt className="text-slate-600">Cost</dt><dd>{money(sale.costPaisa)}</dd></div>}
        </dl>
      </Card>
    </Page>
  );
};

export default PharmacySale;
