import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { FaPrint, FaCheckCircle } from "react-icons/fa";
import { HOSPITAL_ADDRESS, HOSPITAL_NAME, HOSPITAL_NAME_URDU, HOSPITAL_PHONE } from "../config";

// The patient's copy: a small slip printed on 80mm thermal paper (what receptions
// usually have) or any printer the browser's print dialog offers. It opens a
// window, writes the slip, prints and closes.
//
// Each slip has English and Urdu lines: many patients (or the family member with
// them) read Urdu but not English. Hospital details come from admin/src/config.js.
const HOSPITAL = {
  name: HOSPITAL_NAME,
  nameUrdu: HOSPITAL_NAME_URDU,
  address: HOSPITAL_ADDRESS,
  phone: HOSPITAL_PHONE,
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Free follow-ups are a real thing here (FOLLOW_UP_FREE_DAYS), but a missing
// fee should never print as "Free" — it means we don't know.
const feeText = (fee) =>
  typeof fee === "number" ? (fee > 0 ? `Rs. ${fee}` : "Free") : "See at counter";

const SLIP_STYLE = `
  @page { margin: 4mm; }
  body { width: 66mm; margin: 0; font-family: "Courier New", monospace; font-size: 12px; color: #000; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 2px; text-transform: uppercase; letter-spacing: 1px; }
  .ur { font-family: "Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Urdu Typesetting", "Arial", sans-serif; direction: rtl; font-size: 12px; }
  span.ur { display: inline-block; letter-spacing: 0; text-transform: none; }
  .center { text-align: center; }
  .addr { text-align: center; font-size: 10px; margin-bottom: 6px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .type { text-align: center; font-weight: bold; text-transform: uppercase; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; margin: 3px 0; }
  .k { color: #333; }
  .v { font-weight: bold; text-align: right; }
  .foot { text-align: center; font-size: 10px; margin-top: 8px; }
  .token { text-align: center; font-size: 56px; font-weight: bold; line-height: 1; margin: 6px 0 2px; font-family: Arial, sans-serif; }
  .urgent { text-align: center; font-weight: bold; border: 2px solid #000; padding: 2px; margin: 4px 0; }
  .qr { text-align: center; margin-top: 6px; }
  .qr img { width: 34mm; height: 34mm; }
  .small { font-size: 9px; word-break: break-all; text-align: center; }
`;

// Open the print window at once (still inside the click, so it isn't blocked as a
// popup), then fill it — possibly after async work like drawing a QR code.
// Returns null when the popup was blocked.
export const openPrintWindow = () => window.open("", "_blank", "width=380,height=680");

const writeAndPrint = async (win, title, bodyHtml) => {
  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${SLIP_STYLE}</style>
</head>
<body>${bodyHtml}</body>
</html>`);
  win.document.close();
  // Let images (the QR code) finish decoding before the print dialog
  await Promise.all([...win.document.images].map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
  win.focus();
  // Close the window once the print dialog is done (Chrome/Firefox/Edge)
  win.onafterprint = () => win.close();
  win.print();
};

const header = () => `
  <h1>${escapeHtml(HOSPITAL.name)}</h1>
  ${HOSPITAL.nameUrdu ? `<div class="center ur">${escapeHtml(HOSPITAL.nameUrdu)}</div>` : ""}
  <div class="addr">${HOSPITAL.address ? `${escapeHtml(HOSPITAL.address)}<br>` : ""}Ph: ${escapeHtml(HOSPITAL.phone)}</div>
  <hr>`;

const row = (label, value) =>
  `<div class="row"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;

// details: { patientName, doctorName, speciality, dateText, time, fee }
// Returns false when the popup was blocked so the caller can tell the user.
export const printAppointmentSlip = (details) => {
  const win = openPrintWindow();
  if (!win) return false;
  writeAndPrint(
    win,
    "Appointment Slip",
    `${header()}
  <div class="type">Appointment Slip</div>
  <div class="center ur">اپائنٹمنٹ کی پرچی</div>
  ${row("Patient", details.patientName)}
  ${row("Doctor", `Dr. ${details.doctorName}`)}
  ${details.speciality ? row("Speciality", details.speciality) : ""}
  ${row("Date", details.dateText)}
  ${row("Time", details.time)}
  ${row("Fee", feeText(details.fee))}
  <hr>
  <div class="foot">Please arrive 15 minutes early.<br>Keep this slip for your next visit.</div>
  <div class="foot ur">براہ کرم 15 منٹ پہلے تشریف لائیں۔ اگلی بار یہ پرچی ساتھ لائیں۔</div>`
  );
  return true;
};

// The patient takes this to the lab, so the lab finds the request quickly.
// details: { orderNumber, patientName, doctorName, tests: [{ name, sampleType }], urgent, when }
export const printLabRequestSlip = (details, win = openPrintWindow()) => {
  if (!win || win.closed) return false;
  const tests = (details.tests || [])
    .map((t) => `<div class="row"><span>• ${escapeHtml(t.name)}</span><span class="k">${escapeHtml(t.sampleType || "")}</span></div>`)
    .join("");
  writeAndPrint(
    win,
    `Lab request L-${details.orderNumber}`,
    `${header()}
  <div class="type">Lab Request / <span class="ur">لیبارٹری کی پرچی</span></div>
  <div class="token" style="font-size:32px">L-${escapeHtml(details.orderNumber)}</div>
  ${details.urgent ? `<div class="urgent">URGENT / <span class="ur">فوری</span></div>` : ""}
  ${row("Patient", details.patientName)}
  ${row("Doctor", `Dr. ${details.doctorName}`)}
  ${row("Date", details.when)}
  <hr>
  ${tests}
  <hr>
  <div class="foot">Take this slip to the lab to give your samples.</div>
  <div class="foot ur">یہ پرچی لیبارٹری میں دکھا کر سیمپل دیں۔</div>`
  );
  return true;
};

// The receipt part of a slip. receipt: a payment from the billing API
// ({ receiptNo, items, gross, discount, discountAllowedBy, net, method, reference,
//    collectedBy, collectedAt, patient, labOrderNumber })
const METHOD_TEXT = { cash: "Cash", bank_transfer: "Bank transfer" };
const receiptHtml = (receipt) => `
  <hr>
  <div class="type">Receipt / <span class="ur">رسید</span></div>
  ${row("Receipt no.", receipt.receiptNo)}
  ${receipt.labOrderNumber ? row("Lab request", `L-${receipt.labOrderNumber}`) : ""}
  ${(receipt.items || []).map((i) => row(i.label, `Rs. ${i.amount}`)).join("")}
  ${
    receipt.discount > 0
      ? `${row("Discount", `- Rs. ${receipt.discount}`)}${
          receipt.discountAllowedBy?.name ? `<div class="foot" style="margin-top:0;text-align:right">allowed by Dr. ${escapeHtml(receipt.discountAllowedBy.name)}</div>` : ""
        }`
      : ""
  }
  <div class="row" style="font-size:14px"><span class="k">Paid / <span class="ur">ادا شدہ</span></span><span class="v">Rs. ${escapeHtml(receipt.net)}</span></div>
  ${row("Method", `${METHOD_TEXT[receipt.method] || receipt.method}${receipt.reference ? ` (${receipt.reference})` : ""}`)}
  ${row("Received by", receipt.collectedBy?.name || "")}
  ${row("Time", new Date(receipt.collectedAt).toLocaleString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }))}`;

// A receipt on its own (lab charges, or printing one again)
export const printReceiptSlip = (receipt, win = openPrintWindow()) => {
  if (!win || win.closed) return false;
  writeAndPrint(
    win,
    `Receipt ${receipt.receiptNo}`,
    `${header()}
  ${row("Patient", receipt.patient?.name || "")}
  ${receipt.doctorName ? row("Doctor", `Dr. ${receipt.doctorName}`) : ""}
  ${receiptHtml(receipt)}
  <hr>
  <div class="foot">Thank you. Please keep this receipt.</div>
  <div class="foot ur">شکریہ۔ یہ رسید سنبھال کر رکھیں۔</div>`
  ).catch(() => win.close());
  return true;
};

// The patient's prescription. rx: { rxNo, patient, doctor, items, note, createdAt }
export const printPrescriptionSlip = (rx, win = openPrintWindow()) => {
  if (!win || win.closed) return false;
  const lines = (rx.items || [])
    .map((m, i) => {
      const how = [m.dose, m.days ? `${m.days} days` : "", m.qtyUnits ? `(${m.qtyUnits})` : ""].filter(Boolean).join(" × ").replace(" × (", " (");
      return `<div style="margin:4px 0"><b>${i + 1}. ${escapeHtml([m.name, m.strength].filter(Boolean).join(" "))}</b>
        ${how ? `<div>${escapeHtml(how)}</div>` : ""}${m.instructions ? `<div class="k">${escapeHtml(m.instructions)}</div>` : ""}</div>`;
    })
    .join("");
  const age = rx.patient?.age || "";
  writeAndPrint(
    win,
    `Prescription Rx-${rx.rxNo}`,
    `${header()}
  <div class="type">Prescription / <span class="ur">نسخہ</span></div>
  ${row("Rx", `Rx-${rx.rxNo}`)}
  ${row("Patient", `${rx.patient?.name || ""}${age ? `, ${age}` : ""}`)}
  ${row("Doctor", `Dr. ${rx.doctor?.name || ""}`)}
  ${row("Date", new Date(rx.createdAt || Date.now()).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }))}
  <hr>
  ${lines}
  ${rx.note ? `<hr><div>${escapeHtml(rx.note)}</div>` : ""}
  <hr>
  <div class="foot">Take medicines as written. Ask the doctor before stopping.</div>
  <div class="foot ur">دوا لکھے ہوئے طریقے سے لیں۔ بند کرنے سے پہلے ڈاکٹر سے پوچھیں۔</div>`
  ).catch(() => win.close());
  return true;
};

// details: { number, patientName, doctorName, dateText, issuedTime, ahead, waitMinutes, urgent, trackUrl, receipt? }
// receipt (optional): the payment, printed under the token on the same slip
// win: a window from openPrintWindow() opened earlier in the click (e.g. before
// an API call), so the browser doesn't block it
export const printTokenSlip = (details, win = openPrintWindow()) => {
  if (!win || win.closed) return false;
  (async () => {
    let qr = "";
    if (details.trackUrl) {
      try {
        qr = await QRCode.toDataURL(details.trackUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" });
      } catch {
        qr = "";
      }
    }
    const wait =
      typeof details.ahead === "number"
        ? `${details.ahead} ahead · about ${details.waitMinutes} min`
        : "";
    await writeAndPrint(
      win,
      `Token ${details.number}`,
      `${header()}
  <div class="type">Token / <span class="ur">ٹوکن نمبر</span></div>
  <div class="token">${escapeHtml(details.number)}</div>
  ${details.urgent ? `<div class="urgent">URGENT / <span class="ur">فوری</span></div>` : ""}
  ${row("Doctor", `Dr. ${details.doctorName}`)}
  ${row("Patient", details.patientName)}
  ${row("Date", details.dateText)}
  ${row("Issued", details.issuedTime)}
  ${wait ? row("Wait", wait) : ""}
  ${details.receipt ? receiptHtml(details.receipt) : ""}
  <hr>
  <div class="foot">Wait for your number to be called.<br>If you step out, come back before your turn.</div>
  <div class="foot ur">اپنا نمبر پکارے جانے کا انتظار کریں۔ باہر جائیں تو اپنی باری سے پہلے واپس آ جائیں۔</div>
  ${
    qr
      ? `<div class="qr"><img src="${qr}" alt=""></div>
  <div class="foot">Scan to see your turn on a phone</div>
  <div class="foot ur">اپنی باری فون پر دیکھنے کے لیے اسکین کریں</div>
  <div class="small">${escapeHtml(details.trackUrl)}</div>`
      : ""
  }`
    );
  })().catch(() => win.close());
  return true;
};

// Shown after a booking/follow-up is saved: summary + Print slip + Done.
// details: { patientName, doctorName, speciality, dateText, time, fee }
const PrintSlipDialog = ({ title = "Appointment booked", details, onClose }) => {
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handlePrint = () => {
    if (!printAppointmentSlip(details)) {
      setError("The print window was blocked. Allow pop-ups for this site and try again.");
    }
  };

  const rows = [
    ["Patient", details.patientName],
    ["Doctor", `Dr. ${details.doctorName}`],
    ...(details.speciality ? [["Speciality", details.speciality]] : []),
    ["Date", details.dateText],
    ["Time", details.time],
    ["Fee", feeText(details.fee)],
  ];

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-slip-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 flex items-center gap-2">
          <FaCheckCircle className="text-green-600 text-xl" />
          <h2 id="print-slip-title" className="text-lg font-semibold text-gray-900">{title}</h2>
        </div>

        <div className="p-5 space-y-1.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-gray-500">{label}</span>
              <span className="font-medium text-gray-900">{value}</span>
            </div>
          ))}
          <p className="text-xs text-gray-500 pt-2">
            The patient also gets a WhatsApp message (if enabled). The slip gets them
            through the door faster on their next visit.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Done
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-700 text-white font-medium hover:bg-primary-800"
          >
            <FaPrint />
            Print slip
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintSlipDialog;
