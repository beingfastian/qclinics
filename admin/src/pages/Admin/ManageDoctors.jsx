import React, { useContext, useEffect, useState } from "react";
import { useDialog } from "../../components/ui/Dialog";
import Avatar from "../../components/ui/Avatar";
import ShareField from "../../components/ShareField";
import { AdminContext } from "../../context/AdminContext.jsx";
import { FaEdit, FaTrash, FaPlus, FaSearch, FaToggleOn, FaToggleOff } from "react-icons/fa";
import { toast } from "react-toastify";
import axios from "axios";

const ManageDoctors = () => {
  const { confirm } = useDialog();
  const { doctors, aToken, getAllDoctors, changeAvailability, backendUrl } = useContext(AdminContext);
  const [filteredDoctors, setFilteredDoctors] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSpeciality, setFilterSpeciality] = useState("all");
  const [filterAvailability, setFilterAvailability] = useState("all");
  const [editingDoctor, setEditingDoctor] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const specialities = [
    "General physician", "Gynecologist", "Dermatologist",
    "Pediatricians", "Neurologist", "Gastroenterologist"
  ];

  useEffect(() => {
    if (aToken) {
      getAllDoctors();
    }
  }, [aToken]);

  useEffect(() => {
    filterDoctors();
  }, [doctors, searchTerm, filterSpeciality, filterAvailability]);

  const filterDoctors = () => {
    let filtered = doctors;

    if (searchTerm) {
      filtered = filtered.filter(doctor => 
        doctor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doctor.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doctor.speciality.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (filterSpeciality !== "all") {
      filtered = filtered.filter(doctor => doctor.speciality === filterSpeciality);
    }

    if (filterAvailability !== "all") {
      const isAvailable = filterAvailability === "available";
      filtered = filtered.filter(doctor => doctor.available === isAvailable);
    }

    setFilteredDoctors(filtered);
  };

  const handleEditDoctor = (doctor) => {
    setEditingDoctor({
      ...doctor,
      address1: doctor.address?.line1 || "",
      address2: doctor.address?.line2 || "",
      hospitalSharePercent: doctor.hospitalSharePercent ?? 0
    });
    setShowEditModal(true);
  };

  const updateDoctor = async () => {
    if (!editingDoctor) return;
    
    setLoading(true);
    try {
      const updateData = {
        name: editingDoctor.name,
        email: editingDoctor.email,
        experience: editingDoctor.experience,
        fee: editingDoctor.fee,
        about: editingDoctor.about,
        speciality: editingDoctor.speciality,
        degree: editingDoctor.degree,
        address: {
          line1: editingDoctor.address1,
          line2: editingDoctor.address2
        },
        available: editingDoctor.available,
        hospitalSharePercent: editingDoctor.hospitalSharePercent
      };

      const { data } = await axios.put(
        `${backendUrl}/api/admin/update-doctor/${editingDoctor._id}`,
        updateData,
        { headers: { aToken } }
      );

      if (data.success) {
        toast.success("Doctor updated successfully");
        setShowEditModal(false);
        setEditingDoctor(null);
        getAllDoctors();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to update doctor");
    } finally {
      setLoading(false);
    }
  };

  const deleteDoctor = async (doctorId, doctorName) => {
    if (await confirm({
      title: `Delete Dr. ${doctorName}?`,
      message: "Their profile and login are removed permanently. Doctors with upcoming appointments or patients in today's queue can't be deleted.",
      confirmLabel: "Delete doctor",
      tone: "danger",
    })) {
      try {
        const { data } = await axios.delete(
          `${backendUrl}/api/admin/delete-doctor/${doctorId}`,
          { headers: { aToken } }
        );

        if (data.success) {
          toast.success("Doctor deleted successfully");
          getAllDoctors();
        } else {
          toast.error(data.message);
        }
      } catch (error) {
        console.error(error);
        toast.error("Failed to delete doctor");
      }
    }
  };

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Manage Doctors</h1>
            <p className="text-gray-600 mt-1">View, edit, and manage all doctors in the system</p>
          </div>
          <button 
            onClick={() => window.location.href = '/add-doctor'}
            className="flex items-center gap-2 bg-primary-700 text-white px-4 py-2 rounded-lg hover:bg-primary-800 transition-colors"
          >
            <FaPlus /> Add New Doctor
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg border border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search doctors..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
              />
            </div>
            <select
              value={filterSpeciality}
              onChange={(e) => setFilterSpeciality(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
            >
              <option value="all">All Specialities</option>
              {specialities.map(spec => (
                <option key={spec} value={spec}>{spec}</option>
              ))}
            </select>
            <select
              value={filterAvailability}
              onChange={(e) => setFilterAvailability(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
            >
              <option value="all">All Status</option>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <div className="text-sm text-gray-600 flex items-center justify-end">
              Total: {filteredDoctors.length} doctors
            </div>
          </div>
        </div>
      </div>

      {/* Doctors Table */}
      <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {/* Desktop View */}
          <div className="hidden lg:block">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                <tr>
                  <th className="text-left py-4 px-6 font-medium text-gray-700">Doctor</th>
                  <th className="text-left py-4 px-6 font-medium text-gray-700">Speciality</th>
                  <th className="text-left py-4 px-6 font-medium text-gray-700">Experience</th>
                  <th className="text-left py-4 px-6 font-medium text-gray-700">Fee</th>
                  <th className="text-left py-4 px-6 font-medium text-gray-700">Hospital share</th>
                  <th className="text-left py-4 px-6 font-medium text-gray-700">Status</th>
                  <th className="text-left py-4 px-6 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDoctors.map((doctor) => (
                  <tr key={doctor._id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <Avatar src={doctor.image} name={doctor.name} className="w-12 h-12" textClass="text-base" />
                        <div>
                          <p className="font-medium text-gray-900">{doctor.name}</p>
                          <p className="text-sm text-gray-500">{doctor.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-gray-700">{doctor.speciality}</td>
                    <td className="py-4 px-6 text-gray-700">{doctor.experience}</td>
                    <td className="py-4 px-6 text-gray-700">Rs. {doctor.fee}</td>
                    <td className="py-4 px-6 text-gray-700">
                      {doctor.hospitalSharePercent ? `${doctor.hospitalSharePercent}%` : <span className="text-amber-700">Not set</span>}
                    </td>
                    <td className="py-4 px-6">
                      <button
                        onClick={() => changeAvailability(doctor._id)}
                        className="flex items-center gap-2"
                      >
                        {doctor.available ? (
                          <FaToggleOn className="text-green-500 text-xl" />
                        ) : (
                          <FaToggleOff className="text-gray-400 text-xl" />
                        )}
                        <span className={`text-sm ${doctor.available ? 'text-green-600' : 'text-gray-500'}`}>
                          {doctor.available ? 'Available' : 'Unavailable'}
                        </span>
                      </button>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEditDoctor(doctor)}
                          className="p-2 text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                          title="Edit Doctor"
                        >
                          <FaEdit />
                        </button>
                        <button
                          onClick={() => deleteDoctor(doctor._id, doctor.name)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete Doctor"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile View */}
          <div className="lg:hidden">
            {filteredDoctors.map((doctor) => (
              <div key={doctor._id} className="p-4 border-b border-gray-50 last:border-b-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Avatar src={doctor.image} name={doctor.name} className="w-12 h-12" textClass="text-base" />
                    <div>
                      <p className="font-medium text-gray-900">{doctor.name}</p>
                      <p className="text-sm text-gray-500">{doctor.speciality}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => changeAvailability(doctor._id)}
                    className="flex items-center gap-1"
                  >
                    {doctor.available ? (
                      <FaToggleOn className="text-green-500" />
                    ) : (
                      <FaToggleOff className="text-gray-400" />
                    )}
                  </button>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                  <div>
                    <p className="text-gray-500">Experience</p>
                    <p className="font-medium">{doctor.experience}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Fee</p>
                    <p className="font-medium">Rs. {doctor.fee}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Hospital share</p>
                    <p className="font-medium">{doctor.hospitalSharePercent ? `${doctor.hospitalSharePercent}%` : "Not set"}</p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${doctor.available ? 'text-green-600' : 'text-gray-500'}`}>
                    {doctor.available ? 'Available' : 'Unavailable'}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditDoctor(doctor)}
                      className="p-2 text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <FaEdit />
                    </button>
                    <button
                      onClick={() => deleteDoctor(doctor._id, doctor.name)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <FaTrash />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredDoctors.length === 0 && (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FaSearch className="text-gray-400 text-xl" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No doctors found</h3>
              <p className="text-gray-500">
                {searchTerm || filterSpeciality !== "all" || filterAvailability !== "all"
                  ? "Try adjusting your search or filter criteria"
                  : "No doctors have been added yet"
                }
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && editingDoctor && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Edit Doctor</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={editingDoctor.name}
                  onChange={(e) => setEditingDoctor({...editingDoctor, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editingDoctor.email}
                  onChange={(e) => setEditingDoctor({...editingDoctor, email: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Speciality</label>
                <select
                  value={editingDoctor.speciality}
                  onChange={(e) => setEditingDoctor({...editingDoctor, speciality: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                >
                  {specialities.map(spec => (
                    <option key={spec} value={spec}>{spec}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Experience</label>
                <select
                  value={editingDoctor.experience}
                  onChange={(e) => setEditingDoctor({...editingDoctor, experience: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                >
                  {[...Array(15)].map((_, i) => (
                    <option key={i + 1} value={`${i + 1} Year${i > 0 ? 's' : ''}`}>
                      {i + 1} Year{i > 0 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fee (Rs.)</label>
                <input
                  type="number"
                  value={editingDoctor.fee}
                  onChange={(e) => setEditingDoctor({...editingDoctor, fee: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                />
              </div>
              <div>
                <ShareField
                  id="edit-share"
                  value={String(editingDoctor.hospitalSharePercent ?? "")}
                  onChange={(value) => setEditingDoctor({ ...editingDoctor, hospitalSharePercent: value })}
                  fee={editingDoctor.fee}
                  inputClassName="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">A new share applies to visits completed from now on. Past visits keep the share they had.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Education</label>
                <input
                  type="text"
                  value={editingDoctor.degree}
                  onChange={(e) => setEditingDoctor({...editingDoctor, degree: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">About</label>
                <textarea
                  value={editingDoctor.about}
                  onChange={(e) => setEditingDoctor({...editingDoctor, about: e.target.value})}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 outline-none resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingDoctor(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={updateDoctor}
                disabled={loading}
                className="px-4 py-2 bg-primary-700 text-white rounded-lg hover:bg-primary-800 transition-colors disabled:opacity-50"
              >
                {loading ? "Updating..." : "Update Doctor"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageDoctors;