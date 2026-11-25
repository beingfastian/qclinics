// Text for the Qclinics website (English only). Keys stay in one place so copy is
// easy to review. The queue screens (src/pages/queue) carry their own Urdu lines.
// Only describe what the product really does today.
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";

export const LANGUAGES = {
  en: { path: "/", dir: "ltr", locale: "en_PK" },
};

export const langFromPath = () => "en";

const STRINGS = {
  en: {
    "meta.title": "Qclinics | Hospital & Clinic Management Software in Pakistan",
    "meta.description":
      "Token queue, waiting-room screen, WhatsApp reminders in Urdu, lab reports and doctor earnings in one simple system for hospitals and clinics in Pakistan. Book a free demo.",
    "notFound.title": "Page not found",
    "notFound.text": "This page doesn't exist. It may have moved.",
    "notFound.home": "Go to the home page",
    "nav.features": "Features",
    "nav.how": "How it works",
    "nav.pakistan": "Built for Pakistan",
    "nav.faq": "FAQ",
    "nav.menu": "Menu",
    "nav.close": "Close menu",
    "nav.staff": "Staff sign in",
    "action.demo": "Book a free demo",
    "action.demoShort": "Book a demo",
    "action.call": "Call us",
    "action.callShort": "Call",
    "action.email": "Email us",
    "action.see": "See how it works",

    "hero.kicker": "Care without the wait.",
    "hero.title": "Hospital software that ends the waiting-room crowd.",
    "hero.lead": "Tokens, a live queue, WhatsApp reminders in Urdu, lab reports and doctor earnings: one simple system for hospitals and clinics in Pakistan.",
    "hero.point1": "Patients don't need to install an app",
    "hero.point2": "Runs on any computer, tablet or phone",
    "hero.point3": "Urdu and English for patients",
    "mock.board": "Waiting-room screen",
    "mock.now": "Now serving",
    "mock.next": "Next",
    "mock.doctor": "Dr. Ahmed Raza · General physician",
    "mock.whatsapp": "WhatsApp to the patient",
    "mock.message": "Your token number is 14. There are 2 patients ahead of you, about 15 minutes.",
    "mock.track": "Follow your turn",

    "problems.title": "Sound familiar?",
    "problems.p1": "A packed waiting hall, and arguments over whose turn it is.",
    "problems.p2": "Patients book and don't come, while others wait for hours.",
    "problems.p3": "Lab reports get lost on the way back to the doctor.",
    "problems.p4": "Doctor shares worked out by hand at the end of every month.",

    "features.title": "Everything the front desk, doctors and lab need",
    "features.lead": "One system, three simple logins: reception, doctors and the lab.",
    "f.queue.title": "Live token queue",
    "f.queue.text": "Reception issues tokens for appointments and walk-ins. Doctors call the next patient, and the waiting-room TV shows who is being seen.",
    "f.track.title": "Turn tracking on the patient's phone",
    "f.track.text": "A QR code on the printed slip and a WhatsApp link show how many patients are ahead, so families can wait outside.",
    "f.whatsapp.title": "WhatsApp messages in Urdu",
    "f.whatsapp.text": "Booking confirmations, reminders and token updates in Urdu or English, only for patients who agree.",
    "f.appointments.title": "Appointments, walk-ins and follow-ups",
    "f.appointments.text": "Book from a phone-number search, check patients in on arrival, and let doctors schedule the next visit in one click.",
    "f.lab.title": "In-house lab",
    "f.lab.text": "Doctors request tests, the lab uploads the report, and the doctor reviews and approves it.",
    "f.earnings.title": "Doctor shares and profit reports",
    "f.earnings.text": "Set each doctor's share once. Every completed visit is split automatically, with daily, weekly and monthly reports.",
    "f.schedule.title": "Doctor days and leave",
    "f.schedule.text": "Sitting days, timings and leave in one place. Move or cancel a whole day and patients are told.",
    "f.slips.title": "Printed slips",
    "f.slips.text": "Token and appointment slips with the hospital's name, ready for any printer at the counter.",

    "pk.title": "Built for how hospitals work in Pakistan",
    "pk.p1": "Urdu on everything patients see: messages, slips and the token page.",
    "pk.p2": "WhatsApp first: no app to download, no login for patients.",
    "pk.p3": "Families can share one phone number. Patients without a phone get a printed token.",
    "pk.p4": "Works on everyday Android phones and slow internet, and keeps retrying when the connection drops.",
    "pk.p5": "Pakistan time, rupees, CNIC and local phone numbers built in.",

    "how.title": "Up and running quickly",
    "how.s1.title": "Tell us about your hospital",
    "how.s1.text": "Your doctors, their sitting days and fees, and the WhatsApp number patients know.",
    "how.s2.title": "We set it up with your team",
    "how.s2.text": "We add your doctors and show reception, doctors and the lab how to use it.",
    "how.s3.title": "Go live",
    "how.s3.text": "Patients get tokens and WhatsApp updates from the first day.",

    "faq.title": "Questions hospitals ask",
    "faq.q1": "Do patients need to install an app?",
    "faq.a1": "No. Patients get WhatsApp messages and a link to follow their turn. Nothing to download, nothing to sign up for.",
    "faq.q2": "What about patients without WhatsApp or a phone?",
    "faq.a2": "Reception can register any patient, even without a phone number, and print a token slip. WhatsApp is optional.",
    "faq.q3": "What equipment do we need?",
    "faq.a3": "The computers or tablets you already have, with a browser and internet. A TV for the waiting-room screen and a printer for slips are optional.",
    "faq.q4": "Who can see patient information?",
    "faq.a4": "Only your staff can sign in, and each role sees what it needs: doctors see their own patients and earnings, the lab sees its requests.",
    "faq.q5": "How much does it cost?",
    "faq.a5": "It depends on the number of doctors and your setup. Message us and we'll send pricing for your hospital.",
    "faq.q6": "Is it in Urdu?",
    "faq.a6": "Everything patients see is available in Urdu and English. The staff screens are in simple English.",

    "cta.title": "See it running in your hospital",
    "cta.text": "Book a free demo on WhatsApp. We'll show you the queue, the WhatsApp messages and the reports with your own doctors.",

    "footer.about": "Token queue, WhatsApp reminders, lab reports and doctor earnings for hospitals and clinics in Pakistan.",
    "footer.links": "Product",
    "footer.contact": "Contact",
    "footer.rights": "© {year} {product}. All rights reserved.",

    "wa.demo": "Hello! I'd like a demo of {product} for our hospital.",
  },
};

export { STRINGS };

const LanguageContext = createContext(null);

// The language comes from the address, so the server-built page and the browser agree
export const LanguageProvider = ({ lang = "en", children }) => {
  // Built pages already carry lang/dir; this keeps them right in development too
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = LANGUAGES[lang].dir;
  }, [lang]);

  const t = useCallback(
    (key, vars = {}) => {
      const text = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
      return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`);
    },
    [lang]
  );
  const value = useMemo(() => ({ lang, t }), [lang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => useContext(LanguageContext);
