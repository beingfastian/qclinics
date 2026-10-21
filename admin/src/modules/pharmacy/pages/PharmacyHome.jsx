import { useContext } from "react";
import { FaPrescriptionBottleAlt } from "react-icons/fa";
import { PharmacyContext } from "../../../context/PharmacyContext";
import { AdminContext } from "../../../context/AdminContext";
import { Card } from "../../../components/ui";
import { ROLE_LABEL } from "../api";

// Pharmacy home. The dashboard (today's sales and profit, expiry, low stock, held
// bills) replaces this once sales and stock are in place.
const WHAT_YOU_CAN_DO = {
  sell: "Sell at the counter",
  returnWithBill: "Take returns with a bill",
  returnWithoutBill: "Take returns without a bill",
  manageStock: "Manage medicines, purchases, suppliers and stock",
  overrideNegativeStock: "Sell stock that isn't entered yet (logged)",
  viewProfit: "See profit",
  viewReports: "See reports",
};

const PharmacyHome = () => {
  const { pharmacyUser } = useContext(PharmacyContext);
  const { aToken } = useContext(AdminContext);
  const role = pharmacyUser?.role || (aToken ? "owner" : "");
  const permissions = pharmacyUser?.permissions || (aToken ? Object.keys(WHAT_YOU_CAN_DO) : []);

  return (
    <div className="w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
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
      <Card>
        <h2 className="font-semibold text-slate-900">What you can do here</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {permissions.map((p) => (
            <li key={p} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
              {WHAT_YOU_CAN_DO[p] || p}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-500">Medicines, purchases, the sales counter and reports are being added next.</p>
      </Card>
    </div>
  );
};

export default PharmacyHome;
