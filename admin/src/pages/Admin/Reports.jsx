import { useContext, useEffect, useState } from "react";
import axios from "axios";
import { FaCalendarCheck, FaUserMd, FaUsers, FaUserSlash, FaWhatsapp } from "react-icons/fa";
import { AdminContext } from "../../context/AdminContext.jsx";
import ProfitReport from "../../components/ProfitReport";
import { StatTile } from "../../components/ui";

// Money and totals, kept away from the daily work screens (Home is for today's work)
const Reports = () => {
  const { aToken, getDashData, dashData, backendUrl, doctors, getAllDoctors } = useContext(AdminContext);
  const [whatsappStats, setWhatsappStats] = useState({ enabledUsers: 0, todayNotifications: 0 });

  useEffect(() => {
    if (!aToken) return;
    getAllDoctors(); // for the profit report's doctor filter
    getDashData();
    axios
      .get(backendUrl + "/api/admin/whatsapp-stats", { headers: { aToken } })
      .then(({ data }) => data.success && setWhatsappStats(data.data))
      .catch((error) => console.error("Error fetching WhatsApp stats:", error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aToken]);

  const loading = !dashData;
  const last30 = dashData?.last30Days;

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-600">Earnings, doctor shares and totals.</p>
      </div>

      {/* Hospital profit by day / week / month, per doctor or all */}
      <div className="mb-6">
        <ProfitReport mode="admin" headers={{ atoken: aToken }} doctors={doctors} />
      </div>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">All time</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Doctors" value={dashData?.doctors} icon={<FaUserMd />} loading={loading} to="/doctors" />
        <StatTile label="Patients" value={dashData?.patients} icon={<FaUsers />} loading={loading} to="/patients" />
        <StatTile label="Appointments" value={dashData?.appointments} icon={<FaCalendarCheck />} loading={loading} to="/all-appointments" />
        <StatTile
          label="WhatsApp enabled"
          value={whatsappStats.enabledUsers}
          hint={`${whatsappStats.todayNotifications} message${whatsappStats.todayNotifications === 1 ? "" : "s"} sent today`}
          icon={<FaWhatsapp />}
          loading={loading}
        />
        {/* Of patients who should have come (and didn't cancel ahead), how many never showed */}
        <StatTile
          label="No-shows (30 days)"
          value={last30 ? last30.noShow : 0}
          hint={last30 ? `${last30.noShowRate}% missed · ${last30.cancelled} cancelled ahead` : undefined}
          icon={<FaUserSlash />}
          loading={loading}
        />
      </div>
    </div>
  );
};

export default Reports;
