import { useContext, useState } from "react";
import { useDialog } from "../../components/ui/Dialog";
import LanguageSelect from "../../components/LanguageSelect";
import { AdminContext } from "../../context/AdminContext.jsx";
import { toast } from "react-toastify";
import axios from "axios";
import { FaWhatsapp, FaUser, FaIdCard, FaPhone, FaCalendarAlt, FaMapMarkerAlt, FaEnvelope } from "react-icons/fa";

const AddPatient = () => {
  const { confirm } = useDialog();
  const [patientImage, setPatientImage] = useState(false);
  const [name, setName] = useState("");
  const [cnic, setCnic] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("Male");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [language, setLanguage] = useState("ur");
  const { backendUrl, aToken } = useContext(AdminContext);
  const [loading, setLoading] = useState(false);

  const validateCNIC = (cnicValue) => {
    const cleanCNIC = cnicValue.replace(/[-\s]/g, '');
    if (!/^\d{13}$/.test(cleanCNIC)) {
      return false;
    }
    return true;
  };

  const handleCnicChange = (e) => {
    const value = e.target.value;
    const cleanValue = value.replace(/\D/g, '').slice(0, 13);
    setCnic(cleanValue);
  };

  const onSubmitHandler = async (e) => {
    e.preventDefault();
    try {
      if (!patientImage) {
        return toast.error("Patient image not selected");
      }
      
      if (!name || !cnic || !phone || !dob || !address1) {
        return toast.error("Please fill all required fields");
      }

      if (!validateCNIC(cnic)) {
        return toast.error("CNIC must be exactly 13 digits without dashes");
      }

      if (whatsappEnabled && !whatsappNumber) {
        return toast.error("Please enter WhatsApp number when WhatsApp is enabled");
      }

      setLoading(true);
      const formData = new FormData();
      formData.append("image", patientImage);
      formData.append("name", name);
      formData.append("cnic", cnic);
      formData.append("phone", phone);
      formData.append("email", email.trim());
      formData.append("dob", dob);
      formData.append("gender", gender);
      formData.append("address", JSON.stringify({ line1: address1, line2: address2 }));
      formData.append("whatsappEnabled", whatsappEnabled);
      formData.append("whatsappNumber", whatsappNumber);
      formData.append("language", language);

      const { data } = await axios.post(
        backendUrl + "/api/admin/add-patient",
        formData,
        { headers: { aToken } }
      );
      
      if (data.success) {
        toast.success(data.message);
        // Reset form
        setName(""); setCnic(""); setPhone(""); setEmail(""); setDob(""); setGender("Male");
        setAddress1(""); setAddress2(""); setWhatsappEnabled(false); setWhatsappNumber(""); setLanguage("ur");
        setPatientImage(false);
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

  return (
    <div className="w-full p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Add New Patient</h1>
        <p className="text-gray-600">Register a new patient with complete information</p>
      </div>

      <form onSubmit={onSubmitHandler}>
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          
          {/* Image Upload Section */}
          <div className="p-6 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-6">
              <label htmlFor="patientImage" className="cursor-pointer">
                <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-300 hover:border-primary-600 bg-white flex items-center justify-center overflow-hidden transition-all">
                  {patientImage ? (
                    <img
                      src={URL.createObjectURL(patientImage)}
                      alt="Patient"
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
                onChange={(e) => setPatientImage(e.target.files[0])}
                type="file"
                id="patientImage"
                className="hidden"
                accept="image/*"
              />
              <div>
                <h3 className="font-semibold text-gray-900">Patient Profile Picture</h3>
                <p className="text-sm text-gray-600 mt-1">Upload a clear photo of the patient (JPG, PNG)</p>
                <p className="text-sm text-gray-500 mt-1">Recommended: 400x400px, max 5MB</p>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Personal Information */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
                  <FaUser className="text-primary-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Personal Information</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Patient Name *</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter patient's full name"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">CNIC (13 digits) *</label>
                    <div className="relative">
                      <FaIdCard className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={cnic}
                        onChange={handleCnicChange}
                        placeholder="1234567890123"
                        maxLength="13"
                        className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                        required
                      />
                    </div>
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-500">Enter 13 digits without dashes ({cnic.length}/13)</p>
                      {cnic.length > 0 && cnic.length !== 13 && (
                        <p className="text-xs text-red-500">CNIC must be exactly 13 digits</p>
                      )}
                      {cnic.length === 13 && validateCNIC(cnic) && (
                        <p className="text-xs text-green-500">✓ Valid CNIC format</p>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number *</label>
                    <div className="relative">
                      <FaPhone className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="03001234567"
                        className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email (optional)</label>
                    <div className="relative">
                      <FaEnvelope className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="patient@example.com"
                        className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Date of Birth *</label>
                    <div className="relative">
                      <FaCalendarAlt className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input
                        type="date"
                        value={dob}
                        onChange={(e) => setDob(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Gender</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-transparent outline-none transition-all"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Address & Contact */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
                  <FaMapMarkerAlt className="text-green-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Address & Contact</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Address Line 1 *</label>
                    <input
                      type="text"
                      value={address1}
                      onChange={(e) => setAddress1(e.target.value)}
                      placeholder="Street address, house number"
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

                  {/* WhatsApp Settings */}
                  <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <FaWhatsapp className="text-green-500 text-xl" />
                        <div>
                          <p className="font-medium text-gray-700">WhatsApp Notifications</p>
                          <p className="text-sm text-gray-500">Only turn on if the patient agreed to receive confirmations and reminders on WhatsApp</p>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
                        <input
                          type="tel"
                          value={whatsappNumber}
                          onChange={(e) => setWhatsappNumber(e.target.value)}
                          placeholder="+923001234567"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">Include country code (+92 for Pakistan)</p>
                        <div className="mt-3">
                          <LanguageSelect value={language} onChange={setLanguage} />
                        </div>
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
                className="bg-primary-700 text-white px-8 py-3 rounded-lg font-semibold hover:bg-primary-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Adding Patient...
                  </>
                ) : (
                  "Add Patient"
                )}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await confirm({ title: "Clear the form?", message: "Everything you typed on this page will be removed.", confirmLabel: "Clear form", tone: "danger" })) {
                    setName(""); setCnic(""); setPhone(""); setEmail(""); setDob(""); setGender("Male");
                    setAddress1(""); setAddress2(""); setWhatsappEnabled(false); setWhatsappNumber(""); setLanguage("ur");
                    setPatientImage(false);
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

export default AddPatient;