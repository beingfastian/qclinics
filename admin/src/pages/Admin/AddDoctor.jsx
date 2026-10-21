import { useContext, useState } from "react";
import { useDialog } from "../../components/ui/Dialog";
import ShareField, { isValidPercent } from "../../components/ShareField";
import { AdminContext } from "../../context/AdminContext.jsx";
import { toast } from "react-toastify";
import axios from "axios";
import { FaEye, FaEyeSlash, FaWhatsapp, FaUser, FaGraduationCap, FaClock } from "react-icons/fa";

const AddDoctor = () => {
  const { confirm } = useDialog();
  const [docImage, setDocImg] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [experience, setExperience] = useState("1 Year");
  const [fee, setFee] = useState("");
  const [sharePercent, setSharePercent] = useState("");
  const [about, setAbout] = useState("");
  const [speciality, setSpeciality] = useState("General physician");
  const [degree, setDegree] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [sittingDays, setSittingDays] = useState([]);
  const [holidays, setHolidays] = useState("");
  const { backendUrl, aToken } = useContext(AdminContext);
  const [loading, setLoading] = useState(false);

  const daysOfWeek = [
    { value: "monday", label: "Monday" },
    { value: "tuesday", label: "Tuesday" },
    { value: "wednesday", label: "Wednesday" },
    { value: "thursday", label: "Thursday" },
    { value: "friday", label: "Friday" },
    { value: "saturday", label: "Saturday" },
    { value: "sunday", label: "Sunday" }
  ];

  const handleDayChange = (day) => {
    setSittingDays(prev => {
      if (prev.includes(day)) {
        return prev.filter(d => d !== day);
      } else {
        return [...prev, day];
      }
    });
  };

  const selectWeekdays = () => {
    setSittingDays(["monday", "tuesday", "wednesday", "thursday", "friday"]);
  };

  const selectAllDays = () => {
    setSittingDays(daysOfWeek.map(day => day.value));
  };

  const clearAllDays = () => {
    setSittingDays([]);
  };

  const validateTimings = () => {
    const start = new Date(`2000-01-01T${startTime}:00`);
    const end = new Date(`2000-01-01T${endTime}:00`);
    
    if (start >= end) {
      toast.error("End time must be after start time");
      return false;
    }
    
    const diffMs = end - start;
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 1) {
      toast.error("Working hours should be at least 1 hour");
      return false;
    }
    
    return true;
  };

  const validateWhatsAppNumber = (number) => {
    const cleanNumber = number.replace(/[\s\-()]/g, '');
    const pakistaniNumberRegex = /^(\+92|92|0)?3[0-9]{9}$/;
    return pakistaniNumberRegex.test(cleanNumber);
  };

  const onSubmitHandler = async (e) => {
    e.preventDefault();
    try {
      if (!docImage) {
        return toast.error("Doctor image not selected");
      }

      if (!name || !email || !password || !fee || !degree || !address1) {
        return toast.error("Please fill all required fields");
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return toast.error("Please enter a valid email address");
      }

      if (password.length < 6) {
        return toast.error("Password must be at least 6 characters long");
      }

      if (isNaN(fee) || parseFloat(fee) <= 0) {
        return toast.error("Please enter a valid fee amount");
      }
      if (sharePercent === "" || !isValidPercent(sharePercent)) {
        return toast.error("Please enter the hospital's share (0 to 100%)");
      }

      if (!validateTimings()) {
        return;
      }

      if (sittingDays.length === 0) {
        return toast.error("Please select at least one sitting day");
      }

      if (whatsappEnabled) {
        if (!whatsappNumber) {
          return toast.error("Please enter WhatsApp number when WhatsApp is enabled");
        }
        if (!validateWhatsAppNumber(whatsappNumber)) {
          return toast.error("Please enter a valid Pakistani WhatsApp number (e.g., +923001234567)");
        }
      }

      setLoading(true);
      const formData = new FormData();
      formData.append("image", docImage);
      formData.append("name", name);
      formData.append("email", email);
      formData.append("password", password);
      formData.append("experience", experience);
      formData.append("fee", Number(fee));
      formData.append("hospitalSharePercent", sharePercent);
      formData.append("about", about);
      formData.append("speciality", speciality);
      formData.append("degree", degree);
      formData.append("address", JSON.stringify({ line1: address1, line2: address2 }));
      formData.append("whatsappEnabled", whatsappEnabled);
      formData.append("whatsappNumber", whatsappNumber);
      formData.append("timings", JSON.stringify({ start: startTime, end: endTime }));
      formData.append("sittingDays", JSON.stringify(sittingDays));
      formData.append("holidays", holidays);

      const { data } = await axios.post(
        backendUrl + "/api/admin/add-doctor",
        formData,
        { headers: { aToken } }
      );
      
      if (data.success) {
        toast.success(data.message);
        // Reset form
        setName(""); setEmail(""); setAbout(""); setPassword(""); setAddress1(""); setAddress2("");
        setDegree(""); setFee(""); setSharePercent(""); setDocImg(false); setWhatsappEnabled(false); setWhatsappNumber("");
        setStartTime("09:00"); setEndTime("17:00"); setSittingDays([]); setHolidays(""); setShowPassword(false);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Failed to add doctor");
    } finally {
      setLoading(false);
    }
  };

  const getWorkingHoursDuration = () => {
    if (!startTime || !endTime) return "";
    const start = new Date(`2000-01-01T${startTime}:00`);
    const end = new Date(`2000-01-01T${endTime}:00`);
    const diffMs = end - start;
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours > 0 ? `${diffHours} hour(s)` : "Invalid";
  };

  return (
    <div className="w-full p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Add New Doctor</h1>
        <p className="text-gray-600">Create a new doctor profile with complete information</p>
      </div>

      <form onSubmit={onSubmitHandler}>
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          
          {/* Image Upload Section */}
          <div className="p-6 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-6">
              <label htmlFor="docImage" className="cursor-pointer">
                <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-300 hover:border-primary-600 bg-white flex items-center justify-center overflow-hidden transition-all">
                  {docImage ? (
                    <img
                      src={URL.createObjectURL(docImage)}
                      alt="Doctor"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <FaUser className="mx-auto text-gray-400 text-2xl mb-1" />
                      <span className="text-xs text-gray-500">Upload Photo</span>
                    </div>
                  )}
                </div>
              </label>
              <input
                onChange={(e) => setDocImg(e.target.files[0])}
                type="file"
                id="docImage"
                className="hidden"
                accept="image/*"
              />
              <div>
                <h3 className="font-semibold text-gray-900">Doctor Profile Picture</h3>
                <p className="text-sm text-gray-600 mt-1">Upload a professional photo (JPG, PNG)</p>
                <p className="text-sm text-gray-500 mt-1">Recommended: 400x400px, max 5MB</p>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Personal Information */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
                  <FaUser className="text-primary-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Personal Information</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter doctor's full name"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email Address *</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="doctor@example.com"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Password *</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Secure password (min 6 chars)"
                        className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? <FaEyeSlash /> : <FaEye />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Address Line 1 *</label>
                    <input
                      type="text"
                      value={address1}
                      onChange={(e) => setAddress1(e.target.value)}
                      placeholder="Street address, building name"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Address Line 2</label>
                    <input
                      type="text"
                      value={address2}
                      onChange={(e) => setAddress2(e.target.value)}
                      placeholder="Area, city, postal code"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Professional Information */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
                  <FaGraduationCap className="text-green-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Professional Details</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Speciality *</label>
                    <select
                      value={speciality}
                      onChange={(e) => setSpeciality(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                    >
                      <option value="General physician">General physician</option>
                      <option value="Gynecologist">Gynecologist</option>
                      <option value="Dermatologist">Dermatologist</option>
                      <option value="Pediatricians">Pediatricians</option>
                      <option value="Neurologist">Neurologist</option>
                      <option value="Gastroenterologist">Gastroenterologist</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Experience *</label>
                    <select
                      value={experience}
                      onChange={(e) => setExperience(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                    >
                      {[...Array(15)].map((_, i) => (
                        <option key={i + 1} value={`${i + 1} Year${i > 0 ? 's' : ''}`}>
                          {i + 1} Year{i > 0 ? 's' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Education *</label>
                    <input
                      type="text"
                      value={degree}
                      onChange={(e) => setDegree(e.target.value)}
                      placeholder="e.g., MBBS, MD, FCPS"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Consultation Fee (Rs.) *</label>
                    <input
                      type="number"
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      placeholder="Fee in Pakistani Rupees"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                      min="0"
                      step="50"
                      required
                    />
                  </div>

                  <ShareField value={sharePercent} onChange={setSharePercent} fee={fee} required inputClassName="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all" />

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">About Doctor *</label>
                    <textarea
                      value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      placeholder="Brief description of expertise and experience..."
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all resize-none"
                      rows={4}
                      maxLength={500}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">{about.length}/500 characters</p>
                  </div>
                </div>
              </div>

              {/* Schedule & Contact */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
                  <FaClock className="text-primary-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Schedule & Contact</h3>
                </div>
                
                <div className="space-y-4">
                  {/* Working Hours */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Working Hours *</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <input
                          type="time"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-md focus:ring-2 focus:ring-primary-600 outline-none"
                          required
                        />
                        <label className="text-xs text-gray-500">Start</label>
                      </div>
                      <div>
                        <input
                          type="time"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-md focus:ring-2 focus:ring-primary-600 outline-none"
                          required
                        />
                        <label className="text-xs text-gray-500">End</label>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Duration: {getWorkingHoursDuration()}</p>
                  </div>

                  {/* Sitting Days */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Working Days *</label>
                    <div className="flex gap-2 mb-2">
                      <button type="button" onClick={selectWeekdays} className="text-xs bg-primary-100 text-primary-800 px-2 py-1 rounded">
                        Weekdays
                      </button>
                      <button type="button" onClick={selectAllDays} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                        All Days
                      </button>
                      <button type="button" onClick={clearAllDays} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                        Clear
                      </button>
                    </div>
                    <div className="space-y-2">
                      {daysOfWeek.map((day) => (
                        <label key={day.value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                          <input
                            type="checkbox"
                            checked={sittingDays.includes(day.value)}
                            onChange={() => handleDayChange(day.value)}
                            className="rounded text-primary-700 focus:ring-primary-600"
                          />
                          <span className="text-sm">{day.label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Selected: {sittingDays.length} days</p>
                  </div>

                  {/* Holiday Info */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Holiday Information</label>
                    <textarea
                      value={holidays}
                      onChange={(e) => setHolidays(e.target.value)}
                      placeholder="Annual leave, Eid holidays, etc."
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all resize-none"
                      rows={2}
                    />
                  </div>

                  {/* WhatsApp Settings */}
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <FaWhatsapp className="text-green-500" />
                        <div>
                          <p className="font-medium text-gray-700 text-sm">WhatsApp Notifications</p>
                          <p className="text-xs text-gray-500">Only turn on if the doctor agreed to receive appointment messages on WhatsApp</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={whatsappEnabled}
                          onChange={(e) => setWhatsappEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                      </label>
                    </div>
                    
                    {whatsappEnabled && (
                      <div>
                        <input
                          type="tel"
                          value={whatsappNumber}
                          onChange={(e) => setWhatsappNumber(e.target.value)}
                          placeholder="+923001234567"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">Include country code (+92 for Pakistan)</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="p-6 bg-gray-50 border-t border-gray-100">
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className="bg-primary-700 text-white px-8 py-3 rounded-lg font-semibold hover:bg-primary-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Adding Doctor..." : "Add Doctor"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await confirm({ title: "Clear the form?", message: "Everything you typed on this page will be removed.", confirmLabel: "Clear form", tone: "danger" })) {
                    // Reset form logic here
                    setName(""); setEmail(""); setPassword(""); setFee(""); setSharePercent(""); setAbout(""); setDegree("");
                    setAddress1(""); setAddress2(""); setWhatsappEnabled(false); setWhatsappNumber("");
                    setStartTime("09:00"); setEndTime("17:00"); setSittingDays([]); setHolidays("");
                    setDocImg(false); setShowPassword(false);
                  }
                }}
                className="bg-gray-500 text-white px-8 py-3 rounded-lg font-semibold hover:bg-gray-600 transition-colors"
              >
                Reset Form
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default AddDoctor;