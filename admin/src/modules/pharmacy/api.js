import axios from "axios";

// The pharmacy module's API (backend modules/pharmacy). Pharmacy staff send their
// own login (ptoken); the owner uses the admin login (atoken).
export const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

const headers = () => {
  try {
    const pToken = localStorage.getItem("pToken");
    if (pToken) return { ptoken: pToken };
    const aToken = localStorage.getItem("aToken");
    return aToken ? { atoken: aToken } : {};
  } catch {
    return {};
  }
};

// The server answers business errors with a status and { message }; show that
const request = async (method, path, data) => {
  const response = await axios({ method, url: `${backendUrl}/api/pharmacy${path}`, data, headers: headers(), timeout: 20000 });
  return response.data;
};

export const pharmacyGet = (path) => request("get", path);
export const pharmacyPost = (path, data) => request("post", path, data);
export const pharmacyPut = (path, data) => request("put", path, data);

export const errorText = (error) =>
  error?.response?.data?.message || (error?.request ? "Couldn't reach the server. Check the internet connection and try again." : error?.message || "Something went wrong");

export const ROLE_LABEL = { owner: "Owner", manager: "Pharmacy manager", cashier: "Cashier" };
