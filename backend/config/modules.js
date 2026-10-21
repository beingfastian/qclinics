// What this deployment is, and which modules it runs. One codebase, two products:
//
//   APP_MODE=hospital (default)  the hospital system: appointments, queue, billing,
//                                lab, ... and optionally the pharmacy module
//   APP_MODE=pharmacy            a standalone pharmacy: only the pharmacy module, the
//                                shared sign-in and the owner's screens
//
//   PHARMACY_ENABLED=true        turns the pharmacy module on in a hospital
//                                (always on in a standalone pharmacy)
//   LAB_ENABLED=false / BILLING_ENABLED=false   turn those hospital modules off
//
// Each customer (hospital or pharmacy) has its own deployment and database.
export const appMode = () => (String(process.env.APP_MODE || "").trim().toLowerCase() === "pharmacy" ? "pharmacy" : "hospital");
export const isHospital = () => appMode() === "hospital";

export const pharmacyEnabled = () => appMode() === "pharmacy" || process.env.PHARMACY_ENABLED === "true";
export const labEnabled = () => isHospital() && process.env.LAB_ENABLED !== "false";
export const billingEnabled = () => isHospital() && process.env.BILLING_ENABLED !== "false";

// Public: the staff app reads this once to decide which screens and menus to show
export const appConfig = () => ({
  mode: appMode(),
  name: (isHospital() ? process.env.HOSPITAL_NAME : process.env.PHARMACY_NAME || process.env.HOSPITAL_NAME) || "",
  modules: {
    hospital: isHospital(),
    pharmacy: pharmacyEnabled(),
    lab: labEnabled(),
    billing: billingEnabled(),
  },
});
