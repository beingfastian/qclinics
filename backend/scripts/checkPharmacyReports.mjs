// Checks for the pharmacy dashboard and reports: totals that match the bills and
// returns exactly (discounts, refunds, cost, profit), days in Pakistan time (a sale
// at 1:30 am belongs to that day, not the UTC day before), items adding up to the
// bills, staff totals, and who may see what (cashiers: no reports, no cost or
// profit). Through the real expressApp. Run with:
//   npm run check:integration
// Needs a LOCAL MongoDB (CHECK_MONGODB_URI, default 127.0.0.1:27017).
// Uses its own throwaway database and deletes it at the end. Never loads .env.
import path from "path";
import { fileURLToPath } from "url";

const uri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri)) {
  console.error("Refusing to run: the check database must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: path.join(backendDir, "no-such-env-file"),
  MONGODB_URI: uri,
  MONGODB_DB_NAME: "qclinics_pharmreportcheck_" + Date.now(),
  JWT_SECRET: "check-pharmacy-reports-secret",
  ADMIN_EMAIL: "owner@shop.pk",
  ADMIN_PASSWORD: "owner-pass-1",
  WHATSAPP_PROVIDER: "none",
  PHARMACY_ENABLED: "true",
  HOSPITAL_UTC_OFFSET_MINUTES: "300",
  APP_MODE: "",
});

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};

