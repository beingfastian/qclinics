// Checks that the app's emails really go out over SMTP the way they do with Gmail:
// login (AUTH PLAIN), pooled connections, several emails at once, HTML escaping of
// staff-typed names, and a failing mail server reported as { success: false }
// instead of crashing. A tiny fake SMTP server stands in for Gmail, so nothing is
// sent anywhere. Run with: npm run check:integration
import net from "net";

// --- Fake SMTP server (just enough of the protocol for nodemailer) ---
const received = [];
let refuseAuth = false;
const sockets = new Set();
const smtp = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  let buffer = "";
  let inData = false;
  let mail = { from: "", to: [], data: "" };
  const reply = (line) => socket.write(line + "\r\n");
  reply("220 fake.smtp ESMTP ready");
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          received.push(mail);
          mail = { from: "", to: [], data: "" };
          reply("250 OK queued");
        } else {
          mail.data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
        }
        continue;
      }
      const command = line.slice(0, 4).toUpperCase();
      if (command === "EHLO") reply("250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME");
      else if (command === "HELO") reply("250 fake.smtp");
      else if (command === "AUTH") {
        const [, , encoded] = line.split(" ");
        const [, user, pass] = Buffer.from(encoded || "", "base64").toString().split("\0");
        reply(!refuseAuth && user === "hospital@gmail.com" && pass === "app-password" ? "235 Accepted" : "535 Authentication failed");
      } else if (command === "MAIL") { mail.from = line; reply("250 OK"); }
      else if (command === "RCPT") { mail.to.push(line); reply("250 OK"); }
      else if (command === "DATA") { inData = true; reply("354 Go ahead"); }
      else if (command === "RSET" || command === "NOOP") reply("250 OK");
      else if (command === "QUIT") { reply("221 Bye"); socket.end(); }
      else reply("502 Not implemented");
    }
  });
  socket.on("error", () => {});
});
await new Promise((resolve) => smtp.listen(0, "127.0.0.1", resolve));

process.env.EMAIL_HOST = "127.0.0.1";
process.env.EMAIL_PORT = String(smtp.address().port);
process.env.EMAIL_SECURE = "false";
process.env.EMAIL_USER = "hospital@gmail.com";
process.env.EMAIL_PASS = "app-password";
process.env.EMAIL_FROM = '"Haram Medical Complex (HMC)" <hospital@gmail.com>';

const email = await import("../config/emailService.js");
const { sendOTPEmail } = await import("../config/nodemailer.js");

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};
// Quoted-printable / base64 bodies: compare on decoded-ish text
const body = (mail) => mail.data.replace(/=\r?\n/g, "").replace(/=3D/g, "=");

try {
  check("Mail server connection check passes", (await email.testEmailConnection()) === true);

  let r = await sendOTPEmail("doctor@hmc.com", "482913");
  check("Password reset code email is sent", r.success === true, JSON.stringify(r));
  const otpMail = received.at(-1);
  check("Sent to the right address", /doctor@hmc\.com/.test(otpMail?.to.join(" ") || ""), JSON.stringify(otpMail?.to));
  check("The code is in the email", body(otpMail || { data: "" }).includes("482913"));

  r = await email.sendUserAppointmentConfirmation(
    "patient@example.com", "<script>alert(1)</script> Ali", "Sana", "Gynecologist", "21_10_2026", "10:30 AM", 1500
  );
  check("Appointment confirmation is sent", r.success === true && Boolean(r.messageId), JSON.stringify(r));
  const confirmation = body(received.at(-1));
  check("Staff-typed names are HTML-escaped", !confirmation.includes("<script>alert(1)</script>") && confirmation.includes("&lt;script&gt;"));

  // Several at once over the pool (maxConnections: 2), like a burst of bookings
  const before = received.length;
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      email.sendDoctorAppointmentNotification(`doc${i}@hmc.com`, "Sana", `Patient ${i}`, "p@example.com", "21_10_2026", "11:00 AM", 1000)
    )
  );
  check("6 emails at once all go out over the pooled connections", results.every((x) => x.success) && received.length - before === 6, JSON.stringify(results));

  // The mail server drops idle connections (as Gmail does) and then refuses the
  // login: the app reconnects, and the failure is reported, never thrown
  refuseAuth = true;
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => setTimeout(resolve, 200));
  r = await email.sendUserAppointmentConfirmation("patient@example.com", "Ali", "Sana", "Gynecologist", "21_10_2026", "10:30 AM", 1500);
  check("A refused login is reported as failed, not thrown", r.success === false && /535|auth/i.test(r.error || ""), JSON.stringify(r));
} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  email.createTransporter()?.close();
  smtp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL EMAIL CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
