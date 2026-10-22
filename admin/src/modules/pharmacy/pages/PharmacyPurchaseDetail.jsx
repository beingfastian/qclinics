import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FaArrowLeft, FaTruckLoading } from "react-icons/fa";
import { Card, EmptyState, Page, PageHeader } from "../../../components/ui";
import { pharmacyGet, errorText, money, dateText, expiryText } from "../api";

// One purchase as entered: lines, what each unit really cost, totals
const PharmacyPurchaseDetail = () => {
  const { id } = useParams();
  const [purchase, setPurchase] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    pharmacyGet(`/purchases/${id}`)
      .then((data) => setPurchase(data.purchase))
      .catch((e) => (e?.response?.status === 404 || e?.response?.status === 400 ? setMissing(true) : toast.error(errorText(e))));
  }, [id]);

  if (missing) return <Page narrow><EmptyState icon={<FaTruckLoading />} title="Purchase not found" /></Page>;
  if (!purchase) return <Page narrow><p className="text-sm text-slate-500" role="status">Loading…</p></Page>;
  const due = purchase.totalPaisa - purchase.paidPaisa;

  return (
    <Page narrow>
      <Link to="/pharmacy/purchases" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <FaArrowLeft aria-hidden="true" /> Purchases
      </Link>
      <PageHeader
        title={`Purchase #${purchase.purchaseNo}`}
        description={[
          purchase.supplierName,
          purchase.invoiceNo && `Invoice ${purchase.invoiceNo}`,
          dateText(purchase.invoiceDate || purchase.createdAt),
          purchase.by?.name && `Entered by ${purchase.by.name}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <Card padded={false} className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-5 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Batch / expiry</th>
                <th className="px-3 py-2 font-medium">Bought</th>
                <th className="px-3 py-2 font-medium text-right">Pack cost</th>
                <th className="px-3 py-2 font-medium text-right">Line total</th>
                <th className="px-5 py-2 font-medium text-right">Cost / unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchase.items.map((l) => (
                <tr key={l.batchId}>
                  <td className="px-5 py-2"><Link to={`/pharmacy/items/${l.productId}`} className="text-primary-700 underline">{l.name}</Link></td>
                  <td className="px-3 py-2">{l.batchNo || "—"} · {expiryText(l.expiry)}</td>
                  <td className="px-3 py-2">
                    {[l.packs && `${l.packs} packs`, l.looseUnits && `${l.looseUnits} loose`, l.bonusUnits && `${l.bonusUnits} bonus`].filter(Boolean).join(" + ")}
                    <span className="block text-xs text-slate-500">{l.units} units</span>
                  </td>
                  <td className="px-3 py-2 text-right">{money(l.packCostPaisa)}</td>
                  <td className="px-3 py-2 text-right">
                    {money(l.lineTotalPaisa)}
                    {l.discountPaisa > 0 && <span className="block text-xs text-slate-500">after {money(l.discountPaisa)} off</span>}
                  </td>
                  <td className="px-5 py-2 text-right">{money(l.costPerUnitPaisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="ml-auto max-w-sm">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">Total</dt><dd className="font-semibold text-slate-900">{money(purchase.totalPaisa)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Paid</dt><dd>{money(purchase.paidPaisa)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Still to pay</dt><dd className={due > 0 ? "font-semibold text-amber-800" : ""}>{money(due)}</dd></div>
        </dl>
        {purchase.notes && <p className="mt-3 text-sm text-slate-600">{purchase.notes}</p>}
      </Card>
    </Page>
  );
};

export default PharmacyPurchaseDetail;
