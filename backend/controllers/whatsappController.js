import twilio from 'twilio';
import appointmentModel from "../model/appointmentModel.js";
import doctorModel from "../model/doctorModel.js";
import userModel from "../model/userModel.js";
import crypto from 'crypto';
import { sendWhatsAppConfirmation, sendWhatsAppReminder, sendWhatsAppText } from "../config/whatsappService.js";
import { phoneVariants, normalizePhone } from "../whatsapp/phone.js";
import { whatsappInboundModel, whatsappCancelPromptModel } from "../model/whatsappStateModel.js";
import { background } from "../utils/background.js";
import {
  formatSlotDate as formatDisplayDate,
  formatSlotDateUrdu,
  formatSlotTimeUrdu,
  slotToDate,
} from "../utils/slots.js";
import { patientLanguage } from "../whatsapp/templates.js";
import { cancelAppointment } from "../services/appointmentService.js";
import {
  HOSPITAL_ADDRESS,
  HOSPITAL_EMAIL,
  HOSPITAL_EMERGENCY_24_7,
  HOSPITAL_NAME,
  HOSPITAL_PHONE,
  HOSPITAL_WEBSITE,
  PRODUCT_NAME,
} from "../config/hospital.js";

// Reply text for an incoming WhatsApp message (STATUS / CANCEL / BOOK / CONTACT / HELP).
// Shared by the Twilio and Kapso webhooks. Replies in the patient's language
// (Urdu or English); Urdu keywords work too (حالت، منسوخ، بکنگ، رابطہ).
const COMMANDS = {
  status: ["status", "حالت", "اسٹیٹس", "سٹیٹس"],
  cancel: ["cancel", "منسوخ"],
  book: ["book", "appointment", "بکنگ", "اپائنٹمنٹ"],
  contact: ["contact", "info", "رابطہ"],
};
// "cancel", "CANCEL 2", "منسوخ ۲" -> { command, number }. Urdu/Arabic digits count too.
const toAsciiDigits = (text) => text.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
const parseMessage = (text) => {
  const match = /^(\S+)(?:\s+(\d{1,2}))?$/.exec(toAsciiDigits(text));
  const word = match ? match[1] : text;
  const command = Object.keys(COMMANDS).find((name) => COMMANDS[name].includes(word)) || "help";
  return { command, number: match?.[2] ? Number(match[2]) : null };
};
const CANCEL_PROMPT_MS = 30 * 60 * 1000;

// Optional lines, left out when the hospital hasn't set them
const optionalLine = (value, label) => (value ? `${label} ${value}\n` : "");

