import { useEffect, useState } from "react";
import axios from "axios";

// What this deployment is and which modules it runs (backend config/modules.js):
// a hospital (optionally with the pharmacy module) or a standalone pharmacy.
// Read once per page load. If it can't be read (e.g. an older backend), the app
// behaves as a hospital, as it always has.
const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

export const HOSPITAL_DEFAULT = {
  mode: "hospital",
  name: "",
  modules: { hospital: true, pharmacy: false, lab: true, billing: true },
};

let loading = null;
let loaded = null; // once known, components read it on their first render
export const loadAppConfig = () => {
  loading ??= axios
    .get(`${backendUrl}/api/app/config`, { timeout: 10000 })
    .then(({ data }) => (loaded = data?.success && data.config?.modules ? data.config : HOSPITAL_DEFAULT))
    .catch((error) => {
      // Only a missing endpoint means "older hospital backend"; otherwise try again next time
      if (error.response?.status !== 404) loading = null;
      else loaded = HOSPITAL_DEFAULT;
      return HOSPITAL_DEFAULT;
    });
  return loading;
};

// null while loading, then the config
export const useAppConfig = () => {
  const [config, setConfig] = useState(loaded);
  useEffect(() => {
    let alive = true;
    loadAppConfig().then((value) => alive && setConfig(value));
    return () => {
      alive = false;
    };
  }, []);
  return config;
};
