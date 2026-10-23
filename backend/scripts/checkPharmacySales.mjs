// Checks for the pharmacy counter: shifts (one open per person, cash counted at
// closing), sales (server prices, packs and loose units, discount limits, change,
// stock out earliest expiry first, all or nothing, double submit, many counters at
// once, manager approval to sell beyond stock), held bills, and returns (refund at
// the price paid, never more than sold, stock back to its batches). Through the
// real expressApp. Run with:
//   npm run check:integration
// Needs a LOCAL MongoDB (CHECK_MONGODB_URI, default 127.0.0.1:27017). With --rs it
// runs against CHECK_MONGODB_RS_URI (a replica set: real transactions), or skips.
// Uses its own throwaway database and deletes it at the end. Never loads .env.
import path from "path";
import { fileURLToPath } from "url";

const onReplicaSet = process.argv.includes("--rs");
const uri = onReplicaSet ? process.env.CHECK_MONGODB_RS_URI || "" : process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (onReplicaSet && !uri) {
  console.log("SKIP  pharmacy counter checks on a replica set: set CHECK_MONGODB_RS_URI to run them");
  process.exit(0);
}
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(uri)) {
  console.error("Refusing to run: the check database must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: path.join(backendDir, "no-such-env-file"),
  MONGODB_URI: uri,
  MONGODB_DB_NAME: "qclinics_pharmsalescheck_" + Date.now(),
  JWT_SECRET: "check-pharmacy-sales-secret",
  ADMIN_EMAIL: "owner@shop.pk",
  ADMIN_PASSWORD: "owner-pass-1",
  WHATSAPP_PROVIDER: "none",
  PHARMACY_ENABLED: "true",
  PHARMACY_MAX_DISCOUNT_PERCENT: "",
  APP_MODE: "",
});

const tag = onReplicaSet ? "[replica set] " : "";
let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${tag}${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};

