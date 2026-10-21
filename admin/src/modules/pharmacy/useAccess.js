import { useContext } from "react";
import { AdminContext } from "../../context/AdminContext";
import { PharmacyContext } from "../../context/PharmacyContext";

// What the signed-in person may do in the pharmacy. The owner (admin login) may do
// everything; staff get their role's permissions (the server checks again anyway).
export const usePharmacyAccess = () => {
  const { aToken, isOwner } = useContext(AdminContext);
  const { pToken, can } = useContext(PharmacyContext);
  return (permission) => (pToken ? can(permission) : Boolean(aToken && isOwner));
};
