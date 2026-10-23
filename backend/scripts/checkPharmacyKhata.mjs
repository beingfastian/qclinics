// Checks for the pharmacy khata and labels: customers on credit (limits that hold
// even with many counters at once, part paid now, payments, returns back to the
// account, balance always equal to the account entries), the cash drawer counting
// every cash movement, supplier accounts and payments (from the drawer or not), and
// shop barcodes for labels. Through the real expressApp. Run with:
//   npm run check:integration
// Needs a LOCAL MongoDB (CHECK_MONGODB_URI, default 127.0.0.1:27017). With --rs it
// runs against CHECK_MONGODB_RS_URI (a replica set: real transactions), or skips.
// Uses its own throwaway database and deletes it at the end. Never loads .env.
import path from "path";
import { fileURLToPath } from "url";

const onReplicaSet = process.argv.includes("--rs");
const uri = onReplicaSet ? process.env.CHECK_MONGODB_RS_URI || "" : process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (onReplicaSet && !uri) {
  console.log("SKIP  pharmacy khata checks on a replica set: set CHECK_MONGODB_RS_URI to run them");
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
  MONGODB_DB_NAME: "qclinics_pharmkhatacheck_" + Date.now(),
  JWT_SECRET: "check-pharmacy-khata-secret",
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
const { saleModel, returnModel, shiftModel } = await import("../modules/pharmacy/models/salesModels.js");
const { customerModel, customerEntryModel, supplierPaymentModel } = await import("../modules/pharmacy/models/khataModels.js");
const { supportsTransactions } = await import("../lib/transactions.js");
const { localDate } = await import("../modules/pharmacy/time.js");

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, p, headers = {}, body) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body && { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sign = (claims) => jwt.sign(claims, "check-pharmacy-khata-secret", { expiresIn: "1h" });
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const balanceOf = async (id) => (await customerModel.findById(id).lean()).balancePaisa;

// A customer's balance must always equal their account entries
const accountHolds = async (id) => {
  const [row] = await customerEntryModel.aggregate([{ $match: { customerId: String(id) } }, { $group: { _id: null, n: { $sum: "$amountPaisa" } } }]);
  return (await balanceOf(id)) === (row?.n || 0);
};
const validEan13 = (code) => /^\d{13}$/.test(code) && [...code.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0) % 10 === (10 - Number(code[12])) % 10;

try {
  await call("GET", "/api/pharmacy/status");
  while (mongoose.connection.readyState !== 1) await new Promise((r) => setTimeout(r, 100));
  await Promise.all([productModel.init(), saleModel.init(), returnModel.init(), shiftModel.init(), customerModel.init(), customerEntryModel.init(), supplierPaymentModel.init(), pharmacyStaffModel.init()]);
  check(onReplicaSet ? "Running with real transactions" : "Running without transactions (standalone database)", (await supportsTransactions()) === onReplicaSet);
  const pw = await bcrypt.hash("x-pass-1234", 4);
  const [mgr, cash] = await pharmacyStaffModel.create([
    { name: "Sara", email: "sara@shop.pk", password: pw, role: "manager" },
    { name: "Ali", email: "ali@shop.pk", password: pw, role: "cashier" },
  ]);
  const manager = { ptoken: sign({ id: String(mgr._id), role: "pharmacy" }) };
  const cashier = { ptoken: sign({ id: String(cash._id), role: "pharmacy" }) };

  const product = async (body) => (await call("POST", "/api/pharmacy/products", manager, body)).data.product;
  const panadol = (await product({ name: "Panadol", unitName: "tablet", packName: "strip", unitsPerPack: 10, unitPricePaisa: 350, packPricePaisa: 3000, barcodes: ["8961100000017"] }))._id;
  const brufen = (await product({ name: "Brufen", unitName: "tablet", unitPricePaisa: 400 }))._id;
  const supplier = (await call("POST", "/api/pharmacy/suppliers", manager, { name: "Muller & Phipps" })).data.supplier._id;
  // Rs 250 of stock, Rs 100 paid at the time: Rs 150 owed
  await call("POST", "/api/pharmacy/purchases", manager, {
    supplierId: supplier,
    paidPaisa: 10000,
    items: [
      { productId: panadol, expiry: inDays(300), packs: 8, packCostPaisa: 2500 },
      { productId: brufen, expiry: inDays(300), looseUnits: 10, packCostPaisa: 500 },
    ],
  });

  // ---------- Customers ----------
  let r = await call("POST", "/api/pharmacy/customers", cashier, { name: "Haji Rafiq", phone: "0300-1234567", creditLimitPaisa: 100000 });
  check("A cashier can't set a credit limit", r.status === 403);
  r = await call("POST", "/api/pharmacy/customers", cashier, { name: "Haji Rafiq", phone: "0300-1234567" });
  const haji = r.data.customer._id;
  check("A cashier adds a customer (no limit)", r.status === 200 && r.data.customer.balancePaisa === 0 && r.data.customer.creditLimitPaisa === null);
  r = await call("PUT", `/api/pharmacy/customers/${haji}`, cashier, { creditLimitPaisa: 5000 });
  check("A cashier can't change the limit", r.status === 403);
  r = await call("PUT", `/api/pharmacy/customers/${haji}`, manager, { creditLimitPaisa: 5000 });
  check("Manager sets a Rs 50 limit", r.status === 200 && r.data.customer.creditLimitPaisa === 5000);
  r = await call("PUT", `/api/pharmacy/customers/${haji}`, manager, { balancePaisa: -999999, name: "Haji Rafiq Sb" });
  check("The balance can't be edited directly", r.status === 200 && r.data.customer.balancePaisa === 0 && r.data.customer.name === "Haji Rafiq Sb");
  r = await call("GET", "/api/pharmacy/customers?q=haji", cashier);
  check("Find a customer by name", r.data.customers.length === 1);
  r = await call("GET", "/api/pharmacy/customers?q=1234567", cashier);
  check("Find a customer by phone digits", r.data.customers.length === 1 && r.data.customers[0]._id === haji);

  // ---------- Selling on account ----------
  await call("POST", "/api/pharmacy/shifts/open", cashier, { openingCashPaisa: 100000 });
  const sell = (headers, body) => call("POST", "/api/pharmacy/sales", headers, body);
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 1 }], paymentMethod: "account" });
  check("On account without a customer: refused", r.status === 400);
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 12 }], paymentMethod: "account", customerId: haji });
  const bill1 = r.data.sale;
  check("Rs 37 on Haji's khata", r.status === 200 && bill1.onAccountPaisa === 3700 && bill1.customerName === "Haji Rafiq Sb" && (await balanceOf(haji)) === 3700, JSON.stringify(r.data));
  const first = await customerEntryModel.findOne({ customerId: haji }).lean();
  check("The khata entry points to the bill", first.type === "sale" && first.amountPaisa === 3700 && first.balanceAfterPaisa === 3700 && first.ref.no === String(bill1.saleNo));

  const stockBefore = (await productModel.findById(panadol).lean()).stockUnits;
  const salesBefore = await saleModel.countDocuments();
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 10 }], paymentMethod: "account", customerId: haji });
  check("Over the limit: refused, saying the room left (Rs 13)", r.status === 409 && r.data.code === "credit_limit" && r.data.roomPaisa === 1300);
  check("A refused khata bill changes nothing", (await balanceOf(haji)) === 3700 && (await productModel.findById(panadol).lean()).stockUnits === stockBefore && (await saleModel.countDocuments()) === salesBefore && (await accountHolds(haji)));
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 10 }], paymentMethod: "account", customerId: haji, cashReceivedPaisa: 2000 });
  check("Part paid now (Rs 20), the rest (Rs 10) on the khata", r.status === 200 && r.data.sale.onAccountPaisa === 1000 && r.data.sale.cashReceivedPaisa === 2000 && (await balanceOf(haji)) === 4700);
  r = await sell(cashier, { items: [{ productId: panadol, qtyUnits: 1 }], paymentMethod: "account", customerId: haji, cashReceivedPaisa: 400 });
  check("Paid now more than the bill: refused", r.status === 400);
  r = await sell(cashier, { items: [{ productId: brufen, qtyUnits: 99 }], paymentMethod: "account", customerId: haji, cashReceivedPaisa: 0 });
  check("Not enough stock on a khata bill: the khata doesn't move", r.status === 409 && (await balanceOf(haji)) === 4700 && (await accountHolds(haji)));

  // Many counters, one customer near the limit
  const shop = (await call("POST", "/api/pharmacy/customers", manager, { name: "Corner Clinic", creditLimitPaisa: 1000 })).data.customer._id;
  const rush = await Promise.all(Array.from({ length: 5 }, () => sell(cashier, { items: [{ productId: panadol, qtyUnits: 1 }], paymentMethod: "account", customerId: shop })));
  check("5 khata bills of Rs 3.50 at once with a Rs 10 limit: exactly 2 go through", rush.filter((x) => x.status === 200).length === 2 && (await balanceOf(shop)) === 700, JSON.stringify(rush.map((x) => x.status)));
  check("The khata equals its entries after the rush", await accountHolds(shop));
  await call("POST", "/api/pharmacy/shifts/open", manager, { openingCashPaisa: 0 });
  r = await sell(manager, { items: [{ productId: panadol, qtyUnits: 10 }], paymentMethod: "account", customerId: shop });
  check("A manager may go over the limit", r.status === 200 && (await balanceOf(shop)) === 3700);

  // ---------- Payments ----------
  const pay = (headers, id, body) => call("POST", `/api/pharmacy/customers/${id}/payments`, headers, body);
  const once = { amountPaisa: 2000, method: "cash", requestId: "khata-payment-001" };
  const twice = await Promise.all([0, 1].map(() => pay(cashier, haji, once)));
  check("Haji pays Rs 20 cash (sent twice): counted once", twice.every((x) => x.status === 200) && (await balanceOf(haji)) === 2700 && (await customerEntryModel.countDocuments({ requestId: "khata-payment-001" })) === 1, JSON.stringify(twice.map((x) => x.data?.message)));
  r = await pay(cashier, haji, { amountPaisa: 500, method: "card" });
  check("Rs 5 by card", r.status === 200 && r.data.customer.balancePaisa === 2200);
  r = await pay({ ptoken: sign({ id: String(new mongoose.Types.ObjectId()), role: "pharmacy" }) }, haji, { amountPaisa: 100 });
  check("Unknown login: refused", r.status === 401);
  r = await pay(cashier, haji, { amountPaisa: 0 });
  check("A payment of nothing: refused", r.status === 400);

  // ---------- Return of a khata bill ----------
  r = await call("POST", "/api/pharmacy/returns", cashier, { saleId: bill1._id, items: [{ saleItemId: bill1.items[0]._id, qtyUnits: 2 }] });
  check("Return from a khata bill comes off the khata, not the drawer", r.status === 200 && r.data.return.refundTo === "account" && (await balanceOf(haji)) === 2200 - r.data.return.totalRefundPaisa && (await accountHolds(haji)));
  r = await call("GET", `/api/pharmacy/customers/${haji}/statement?limit=2`, cashier);
  const all = [...r.data.entries];
  if (r.data.nextCursor) all.push(...(await call("GET", `/api/pharmacy/customers/${haji}/statement?limit=50&cursor=${r.data.nextCursor}`, cashier)).data.entries);
  check("Statement: every entry once, newest first, the latest balance on top", all.length === 5 && new Set(all.map((e) => e._id)).size === 5 && all[0].balanceAfterPaisa === (await balanceOf(haji)) && all[0].type === "return");
  r = await call("GET", "/api/pharmacy/customers?owing=true", manager);
  check("Who owes: biggest first, with the total owed", r.data.customers[0]._id === shop && r.data.owed.totalPaisa === (await balanceOf(haji)) + (await balanceOf(shop)) && r.data.owed.customers === 2);

  // ---------- Suppliers ----------
  r = await call("GET", "/api/pharmacy/suppliers", manager);
  check("Supplier owed Rs 150 (Rs 250 bought, Rs 100 paid)", r.data.suppliers[0].balancePaisa === 15000, JSON.stringify(r.data.suppliers));
  r = await call("POST", `/api/pharmacy/suppliers/${supplier}/payments`, cashier, { amountPaisa: 1000 });
  check("A cashier can't pay suppliers", r.status === 403);
  r = await call("POST", `/api/pharmacy/suppliers/${supplier}/payments`, manager, { amountPaisa: 5000, method: "bank", reference: "IBFT 7781" });
  check("Manager pays Rs 50 by bank", r.status === 200);
  r = await call("POST", `/api/pharmacy/suppliers/${supplier}/payments`, manager, { amountPaisa: 1000, method: "bank", fromDrawer: true });
  check("Only cash can come out of the drawer", r.status === 400);
  const supTwice = await Promise.all([0, 1].map(() => call("POST", `/api/pharmacy/suppliers/${supplier}/payments`, manager, { amountPaisa: 3000, method: "cash", fromDrawer: true, requestId: "supplier-pay-0001" })));
  check("Rs 30 from the manager's drawer (sent twice): once", supTwice.every((x) => x.status === 200) && (await supplierPaymentModel.countDocuments({ requestId: "supplier-pay-0001" })) === 1);
  r = await call("GET", `/api/pharmacy/suppliers/${supplier}/statement`, manager);
  check("Supplier statement: purchase, then payments, running balance down to Rs 70", r.data.balancePaisa === 7000 && r.data.lines.length === 3 && r.data.lines.at(-1).balancePaisa === 7000 && r.data.lines[0].kind === "purchase");

  // ---------- The drawers ----------
  const shiftOf = async (headers) => (await call("GET", "/api/pharmacy/shifts/current", headers)).data.shift;
  const ali = await shiftOf(cashier);
  // Ali: opening Rs 1000 + Rs 20 paid now on account + Rs 20 khata cash; nothing else in cash
  check("Ali's drawer: opening + cash paid now + khata cash (card and khata bills not counted)", ali.expectedCashPaisa === 100000 + 2000 + 2000 && ali.totals.khataCashPaisa === 2000 && ali.totals.khataCardPaisa === 500 && ali.totals.onAccountPaisa > 0 && ali.totals.refundsPaisa === 0 && ali.totals.accountReturnsPaisa > 0, JSON.stringify(ali));
  const sara = await shiftOf(manager);
  check("Sara's drawer: the supplier payment taken out", sara.expectedCashPaisa === -3000 && sara.totals.supplierPaidPaisa === 3000);
  r = await call("POST", "/api/pharmacy/shifts/close", cashier, { countedCashPaisa: ali.expectedCashPaisa });
  check("Ali's drawer matches at closing", r.data.shift.differencePaisa === 0);
  r = await pay(cashier, haji, { amountPaisa: 100 });
  check("No khata payment without an open shift", r.status === 409 && r.data.code === "no_shift");

  // ---------- Reports ----------
  r = await call("GET", `/api/pharmacy/reports/summary?from=${localDate()}&to=${localDate()}`, manager);
  const onAccount = (await saleModel.find({}).lean()).reduce((s, x) => s + (x.onAccountPaisa || 0), 0);
  check("Reports show what went on khata today", r.data.totals.accountPaisa === onAccount && onAccount > 0);

  // ---------- Shop barcodes for labels ----------
  const codes = await Promise.all([0, 1].map(() => call("POST", `/api/pharmacy/products/${brufen}/shop-barcode`, manager)));
  const code = codes[0].data.product.barcodes[0];
  check("An item without a barcode gets a shop barcode (EAN-13, starts 20)", validEan13(code) && code.startsWith("20"), code);
  check("Two clicks at once: one code", codes.every((x) => x.data.product.barcodes.length === 1 && x.data.product.barcodes[0] === code));
  r = await call("GET", `/api/pharmacy/products/barcode/${code}`, cashier);
  check("Scanning the shop barcode finds the item", r.data.product?._id === brufen);
  r = await call("POST", `/api/pharmacy/products/${panadol}/shop-barcode`, manager);
  check("An item with the maker's barcode keeps it", r.data.product.barcodes.join() === "8961100000017");
  r = await call("POST", `/api/pharmacy/products/${panadol}/shop-barcode`, cashier);
  check("A cashier can't add barcodes", r.status === 403);
  for (const id of [haji, shop]) check(`Khata equals its entries at the end (${id.slice(-4)})`, await accountHolds(id));
} catch (error) {
  console.log("CRASH  " + (error.stack || error));
  failures++;
} finally {
  server.close();
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : `\nALL PHARMACY KHATA CHECKS PASSED${onReplicaSet ? " (replica set)" : ""}`);
  process.exit(failures ? 1 : 0);
}