const { default: app } = await import("../expressApp.js");
const mongoose = (await import("mongoose")).default;
const jwt = (await import("jsonwebtoken")).default;
const bcrypt = (await import("bcrypt")).default;
const { pharmacyStaffModel } = await import("../modules/pharmacy/models/staffModel.js");
const { productModel } = await import("../modules/pharmacy/models/productModel.js");
const { batchModel, movementModel } = await import("../modules/pharmacy/models/stockModels.js");
const { saleModel, returnModel, shiftModel } = await import("../modules/pharmacy/models/salesModels.js");
const { supportsTransactions } = await import("../lib/transactions.js");

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, headers = {}, body) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body && { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sign = (claims) => jwt.sign(claims, "check-pharmacy-sales-secret", { expiresIn: "1h" });
const DAY = 86400000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stockOf = async (id) => (await productModel.findById(id).lean()).stockUnits;
const shelfOf = async (id) => (await batchModel.find({ productId: String(id) }).sort({ expiry: 1 }).lean()).map((b) => `${b.batchNo}:${b.qtyUnits}`).join(" ");

// Stock totals must always equal the movement log, and the shelf plus what was sold beyond it
const ledgerHolds = async (productId) => {
  const id = String(productId);
  const product = await productModel.findById(id).lean();
  const sum = async (model, match) => (await model.aggregate([{ $match: match }, { $group: { _id: null, n: { $sum: "$qtyUnits" } } }]))[0]?.n || 0;
  const moved = await sum(movementModel, { productId: id });
  const shelf = await sum(batchModel, { productId: id });
  const oversold = await sum(movementModel, { productId: id, negativeOverride: true });
  return product.stockUnits === moved && product.stockUnits === shelf + oversold;
};

try {
  await call("GET", "/api/pharmacy/status");
  while (mongoose.connection.readyState !== 1) await new Promise((r) => setTimeout(r, 100));
  await Promise.all([productModel.init(), batchModel.init(), movementModel.init(), saleModel.init(), returnModel.init(), shiftModel.init(), pharmacyStaffModel.init()]);
  check(onReplicaSet ? "Running with real transactions" : "Running without transactions (standalone database)", (await supportsTransactions()) === onReplicaSet);
  const pw = await bcrypt.hash("x-pass-1234", 4);
  const [mgr, cash, cash2] = await pharmacyStaffModel.create([
    { name: "Sara", email: "sara@shop.pk", password: pw, role: "manager" },
    { name: "Ali", email: "ali@shop.pk", password: pw, role: "cashier" },
    { name: "Hina", email: "hina@shop.pk", password: pw, role: "cashier" },
  ]);
  const manager = { ptoken: sign({ id: String(mgr._id), role: "pharmacy" }) };
  const cashier = { ptoken: sign({ id: String(cash._id), role: "pharmacy" }) };
  const cashier2 = { ptoken: sign({ id: String(cash2._id), role: "pharmacy" }) };
  const owner = { atoken: sign({ email: "owner@shop.pk", role: "admin" }) };

  // Stock to sell: Panadol (strip of 10: Rs 30, Rs 3.50 a tablet) in two batches,
  // Brufen (single units, Rs 4) with 5 on the shelf
  const product = async (body) => (await call("POST", "/api/pharmacy/products", manager, body)).data.product._id;
  const panadol = await product({ name: "Panadol", salt: "Paracetamol", form: "tablet", unitName: "tablet", packName: "strip", unitsPerPack: 10, unitPricePaisa: 350, packPricePaisa: 3000 });
  const brufen = await product({ name: "Brufen", unitName: "tablet", unitPricePaisa: 400 });
  const supplier = (await call("POST", "/api/pharmacy/suppliers", manager, { name: "Supplier" })).data.supplier._id;
  await call("POST", "/api/pharmacy/purchases", manager, {
    supplierId: supplier,
    items: [
      { productId: panadol, batchNo: "SOON", expiry: inDays(60), packs: 4, packCostPaisa: 2500 },
      { productId: panadol, batchNo: "LATE", expiry: inDays(400), packs: 6, packCostPaisa: 2000 },
      { productId: brufen, batchNo: "B1", expiry: inDays(200), looseUnits: 5, packCostPaisa: 300 },
    ],
  });
  check("Stock ready: 100 Panadol, 5 Brufen", (await stockOf(panadol)) === 100 && (await stockOf(brufen)) === 5);

  // ---------- Shifts ----------
  const sell = (headers, body) => call("POST", "/api/pharmacy/sales", headers, { paymentMethod: "cash", ...body });
  let r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 1 }] });
  check("No sale before the shift is opened", r.status === 409 && r.data.code === "no_shift");
  const opens = await Promise.all([0, 1, 2].map(() => call("POST", "/api/pharmacy/shifts/open", cashier, { openingCashPaisa: 500000 })));
  check("Opening a shift three times at once: one shift", opens.every((x) => x.status === 200) && new Set(opens.map((x) => x.data.shift._id)).size === 1 && (await shiftModel.countDocuments({ status: "open" })) === 1, JSON.stringify(opens.map((x) => x.status)));
  const shiftId = opens[0].data.shift._id;
  r = await call("GET", "/api/pharmacy/shifts/current", cashier);
  check("Current shift: Rs 5,000 opening, expected cash Rs 5,000", r.data.shift?.openingCashPaisa === 500000 && r.data.shift.expectedCashPaisa === 500000);
  await call("POST", "/api/pharmacy/shifts/open", manager, { openingCashPaisa: 0 });

  // ---------- Sales ----------
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 12 }], cashReceivedPaisa: 5000, expectedTotalPaisa: 3700 });
  const sale1 = r.data.sale;
  check("12 tablets = 1 strip (Rs 30) + 2 tablets (Rs 7) = Rs 37", r.status === 200 && sale1.totalPaisa === 3700 && sale1.items[0].lineTotalPaisa === 3700, JSON.stringify(r.data));
  check("Change from Rs 50: Rs 13", sale1?.changePaisa === 1300 && sale1.cashReceivedPaisa === 5000);
  check("Bill numbered 1", sale1?.saleNo === 1);
  check("A cashier's bill has no cost or batches in it", sale1 && sale1.costPaisa === undefined && sale1.items[0].allocations === undefined && sale1.items[0].costPaisa === undefined);
  r = await call("GET", `/api/pharmacy/sales/${sale1._id}`, manager);
  check("Sold from the batch expiring first, costed at its price (12 x Rs 2.50)", r.data.sale.items[0].allocations.length === 1 && r.data.sale.costPaisa === 3000 && (await shelfOf(panadol)) === "SOON:28 LATE:60");
  check("Stock totals equal the movement log after a sale", await ledgerHolds(panadol));

  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 10 }], expectedTotalPaisa: 3500 });
  check("The total changed since the bill was started: refused with the new total", r.status === 409 && r.data.code === "price_changed" && r.data.totalPaisa === 3000);
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 10 }], cashReceivedPaisa: 2000 });
  check("Cash received less than the total: refused", r.status === 400);
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 10 }], discountPaisa: 300 });
  check("Cashier gives 10% off", r.status === 200 && r.data.sale.totalPaisa === 2700 && r.data.sale.changePaisa === 0, JSON.stringify(r.data));
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 10 }], discountPaisa: 301 });
  check("Cashier can't give more than 10%", r.status === 403 && r.data.code === "discount_limit");
  r = await sell(manager, { items: [{ productId: panadol, qtyUnits: 10 }], discountPaisa: 1500, paymentMethod: "card", cashReceivedPaisa: 99999 });
  check("Manager gives 50% off; a card payment has no change", r.status === 200 && r.data.sale.totalPaisa === 1500 && r.data.sale.changePaisa === 0 && r.data.sale.cashReceivedPaisa === 1500);
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 3 }, { productId: panadol, qtyUnits: 7 }] });
  check("The same item twice in a bill is one line (3 + 7 = a strip)", r.data.sale?.items.length === 1 && r.data.sale.totalPaisa === 3000);

  // All or nothing
  let stockBefore = await stockOf(panadol);
  let shelfBefore = await shelfOf(panadol);
  const salesBefore = await saleModel.countDocuments();
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 2 }, { productId: brufen, qtyUnits: 9 }] });
  check("Not enough Brufen: refused, saying how many there are", r.status === 409 && r.data.code === "insufficient_stock" && r.data.availableUnits === 5 && r.data.productId === brufen);
  check("A refused bill changes nothing (not even the line that was in stock)",
    (await stockOf(panadol)) === stockBefore && (await shelfOf(panadol)) === shelfBefore && (await stockOf(brufen)) === 5 && (await saleModel.countDocuments()) === salesBefore && (await ledgerHolds(panadol)));

  // Selling beyond the stock: a manager has to allow it
  r = await sell(cashier, { items: [{ productId: brufen, qtyUnits: 7 }], allowNegative: true });
  check("Cashier asks to sell beyond stock without a manager: refused", r.status === 403 && r.data.code === "approval_needed");
  r = await sell(cashier, { items: [{ productId: brufen, qtyUnits: 7 }], allowNegative: true, managerApproval: { email: "hina@shop.pk", password: "x-pass-1234" } });
  check("Another cashier's password doesn't count as approval", r.status === 403 && r.data.code === "approval_refused");
  r = await sell(cashier, { items: [{ productId: brufen, qtyUnits: 7 }], allowNegative: true, managerApproval: { email: "sara@shop.pk", password: "wrong-pass" } });
  check("Wrong manager password: refused", r.status === 403);
  r = await sell(cashier, { items: [{ productId: brufen, qtyUnits: 7 }], allowNegative: true, managerApproval: { email: "SARA@shop.pk", password: "x-pass-1234" } });
  const overSale = r.data.sale;
  check("Manager approves at the counter: 7 sold with 5 on the shelf", r.status === 200 && (await stockOf(brufen)) === -2, JSON.stringify(r.data));
  const overDoc = await saleModel.findById(overSale._id).lean();
  check("The bill records who allowed it", overDoc.negativeOverride === true && overDoc.approvedBy?.name === "Sara" && overDoc.by.name === "Ali");
  check("Stock totals equal the movement log after selling beyond stock", await ledgerHolds(brufen));

  // Double submit
  stockBefore = await stockOf(panadol);
  const same = { items: [{ productId: panadol, qtyUnits: 2 }], requestId: "sale-request-0001" };
  const twice = await Promise.all([0, 1, 2].map(() => sell(cashier, same)));
  const later = await sell(cashier, same);
  check("Double submit (at once and later): one bill, stock taken once",
    [...twice, later].every((x) => x.status === 200) && new Set([...twice, later].map((x) => x.data.sale._id)).size === 1 &&
    (await stockOf(panadol)) === stockBefore - 2 && (await saleModel.countDocuments({ requestId: "sale-request-0001" })) === 1,
    JSON.stringify(twice.map((x) => x.status)));
  check("Stock totals equal the movement log after a double submit", await ledgerHolds(panadol));

  // Many counters at once
  await call("POST", "/api/pharmacy/shifts/open", cashier2, { openingCashPaisa: 0 });
  const rush = await product({ name: "Rush Item", unitName: "tablet", unitPricePaisa: 100 });
  await call("POST", "/api/pharmacy/purchases", manager, {
    supplierId: supplier,
    items: [
      { productId: rush, batchNo: "R1", expiry: inDays(90), looseUnits: 9, packCostPaisa: 50 },
      { productId: rush, batchNo: "R2", expiry: inDays(300), looseUnits: 11, packCostPaisa: 60 },
    ],
  });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => sell(i % 2 ? cashier : cashier2, { items: [{ productId: rush, qtyUnits: 3 }] })));
  const sold = results.filter((x) => x.status === 200);
  check("10 bills at once, 20 in stock, 3 each: exactly 6 go through, the rest told the stock", sold.length === 6 && results.filter((x) => x.status === 409).every((x) => x.data.code === "insufficient_stock"), JSON.stringify(results.map((x) => x.status)));
  check("Nothing below zero, 2 left, bill numbers all different", (await stockOf(rush)) === 2 && (await batchModel.find({ productId: rush }).lean()).every((b) => b.qtyUnits >= 0) && new Set(sold.map((x) => x.data.sale.saleNo)).size === 6);
  check("Stock totals equal the movement log after the rush", await ledgerHolds(rush));

  await call("PUT", `/api/pharmacy/products/${rush}`, manager, { active: false });
  r = await sell(cashier, { items: [{ productId: rush, qtyUnits: 1 }] });
  check("A turned-off item can't be sold", r.status === 409 && r.data.code === "item_gone");

  // ---------- Held bills ----------
  r = await call("POST", "/api/pharmacy/held", cashier, { label: "Man in blue", items: [{ productId: panadol, qtyUnits: 12 }] });
  check("Bill held with its total", r.status === 200 && r.data.held.totalPaisa === 3700);
  const heldId = r.data.held._id;
  r = await call("GET", "/api/pharmacy/held", cashier2);
  check("Held bills show at every counter", r.data.held.some((h) => h._id === heldId && h.label === "Man in blue"));
  const takes = await Promise.all([cashier, cashier2].map((h) => call("POST", `/api/pharmacy/held/${heldId}/take`, h)));
  check("Two counters pick up the same held bill: only one gets it", takes.filter((x) => x.status === 200).length === 1 && takes.some((x) => x.status === 404));

  // ---------- Returns ----------
  // Rs 60 for 20 tablets, 10% off: Rs 54 paid
  const stockBeforeBill = await stockOf(panadol);
  const billed = (await sell(cashier, { items: [{ productId: panadol, qtyUnits: 20 }], discountPaisa: 600, cashReceivedPaisa: 5400 })).data.sale;
  const line = billed.items[0];
  const shelfAtSale = await shelfOf(panadol);
  const ret = (headers, items, extra = {}) => call("POST", "/api/pharmacy/returns", headers, { saleId: billed._id, items, ...extra });
  r = await call("GET", `/api/pharmacy/sales/no/${billed.saleNo}`, cashier2);
  check("Another counter finds the bill by its number", r.data.sale?._id === billed._id);
  r = await ret(cashier2, [{ saleItemId: line._id, qtyUnits: 5 }]);
  check("Return 5 of 20: refund Rs 13.50 (the price paid, after the discount)", r.status === 200 && r.data.return.totalRefundPaisa === 1350, JSON.stringify(r.data));
  check("Returned stock goes back to the batch it came from", (await shelfOf(panadol)) !== shelfAtSale && (await ledgerHolds(panadol)));
  r = await ret(cashier2, [{ saleItemId: line._id, qtyUnits: 16 }]);
  check("Can't return more than is left on the bill (15)", r.status === 409 && r.data.code === "over_return" && r.data.returnableUnits === 15);
  const racing = await Promise.all([0, 1].map(() => ret(cashier, [{ saleItemId: line._id, qtyUnits: 15 }])));
  check("The rest returned at two counters at once: only one refund", racing.filter((x) => x.status === 200).length === 1 && racing.some((x) => x.status === 409), JSON.stringify(racing.map((x) => x.status)));
  const billedNow = await saleModel.findById(billed._id).lean();
  check("Refunds add up to exactly what was paid", billedNow.refundedPaisa === 5400 && billedNow.items[0].returnedUnits === 20);
  check("The whole bill back on the shelf: stock as before the sale", (await stockOf(panadol)) === stockBeforeBill && (await ledgerHolds(panadol)));
  r = await call("POST", "/api/pharmacy/returns", cashier, { saleId: overSale._id, items: [{ saleItemId: overSale.items[0]._id, qtyUnits: 7 }] });
  check("Returning stock that was sold beyond the shelf undoes the shortfall", r.status === 200 && (await stockOf(brufen)) === 5 && (await ledgerHolds(brufen)));
  const once = { requestId: "return-request-001" };
  const sale9 = (await sell(cashier, { items: [{ productId: panadol, qtyUnits: 4 }] })).data.sale;
  const retTwice = await Promise.all([0, 1].map(() => call("POST", "/api/pharmacy/returns", cashier, { saleId: sale9._id, items: [{ saleItemId: sale9.items[0]._id, qtyUnits: 1 }], ...once })));
  check("Return double submit: one return", new Set(retTwice.map((x) => x.data.return?._id)).size === 1 && (await returnModel.countDocuments({ requestId: "return-request-001" })) === 1, JSON.stringify(retTwice.map((x) => x.status)));

  r = await call("POST", "/api/pharmacy/returns", cashier, { items: [{ productId: brufen, qtyUnits: 1 }], reason: "x" });
  check("A cashier can't take a return without a bill", r.status === 403);
  r = await call("POST", "/api/pharmacy/returns", manager, { items: [{ productId: brufen, qtyUnits: 1 }] });
  check("A return without a bill needs a reason", r.status === 400);
  r = await call("POST", "/api/pharmacy/returns", manager, { items: [{ productId: brufen, qtyUnits: 2 }], reason: "Bill lost, regular customer" });
  check("Manager: return without a bill at today's price (2 x Rs 4)", r.status === 200 && r.data.return.totalRefundPaisa === 800 && r.data.return.withoutBill && (await stockOf(brufen)) === 7 && (await ledgerHolds(brufen)));

  // ---------- Lists and closing ----------
  r = await call("GET", "/api/pharmacy/sales", cashier);
  check("A cashier's sales list: their own shift only", r.status === 200 && r.data.sales.length > 0 && r.data.sales.every((s) => s.shiftId === shiftId && s.costPaisa === undefined));
  r = await call("GET", "/api/pharmacy/shifts", cashier);
  check("A cashier can't list every shift", r.status === 403);

  const cur = (await call("GET", "/api/pharmacy/shifts/current", cashier)).data.shift;
  const cashSales = (await saleModel.find({ shiftId, paymentMethod: "cash" }).lean()).reduce((s, x) => s + x.totalPaisa, 0);
  const refunds = (await returnModel.find({ shiftId }).lean()).reduce((s, x) => s + x.totalRefundPaisa, 0);
  check("Expected cash = opening + cash sales - refunds", cur.expectedCashPaisa === 500000 + cashSales - refunds && cur.totals.refundsPaisa === refunds, JSON.stringify(cur));
  check("A cashier's shift has no profit in it", cur.totals.profitPaisa === undefined);
  r = await call("POST", "/api/pharmacy/shifts/close", cashier, { countedCashPaisa: cur.expectedCashPaisa - 1000, note: "Rs 10 short" });
  check("Closing with Rs 10 less than expected records the shortage", r.status === 200 && r.data.shift.differencePaisa === -1000 && r.data.shift.status === "closed");
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 1 }] });
  check("No sale after the shift is closed", r.status === 409 && r.data.code === "no_shift");
  r = await call("POST", "/api/pharmacy/shifts/close", cashier, { countedCashPaisa: 0 });
  check("Closing twice: refused", r.status === 409);
  r = await call("GET", "/api/pharmacy/shifts", manager);
  const closed = r.data.shifts.find((s) => s._id === shiftId);
  check("Manager sees the closed shift with its shortage and profit", closed?.differencePaisa === -1000 && typeof closed.totals.profitPaisa === "number" && closed.closeNote === "Rs 10 short");
  r = await call("GET", "/api/pharmacy/shifts/current", owner);
  check("The owner has their own shift (none open yet)", r.status === 200 && r.data.shift === null);
  r = await call("POST", "/api/pharmacy/shifts/open", cashier, { openingCashPaisa: 100 });
  check("A new shift can be opened after closing", r.status === 200 && r.data.shift._id !== shiftId);
  for (const id of [panadol, brufen, rush]) check(`Stock totals equal the movement log at the end (${id.slice(-4)})`, await ledgerHolds(id));
} catch (error) {
  console.log("CRASH  " + (error.stack || error));
  failures++;
} finally {
  server.close();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : `\nALL PHARMACY COUNTER CHECKS PASSED${onReplicaSet ? " (replica set)" : ""}`);
  process.exit(failures ? 1 : 0);
}