// Wording per language
const TEXT = {
  en: {
    statusHeader: (name) => `*Hello ${name}! 👋*\n\n*Your Recent Appointments:*\n\n`,
    labels: { cancelled: "❌ Cancelled", completed: "✅ Completed", no_show: "⚠️ Missed", upcoming: "⏰ Upcoming", past: "🕘 Past" },
    statusFooter: () => "Need help? Reply *HELP* for more options.",
    noAppointments: (name) =>
      `*Hello ${name}! 👋*\n\nYou currently have no appointments.\n\n` +
      `To book an appointment:\n${optionalLine(HOSPITAL_WEBSITE, "🌐 Visit:")}📞 Call: ${HOSPITAL_PHONE}\n💬 WhatsApp: ${HOSPITAL_PHONE}\n\nReply *HELP* for more options.`,
    statusError: () => "Sorry, there was an error fetching your appointments. Please try again later.",
    cancelled: (apt) =>
      `*Appointment Cancelled Successfully ❌*\n\nDetails:\n👨‍⚕️ Dr. ${apt.docData.name}\n📅 ${formatDisplayDate(apt.slotDate)}\n🕐 ${apt.slotTime}\n\n` +
      `To book a new appointment:\n${optionalLine(HOSPITAL_WEBSITE, "🌐 Visit:")}📞 Call: ${HOSPITAL_PHONE}\n\nThank you!`,
    // Numbered list after CANCEL: nothing is cancelled until the patient picks one
    cancelChoose: (items) =>
      `*Which appointment do you want to cancel?*\n\n` +
      items.map((it, i) => `*${i + 1}.* Dr. ${it.doctor} · ${formatDisplayDate(it.slotDate)} · ${it.slotTime}${it.patient ? ` (${it.patient})` : ""}`).join("\n") +
      `\n\nReply *CANCEL 1*${items.length > 1 ? " (or another number)" : ""} to cancel it. Nothing is cancelled until you reply.`,
    nothingToCancel: () =>
      `*No Upcoming Appointment Found*\n\nYou don't have any upcoming appointments to cancel.\n\n` +
      `To book a new appointment:\n${optionalLine(HOSPITAL_WEBSITE, "🌐 Visit:")}📞 Call: ${HOSPITAL_PHONE}\n\nReply *HELP* for more options.`,
    cancelError: () => "Sorry, there was an error cancelling your appointment. Please try again later or contact us directly.",
    book: (specialities) =>
      `*Book New Appointment 📅*\n\nTo book an appointment with our doctors:\n\n` +
      `${optionalLine(HOSPITAL_WEBSITE, "🌐 *Website:*")}📞 *Call:* ${HOSPITAL_PHONE}\n💬 *WhatsApp:* ${HOSPITAL_PHONE}\n\n` +
      (specialities.length ? `*Our Specialties:*\n${specialities.map((s) => `• ${s}`).join("\n")}\n\n` : "") +
      `We're here to help! 🏥`,
    contact: () =>
      `*${HOSPITAL_NAME} Contact Info 🏥*\n\n${optionalLine(HOSPITAL_ADDRESS, "📍 *Address:*")}` +
      `📞 *Phone:* ${HOSPITAL_PHONE}\n💬 *WhatsApp:* ${HOSPITAL_PHONE}\n${optionalLine(HOSPITAL_EMAIL, "📧 *Email:*")}` +
      `${optionalLine(HOSPITAL_WEBSITE, "🌐 *Website:*")}` +
      (HOSPITAL_EMERGENCY_24_7 ? `\nWe're here 24/7 for emergencies! 🚑` : ""),
    help: () =>
      `*Welcome to ${HOSPITAL_NAME}! 🏥*\n\n*Available Commands:*\n• *STATUS* - Check your appointments\n` +
      `• *CANCEL* - Cancel an appointment\n• *BOOK* - Get booking information\n• *CONTACT* - Hospital contact details\n` +
      `• *HELP* - Show this menu\n\n*Quick Actions:*\n${optionalLine(HOSPITAL_WEBSITE, "🌐 Book Online:")}📞 Call Direct: ${HOSPITAL_PHONE}\n\nHow can we help you today?\n\n_Powered by ${PRODUCT_NAME}_`,
  },
  ur: {
    statusHeader: (name) => `*السلام علیکم ${name}! 👋*\n\n*آپ کی حالیہ اپائنٹمنٹس:*\n\n`,
    labels: { cancelled: "❌ منسوخ", completed: "✅ مکمل", no_show: "⚠️ نہیں آئے", upcoming: "⏰ آنے والی", past: "🕘 گزر چکی" },
    statusFooter: () => "مزید معلومات کے لیے *مدد* یا *HELP* لکھ کر بھیجیں۔",
    noAppointments: (name) =>
      `*السلام علیکم ${name}! 👋*\n\nاس وقت آپ کی کوئی اپائنٹمنٹ نہیں ہے۔\n\n` +
      `اپائنٹمنٹ کے لیے:\n📞 کال کریں: ${HOSPITAL_PHONE}\n💬 واٹس ایپ: ${HOSPITAL_PHONE}${HOSPITAL_WEBSITE ? `\n🌐 ویب سائٹ: ${HOSPITAL_WEBSITE}` : ""}`,
    statusError: () => "معذرت، آپ کی اپائنٹمنٹس دیکھنے میں مسئلہ ہوا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔",
    cancelled: (apt) =>
      `*آپ کی اپائنٹمنٹ منسوخ کر دی گئی ہے ❌*\n\n👨‍⚕️ ڈاکٹر ${apt.docData.name}\n` +
      `📅 ${formatSlotDateUrdu(apt.slotDate)}\n🕐 ${formatSlotTimeUrdu(apt.slotTime)}\n\n` +
      `نئی اپائنٹمنٹ کے لیے ${HOSPITAL_PHONE} پر کال کریں۔ شکریہ!`,
    cancelChoose: (items) =>
      `*کون سی اپائنٹمنٹ منسوخ کرنی ہے؟*\n\n` +
      items.map((it, i) => `*${i + 1}.* ڈاکٹر ${it.doctor} · ${formatSlotDateUrdu(it.slotDate)} · ${formatSlotTimeUrdu(it.slotTime)}${it.patient ? ` (${it.patient})` : ""}`).join("\n") +
      `\n\nمنسوخ کرنے کے لیے *منسوخ 1*${items.length > 1 ? " (یا کوئی اور نمبر)" : ""} لکھ کر بھیجیں۔ جواب دیے بغیر کچھ منسوخ نہیں ہوگا۔`,
    nothingToCancel: () =>
      `*کوئی آنے والی اپائنٹمنٹ نہیں ملی*\n\nمنسوخ کرنے کے لیے آپ کی کوئی آنے والی اپائنٹمنٹ نہیں ہے۔\n\n` +
      `مزید معلومات کے لیے ${HOSPITAL_PHONE} پر کال کریں۔`,
    cancelError: () => "معذرت، اپائنٹمنٹ منسوخ کرنے میں مسئلہ ہوا۔ براہ کرم ہسپتال کو کال کریں۔",
    book: () =>
      `*نئی اپائنٹمنٹ 📅*\n\nاپائنٹمنٹ کے لیے:\n📞 کال کریں: ${HOSPITAL_PHONE}\n💬 واٹس ایپ: ${HOSPITAL_PHONE}${HOSPITAL_WEBSITE ? `\n🌐 ویب سائٹ: ${HOSPITAL_WEBSITE}` : ""}`,
    contact: () =>
      `*${HOSPITAL_NAME} 🏥*\n\n${optionalLine(HOSPITAL_ADDRESS, "📍")}📞 فون: ${HOSPITAL_PHONE}\n` +
      `💬 واٹس ایپ: ${HOSPITAL_PHONE}` +
      (HOSPITAL_EMERGENCY_24_7 ? `\n\nایمرجنسی 24 گھنٹے کھلی ہے 🚑` : ""),
    help: () =>
      `*${HOSPITAL_NAME} 🏥*\n\nیہ الفاظ لکھ کر بھیجیں:\n• *حالت* (STATUS) - اپنی اپائنٹمنٹس دیکھیں\n` +
      `• *منسوخ* (CANCEL) - اپائنٹمنٹ منسوخ کریں\n• *بکنگ* (BOOK) - اپائنٹمنٹ کی معلومات\n` +
      `• *رابطہ* (CONTACT) - ہسپتال کا پتہ اور فون\n\n📞 ${HOSPITAL_PHONE}`,
  },
};

