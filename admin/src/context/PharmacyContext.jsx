import { createContext, useContext, useEffect, useState } from "react";
import { pharmacyGet } from "../modules/pharmacy/api";
import { AdminContext } from "./AdminContext";

export const PharmacyContext = createContext();

// Login state for pharmacy staff (their own token, like aToken/dToken/lToken), and
// the signed-in pharmacy user with what their role may do (from /api/pharmacy/me;
// the server checks every request anyway, this only decides what to show).
const PharmacyContextProvider = ({ children }) => {
  const { aToken } = useContext(AdminContext);
  const [pToken, setPToken] = useState(() => {
    try {
      return localStorage.getItem("pToken") || "";
    } catch {
      return "";
    }
  });
  const [pharmacyUser, setPharmacyUser] = useState(null);

  useEffect(() => {
    if (!pToken) {
      setPharmacyUser(null);
      return;
    }
    let alive = true;
    pharmacyGet("/me")
      .then((data) => alive && data.success && setPharmacyUser(data.user))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pToken, aToken]);

  const can = (permission) => Boolean(pharmacyUser?.permissions?.includes(permission));

  return <PharmacyContext.Provider value={{ pToken, setPToken, pharmacyUser, can }}>{children}</PharmacyContext.Provider>;
};

export default PharmacyContextProvider;
