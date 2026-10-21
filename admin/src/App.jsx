import { Suspense, lazy, useCallback, useContext, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { AdminContext } from "./context/AdminContext";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import { PageBoundary } from "./components/ErrorBoundary";

// Each page's code is loaded when it is first opened, so the app starts with a
// small download instead of every screen at once.
const PageLoading = () => (
  <p className="p-6 text-sm text-slate-500" role="status">
    Loading…
  </p>
);
const Dashboard = lazy(() => import("./pages/Admin/Dashboard.jsx"));
const AllAppointments = lazy(() => import("./pages/Admin/AllAppointments.jsx"));
const AddDoctor = lazy(() => import("./pages/Admin/AddDoctor.jsx"));
const ManageDoctors = lazy(() => import("./pages/Admin/ManageDoctors.jsx"));
const AddPatient = lazy(() => import("./pages/Admin/AddPatient.jsx"));
const ManagePatients = lazy(() => import("./pages/Admin/ManagePatients.jsx"));
const Settings = lazy(() => import("./pages/Admin/Settings.jsx"));
const BookAppointmentForPatient = lazy(() => import("./pages/Admin/BookAppointmentForPatient.jsx"));
import { DoctorContext } from "./context/DoctorContext.jsx";
const DoctorDashboard = lazy(() => import("./pages/Doctor/DoctorDashboard.jsx"));
const DoctorAppointments = lazy(() => import("./pages/Doctor/DoctorAppointments.jsx"));
const DoctorProfile = lazy(() => import("./pages/Doctor/DoctorProfile.jsx"));
const DoctorLeaveRequest = lazy(() => import("./pages/Doctor/DoctorLeaveRequest"));
const AdminLeaveManagement = lazy(() => import("./pages/Admin/AdminLeaveManagement.jsx"));
import { NotificationProvider } from "./context/NotificationContext.jsx";
const ForgotPassword = lazy(() => import("./pages/Doctor/ForgotPassword"));
const VerifyOTP = lazy(() => import("./pages/Doctor/VerifyOTP"));
const ResetPassword = lazy(() => import("./pages/Doctor/ResetPassword"));
const Queue = lazy(() => import("./pages/Queue.jsx"));
import { LabContext } from "./context/LabContext.jsx";
const LabOrders = lazy(() => import("./pages/Lab/LabOrders.jsx"));
const LabOrderDetail = lazy(() => import("./pages/Lab/LabOrderDetail.jsx"));
const LabTests = lazy(() => import("./pages/Lab/LabTests.jsx"));
const LabStaff = lazy(() => import("./pages/Lab/LabStaff.jsx"));
const Billing = lazy(() => import("./pages/Billing.jsx"));
const Money = lazy(() => import("./pages/Money.jsx"));

const App = () => {
  const { aToken, isOwner } = useContext(AdminContext);
  const { dToken } = useContext(DoctorContext);
  const { lToken } = useContext(LabContext);
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  return (
    <BrowserRouter>
      <ToastContainer />
      {aToken || dToken || lToken ? (
        <NotificationProvider>
          <div className="min-h-screen bg-slate-50">
            <Navbar onMenuClick={() => setNavOpen(true)} />
            <div className="flex">
              <Sidebar mobileOpen={navOpen} onClose={closeNav} />
              <main className="flex-1 min-w-0">
              <PageBoundary>
              <Suspense fallback={<PageLoading />}>
              {aToken && !isOwner ? (
                // Shared reception login: the front desk only (no doctors' settings,
                // leave decisions, profit, staff or system settings)
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/queue" element={<Queue />} />
                  <Route path="/all-appointments" element={<AllAppointments />} />
                  <Route path="/book-appointment" element={<BookAppointmentForPatient />} />
                  <Route path="/patients" element={<ManagePatients />} />
                  <Route path="/add-patient" element={<AddPatient />} />
                  <Route path="/lab-requests" element={<LabOrders />} />
                  <Route path="/lab-requests/:id" element={<LabOrderDetail />} />
                  <Route path="/billing" element={<Billing />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              ) : aToken ? (
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/queue" element={<Queue />} />
                  <Route path="/all-appointments" element={<AllAppointments />} />
                  <Route path="/book-appointment" element={<BookAppointmentForPatient />} />
                  <Route path="/doctors" element={<ManageDoctors />} />
                  <Route path="/add-doctor" element={<AddDoctor />} />
                  <Route path="/patients" element={<ManagePatients />} />
                  <Route path="/add-patient" element={<AddPatient />} />
                  <Route path="/leave-management" element={<AdminLeaveManagement />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/lab-requests" element={<LabOrders />} />
                  <Route path="/lab-requests/:id" element={<LabOrderDetail />} />
                  <Route path="/lab-tests" element={<LabTests />} />
                  <Route path="/lab-staff" element={<LabStaff />} />
                  <Route path="/billing" element={<Billing />} />
                  <Route path="/money" element={<Money />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              ) : dToken ? (
                <Routes>
                  <Route path="/doctor" element={<DoctorDashboard />} />
                  <Route path="/doctor/queue" element={<Queue />} />
                  <Route path="/doctor/appointments" element={<DoctorAppointments />} />
                  <Route path="/doctor/profile" element={<DoctorProfile />} />
                  <Route path="/doctor/leave-requests" element={<DoctorLeaveRequest />} />
                  <Route path="/doctor/lab-reports" element={<LabOrders />} />
                  <Route path="/doctor/lab-reports/:id" element={<LabOrderDetail />} />
                  <Route path="*" element={<Navigate to="/doctor" replace />} />
                </Routes>
              ) : (
                <Routes>
                  <Route path="/lab" element={<LabOrders />} />
                  <Route path="/lab/orders/:id" element={<LabOrderDetail />} />
                  <Route path="/lab/tests" element={<LabTests />} />
                  <Route path="*" element={<Navigate to="/lab" replace />} />
                </Routes>
              )}
              </Suspense>
              </PageBoundary>
              </main>
            </div>
          </div>
        </NotificationProvider>
      ) : (
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/verify-otp" element={<VerifyOTP />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      )}
    </BrowserRouter>
  );
};

export default App;