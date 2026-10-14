// Always-on server (Railway, Render, local): the Express app from expressApp.js,
// plus live updates (Socket.IO) and the reminder timer. Vercel uses api/index.js.
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import app, { corsOptions } from "./expressApp.js";
import { labStaffModel } from "./model/labModel.js";
import { getWhatsAppProvider } from "./config/whatsappService.js";
import { startReminderScheduler } from "./jobs/reminders.js";

const port = process.env.PORT || 4000;
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { ...corsOptions, methods: ["GET", "POST"] }
});

// Make io accessible to routes
app.set("io", io);

// Socket.IO: the client sends its token, and the server decides the room.
// Admins join "admin"; doctors join "doctor_<id>"; lab staff join "lab".
io.use(async (socket, next) => {
  try {
    const decoded = jwt.verify(socket.handshake.auth?.token || "", process.env.JWT_SECRET);
    if (decoded.role === "admin") {
      socket.data.room = "admin";
    } else if (decoded.role === "doctor" && decoded.id) {
      socket.data.room = `doctor_${decoded.id}`;
    } else if (decoded.role === "lab" && decoded.id) {
      // Turned-off lab accounts get no live alerts
      if (!(await labStaffModel.exists({ _id: decoded.id, active: true }))) return next(new Error("Unauthorized"));
      socket.data.room = "lab";
    } else {
      return next(new Error("Unauthorized"));
    }
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(socket.data.room);
});

server.listen(port, () => {
  console.log("Server Started on port", port);
  console.log("WhatsApp provider:", getWhatsAppProvider() || "not configured");
  startReminderScheduler();
});
