import mongoose from "mongoose";

// Connection to MongoDB, shared by every request of this process.
//
// On Vercel a new instance can fail to reach Atlas on its first try (seen in the
// logs: "Could not connect to any servers"). The process must not exit then: that
// kills the instance mid-request and fails even requests that don't need the
// database. Instead the connection is retried, and requests wait for it briefly
// (see the database check in expressApp.js), getting a clear 503 if it stays down.
//
//   DB_CONNECT_ATTEMPTS=3          tries per connection round
//   DB_SERVER_TIMEOUT_MS=10000     how long one try waits for a database server
const attempts = () => Math.max(1, Number(process.env.DB_CONNECT_ATTEMPTS) || 3);
const serverTimeout = () => Math.max(500, Number(process.env.DB_SERVER_TIMEOUT_MS) || 10000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let announced = false;
let everConnected = false;
let connecting = null;

// Once connected, the driver reconnects by itself after a network blip: wait for it
const reconnected = () =>
  new Promise((resolve) => mongoose.connection.once("connected", () => resolve(mongoose.connection)));

// Resolves when connected; rejects when every try of this round failed. Calling it
// again after a failure starts a new round (the next request tries again).
const connectDB = () => {
  if (!announced) {
    announced = true;
    mongoose.connection.on("connected", () => {
      everConnected = true;
      console.log("Database Connected");
    });
  }
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (everConnected) return reconnected();
  if (!connecting) {
    connecting = (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          // dbName is passed as an option so connection strings that end with
          // query parameters (as Atlas provides them) still work.
          await mongoose.connect(process.env.MONGODB_URI, {
            dbName: process.env.MONGODB_DB_NAME || "prescripto",
            serverSelectionTimeoutMS: serverTimeout(),
            // Each Vercel instance has its own pool; keep it small so a burst of new
            // instances doesn't use up the cluster's connections (free Atlas: 500)
            ...(process.env.VERCEL && { maxPoolSize: 5 }),
          });
          return mongoose.connection;
        } catch (error) {
          console.error(`Database connection failed (try ${attempt} of ${attempts()}):`, error.message);
          if (attempt >= attempts()) throw error;
          await sleep(500 * attempt);
        }
      }
    })().finally(() => {
      connecting = null;
    });
  }
  return connecting;
};

export default connectDB;
