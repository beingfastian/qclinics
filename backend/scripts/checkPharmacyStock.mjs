// Checks for pharmacy stock: items (search, barcodes, substitutes, cost hidden from
// cashiers), suppliers, purchases (packs, loose units, bonus, discount, idempotent),
// and the stock engine every sale will use (earliest expiry first, expired never
// sold, never below zero under concurrency, manager override logged, totals always
// equal the movement log). Through the real expressApp. Run with:
//   npm run check:integration
// Needs a LOCAL MongoDB (CHECK_MONGODB_URI, default 127.0.0.1:27017). With --rs it
// runs against CHECK_MONGODB_RS_URI (a replica set: real transactions), or skips.
// Uses its own throwaway database and deletes it at the end. Never loads .env.
import path from "path";
import { fileURLToPath } from "url";

const onReplicaSet = process.argv.includes("--rs");
const uri = onReplicaSet ? process.env.CHECK_MONGODB_RS_URI || "" : process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (onReplicaSet && !uri) {
  console.log("SKIP  pharmacy stock checks on a replica set: set CHECK_MONGODB_RS_URI to run them");
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
  MONGODB_DB_NAME: "qclinics_pharmstockcheck_" + Date.now(),
  JWT_SECRET: "check-pharmacy-stock-secret",
  ADMIN_EMAIL: "owner@shop.pk",
  ADMIN_PASSWORD: "owner-pass-1",
  WHATSAPP_PROVIDER: "none",
  PHARMACY_ENABLED: "true",
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
const { purchaseModel } = await import("../modules/pharmacy/models/purchaseModels.js");
const { takeStock, sellableUnits } = await import("../modules/pharmacy/services/stockService.js");
const { inTransaction, supportsTransactions } = await import("../lib/transactions.js");

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, headers = {}, body) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body && { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sign = (claims) => jwt.sign(claims, "check-pharmacy-stock-secret", { expiresIn: "1h" });
const DAY = 86400000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

// Stock totals must always equal the movement log (and the shelf, when nothing was oversold)
const ledgerHolds = async (productId) => {
  const product = await productModel.findById(productId).lean();
  const [moved] = await movementModel.aggregate([{ $match: { productId: String(productId) } }, { $group: { _id: null, n: { $sum: "$qtyUnits" } } }]);
  const [shelf] = await batchModel.aggregate([{ $match: { productId: String(productId) } }, { $group: { _id: null, n: { $sum: "$qtyUnits" } } }]);
  const [oversold] = await movementModel.aggregate([{ $match: { productId: String(productId), negativeOverride: true } }, { $group: { _id: null, n: { $sum: "$qtyUnits" } } }]);
  return product.stockUnits === (moved?.n || 0) && product.stockUnits === (shelf?.n || 0) + (oversold?.n || 0);
};

try {
  await call("GET", "/api/pharmacy/status");
  while (mongoose.connection.readyState !== 1) await new Promise((r) => setTimeout(r, 100));
  await Promise.all([productModel.init(), purchaseModel.init(), batchModel.init(), movementModel.init(), pharmacyStaffModel.init()]);
  check(onReplicaSet ? "Running with real transactions" : "Running without transactions (standalone database)", (await supportsTransactions()) === onReplicaSet);
  const pw = await bcrypt.hash("x-pass-1234", 4);
  const [mgr, cash] = await pharmacyStaffModel.create([
    { name: "Sara", email: "sara@shop.pk", password: pw, role: "manager" },
    { name: "Ali", email: "ali@shop.pk", password: pw, role: "cashier" },
  ]);
  const manager = { ptoken: sign({ id: String(mgr._id), role: "pharmacy" }) };
  const cashier = { ptoken: sign({ id: String(cash._id), role: "pharmacy" }) };

  // ---------- Items ----------
  let r = await call("POST", "/api/pharmacy/products", manager, {
    name: "Panadol", salt: "Paracetamol", strength: "500 mg", form: "tablet", unitName: "tablet", packName: "strip",
    unitsPerPack: 10, unitPricePaisa: 350, packPricePaisa: 3000, barcodes: ["8961100000017"], reorderLevelUnits: 20,
  });
  check("Manager adds an item (Rs 3.50 a tablet, Rs 30 a strip of 10)", r.status === 200 && r.data.product.unitPricePaisa === 350 && r.data.product.packPricePaisa === 3000 && r.data.product.stockUnits === 0, JSON.stringify(r.data));
  const panadol = r.data.product._id;
  const calpol = (await call("POST", "/api/pharmacy/products", manager, { name: "Calpol", salt: "paracetamol", strength: "500 MG", form: "tablet", unitName: "tablet", packName: "strip", unitsPerPack: 10, unitPricePaisa: 300 })).data.product._id;
  const panadolExtra = (await call("POST", "/api/pharmacy/products", manager, { name: "Panadol Extra", salt: "Paracetamol", strength: "650 mg", form: "tablet", unitPricePaisa: 500 })).data.product._id;
  const brufen = (await call("POST", "/api/pharmacy/products", manager, { name: "Brufen", salt: "Ibuprofen", strength: "400 mg", form: "tablet", unitPricePaisa: 400, unitsPerPack: 10, packName: "strip" })).data.product._id;
  const pampers = (await call("POST", "/api/pharmacy/products", manager, { name: "Pampers", variant: "Medium", category: "other", unitName: "pack", unitPricePaisa: 250000, trackExpiry: false })).data.product._id;
  check("Non-medicine item with a size and no expiry", Boolean(pampers));

  r = await call("POST", "/api/pharmacy/products", manager, { name: "", unitPricePaisa: 12.5 });
  check("Bad item: 400 with the fields", r.status === 400 && r.data.fields.name && r.data.fields.unitPricePaisa, JSON.stringify(r.data));
  r = await call("POST", "/api/pharmacy/products", manager, { name: "Copy", unitPricePaisa: 100, barcodes: ["8961100000017"] });
  check("A barcode already used by another item: 409", r.status === 409 && r.data.code === "barcode_taken");
  r = await call("POST", "/api/pharmacy/products", manager, { name: "Twice", unitPricePaisa: 100, barcodes: ["111", "111"] });
  check("The same barcode twice on one item: 400", r.status === 400);
  const race = await Promise.all([0, 1].map((i) => call("POST", "/api/pharmacy/products", manager, { name: `Race ${i}`, unitPricePaisa: 100, barcodes: ["999000"] })));
  check("Same new barcode on two items at the same moment: one saved, the other 409", race.filter((x) => x.status === 200).length === 1 && race.some((x) => x.status === 409), JSON.stringify(race.map((x) => x.status)));
  r = await call("POST", "/api/pharmacy/products", cashier, { name: "X", unitPricePaisa: 100 });
  check("A cashier can't add items", r.status === 403);

  r = await call("GET", "/api/pharmacy/products?q=pana", cashier);
  check("Search by the start of the name (any case)", r.data.products.map((p) => p.name).sort().join() === "Panadol,Panadol Extra");
  r = await call("GET", "/api/pharmacy/products?q=PARACETAMOL", cashier);
  check("Search by salt", r.data.products.length === 3);
  r = await call("GET", "/api/pharmacy/products?q=8961100000017", cashier);
  check("Search by barcode", r.data.products.length === 1 && r.data.products[0].name === "Panadol");
  r = await call("GET", "/api/pharmacy/products/barcode/8961100000017", cashier);
  check("Scan a barcode", r.data.product?._id === panadol);
  r = await call("GET", `/api/pharmacy/products?q=${encodeURIComponent("(.*)+")}`, cashier);
  check("Search text is matched literally", r.status === 200 && r.data.products.length === 0);
  const seen = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    r = await call("GET", `/api/pharmacy/products?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, cashier);
    seen.push(...r.data.products.map((p) => p.name));
    if (!r.data.nextCursor) break;
    cursor = r.data.nextCursor;
  }
  check("Paging through items gives each once, by name", seen.length === new Set(seen).size && seen.join() === [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(), seen.join());
  r = await call("GET", `/api/pharmacy/products/${panadol}/substitutes`, cashier);
  check("Substitutes: same salt and strength only", r.data.substitutes.map((p) => p.name).join() === "Calpol", JSON.stringify(r.data.substitutes?.map((p) => p.name)));

  r = await call("PUT", `/api/pharmacy/products/${brufen}`, manager, { unitPricePaisa: 450 });
  const brufenNow = (await call("GET", `/api/pharmacy/products/${brufen}`, manager)).data.product;
  check("Changing the price keeps everything else", brufenNow.unitPricePaisa === 450 && brufenNow.unitsPerPack === 10 && brufenNow.salt === "Ibuprofen" && brufenNow.packName === "strip");
  await call("PUT", `/api/pharmacy/products/${brufen}`, manager, { name: "Brufen Forte" });
  r = await call("GET", "/api/pharmacy/products?q=brufen f", cashier);
  check("A renamed item is found by its new name", r.data.products.length === 1);

  // ---------- Suppliers ----------
  r = await call("POST", "/api/pharmacy/suppliers", manager, { name: "Muller & Phipps", phone: "042-111" });
  const supplier = r.data.supplier._id;
  check("Manager adds a supplier", r.status === 200);
  r = await call("GET", "/api/pharmacy/suppliers", cashier);
  check("A cashier can't see suppliers", r.status === 403);
  const offSupplier = (await call("POST", "/api/pharmacy/suppliers", manager, { name: "Closed Co", active: false })).data.supplier._id;

  // ---------- Purchases ----------
  const purchase = (items, extra = {}, headers = manager) =>
    call("POST", "/api/pharmacy/purchases", headers, { supplierId: supplier, invoiceNo: "INV-1", items, ...extra });
  r = await purchase([
    { productId: panadol, batchNo: "P-LATE", expiry: inDays(400), packs: 5, bonusUnits: 10, packCostPaisa: 2500 },
    { productId: pampers, packs: 2, packCostPaisa: 200000, discountPaisa: 10000 },
  ], { paidPaisa: 100000 });
  const p1 = r.data.purchase;
  check("Purchase saved with a number", r.status === 200 && p1.purchaseNo === 1, JSON.stringify(r.data));
  const line = p1?.items?.[0];
  check("5 strips + 10 bonus tablets = 60 tablets for Rs 125", line?.units === 60 && line.lineTotalPaisa === 12500);
  check("Bonus lowers the real cost per tablet (Rs 2.08)", Math.abs(line?.costPerUnitPaisa - 12500 / 60) < 1e-9);
  check("Trade discount on a line (2 packs at Rs 2,000 less Rs 100)", p1?.items?.[1]?.lineTotalPaisa === 390000 && p1.totalPaisa === 402500);
  check("Stock in: 60 tablets", (await productModel.findById(panadol).lean()).stockUnits === 60);
  check("Stock totals equal the movement log after a purchase", await ledgerHolds(panadol));
  r = await purchase([{ productId: panadol, batchNo: "P-SOON", expiry: inDays(20), looseUnits: 5, packCostPaisa: 2000 }]);
  check("Loose tablets bought: 5 at Rs 2 each", r.data.purchase?.items[0].lineTotalPaisa === 1000 && r.data.purchase.items[0].units === 5);
  r = await purchase([{ productId: calpol, packs: 1, packCostPaisa: 2000 }]);
  check("Expiry is required for medicines", r.status === 400 && /expiry/i.test(r.data.message));
  r = await purchase([{ productId: calpol, packs: 1, packCostPaisa: 2000, expiry: inDays(-1) }]);
  check("An already expired batch is refused", r.status === 400 && /expired/i.test(r.data.message));
  r = await purchase([{ productId: calpol, expiry: inDays(300), packCostPaisa: 2000 }]);
  check("A line with no quantity is refused", r.status === 400);
  r = await purchase([{ productId: calpol, expiry: inDays(300), packs: 1, packCostPaisa: 2000, discountPaisa: 5000 }]);
  check("A discount bigger than the line is refused", r.status === 400);
  r = await purchase([{ productId: calpol, expiry: inDays(300), packs: 1, packCostPaisa: 2000 }], { paidPaisa: 999999 });
  check("Paid more than the total is refused", r.status === 400);
  r = await call("POST", "/api/pharmacy/purchases", manager, { supplierId: offSupplier, items: [{ productId: calpol, expiry: inDays(300), packs: 1, packCostPaisa: 2000 }] });
  check("A turned-off supplier: 404", r.status === 404);
  r = await purchase([{ productId: calpol, expiry: inDays(300), packs: 1, packCostPaisa: 2000 }], {}, cashier);
  check("A cashier can't enter purchases", r.status === 403);

  const before = (await productModel.findById(calpol).lean()).stockUnits;
  const once = { requestId: "purchase-req-0001" };
  const twice = await Promise.all([0, 1].map(() => purchase([{ productId: calpol, expiry: inDays(300), packs: 3, packCostPaisa: 2000 }], once)));
  const again = await purchase([{ productId: calpol, expiry: inDays(300), packs: 3, packCostPaisa: 2000 }], once);
  check("Double submit (at once and again later): one purchase, stock counted once",
    twice.every((x) => x.status === 200) && new Set([...twice, again].map((x) => x.data.purchase._id)).size === 1 &&
    (await productModel.findById(calpol).lean()).stockUnits === before + 30 && (await purchaseModel.countDocuments({ requestId: "purchase-req-0001" })) === 1,
    JSON.stringify(twice.map((x) => x.status)));
  check("Stock totals equal the movement log (Calpol)", await ledgerHolds(calpol));

  // ---------- What cashiers see ----------
  r = await call("GET", `/api/pharmacy/products/${panadol}`, cashier);
  check("A cashier gets no cost prices (item or batches)", r.data.product.lastCostPerUnitPaisa === undefined && r.data.batches.every((b) => b.costPerUnitPaisa === undefined), JSON.stringify(r.data));
  r = await call("GET", `/api/pharmacy/products/${panadol}`, manager);
  check("A manager sees cost prices", r.data.product.lastCostPerUnitPaisa >= 0 && r.data.batches.every((b) => b.costPerUnitPaisa >= 0));
  check("Batches listed by expiry, soonest first", r.data.batches[0].batchNo === "P-SOON");

  // ---------- The stock engine (what a sale will use) ----------
  const by = { role: "cashier", id: String(cash._id), name: "Ali" };
  // An expired batch on the shelf (as if it was bought long ago)
  await batchModel.create({ productId: panadol, batchNo: "P-OLD", expiry: new Date(Date.now() - DAY), costPerUnitPaisa: 100, receivedUnits: 7, qtyUnits: 7 });
  await movementModel.create({ productId: panadol, type: "purchase", qtyUnits: 7, costPerUnitPaisa: 100, ref: { kind: "test" } });
  await productModel.updateOne({ _id: panadol }, { $inc: { stockUnits: 7 } });
  check("Expired stock isn't counted as sellable", (await sellableUnits(panadol)) === 65);

  let allocations = await inTransaction((session) => takeStock({ productId: panadol, units: 8, ref: { kind: "test" }, by }, session));
  check("A sale takes from the batch expiring first, never the expired one",
    allocations.length === 2 && allocations[0].qtyUnits === 5 && allocations[1].qtyUnits === 3 && !allocations.some((a) => a.costPerUnitPaisa === 100), JSON.stringify(allocations));
  const stockBefore = (await productModel.findById(panadol).lean()).stockUnits;
  const shelfBefore = JSON.stringify((await batchModel.find({ productId: panadol }).sort({ _id: 1 }).lean()).map((b) => b.qtyUnits));
  let error = null;
  try {
    await inTransaction((session) => takeStock({ productId: panadol, units: 1000, ref: { kind: "test" }, by }, session));
  } catch (e) {
    error = e;
  }
  check("Selling more than the stock is refused, saying how many there are", error?.code === "insufficient_stock" && error.extra.availableUnits === 57, `${error?.code} ${error?.extra?.availableUnits}`);
  check("A refused sale changes nothing", (await productModel.findById(panadol).lean()).stockUnits === stockBefore && JSON.stringify((await batchModel.find({ productId: panadol }).sort({ _id: 1 }).lean()).map((b) => b.qtyUnits)) === shelfBefore);

  // Many counters selling the last stock at the same moment
  const contested = (await call("POST", "/api/pharmacy/products", manager, { name: "Last Stock", salt: "x", unitPricePaisa: 100 })).data.product._id;
  await purchase([
    { productId: contested, batchNo: "A", expiry: inDays(30), looseUnits: 8, packCostPaisa: 100 },
    { productId: contested, batchNo: "B", expiry: inDays(60), looseUnits: 12, packCostPaisa: 100 },
  ]);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => inTransaction((session) => takeStock({ productId: contested, units: 3, ref: { kind: "test" }, by }, session))));
  const sold = results.filter((x) => x.status === "fulfilled").length;
  const shelf = await batchModel.find({ productId: contested }).lean();
  check("10 counters at once, 20 in stock, 3 each: exactly 6 sales go through", sold === 6, `${sold} sold`);
  check("No batch ever below zero; 2 left on the shelf", shelf.every((b) => b.qtyUnits >= 0) && shelf.reduce((s, b) => s + b.qtyUnits, 0) === 2);
  check("Stock totals equal the movement log after the rush", await ledgerHolds(contested));

  // Manager override: sold before the purchase was entered
  allocations = await inTransaction((session) => takeStock({ productId: contested, units: 5, ref: { kind: "test" }, by: { role: "manager", name: "Sara" }, allowNegative: true }, session));
  const override = await movementModel.findOne({ productId: contested, negativeOverride: true }).lean();
  check("Manager override sells beyond the stock and is recorded", allocations.some((a) => a.negativeOverride && a.qtyUnits === 3) && override?.by?.name === "Sara" && override.qtyUnits === -3);
  check("Stock shows the shortfall (-3) and still equals the movement log", (await productModel.findById(contested).lean()).stockUnits === -3 && (await ledgerHolds(contested)));

  // ---------- Corrections ----------
  const oldBatch = await batchModel.findOne({ batchNo: "P-OLD" }).lean();
  r = await call("POST", "/api/pharmacy/stock/adjust", manager, { batchId: String(oldBatch._id), deltaUnits: -7, type: "expired", reason: "Expired, sent back" });
  check("Manager writes off an expired batch", r.status === 200 && (await batchModel.findById(oldBatch._id).lean()).qtyUnits === 0);
  r = await call("POST", "/api/pharmacy/stock/adjust", manager, { batchId: String(oldBatch._id), deltaUnits: -1, type: "damaged", reason: "x" });
  check("Can't take off more than the batch has: 409", r.status === 409);
  r = await call("POST", "/api/pharmacy/stock/adjust", manager, { batchId: String(oldBatch._id), deltaUnits: 3, type: "expired", reason: "x" });
  check("Expired/damaged can only take stock off", r.status === 400);
  const lateBatch = await batchModel.findOne({ batchNo: "P-LATE" }).lean();
  r = await call("POST", "/api/pharmacy/stock/adjust", manager, { batchId: String(lateBatch._id), deltaUnits: 2, type: "adjustment", reason: "Counted 2 more" });
  check("Count correction can add", r.status === 200 && (await batchModel.findById(lateBatch._id).lean()).qtyUnits === lateBatch.qtyUnits + 2);
  r = await call("POST", "/api/pharmacy/stock/adjust", manager, { batchId: String(lateBatch._id), deltaUnits: -1, type: "adjustment", reason: "" });
  check("A correction needs a reason", r.status === 400);
  r = await call("POST", "/api/pharmacy/stock/adjust", cashier, { batchId: String(lateBatch._id), deltaUnits: -1, type: "damaged", reason: "x" });
  check("A cashier can't correct stock", r.status === 403);
  check("Stock totals equal the movement log after corrections", await ledgerHolds(panadol));

  // ---------- Alerts and history ----------
  r = await call("GET", "/api/pharmacy/stock/expiring?days=500", cashier);
  check("Expiring list: batches on the shelf, sold-out ones left out, no values for a cashier", r.status === 200 && r.data.batches.some((b) => b.batchNo === "P-LATE") && !r.data.batches.some((b) => b.batchNo === "P-SOON") && r.data.batches.every((b) => b.qtyUnits > 0 && b.valuePaisa === undefined), JSON.stringify(r.data.batches));
  r = await call("GET", "/api/pharmacy/stock/low", cashier);
  check("Low stock lists items at or below their reorder level", r.data.products.some((p) => p.name === "Last Stock") && !r.data.products.some((p) => p.name === "Panadol"));
  const history = [];
  cursor = "";
  for (let i = 0; i < 20; i++) {
    r = await call("GET", `/api/pharmacy/stock/movements?productId=${panadol}&limit=3${cursor ? `&cursor=${cursor}` : ""}`, manager);
    history.push(...r.data.movements);
    if (!r.data.nextCursor) break;
    cursor = r.data.nextCursor;
  }
  check("Stock history pages through every movement once, newest first",
    history.length === (await movementModel.countDocuments({ productId: panadol })) && new Set(history.map((m) => m._id)).size === history.length);
  r = await call("GET", `/api/pharmacy/stock/movements?productId=${panadol}`, cashier);
  check("A cashier can't see stock history (it has costs)", r.status === 403);
} catch (error) {
  console.log("CRASH  " + (error.stack || error));
  failures++;
} finally {
  server.close();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : `\nALL PHARMACY STOCK CHECKS PASSED${onReplicaSet ? " (replica set)" : ""}`);
  process.exit(failures ? 1 : 0);
}