// Someone the hospital has no record of: reply in both languages
const unknownUserReply = () =>
  `*Welcome to ${HOSPITAL_NAME}! 🏥*\n\nWe couldn't find your account with this number.\n` +
  `Please contact us at ${HOSPITAL_PHONE} to register or book an appointment.\n\n` +
  `ہمیں اس نمبر پر آپ کا ریکارڈ نہیں ملا۔ رجسٹریشن یا اپائنٹمنٹ کے لیے ${HOSPITAL_PHONE} پر کال کریں۔`;

const statusLabel = (apt, labels, now = new Date()) => {
  if (apt.cancelled) return labels.cancelled;
  if (apt.isCompleted) return labels.completed;
  if (apt.status === "no_show") return labels.no_show;
  const startAt = apt.startAt || slotToDate(apt.slotDate, apt.slotTime);
  return startAt && startAt <= now ? labels.past : labels.upcoming;
};

const buildBotReply = async (phoneNumber, userMessage) => {
  // Everyone registered on this WhatsApp number (a family often shares one phone)
  const variants = phoneVariants(phoneNumber);
  const users = await userModel
    .find({ $or: [{ whatsappNumber: { $in: variants } }, { phone: { $in: variants } }] })
    .sort({ whatsappEnabled: -1, _id: 1 });
  if (!users.length) return unknownUserReply();
  const user = users[0];
  const userIds = users.map((u) => u._id.toString());
  const family = users.length > 1;

  const lang = patientLanguage(user);
  const t = TEXT[lang];

  const { command, number } = parseMessage(userMessage);
  switch (command) {
    case "status":
      try {
        const appointments = await appointmentModel
          .find({ userId: { $in: userIds } })
          .sort({ date: -1 })
          .limit(family ? 5 : 3);
        if (!appointments.length) return t.noAppointments(user.name);

        let text = t.statusHeader(user.name);
        appointments.forEach((apt, index) => {
          const date = lang === "ur" ? formatSlotDateUrdu(apt.slotDate) : formatDisplayDate(apt.slotDate);
          const time = lang === "ur" ? formatSlotTimeUrdu(apt.slotTime) : apt.slotTime;
          text += `${index + 1}. *${lang === "ur" ? "ڈاکٹر" : "Dr."} ${apt.docData.name}*${family ? ` (${apt.userData?.name})` : ""}\n`;
          text += `   📅 ${date}\n   🕐 ${time}\n   ${statusLabel(apt, t.labels)}\n\n`;
        });
        return (text + t.statusFooter()).trim();
      } catch (error) {
        console.error("Error fetching appointments:", error);
        return t.statusError();
      }

    case "cancel":
      try {
        // Two steps, so a shared family phone (or a mistyped word) can't cancel the
        // wrong visit: CANCEL lists the upcoming visits of everyone on this number,
        // numbered; CANCEL <n> cancels exactly the one that was shown as n.
        const phoneKey = normalizePhone(phoneNumber);
        if (number) {
          const prompt = await whatsappCancelPromptModel.findById(phoneKey).lean();
          const chosenId = prompt && prompt.expiresAt > new Date() ? prompt.appointmentIds[number - 1] : null;
          if (chosenId) {
            const chosen = await appointmentModel.findOne({ _id: chosenId, userId: { $in: userIds } });
            if (chosen && !chosen.cancelled && !chosen.isCompleted) {
              await cancelAppointment(chosen._id, { role: "patient", id: chosen.userId }, {
                reason: "Cancelled by patient on WhatsApp",
                notifyPatient: false,
              });
              await whatsappCancelPromptModel.deleteOne({ _id: phoneKey });
              return t.cancelled(chosen);
            }
          }
          // No list sent recently, or a number that wasn't on it: show the list (again)
        }
        const upcoming = await appointmentModel
          .find({
            userId: { $in: userIds },
            cancelled: false,
            isCompleted: false,
            status: { $ne: "no_show" },
            startAt: { $gt: new Date() },
          })
          .sort({ startAt: 1 })
          .limit(5);
        if (!upcoming.length) return t.nothingToCancel();
        await whatsappCancelPromptModel.updateOne(
          { _id: phoneKey },
          { $set: { appointmentIds: upcoming.map((a) => String(a._id)), expiresAt: new Date(Date.now() + CANCEL_PROMPT_MS) } },
          { upsert: true }
        );
        return t.cancelChoose(
          upcoming.map((a) => ({ doctor: a.docData?.name, slotDate: a.slotDate, slotTime: a.slotTime, patient: family ? a.userData?.name : "" }))
        );
      } catch (error) {
        console.error("Error cancelling appointment:", error);
        return t.cancelError();
      }

    case "book":
      try {
        // Specialities of this hospital's doctors who are taking patients
        const specialities = await doctorModel.distinct("speciality", { available: true });
        return t.book(specialities.sort());
      } catch (error) {
        console.error("Error loading specialities:", error);
        return t.book([]);
      }
    case "contact":
      return t.contact();
    default:
      return t.help();
  }
};

