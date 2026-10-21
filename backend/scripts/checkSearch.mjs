// Checks for reception's patient search by phone (services/queueService.js
// searchPatients): full numbers use the indexed phoneKeys, kept correct on every way
// a patient is saved; existing patients are backfilled once; until then the search
// falls back to the old way; results are the same as the old search for full numbers
// typed in every usual format. Run with: npm run check:integration
//
// Needs a LOCAL MongoDB (default mongodb://127.0.0.1:27017, or CHECK_MONGODB_URI).
// Uses its own throwaway database and deletes it at the end. Refuses remote URIs.
process.env.WHATSAPP_PROVIDER = "none";
const mongoose = (await import("mongoose")).default;
const baseUri = process.env.CHECK_MONGODB_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(baseUri)) {
  console.error("Refusing to run: CHECK_MONGODB_URI must be a local MongoDB (this script deletes its test database).");
  process.exit(1);
}
await mongoose.connect(baseUri, { dbName: "qclinics_searchcheck_" + Date.now() });
const { default: userModel } = await import("../model/userModel.js");
const { runMigrations } = await import("../config/migrations.js");
const { searchPatients } = await import("../services/queueService.js");

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && extra ? "  -> " + extra : ""}`);
  if (!cond) failures++;
};
const keys = async (id) => (await userModel.findById(id).lean()).phoneKeys;

try {
  await userModel.syncIndexes();

  // --- Existing patients (saved before phoneKeys existed): found before and after the backfill ---
  const old = Array.from({ length: 300 }, (_, i) => ({
    name: `Old Patient ${i}`,
    phone: i % 3 === 0 ? `+92 31${String(10000000 + i).slice(-8)}` : `031${String(10000000 + i).slice(-8)}`,
    ...(i % 4 === 0 && { whatsappNumber: `0345${String(1000000 + i).slice(-7)}` }),
    gender: "Male",
  }));
  await userModel.collection.insertMany(old);
  let r = await searchPatients("0311 0000007");
  check("Before the backfill, a full number is still found (old search)", r.some((p) => p.name === "Old Patient 7"), JSON.stringify(r.map((p) => p.name)));
  await runMigrations();
  check("Backfill gives every existing patient phone keys", (await userModel.countDocuments({ phoneKeys: { $exists: false } })) === 0);
  check("Backfill keeps phone and WhatsApp number both", (await userModel.findOne({ name: "Old Patient 4" }).lean()).phoneKeys.length === 2);

  // --- Every way a patient is saved keeps the keys right ---
  const created = await userModel.create({ name: "Created", phone: "0300 1234567" });
  check("create(): key from the phone", JSON.stringify(await keys(created._id)) === '["3001234567"]', JSON.stringify(await keys(created._id)));
  const saved = await new userModel({ name: "Saved", phone: "03001112222", whatsappNumber: "+923119876543" }).save();
  check("new + save(): phone and WhatsApp number", JSON.stringify((await keys(saved._id)).sort()) === '["3001112222","3119876543"]');
  await userModel.findByIdAndUpdate(created._id, { phone: "0321-5550000" });
  check("findByIdAndUpdate(phone): keys follow the new number", JSON.stringify(await keys(created._id)) === '["3215550000"]', JSON.stringify(await keys(created._id)));
  await userModel.findByIdAndUpdate(created._id, { $set: { whatsappNumber: "923335550000" } });
  check("findByIdAndUpdate($set whatsappNumber): both numbers", JSON.stringify((await keys(created._id)).sort()) === '["3215550000","3335550000"]');
  await userModel.findByIdAndUpdate(created._id, { $unset: { whatsappNumber: 1 } });
  check("findByIdAndUpdate($unset whatsappNumber): only the phone left", JSON.stringify(await keys(created._id)) === '["3215550000"]');
  await userModel.findByIdAndUpdate(created._id, { name: "Created Renamed" });
  check("An update that doesn't touch numbers leaves the keys", JSON.stringify(await keys(created._id)) === '["3215550000"]');
  const noPhone = await userModel.create({ name: "Walk-in without phone" });
  check("No phone: no keys", (await keys(noPhone._id)).length === 0);

  // --- Same results as the old search, for full numbers in every usual format ---
  const oldSearch = async (text) => {
    const core = text.replace(/\D/g, "").replace(/^(0092|92|0)/, "");
    return (await userModel.find({ $or: [{ phone: { $regex: core } }, { whatsappNumber: { $regex: core } }] }).select("_id").limit(10).lean())
      .map((u) => String(u._id)).sort().join();
  };
  const formats = (local) => [local, `${local.slice(0, 4)} ${local.slice(4)}`, `+92${local.slice(1)}`, `92${local.slice(1)}`, `0092 ${local.slice(1)}`, `+92 ${local.slice(1, 4)} ${local.slice(4)}`];
  const mismatches = [];
  let compared = 0;
  for (const i of [0, 1, 3, 4, 7, 8, 12, 99, 150, 299]) {
    const locals = [`031${String(10000000 + i).slice(-8)}`, ...(i % 4 === 0 ? [`0345${String(1000000 + i).slice(-7)}`] : [])];
    for (const local of locals) {
      for (const typed of formats(local)) {
        compared++;
        const now = (await searchPatients(typed)).map((p) => String(p._id)).sort().join();
        if (now !== (await oldSearch(typed))) mismatches.push(typed);
      }
    }
  }
  check(`Same patients as the old search for ${compared} full numbers in 6 formats`, mismatches.length === 0, mismatches.slice(0, 5).join(" | "));
  r = await searchPatients("0399 9999999");
  check("A number nobody has: no results", r.length === 0);
  r = await searchPatients("00007");
  check("Part of a number still works (matched anywhere, as before)", r.some((p) => p.name === "Old Patient 7"));
  r = await searchPatients("old patient 1");
  check("Name search unchanged", r.length > 0 && r.every((p) => /old patient 1/i.test(p.name)));

  // --- The full-number search uses the index (no reading every patient) ---
  const plan = JSON.stringify((await userModel.find({ phoneKeys: "3110000007" }).explain("queryPlanner")).queryPlanner.winningPlan);
  check("Full-number search is an index lookup", /IXSCAN/.test(plan) && /phoneKeys/.test(plan) && !/COLLSCAN/.test(plan));
} catch (error) {
  console.error("TEST CRASHED:", error);
  failures++;
} finally {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL SEARCH CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
