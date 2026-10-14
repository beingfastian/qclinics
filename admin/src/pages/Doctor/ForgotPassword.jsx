import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import axios from "axios";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!email) {
      toast.error("Please enter your email");
      return;
    }
    
    setLoading(true);
    
    try {
      const { data } = await axios.post(
        `${backendUrl}/api/auth/forgot-password`,
        { email }
      );
      
      if (data.success) {
        toast.success(data.message);
        // Redirect to OTP verification page
        window.location.href = `/verify-otp?email=${encodeURIComponent(email)}`;
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-primary p-6 text-center">
          <div className="h-16 w-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
  <svg className="h-8 w-8 text-primary-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
</div>
          <h2 className="text-2xl font-bold text-white">Forgot Password</h2>
          <p className="text-primary-100 mt-2">Doctors: enter your email to get a reset code</p>
          <p className="text-primary-100 mt-1 text-sm">Reception and lab staff: ask the hospital admin to reset your password.</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-medium mb-2" htmlFor="email">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-primary-600 transition"
              placeholder="doctor@example.com"
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary-800 transition-colors flex items-center justify-center disabled:opacity-70"
          >
            {loading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Sending OTP...
              </>
            ) : (
              "Send OTP"
            )}
          </button>
          
          <div className="mt-6 text-center">
            <p className="text-gray-600">
              Remember your password?{" "}
              <Link to="/login" className="text-primary-700 hover:text-primary-900 font-medium">
                Login
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ForgotPassword;