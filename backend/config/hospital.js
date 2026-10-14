// Details of the hospital running Qclinics, shown in WhatsApp replies and emails.
// Each hospital sets these in .env (HOSPITAL_*); the default name is the current hospital (Haram Medical Complex).
export const HOSPITAL_NAME = process.env.HOSPITAL_NAME || "Haram Medical Complex (HMC)";
export const HOSPITAL_PHONE = process.env.HOSPITAL_PHONE || "+920000000000";
export const HOSPITAL_EMAIL = process.env.HOSPITAL_EMAIL || "";
export const HOSPITAL_ADDRESS = process.env.HOSPITAL_ADDRESS || "";
// Patient-facing website, e.g. "cityhospital.com" (optional)
export const HOSPITAL_WEBSITE = process.env.HOSPITAL_WEBSITE || "";

export const PRODUCT_NAME = "Qclinics";
export const PRODUCT_TAGLINE = "Care without the wait.";
