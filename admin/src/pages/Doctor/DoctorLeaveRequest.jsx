import { useContext, useState, useEffect } from "react";
import { useDialog } from "../../components/ui/Dialog";
import { DoctorContext } from "../../context/DoctorContext";
import { toast } from "react-toastify";
import { FaCalendarAlt, FaPlus, FaTrash, FaEye, FaClock, FaTimes } from "react-icons/fa";

const DoctorLeaveRequest = () => {
  const { confirm } = useDialog();
  const { 
    dToken, 
    leaveRequests, 
    requestLeave, 
    getLeaveRequests, 
    cancelLeaveRequest 
  } = useContext(DoctorContext);
  
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fromDate: "",
    toDate: "",
    reason: "",
    type: "vacation"
  });

  const leaveTypes = [
    { value: "vacation", label: "Vacation", color: "bg-primary-100 text-primary-800" },
    { value: "sick", label: "Sick Leave", color: "bg-red-100 text-red-700" },
    { value: "emergency", label: "Emergency", color: "bg-orange-100 text-orange-700" },
    { value: "personal", label: "Personal", color: "bg-purple-100 text-purple-700" },
    { value: "other", label: "Other", color: "bg-gray-100 text-gray-700" }
  ];

  const statusColors = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    approved: "bg-green-100 text-green-800 border-green-200",
    rejected: "bg-red-100 text-red-800 border-red-200"
  };

  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const submitLeaveRequest = async (e) => {
    e.preventDefault();
    
    if (!formData.fromDate || !formData.toDate || !formData.reason.trim()) {
      toast.error("Please fill all required fields");
      return;
    }

    const fromDate = new Date(formData.fromDate);
    const toDate = new Date(formData.toDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (fromDate < today) {
      toast.error("From date cannot be in the past");
      return;
    }

    if (toDate < fromDate) {
      toast.error("To date must be after from date");
      return;
    }

    const hasOverlap = leaveRequests.some(request => {
      if (request.status === 'rejected') return false;
      const existingFrom = new Date(request.fromDate);
      const existingTo = new Date(request.toDate);
      return (fromDate <= existingTo && toDate >= existingFrom);
    });

    if (hasOverlap) {
      toast.error("Leave request overlaps with existing request");
      return;
    }

    setLoading(true);
    try {
      const result = await requestLeave(formData);
      if (result.success) {
        setFormData({
          fromDate: "",
          toDate: "",
          reason: "",
          type: "vacation"
        });
        setShowForm(false);
      }
    } catch (error) {
      console.error('Error submitting leave request:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelLeaveRequest = async (requestId) => {
    if (!(await confirm({ title: "Withdraw this leave request?", message: "The admin will no longer see it for approval.", confirmLabel: "Withdraw request", tone: "danger" }))) {
      return;
    }
    try {
      await cancelLeaveRequest(requestId);
    } catch (error) {
      console.error('Error cancelling leave request:', error);
    }
  };

  const calculateDays = (fromDate, toDate) => {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const diffTime = Math.abs(to - from);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getTypeColor = (type) => {
    return leaveTypes.find(t => t.value === type)?.color || "bg-gray-100 text-gray-700";
  };

  useEffect(() => {
    if (dToken) {
      getLeaveRequests();
    }
  }, [dToken]);

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Leave Requests</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary-700 text-white px-4 py-2 rounded-lg hover:bg-primary-800 transition-colors"
        >
          <FaPlus />
          Request Leave
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg p-4 border border-gray-100">
          <div className="text-2xl font-bold text-gray-900">{leaveRequests?.length || 0}</div>
          <div className="text-sm text-gray-500">Total Requests</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-100">
          <div className="text-2xl font-bold text-yellow-600">
            {leaveRequests?.filter(r => r.status === 'pending').length || 0}
          </div>
          <div className="text-sm text-gray-500">Pending</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-100">
          <div className="text-2xl font-bold text-green-600">
            {leaveRequests?.filter(r => r.status === 'approved').length || 0}
          </div>
          <div className="text-sm text-gray-500">Approved</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-100">
          <div className="text-2xl font-bold text-red-600">
            {leaveRequests?.filter(r => r.status === 'rejected').length || 0}
          </div>
          <div className="text-sm text-gray-500">Rejected</div>
        </div>
      </div>

      {/* Leave Request Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">New Leave Request</h2>
            <button
              onClick={() => setShowForm(false)}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <FaTimes />
            </button>
          </div>
          
          <form onSubmit={submitLeaveRequest} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">From Date *</label>
                <input
                  type="date"
                  value={formData.fromDate}
                  onChange={(e) => setFormData({...formData, fromDate: e.target.value})}
                  min={getTodayDate()}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">To Date *</label>
                <input
                  type="date"
                  value={formData.toDate}
                  onChange={(e) => setFormData({...formData, toDate: e.target.value})}
                  min={formData.fromDate || getTodayDate()}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Leave Type *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({...formData, type: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none"
                  required
                >
                  {leaveTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Duration</label>
                <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                  {formData.fromDate && formData.toDate ? 
                    `${calculateDays(formData.fromDate, formData.toDate)} day(s)` : 
                    'Select dates'
                  }
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Reason *</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({...formData, reason: e.target.value})}
                placeholder="Please provide reason for leave request..."
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none resize-none"
                rows={3}
                required
              />
            </div>
            
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="bg-primary-700 text-white px-6 py-2 rounded-lg hover:bg-primary-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Leave Requests List */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Your Leave Requests</h2>
        </div>
        
        {!leaveRequests || leaveRequests.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FaCalendarAlt className="text-gray-400 text-xl" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No leave requests found</h3>
            <p className="text-gray-500">Click &quot;Request Leave&quot; to submit your first leave request</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Desktop View */}
            <div className="hidden lg:block">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-4 px-6 font-medium text-gray-700">Dates</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-700">Duration</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-700">Type</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-700">Status</th>
                    <th className="text-left py-4 px-6 font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveRequests.map((request) => (
                    <tr key={request._id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-4 px-6">
                        <div>
                          <p className="font-medium text-gray-900">{formatDate(request.fromDate)}</p>
                          <p className="text-sm text-gray-500">to {formatDate(request.toDate)}</p>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center gap-1 text-gray-600">
                          <FaClock className="text-xs" />
                          {calculateDays(request.fromDate, request.toDate)} days
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${getTypeColor(request.type)}`}>
                          {request.type.charAt(0).toUpperCase() + request.type.slice(1)}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${statusColors[request.status]}`}>
                          {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          {request.status === 'pending' && (
                            <button
                              onClick={() => handleCancelLeaveRequest(request._id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Cancel Request"
                            >
                              <FaTrash className="text-xs" />
                            </button>
                          )}
                          {request.adminResponse && (
                            <button
                              onClick={() => toast.info(`Admin Response: ${request.adminResponse}`)}
                              className="p-2 text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                              title="View Admin Response"
                            >
                              <FaEye className="text-xs" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View */}
            <div className="lg:hidden">
              {leaveRequests.map((request) => (
                <div key={request._id} className="p-4 border-b border-gray-50 last:border-b-0">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-medium text-gray-900">
                        {formatDate(request.fromDate)} - {formatDate(request.toDate)}
                      </p>
                      <p className="text-sm text-gray-500 flex items-center gap-1">
                        <FaClock />
                        {calculateDays(request.fromDate, request.toDate)} days
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusColors[request.status]}`}>
                      {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </span>
                  </div>
                  
                  <div className="mb-3">
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${getTypeColor(request.type)}`}>
                      {request.type.charAt(0).toUpperCase() + request.type.slice(1)}
                    </span>
                  </div>
                  
                  <p className="text-sm text-gray-600 mb-3">{request.reason}</p>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      Submitted: {formatDate(request.submittedAt)}
                    </span>
                    <div className="flex gap-2">
                      {request.status === 'pending' && (
                        <button
                          onClick={() => handleCancelLeaveRequest(request._id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <FaTrash className="text-xs" />
                        </button>
                      )}
                      {request.adminResponse && (
                        <button
                          onClick={() => toast.info(`Admin Response: ${request.adminResponse}`)}
                          className="p-2 text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                        >
                          <FaEye className="text-xs" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DoctorLeaveRequest;