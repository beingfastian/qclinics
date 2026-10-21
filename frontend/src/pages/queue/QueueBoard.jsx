import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { HOSPITAL_NAME, HOSPITAL_NAME_URDU } from "../../config";

// Waiting-room screen (a TV or tablet at reception): which token each doctor is
// seeing now and who is next. Token numbers only, never names. Labels are in
// English and Urdu. Plays a chime (and can read the number aloud) when a new
// token is called, keeps the screen awake, and survives internet drops.
const POLL_MS = 7000;

const playChime = (audioRef) => {
  try {
    const ctx = audioRef.current || new (window.AudioContext || window.webkitAudioContext)();
    audioRef.current = ctx;
    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.4, now + i * 0.35 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.35);
      osc.stop(now + i * 0.35 + 0.32);
    });
  } catch {
    /* no audio on this device */
  }
};

// Read "Token number 12, Doctor Ahmed" aloud; an Urdu voice is used if the device has one
const announce = (number, doctorName) => {
  if (!("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  const urdu = voices.find((v) => v.lang?.toLowerCase().startsWith("ur"));
  const text = urdu ? `ٹوکن نمبر ${number}، ڈاکٹر ${doctorName}` : `Token number ${number}, Doctor ${doctorName}`;
  const utterance = new SpeechSynthesisUtterance(text);
  if (urdu) utterance.voice = urdu;
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
};

const QueueBoard = () => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
  const [board, setBoard] = useState(null);
  const [offline, setOffline] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [sound, setSound] = useState(false);
  const [voice, setVoice] = useState(false);
  const [flash, setFlash] = useState({}); // docId -> true while a new number is highlighted
  const previous = useRef({});
  const audio = useRef(null);
  const settings = useRef({ sound, voice });
  settings.current = { sound, voice };

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${backendUrl}/api/queue/public/board`, { timeout: 10000 });
      if (!data.success) return;
      setOffline(false);
      // New number called for a doctor: highlight, chime, announce
      const changed = {};
      for (const doctor of data.board.doctors) {
        const before = previous.current[doctor.docId];
        if (doctor.nowServing != null && before !== undefined && before !== doctor.nowServing) {
          changed[doctor.docId] = true;
          if (settings.current.sound) playChime(audio);
          if (settings.current.voice) setTimeout(() => announce(doctor.nowServing, doctor.doctorName), 900);
        }
        previous.current[doctor.docId] = doctor.nowServing;
      }
      if (Object.keys(changed).length) {
        setFlash(changed);
        setTimeout(() => setFlash({}), 6000);
      }
      setBoard(data.board);
    } catch {
      setOffline(true);
    }
  }, [backendUrl]);

  useEffect(() => {
    document.title = `Queue · ${HOSPITAL_NAME}`;
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setClock(new Date()), 1000);
    window.addEventListener("online", load);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("online", load);
    };
  }, [load]);

  // Keep a TV/tablet screen from sleeping (where supported)
  useEffect(() => {
    let lock;
    const request = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
      } catch {
        /* not supported or not allowed */
      }
    };
    request();
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release?.().catch(() => {});
    };
  }, []);

  const enableSound = () => {
    setSound(true);
    playChime(audio); // the click unlocks audio in the browser
  };

  const fullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

  const doctors = board?.doctors || [];

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-slate-900 border-b border-slate-800">
        <div>
          <p className="text-2xl md:text-3xl font-bold">{HOSPITAL_NAME}</p>
          <p className="text-lg text-slate-300" dir="rtl" lang="ur">{HOSPITAL_NAME_URDU ? `${HOSPITAL_NAME_URDU} · ` : ""}او پی ڈی</p>
        </div>
        <div className="flex items-center gap-3">
          {!sound ? (
            <button onClick={enableSound} className="px-3 py-2 rounded-lg bg-slate-800 text-sm hover:bg-slate-700">
              Turn on sound
            </button>
          ) : (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
              Read numbers aloud
            </label>
          )}
          <button onClick={fullscreen} className="px-3 py-2 rounded-lg bg-slate-800 text-sm hover:bg-slate-700">
            Full screen
          </button>
          <p className="text-3xl md:text-4xl font-mono tabular-nums">
            {clock.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </header>

      {offline && (
        <div className="px-6 py-2 bg-red-700 text-center text-lg">
          Connection lost, retrying… / انٹرنیٹ کا مسئلہ، دوبارہ کوشش جاری ہے
        </div>
      )}

      <main className="flex-1 p-4 md:p-6">
        {!board ? (
          <p className="text-center text-2xl text-slate-400 mt-20">Loading…</p>
        ) : doctors.length === 0 ? (
          <div className="text-center mt-24">
            <p className="text-3xl text-slate-300">No tokens issued yet today</p>
            <p className="text-2xl text-slate-400 mt-3" dir="rtl" lang="ur">آج ابھی کوئی ٹوکن جاری نہیں ہوا</p>
          </div>
        ) : (
          <div className="grid gap-4 md:gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" }}>
            {doctors.map((d) => (
              <section
                key={d.docId}
                className={`rounded-2xl border p-5 md:p-6 transition-colors duration-700 ${
                  flash[d.docId] ? "bg-emerald-700 border-emerald-400" : "bg-slate-900 border-slate-800"
                }`}
              >
                <p className="text-2xl md:text-3xl font-semibold truncate">Dr. {d.doctorName}</p>
                <p className="text-slate-400 text-lg truncate">{d.speciality}</p>

                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-slate-300 text-lg">
                      Now serving · <span dir="rtl" lang="ur">اب باری</span>
                    </p>
                    <p className="text-8xl md:text-9xl font-bold leading-none tabular-nums">
                      {d.nowServing ?? "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400">Waiting</p>
                    <p className="text-4xl font-semibold tabular-nums">{d.waitingCount}</p>
                  </div>
                </div>

                {d.paused ? (
                  <p className="mt-4 px-3 py-2 rounded-lg bg-amber-500 text-slate-950 text-xl font-semibold">
                    Doctor on break{d.pauseNote ? <>: <bdi>{d.pauseNote}</bdi></> : ""} · <span dir="rtl" lang="ur">ڈاکٹر وقفے پر ہیں</span>
                  </p>
                ) : !d.started ? (
                  <p className="mt-4 px-3 py-2 rounded-lg bg-slate-800 text-xl">
                    Not started yet · <span dir="rtl" lang="ur">ابھی شروع نہیں ہوا</span>
                  </p>
                ) : null}

                <div className="mt-4">
                  <p className="text-slate-400 text-lg">
                    Next · <span dir="rtl" lang="ur">اگلے</span>
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {d.next.length ? (
                      d.next.map((n) => (
                        <span key={n} className="min-w-[3.5rem] text-center px-3 py-1 rounded-lg bg-slate-800 text-3xl font-semibold tabular-nums">
                          {n}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-500 text-xl">—</span>
                    )}
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="px-6 py-3 text-center text-slate-400 text-lg border-t border-slate-800">
        Please wait for your number. Patients with appointments and urgent cases may be called in between.
        <span className="block" dir="rtl" lang="ur">
          اپنے نمبر کا انتظار کریں۔ اپائنٹمنٹ والے اور ایمرجنسی مریض درمیان میں بلائے جا سکتے ہیں۔
        </span>
      </footer>
    </div>
  );
};

export default QueueBoard;