const { default: app } = await import("../expressApp.js");
const mongoose = (await import("mongoose")).default;
const jwt = (await import("jsonwebtoken")).default;
const bcrypt = (await import("bcrypt")).default;
const { pharmacyStaffModel } = await import("../modules/pharmacy/models/staffModel.js");
const { batchModel } = await import("../modules/pharmacy/models/stockModels.js");
const { saleModel, returnModel } = await import("../modules/pharmacy/models/salesModels.js");
const { localDate } = await import("../modules/pharmacy/time.js");

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, headers = {}, body) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body && { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sign = (claims) => jwt.sign(claims, "check-pharmacy-reports-secret", { expiresIn: "1h" });
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// What the reports should say, straight from the documents
const expected = async (match = {}) => {
  const sales = await saleModel.find(match).lean();
  const returns = await returnModel.find(match).lean();
  const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
  const salesPaisa = sum(sales, (s) => s.totalPaisa);
  const refundsPaisa = sum(returns, (r) => r.totalRefundPaisa);
  const costPaisa = sum(sales, (s) => s.costPaisa) - sum(returns, (r) => r.costPaisa);
  return { bills: sales.length, salesPaisa, refundsPaisa, netSalesPaisa: salesPaisa - refundsPaisa, costPaisa, profitPaisa: salesPaisa - refundsPaisa - costPaisa, discountPaisa: sum(sales, (s) => s.discountPaisa) };
};

try {
  await call("GET", "/api/pharmacy/status");
  while (mongoose.connection.readyState !== 1) await new Promise((r) => setTimeout(r, 100));
  const pw = await bcrypt.hash("x-pass-1234", 4);
  const [mgr, cash] = await pharmacyStaffModel.create([
    { name: "Sara", email: "sara@shop.pk", password: pw, role: "manager" },
    { name: "Ali", email: "ali@shop.pk", password: pw, role: "cashier" },
  ]);
  const manager = { ptoken: sign({ id: String(mgr._id), role: "pharmacy" }) };
  const cashier = { ptoken: sign({ id: String(cash._id), role: "pharmacy" }) };
  const owner = { atoken: sign({ email: "owner@shop.pk", role: "admin" }) };

  const product = async (body) => (await call("POST", "/api/pharmacy/products", manager, body)).data.product._id;
  const panadol = await product({ name: "Panadol", unitName: "tablet", packName: "strip", unitsPerPack: 10, unitPricePaisa: 350, packPricePaisa: 3000, reorderLevelUnits: 5 });
  const brufen = await product({ name: "Brufen", unitName: "tablet", unitPricePaisa: 400, reorderLevelUnits: 50 });
  const supplier = (await call("POST", "/api/pharmacy/suppliers", manager, { name: "Supplier" })).data.supplier._id;
  await call("POST", "/api/pharmacy/purchases", manager, {
    supplierId: supplier,
    items: [
      { productId: panadol, batchNo: "P1", expiry: inDays(20), packs: 4, packCostPaisa: 2500 },
      { productId: panadol, batchNo: "P2", expiry: inDays(300), packs: 6, packCostPaisa: 2000 },
      { productId: brufen, batchNo: "B1", expiry: inDays(300), looseUnits: 10, packCostPaisa: 300 },
    ],
  });
  await call("POST", "/api/pharmacy/shifts/open", cashier, { openingCashPaisa: 100000 });
  const sell = async (body) => (await call("POST", "/api/pharmacy/sales", cashier, { paymentMethod: "cash", ...body })).data.sale;
  const billA = await sell({ items: [{ productId: panadol, qtyUnits: 12 }] }); // Rs 37
  const billB = await sell({ items: [{ productId: panadol, qtyUnits: 20 }], discountPaisa: 600, paymentMethod: "card" }); // Rs 54
  const billC = await sell({ items: [{ productId: brufen, qtyUnits: 2 }], paymentMethod: "online" }); // Rs 8
  await call("POST", "/api/pharmacy/returns", cashier, { saleId: billB._id, items: [{ saleItemId: billB.items[0]._id, qtyUnits: 5 }] }); // Rs 13.50 back
  await call("POST", "/api/pharmacy/held", cashier, { items: [{ productId: brufen, qtyUnits: 1 }] });
  const today = localDate();

  // ---------- Summary ----------
  let r = await call("GET", `/api/pharmacy/reports/summary?from=${today}&to=${today}`, manager);
  const t = r.data.totals;
  const want = await expected();
  check("Today: 3 bills, Rs 99 sold, Rs 6 discount", r.status === 200 && t.bills === 3 && t.salesPaisa === 9900 && t.discountPaisa === 600, JSON.stringify(t));
  check("By payment: cash Rs 37, card Rs 54, online Rs 8", t.cashPaisa === 3700 && t.cardPaisa === 5400 && t.onlinePaisa === 800);
  check("Refunds Rs 13.50, net sales Rs 85.50", t.refundsPaisa === 1350 && t.netSalesPaisa === 8550);
  check("Cost and profit match the bills and returns exactly", t.costPaisa === want.costPaisa && t.profitPaisa === want.profitPaisa && t.profitPaisa === 8550 - want.costPaisa, `${t.costPaisa}/${want.costPaisa} ${t.profitPaisa}/${want.profitPaisa}`);
  check("The day's row says the same", r.data.days.length === 1 && r.data.days[0].date === today && r.data.days[0].netSalesPaisa === 8550 && r.data.days[0].profitPaisa === t.profitPaisa);
  check("Staff totals: Ali, 3 bills", r.data.staff.length === 1 && r.data.staff[0].name === "Ali" && r.data.staff[0].bills === 3 && r.data.staff[0].salesPaisa === 9900);

  r = await call("GET", `/api/pharmacy/reports/items?from=${today}&to=${today}`, manager);
  const pan = r.data.items.find((i) => i.productId === panadol);
  check("Panadol: 32 sold, 5 back, Rs 91 after the discount share, Rs 77.50 net", pan?.unitsSold === 32 && pan.unitsReturned === 5 && pan.revenuePaisa === 9100 && pan.netPaisa === 7750, JSON.stringify(pan));
  check("Items add up to the bills (net and profit)", r.data.items.reduce((s, i) => s + i.netPaisa, 0) === 8550 && r.data.items.reduce((s, i) => s + i.profitPaisa, 0) === t.profitPaisa);
  check("Best seller first", r.data.items[0].productId === panadol);
  r = await call("GET", `/api/pharmacy/reports/items?from=${today}&to=${today}&sort=units`, owner);
  check("The owner sees the items report with profit", r.status === 200 && r.data.items.every((i) => typeof i.profitPaisa === "number"));

  // ---------- Who may see what ----------
  r = await call("GET", `/api/pharmacy/reports/summary?from=${today}&to=${today}`, cashier);
  check("A cashier can't open reports", r.status === 403);
  r = await call("GET", "/api/pharmacy/dashboard", cashier);
  const cd = r.data.dashboard;
  check("Cashier's dashboard: their shift, held bills, stock alerts; no takings", r.status === 200 && cd.myShift?.totals?.salesCount === 3 && cd.heldBills === 1 && cd.totals === undefined && cd.stockValue === undefined && cd.myShift.totals.profitPaisa === undefined, JSON.stringify(cd));
  check("Stock alerts: Brufen low, one batch expiring within 30 days", cd.alerts.lowStock === 1 && cd.alerts.expiringSoon === 1 && cd.alerts.expiredOnShelf === 0, JSON.stringify(cd.alerts));

  r = await call("GET", "/api/pharmacy/dashboard", manager);
  const md = r.data.dashboard;
  check("Manager's dashboard: today's takings and profit", md.totals.netSalesPaisa === 8550 && md.totals.profitPaisa === t.profitPaisa);
  check("Open shifts with their sales so far", md.openShifts.length === 1 && md.openShifts[0].name === "Ali" && md.openShifts[0].salesPaisa === 9900);
  check("Top items today", md.topItems[0].name === "Panadol" && md.topItems.length === 2);
  const shelf = (await batchModel.find({ qtyUnits: { $gt: 0 } }).lean()).reduce((s, b) => s + b.qtyUnits * b.costPerUnitPaisa, 0);
  check("Stock value at cost matches the shelf", md.stockValue.valuePaisa === Math.round(shelf) && md.stockValue.expiredPaisa === 0, `${md.stockValue.valuePaisa} vs ${shelf}`);

  // A shortage at closing shows up for the manager
  const cur = (await call("GET", "/api/pharmacy/shifts/current", cashier)).data.shift;
  await call("POST", "/api/pharmacy/shifts/close", cashier, { countedCashPaisa: cur.expectedCashPaisa - 500, note: "Rs 5 short" });
  r = await call("GET", "/api/pharmacy/dashboard", manager);
  check("Closed short: listed on the manager's dashboard", r.data.dashboard.shortages.length === 1 && r.data.dashboard.shortages[0].differencePaisa === -500 && r.data.dashboard.openShifts.length === 0);

  // ---------- Pakistan days ----------
  // Bill A at 01:30 on 15 March in Pakistan (20:30 UTC on the 14th); bill C at 23:30 on the 14th
  await saleModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(billA._id) }, { $set: { createdAt: new Date("2026-03-14T20:30:00Z") } });
  await saleModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(billC._id) }, { $set: { createdAt: new Date("2026-03-14T18:30:00Z") } });
  r = await call("GET", "/api/pharmacy/reports/summary?from=2026-03-15&to=2026-03-15", manager);
  check("A sale at 1:30 am counts on that day in Pakistan, not the UTC day", r.data.totals.bills === 1 && r.data.totals.salesPaisa === 3700, JSON.stringify(r.data.totals));
  r = await call("GET", "/api/pharmacy/reports/summary?from=2026-03-14&to=2026-03-15", manager);
  const d22 = r.data.days.find((d) => d.date === "2026-03-14");
  const d23 = r.data.days.find((d) => d.date === "2026-03-15");
  check("Two days, one row each, in the right day", r.data.days.length === 2 && d22.bills === 1 && d22.salesPaisa === 800 && d23.bills === 1 && d23.salesPaisa === 3700, JSON.stringify(r.data.days));
  r = await call("GET", "/api/pharmacy/reports/summary?from=2026-03-01&to=2026-03-31", manager);
  check("A month: a row for every day, quiet days at zero", r.data.days.length === 31 && r.data.days.filter((d) => d.bills).length >= 2 && r.data.days[0].date === "2026-03-01" && r.data.days[30].date === "2026-03-31");

  // ---------- Bad ranges ----------
  r = await call("GET", "/api/pharmacy/reports/summary?from=2026-10-23&to=2026-10-01", manager);
  check("Start after end: 400", r.status === 400);
  r = await call("GET", "/api/pharmacy/reports/summary?from=2025-01-01&to=2026-10-23", manager);
  check("More than a year: 400", r.status === 400);
  r = await call("GET", "/api/pharmacy/reports/summary?from=2026-02-30&to=2026-03-01", manager);
  check("A date that doesn't exist: 400", r.status === 400);
  r = await call("GET", "/api/pharmacy/reports/summary", manager);
  check("No dates: 400", r.status === 400);
} catch (error) {
  console.log("CRASH  " + (error.stack || error));
  failures++;
} finally {
  server.close();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PHARMACY REPORT CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}
