import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

// One list, filtered and paged by the server: appointments
// (backend/services/appointmentListService.js) or patients (listKey "patients"). The screens used to load every
// appointment ever made and filter here; that stops working as a hospital grows.
//
//   url         /api/admin/appointments or /api/doctor/appointments
//   headers     the login header, e.g. { atoken } or { dToken }
//   filters     { range, docId, status, notify, q }: empty values are left out
//   refreshKey  changes after an action (cancel, reschedule...): reloads what's shown
//   listKey     the list's name in the response ("appointments" or "patients")
//
// Returns { items, counts, summary, total, hasMore, loading, loadMore }.
// A slower, older response never replaces a newer one (filters changed meanwhile).
const PAGE_SIZE = 50;
const MAX_RELOAD = 200; // the server's largest page

const useAppointmentPages = ({ url, headers, filters, refreshKey = 0, enabled = true, pageSize = PAGE_SIZE, listKey = "appointments" }) => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);
  const [counts, setCounts] = useState(null);
  const [summary, setSummary] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const shown = useRef(0);
  shown.current = items.length;

  // "all" means no filter for doctor/status/messages, but is a real value for range
  const params = Object.fromEntries(
    Object.entries(filters).filter(([key, v]) => v !== undefined && v !== null && v !== "" && (key === "range" || v !== "all"))
  );
  const paramsKey = JSON.stringify(params);
  const headersKey = JSON.stringify(headers);

  const load = useCallback(
    async ({ cursor, limit } = {}) => {
      const request = ++latest.current;
      setLoading(true);
      try {
        const { data } = await axios.get(url, {
          headers: JSON.parse(headersKey),
          params: { ...JSON.parse(paramsKey), limit: limit || pageSize, ...(cursor && { cursor }) },
          timeout: 20000,
        });
        if (request !== latest.current) return;
        if (!data.success) {
          toast.error(data.message);
          return;
        }
        const rows = data[listKey] || [];
        setItems((previous) => (cursor ? [...previous, ...rows] : rows));
        setNextCursor(data.nextCursor || null);
        if (!cursor) {
          setCounts(data.counts || null);
          setSummary(data.summary || null);
          setTotal(data.total ?? data.summary?.total ?? null);
        }
      } catch (error) {
        if (request === latest.current) toast.error(error.response?.data?.message || error.message);
      } finally {
        if (request === latest.current) setLoading(false);
      }
    },
    [url, headersKey, paramsKey, pageSize, listKey]
  );

  // New filters: start again from the first page
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  // After an action: reload, keeping as many rows as were shown (up to one big page)
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    if (enabled) load({ limit: Math.min(MAX_RELOAD, Math.max(pageSize, shown.current)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const loadMore = useCallback(() => {
    if (nextCursor && !loading) load({ cursor: nextCursor });
  }, [nextCursor, loading, load]);

  return { items, counts, summary, total, hasMore: Boolean(nextCursor), loading, loadMore };
};

export default useAppointmentPages;

// One doctor's active appointments on one day, for "Manage a Day"
export const fetchDayAppointments = async (url, headers, docId, slotDate) => {
  const { data } = await axios.get(url, {
    headers,
    params: { day: slotDate, ...(docId && { docId }), limit: 200, counts: 0 },
    timeout: 20000,
  });
  if (!data.success) throw new Error(data.message);
  return data.appointments;
};
