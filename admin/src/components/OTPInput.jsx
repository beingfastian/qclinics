import { useState, useEffect, useRef } from "react";

const OTPInput = ({ length = 6, onChange, value }) => {
  const [otp, setOtp] = useState(new Array(length).fill(""));
  const inputRefs = useRef([]);

  useEffect(() => {
    if (value && value.length === length) {
      const otpArray = value.split("");
      setOtp(otpArray);
    }
  }, [value, length]);

  const handleChange = (e, index) => {
    const val = e.target.value;
    if (isNaN(val)) return;

    const newOtp = [...otp];
    newOtp[index] = val.substring(val.length - 1);
    setOtp(newOtp);

    // Trigger onChange callback
    if (onChange) {
      onChange(newOtp.join(""));
    }

    // Move to next input if current field is filled
    if (val && index < length - 1 && inputRefs.current[index + 1]) {
  inputRefs.current[index + 1].focus();
}
  };

  const handleKeyDown = (e, index) => {
    // Move to previous input on backspace if current input is empty
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").slice(0, length);
    if (/^\d+$/.test(pastedData)) {
      const newOtp = pastedData.split("");
      setOtp(newOtp);
      if (onChange) {
        onChange(pastedData);
      }
      
      // Focus the last input or the next empty input
      const lastIndex = Math.min(length - 1, pastedData.length - 1);
      inputRefs.current[lastIndex].focus();
    }
  };

  return (
    <div className="flex justify-center space-x-3">
      {otp.map((digit, index) => (
        <input
          key={index}
          type="text"
          ref={(el) => (inputRefs.current[index] = el)}
          value={digit}
          onChange={(e) => handleChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={handlePaste}
          className="w-12 h-12 text-center text-xl font-semibold border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-600 focus:border-primary-600 transition"
          maxLength={1}
        />
      ))}
    </div>
  );
};

export default OTPInput;