// Each incoming message is answered once: Kapso and Twilio may deliver the same one
// twice (retries). The first delivery records the message id; later ones are skipped.
const firstDelivery = async (id) => {
  if (!id) return true;
  try {
    await whatsappInboundModel.create({ _id: String(id), expiresAt: new Date(Date.now() + 7 * 86400000) });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

const twimlReply = (res, text) => {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(text);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
};

// Twilio webhook: replies in the HTTP response (TwiML)
export const handleWhatsAppWebhook = async (req, res) => {
  try {
    const { Body, From } = req.body;
    if (!Body || !From) {
      return res.status(400).send('Invalid request');
    }
    if (!(await firstDelivery(req.body.MessageSid && `twilio:${req.body.MessageSid}`))) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return res.end(new twilio.twiml.MessagingResponse().toString()); // already answered
    }
    const reply = await buildBotReply(From.replace('whatsapp:', ''), Body.toLowerCase().trim());
    twimlReply(res, reply);
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    twimlReply(res, `Sorry, there was an error processing your request. Please try again later or contact us directly at ${HOSPITAL_PHONE}.`);
  }
};

// Kapso webhook: verifies the signature, acknowledges at once, then replies via the API.
// The reply is free because it is sent within 24 hours of the patient's message.
export const handleKapsoWebhook = async (req, res) => {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  const signature = req.get('X-Webhook-Signature') || '';
  if (!secret || !req.rawBody) {
    return res.status(500).json({ success: false, message: 'Webhook secret not configured' });
  }
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  res.status(200).json({ received: true });

  if (req.get('X-Webhook-Event') !== 'whatsapp.message.received') return;
  const events = req.body?.batch ? req.body.data || [] : [req.body];
  // After the reply above; on Vercel, waitUntil keeps the function running until done
  background(
    (async () => {
      for (const event of events) {
        const message = event?.message;
        if (message?.type !== 'text' || !message.from || !message.text?.body) continue;
        try {
          if (!(await firstDelivery(message.id && `kapso:${message.id}`))) continue; // already answered
          const reply = await buildBotReply(message.from, message.text.body.toLowerCase().trim());
          await sendWhatsAppText(message.from, reply);
        } catch (error) {
          console.error('Kapso webhook reply failed:', error.message);
        }
      }
    })()
  );
};

// Send WhatsApp reminder
export const sendWhatsAppAppointmentReminder = async (req, res) => {
  try {
    const { phoneNumber, userName, doctorName, appointmentDate, appointmentTime } = req.body;
    
    if (!phoneNumber || !userName || !doctorName || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required for reminder' 
      });
    }
    
    const result = await sendWhatsAppReminder(
      phoneNumber,
      userName,
      doctorName,
      appointmentDate,
      appointmentTime
    );
    
    res.json(result);
  } catch (error) {
    console.error('Send reminder error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Test WhatsApp connection
export const testWhatsApp = async (req, res) => {
  try {
    const testNumber = process.env.TEST_WHATSAPP_NUMBER;
    if (!testNumber) {
      return res.json({ success: false, message: "Set TEST_WHATSAPP_NUMBER in the backend .env" });
    }
    
    const result = await sendWhatsAppConfirmation(
      testNumber,
      "Test User",
      "Test Doctor",
      "General Medicine",
      "1_1_2024",
      "10:00 AM",
      "100"
    );
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: "WhatsApp test message sent successfully",
        messageId: result.messageId 
      });
    } else {
      res.json({ 
        success: false, 
        message: "WhatsApp test failed: " + result.error 
      });
    }
  } catch (error) {
    console.error('WhatsApp test error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};