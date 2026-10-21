import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { HOSPITAL_NAME, HOSPITAL_NAME_URDU, HOSPITAL_PHONE } from "../../config";
import { assets } from "../../assets/assets";

// A patient's own token page, opened from the WhatsApp link or the QR code on the
// slip (often on a family member's phone). Urdu first, English under it. Shows
// the place in line and a rough wait, and buzzes the phone when it's their turn.
const POLL_MS = 15000;

const formatDay = (day) => {
  const [d, m, y] = String(day || "").split("_").map(Number);
  if (!d) return day;
  return new Date(y, m - 1, d).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
};

const Line = ({ ur, en, className = "" }) => (
  <div className={className}>
    <p dir="rtl" lang="ur" className="text-xl leading-relaxed">{ur}</p>
    <p className="text-sm opacity-80 mt-0.5">{en}</p>
  </div>
);

const QueueTrack = () => {
  const { publicId } = useParams();
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
  const [token, setToken] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const lastStatus = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${backendUrl}/api/queue/public/token/${encodeURIComponent(publicId)}`, { timeout: 10000 });
      setOffline(false);
      if (data.success) {
        if (data.token.status === "called" && lastStatus.current && lastStatus.current !== "called") {
          navigator.vibrate?.([400, 200, 400, 200, 400]);
        }
        lastStatus.current = data.token.status;
        setToken(data.token);
        setUpdatedAt(new Date());
      }
    } catch (error) {
      if (error.response?.status === 404) setNotFound(true);
      else setOffline(true);
    }
  }, [backendUrl, publicId]);

  useEffect(() => {
    document.title = `My token · ${HOSPITAL_NAME}`;
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", load);
    };
  }, [load]);

  let box;
  if (notFound) {
    box = (
      <Line
        className="p-5 rounded-2xl bg-slate-100 text-slate-800"
        ur="یہ ٹوکن نہیں ملا۔ براہ کرم ریسیپشن سے رابطہ کریں۔"
        en="This token was not found. Please ask at reception."
      />
    );
  } else if (!token) {
    box = <p className="text-center text-slate-500 py-10">Loading… / لوڈ ہو رہا ہے</p>;
  } else if (!token.isToday) {
    box = (
      <Line
        className="p-5 rounded-2xl bg-slate-100 text-slate-800"
        ur={`یہ ٹوکن ${formatDay(token.day)} کا تھا۔`}
        en={`This token was for ${formatDay(token.day)}.`}
      />
    );
  } else if (token.status === "called") {
    box = (
      <Line
        className="p-5 rounded-2xl bg-green-600 text-white"
        ur={`آپ کی باری آ گئی ہے! ڈاکٹر ${token.doctorName} کے کمرے میں تشریف لے جائیں۔`}
        en={`It's your turn! Please go to Dr. ${token.doctorName}.`}
      />
    );
  } else if (token.status === "done") {
    box = <Line className="p-5 rounded-2xl bg-slate-100 text-slate-800" ur="آپ کا معائنہ مکمل ہو گیا۔ شکریہ!" en="Your visit is complete. Thank you!" />;
  } else if (token.status === "skipped") {
    box = (
      <Line
        className="p-5 rounded-2xl bg-amber-100 text-amber-900"
        ur="آپ کا نمبر پکارا گیا لیکن آپ موجود نہیں تھے۔ براہ کرم فوراً ریسیپشن پر آئیں، آپ کو دوبارہ لائن میں لگا دیا جائے گا۔"
        en="Your number was called but you weren't there. Please come to reception now and you'll be put back in line."
      />
    );
  } else if (token.status === "left") {
    box = <Line className="p-5 rounded-2xl bg-slate-100 text-slate-800" ur="یہ ٹوکن منسوخ ہو چکا ہے۔" en="This token was cancelled." />;
  } else {
    box = (
      <div className="space-y-3">
        <div className="p-5 rounded-2xl bg-primary text-white">
          {token.ahead === 0 ? (
            <Line ur="آپ اگلے ہیں! ویٹنگ ایریا میں رہیں۔" en="You are next! Please stay in the waiting area." />
          ) : (
            <Line
              ur={`آپ سے پہلے ${token.ahead} مریض ہیں · تقریباً ${token.waitMinutes} منٹ`}
              en={`${token.ahead} patient(s) ahead of you · about ${token.waitMinutes} min`}
            />
          )}
        </div>
        {token.ahead !== null && token.ahead <= 3 && token.ahead > 0 && (
          <Line
            className="p-4 rounded-2xl bg-amber-100 text-amber-900"
            ur="آپ کی باری قریب ہے، براہ کرم ویٹنگ ایریا میں واپس آ جائیں۔"
            en="Your turn is near. Please come back to the waiting area."
          />
        )}
        {token.paused && (
          <Line
            className="p-4 rounded-2xl bg-amber-100 text-amber-900"
            ur={`ڈاکٹر اس وقت وقفے پر ہیں${token.pauseNote ? ` (⁨${token.pauseNote}⁩)` : ""}۔ وقت میں تاخیر ہو سکتی ہے۔`}
            en={`The doctor is on a break${token.pauseNote ? ` (${token.pauseNote})` : ""}. Times may be later.`}
          />
        )}
        {!token.started && !token.paused && (
          <Line
            className="p-4 rounded-2xl bg-slate-100 text-slate-800"
            ur="ڈاکٹر نے ابھی مریض دیکھنا شروع نہیں کیے۔ وقت اندازاً ہے۔"
            en="The doctor hasn't started yet, so the time is only a guess."
          />
        )}
        {token.urgent && <p className="text-sm text-red-700">Marked urgent / فوری</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center px-4 py-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-5">
          <img src={assets.logo_mark} alt="" className="mx-auto mb-2 h-10 w-10" />
          <p className="font-display text-xl font-bold text-slate-900">{HOSPITAL_NAME}</p>
          {HOSPITAL_NAME_URDU && (
            <p className="text-slate-600" dir="rtl" lang="ur">{HOSPITAL_NAME_URDU}</p>
          )}
        </div>

        {token && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4 text-center">
            <p className="text-slate-500">
              Your token · <span dir="rtl" lang="ur">آپ کا ٹوکن نمبر</span>
            </p>
            <p className="text-7xl font-bold text-slate-900 tabular-nums my-2">{token.number}</p>
            <p className="text-slate-700">Dr. {token.doctorName}</p>
            {token.speciality && <p className="text-sm text-slate-500">{token.speciality}</p>}
            {token.isToday && token.status !== "done" && token.status !== "left" && (
              <p className="mt-3 text-sm text-slate-500">
                Now serving · <span dir="rtl" lang="ur">اب باری</span>: <span className="font-semibold text-slate-900">{token.nowServing ?? "—"}</span>
              </p>
            )}
          </div>
        )}

        {box}

        {offline && (
          <p className="mt-4 text-center text-sm text-red-700">
            No internet, retrying… / انٹرنیٹ نہیں، دوبارہ کوشش جاری ہے
          </p>
        )}
        <p className="mt-6 text-center text-xs text-slate-500">
          Updates by itself every few seconds{updatedAt ? ` · last ${updatedAt.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}` : ""}.
          <br />
          Help: <a className="underline" href={`tel:${HOSPITAL_PHONE}`}>{HOSPITAL_PHONE}</a>
        </p>
      </div>
    </div>
  );
};

export default QueueTrack;
