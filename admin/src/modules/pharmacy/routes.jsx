import { lazy } from "react";
import { Route } from "react-router-dom";

// The pharmacy's pages, each loaded when first opened. The same list serves the
// owner (hospital or standalone pharmacy) and pharmacy staff; `canManage` and
// `canReport` add the manager pages (the server checks every request anyway).
const PharmacyHome = lazy(() => import("./pages/PharmacyHome.jsx"));
const PharmacyStaff = lazy(() => import("./pages/PharmacyStaff.jsx"));
const PharmacyItems = lazy(() => import("./pages/PharmacyItems.jsx"));
const PharmacyItem = lazy(() => import("./pages/PharmacyItem.jsx"));
const PharmacyStock = lazy(() => import("./pages/PharmacyStock.jsx"));
const PharmacySuppliers = lazy(() => import("./pages/PharmacySuppliers.jsx"));
const PharmacyPurchases = lazy(() => import("./pages/PharmacyPurchases.jsx"));
const PharmacyPurchaseNew = lazy(() => import("./pages/PharmacyPurchaseNew.jsx"));
const PharmacyPurchaseDetail = lazy(() => import("./pages/PharmacyPurchaseDetail.jsx"));
const PharmacyCounter = lazy(() => import("./pages/PharmacyCounter.jsx"));
const PharmacyShift = lazy(() => import("./pages/PharmacyShift.jsx"));
const PharmacySale = lazy(() => import("./pages/PharmacySale.jsx"));
const PharmacyReturns = lazy(() => import("./pages/PharmacyReturns.jsx"));
const PharmacyReports = lazy(() => import("./pages/PharmacyReports.jsx"));
const PharmacyShifts = lazy(() => import("./pages/PharmacyShifts.jsx"));
const PharmacyCustomers = lazy(() => import("./pages/PharmacyCustomers.jsx"));
const PharmacyCustomer = lazy(() => import("./pages/PharmacyCustomer.jsx"));
const PharmacySupplier = lazy(() => import("./pages/PharmacySupplier.jsx"));
const PharmacyLabels = lazy(() => import("./pages/PharmacyLabels.jsx"));
const PharmacyPrescriptions = lazy(() => import("./pages/PharmacyPrescriptions.jsx"));

export const pharmacyRoutes = ({ owner = false, canManage = false, canReport = false }) => [
  <Route key="home" path="/pharmacy" element={<PharmacyHome />} />,
  <Route key="counter" path="/pharmacy/counter" element={<PharmacyCounter />} />,
  <Route key="shift" path="/pharmacy/shift" element={<PharmacyShift />} />,
  <Route key="sale" path="/pharmacy/sales/:id" element={<PharmacySale />} />,
  <Route key="returns" path="/pharmacy/returns" element={<PharmacyReturns />} />,
  <Route key="customers" path="/pharmacy/customers" element={<PharmacyCustomers />} />,
  <Route key="prescriptions" path="/pharmacy/prescriptions" element={<PharmacyPrescriptions />} />,
  <Route key="customer" path="/pharmacy/customers/:id" element={<PharmacyCustomer />} />,
  <Route key="items" path="/pharmacy/items" element={<PharmacyItems />} />,
  <Route key="item" path="/pharmacy/items/:id" element={<PharmacyItem />} />,
  <Route key="stock" path="/pharmacy/stock" element={<PharmacyStock />} />,
  ...(canManage || owner
    ? [
        <Route key="suppliers" path="/pharmacy/suppliers" element={<PharmacySuppliers />} />,
        <Route key="supplier" path="/pharmacy/suppliers/:id" element={<PharmacySupplier />} />,
        <Route key="labels" path="/pharmacy/labels" element={<PharmacyLabels />} />,
        <Route key="purchases" path="/pharmacy/purchases" element={<PharmacyPurchases />} />,
        <Route key="purchase-new" path="/pharmacy/purchases/new" element={<PharmacyPurchaseNew />} />,
        <Route key="purchase" path="/pharmacy/purchases/:id" element={<PharmacyPurchaseDetail />} />,
      ]
    : []),
  ...(canReport || owner
    ? [
        <Route key="reports" path="/pharmacy/reports" element={<PharmacyReports />} />,
        <Route key="shifts" path="/pharmacy/shifts" element={<PharmacyShifts />} />,
      ]
    : []),
  ...(owner ? [<Route key="staff" path="/pharmacy/staff" element={<PharmacyStaff />} />] : []),
];
