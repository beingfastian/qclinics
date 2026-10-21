import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import axios from "axios";
import BrandLogo from "../../components/ui/BrandLogo";
import OTPInput from "../../components/OTPInput";

const VerifyOTP = () => {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") || "";
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  // A new OTP can be asked for after a minute (the server allows one a minute, 5 an hour)
  const RESEND_AFTER = 60;
  const [timeLeft, setTimeLeft] = useState(RESEND_AFTER);
  const [canResend, setCanResend] = useState(false);
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  useEffect(() => {
    if (!email) navigate("/forgot-password", { replace: true });
  }, [email, navigate]);

  // Timer countdown
  useEffect(() => {
    if (timeLeft <= 0) {
      setCanResend(true);
      return;
    }

    const timerId = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timerId);
  }, [timeLeft]);

  const handleResendOTP = async () => {
    try {
      const { data } = await axios.post(
        `${backendUrl}/api/auth/forgot-password`,
        { email }
      );
      
      if (data.success) {
        toast.success(data.message);
        setTimeLeft(RESEND_AFTER);
        setCanResend(false);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to resend OTP");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (otp.length !== 6) {
      toast.error("Please enter a valid 6-digit OTP");
      return;
    }
    
    setLoading(true);
    
    try {
      const { data } = await axios.post(
        `${backendUrl}/api/auth/verify-otp`,
        { email, otp }
      );
      
      if (data.success) {
        toast.success(data.message);
        // The reset token proves the OTP was verified; it expires in 10 minutes
        sessionStorage.setItem("resetToken", data.resetToken);
        navigate("/reset-password");
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  // Format time as MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-primary p-6 text-center">
          <div className="mx-auto mb-3 inline-block rounded-xl bg-white px-4 py-2"><BrandLogo size="sm" /></div>
          <h2 className="text-2xl font-bold text-white">Verify OTP</h2>
          <p className="text-primary-100 mt-2">Enter the 6-digit code sent to {email || "your email"}. It works for 10 minutes.</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-medium mb-2">
              One-Time Password
            </label>
            <OTPInput value={otp} onChange={setOtp} length={6} />
          </div>
          
          <div className="mb-6 text-center">
            {!canResend ? (
              <p className="text-gray-600">
                Resend OTP in <span className="font-medium text-primary-700">{formatTime(timeLeft)}</span>
              </p>
            ) : (
              <button
                type="button"
                onClick={handleResendOTP}
                className="text-primary-700 hover:text-primary-900 font-medium"
              >
                Resend OTP
              </button>
            )}
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
                Verifying...
              </>
            ) : (
              "Verify OTP"
            )}
          </button>
          
          <div className="mt-6 text-center">
            <p className="text-gray-600">
              <Link to="/forgot-password" className="text-primary-700 hover:text-primary-900 font-medium">
                Back to Forgot Password
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VerifyOTP;