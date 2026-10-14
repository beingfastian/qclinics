// Details of the hospital running this site. Each hospital sets these in
// frontend/.env (VITE_HOSPITAL_*); the default name is the current hospital (Haram Medical Complex).
const env = import.meta.env;

export const HOSPITAL_NAME = env.VITE_HOSPITAL_NAME || "Haram Medical Complex (HMC)";
// Optional: shown under the English name on the queue screens
export const HOSPITAL_NAME_URDU = env.VITE_HOSPITAL_NAME_URDU || "";
// Contact number used for WhatsApp buttons, calls and contact info.
export const HOSPITAL_PHONE = env.VITE_HOSPITAL_PHONE || "+920000000000";
export const HOSPITAL_EMAIL = env.VITE_HOSPITAL_EMAIL || "info@example.com";
export const HOSPITAL_ADDRESS = env.VITE_HOSPITAL_ADDRESS || "Hospital address, City";
// Optional: opening hours as you want patients to read them (English and Urdu)
export const HOSPITAL_HOURS = env.VITE_HOSPITAL_HOURS || "";
export const HOSPITAL_HOURS_URDU = env.VITE_HOSPITAL_HOURS_URDU || "";
// Optional: your Google Maps link; otherwise the address is searched on Google Maps
export const HOSPITAL_MAP_URL = env.VITE_HOSPITAL_MAP_URL || "";

// Contact for the product itself (demo requests, sales): WhatsApp and Call
// buttons on the website. VITE_SALES_PHONE overrides it.
export const SALES_PHONE = env.VITE_SALES_PHONE || "+923338082908";
export const SALES_EMAIL = env.VITE_SALES_EMAIL || "hanzladev376@gmail.com";
// Public address of this website, e.g. "https://qclinics.pk" (no trailing slash).
// Used at build time for canonical links, hreflang, the sitemap and link previews.
// On Vercel it falls back to the project's production address automatically.
export const SITE_URL = (env.VITE_SITE_URL || "").replace(/\/+$/, "");
// Optional: where staff sign in (the admin app), shown as "Staff sign in"
export const STAFF_APP_URL = env.VITE_STAFF_APP_URL || "";

// The product itself
export const PRODUCT_NAME = "Qclinics";
export const PRODUCT_TAGLINE = "Care without the wait.";
