// Days in the shop's local time (Pakistan: UTC+5, no daylight saving). Servers run
// in UTC, so "today" and report days are worked out here. Same setting as the
// hospital (HOSPITAL_UTC_OFFSET_MINUTES), read here so the module stays on its own.
export const offsetMinutes = () => {
  const value = Number(process.env.HOSPITAL_UTC_OFFSET_MINUTES ?? 300);
  return Number.isFinite(value) ? value : 300;
};

// "+05:00" for MongoDB date grouping
export const offsetText = () => {
  const m = offsetMinutes();
  const abs = Math.abs(m);
  return `${m < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

// "yyyy-mm-dd" of a moment, in local time
export const localDate = (moment = new Date()) => new Date(moment.getTime() + offsetMinutes() * 60000).toISOString().slice(0, 10);

// The moment a local day starts ("2026-10-23" -> 2026-10-22T19:00Z in Pakistan)
export const dayStart = (isoDate) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - offsetMinutes() * 60000);

// [from, to) moments for local days from..to (both included)
export const dayRange = (from, to) => ({ start: dayStart(from), end: new Date(dayStart(to).getTime() + 86400000) });
