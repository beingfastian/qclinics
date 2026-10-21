import { useContext, useEffect, useState } from "react";
import { DoctorContext } from "../../context/DoctorContext";
import { AppContext } from "../../context/AppContext";
import { toast } from "react-toastify";
import axios from "axios";
import {
  FaEdit,
  FaSave,
  FaTimes,
  FaUser,
  FaGraduationCap,
  FaClock,
  FaDollarSign,
  FaMapMarkerAlt,
  FaToggleOn,
  FaToggleOff,
} from "react-icons/fa";

const DoctorProfile = () => {
  const [isEdit, setIsEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const { dToken, profileData, setProfileData, getProfileData, backendUrl } =
    useContext(DoctorContext);
  const { currency } = useContext(AppContext);

  const updateProfile = async () => {
    setLoading(true);
    try {
      const updateData = {
        address: profileData.address,
        fee: profileData.fee,
        available: profileData.available,
      };

      const { data } = await axios.post(
        backendUrl + "/api/doctor/update-profile",
        updateData,
        { headers: { dToken } }
      );
      if (data.success) {
        toast.success(data.message);
        setIsEdit(false);
        getProfileData();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (dToken) {
      getProfileData();
    }
  }, [dToken]);

  if (!profileData) {
    return (
      <div className="w-full p-4 sm:p-6 max-w-4xl mx-auto">
        <div className="animate-pulse">
          <div className="bg-gray-200 h-64 rounded-2xl mb-6"></div>
          <div className="bg-gray-200 h-8 rounded mb-4"></div>
          <div className="bg-gray-200 h-4 rounded mb-2"></div>
          <div className="bg-gray-200 h-4 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Header Section */}
        <div className="relative bg-primary p-8">
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* Profile Image */}
            <div className="relative">
              <img
                className="w-32 h-32 rounded-2xl object-cover border-4 border-white shadow-lg"
                src={profileData.image}
                alt={profileData.name}
              />
              <div
                className={`absolute -bottom-2 -right-2 w-8 h-8 rounded-full border-4 border-white flex items-center justify-center text-white text-sm font-bold ${
                  profileData.available ? "bg-green-500" : "bg-gray-400"
                }`}
              >
                {profileData.available ? "✓" : "○"}
              </div>
            </div>

            {/* Name, Degree, Speciality */}
            <div className="flex-1 text-center md:text-left">
              <h1 className="text-3xl font-bold text-white mb-2">
                {profileData.name}
              </h1>

              <div className="flex flex-col md:flex-row items-center gap-2 text-white/90 mb-3">
                <div className="flex items-center gap-1">
                  <FaGraduationCap />
                  <span>{profileData.degree}</span>
                </div>
                <span className="hidden md:inline">•</span>
                <span>{profileData.speciality}</span>
              </div>

              <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-white text-sm">
                <FaClock />
                <span>{profileData.experience} experience</span>
              </div>
            </div>

            {/* Edit / Save Buttons */}
            <div className="md:ml-auto">
              {!isEdit ? (
                <button
                  onClick={() => setIsEdit(true)}
                  className="flex items-center gap-2 bg-white text-primary-700 px-4 py-2 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                >
                  <FaEdit />
                  Edit Profile
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={updateProfile}
                    disabled={loading}
                    className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-600 transition-colors disabled:opacity-50"
                  >
                    <FaSave />
                    {loading ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => setIsEdit(false)}
                    className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg font-semibold hover:bg-gray-600 transition-colors"
                  >
                    <FaTimes />
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="p-8 space-y-8">
          {/* About Section */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FaUser className="text-primary-700" />
              About
            </h2>
            <div className="bg-gray-50 rounded-xl p-6">
              <p className="text-gray-700 leading-relaxed">
                {profileData.about}
              </p>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Fee Section */}
            <div className="bg-gray-50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FaDollarSign className="text-green-600" />
                Consultation Fee
              </h3>
              {isEdit ? (
                <input
                  type="number"
                  value={profileData.fee}
                  onChange={(e) =>
                    setProfileData((prev) => ({
                      ...prev,
                      fee: e.target.value,
                    }))
                  }
                  className="w-32 px-3 py-2 border border-gray-300 rounded-md outline-primary-600"
                  min="0"
                />
              ) : (
                <p className="text-gray-700 text-lg font-medium">
                  {currency}
                  {profileData.fee} / session
                </p>
              )}
              {/* Set by the hospital admin; shown so the doctor knows what each visit pays them */}
              <p className="text-sm text-gray-600 mt-3">
                {profileData.hospitalSharePercent > 0 ? (
                  <>
                    Hospital share: {profileData.hospitalSharePercent}% · you receive{" "}
                    {currency}
                    {(Number(profileData.fee) || 0) - Math.round(((Number(profileData.fee) || 0) * profileData.hospitalSharePercent) / 100)} per visit
                  </>
                ) : (
                  "Hospital share: not set by the admin yet"
                )}
              </p>
            </div>

            {/* Availability Section */}
            <div className="bg-gray-50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FaClock className="text-primary-700" />
                Availability Status
              </h3>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3 h-3 rounded-full ${
                      profileData.available ? "bg-green-500" : "bg-gray-400"
                    }`}
                  ></span>
                  <span className="font-medium">
                    {profileData.available
                      ? "Available for appointments"
                      : "Currently unavailable"}
                  </span>
                </div>
                {isEdit && (
                  <button
                    onClick={() =>
                      setProfileData((prev) => ({
                        ...prev,
                        available: !prev.available,
                      }))
                    }
                    className="flex items-center gap-1 text-lg"
                  >
                    {profileData.available ? (
                      <FaToggleOn className="text-green-500" />
                    ) : (
                      <FaToggleOff className="text-gray-400" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Address Section */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FaMapMarkerAlt className="text-red-500" />
              Clinic Address
            </h2>
            <div className="bg-gray-50 rounded-xl p-6 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address Line 1
                </label>
                {isEdit ? (
                  <input
                    type="text"
                    value={profileData.address.line1}
                    onChange={(e) =>
                      setProfileData((prev) => ({
                        ...prev,
                        address: { ...prev.address, line1: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md outline-primary-600"
                  />
                ) : (
                  <p className="text-gray-700">{profileData.address.line1}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address Line 2
                </label>
                {isEdit ? (
                  <input
                    type="text"
                    value={profileData.address.line2}
                    onChange={(e) =>
                      setProfileData((prev) => ({
                        ...prev,
                        address: { ...prev.address, line2: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md outline-primary-600"
                  />
                ) : (
                  <p className="text-gray-700">{profileData.address.line2}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DoctorProfile;
