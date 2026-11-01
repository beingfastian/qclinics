import { useContext, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { FaEye, FaEyeSlash, FaListOl, FaFileMedical, FaChartBar } from "react-icons/fa";
import BrandLogo from "../components/ui/BrandLogo";
import { HOSPITAL_LOGO, HOSPITAL_NAME, PRODUCT_TAGLINE } from "../config";
import { AdminContext } from "../context/AdminContext";
import { DoctorContext } from "../context/DoctorContext";
import { LabContext } from "../context/LabContext";
import { PharmacyContext } from "../context/PharmacyContext";
import { Button, Field, Input } from "../components/ui";

// One sign-in for admin, doctors and lab staff: the server recognises the email
// and says which role it is, and the matching dashboard opens.

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const { setAToken, backendUrl } = useContext(AdminContext);
  const { setDToken } = useContext(DoctorContext);
  const { setLToken } = useContext(LabContext);
  const { setPToken } = useContext(PharmacyContext);
  const navigate = useNavigate();

  const onSubmitHandler = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.post(backendUrl + "/api/auth/login", { email: email.trim(), password });
      if (!data.success) {
        setError(data.message);
        return;
      }
      // One role at a time: drop any older session first
      ["aToken", "dToken", "lToken", "pToken"].forEach((key) => localStorage.removeItem(key));
      // Reception uses the admin app (same token header) without the owner's pages
      if (data.role === "admin" || data.role === "reception") {
        localStorage.setItem("aToken", data.token);
        setAToken(data.token);
        navigate("/");
      } else if (data.role === "doctor") {
        localStorage.setItem("dToken", data.token);
        navigate("/doctor");
        setDToken(data.token);
      } else if (data.role === "lab") {
        localStorage.setItem("lToken", data.token);
        navigate("/lab");
        setLToken(data.token);
      } else if (data.role === "pharmacy") {
        localStorage.setItem("pToken", data.token);
        navigate("/pharmacy");
        setPToken(data.token);
      } else {
        setError("This account can't sign in here.");
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Couldn't reach the server. Check the internet connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-2">
      {/* Brand panel (large screens) */}
      <aside className="hidden lg:flex flex-col justify-between bg-primary-900 p-12 text-white">
        <div>
          <div className="inline-block rounded-xl bg-white px-5 py-3">
            <BrandLogo size="lg" tagline />
          </div>
          {HOSPITAL_LOGO ? (
            <div className="mt-6 flex w-fit items-center gap-3 rounded-xl bg-white p-3 pr-5">
              <img src={HOSPITAL_LOGO} alt="" className="h-16 w-16 object-contain" />
              <p className="text-base font-semibold text-slate-900">{HOSPITAL_NAME}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-primary-100">{HOSPITAL_NAME}</p>
          )}
        </div>
        <div>
          <p className="font-display text-4xl font-semibold leading-tight">{PRODUCT_TAGLINE}</p>
          <ul className="mt-8 space-y-4 text-primary-50">
            <li className="flex items-center gap-3">
              <FaListOl aria-hidden="true" className="text-primary-300" /> Live queue for reception and doctors
            </li>
            <li className="flex items-center gap-3">
              <FaFileMedical aria-hidden="true" className="text-primary-300" /> Lab requests and reports in one place
            </li>
            <li className="flex items-center gap-3">
              <FaChartBar aria-hidden="true" className="text-primary-300" /> Daily, weekly and monthly reports
            </li>
          </ul>
        </div>
        <p className="text-sm text-primary-200">Secure sign-in for hospital staff only.</p>
      </aside>

      {/* Sign-in form */}
      <main className="flex min-h-screen items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <BrandLogo size="lg" tagline />
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700">
              {HOSPITAL_LOGO && <img src={HOSPITAL_LOGO} alt="" className="h-10 w-10 object-contain" />}
              {HOSPITAL_NAME}
            </p>
          </div>

          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-600">Reception, doctors and lab staff: enter your work email and password.</p>

          <form onSubmit={onSubmitHandler} className="mt-6 space-y-4" noValidate>
            <Field label="Email" htmlFor="login-email">
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@hospital.pk"
                required
              />
            </Field>
            <Field label="Password" htmlFor="login-password">
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:text-slate-800"
                >
                  {showPassword ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
                </button>
              </div>
            </Field>

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full" disabled={!email || !password}>
              {loading ? "Signing in" : "Sign in"}
            </Button>

            <div className="text-right">
              <Link to="/forgot-password" className="text-sm font-medium text-primary-700 hover:text-primary-900">
                Forgot password?
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Login;
