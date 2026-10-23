// Sales at the counter. One save (a transaction): the sale with its number, the
// stock taken (earliest expiry first, stockService.takeStock) with its cost, all or
// nothing. Prices always come from the item list on the server, never the browser;
// if they changed since the cart was built, the sale is refused with the new total.
// A double click or a retry with the same requestId returns the first sale.
import mongoose from "mongoose";
import { saleModel, heldBillModel } from "../models/salesModels.js";
import { productModel } from "../models/productModel.js";
import { nextNumber } from "../models/stockModels.js";
import { takeStock, undoStock } from "./stockService.js";
import { linePrice } from "./pricing.js";
import { requireShift, touchShift } from "./shiftService.js";
import { checkLogin } from "./staffService.js";
import { chargeAccount, undoAccount } from "./khataService.js";
import { customerModel } from "../models/khataModels.js";
import { dispenseAgainst, undoDispense } from "./prescriptionService.js";
import { PharmacyError, notFound } from "../http.js";
import { can } from "../permissions.js";
import { inTransaction, isDuplicateKey, supportsTransactions } from "../../../lib/transactions.js";

// Cashiers may give up to this discount on a bill; managers any
export const maxCashierDiscountPercent = () => {
  const text = String(process.env.PHARMACY_MAX_DISCOUNT_PERCENT ?? "").trim();
  const value = Number(text);
  return text !== "" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : 10;
};

// Cost prices and profit only for those who may see them
export const publicSale = (sale, actor) => {
  const out = { ...sale, _id: String(sale._id) };
  if (!can(actor, "viewProfit")) {
    delete out.costPaisa;
    out.items = sale.items.map(({ costPaisa, allocations, ...item }) => ({ ...item, _id: String(item._id) }));
  }
  return out;
};

// The same item twice in a cart counts once
// (a line's prescription line, if any, is kept from the first time it appears)
const mergeLines = (items) => {
  const merged = new Map();
  for (const { productId, qtyUnits, rxLine } of items) {
    const line = merged.get(productId) || { productId, qtyUnits: 0, rxLine };
    merged.set(productId, { ...line, qtyUnits: line.qtyUnits + qtyUnits });
  }
  return [...merged.values()];
};

// Price a cart from the server's item list: lines, subtotal
export const priceCart = async (items) => {
  const lines = mergeLines(items);
  const products = new Map((await productModel.find({ _id: { $in: lines.map((l) => l.productId) } }).lean()).map((p) => [String(p._id), p]));
  const priced = lines.map((line) => {
    const product = products.get(line.productId);
    if (!product || !product.active) throw new PharmacyError("An item in the bill is no longer sold. Remove it and try again.", { status: 409, code: "item_gone", extra: { productId: line.productId } });
    return { product, qtyUnits: line.qtyUnits, rxLine: line.rxLine, lineTotalPaisa: linePrice(product, line.qtyUnits) };
  });
  return { priced, subtotalPaisa: priced.reduce((sum, l) => sum + l.lineTotalPaisa, 0) };
};

// A manager's email and password typed at the cashier's counter to allow selling
// stock that isn't entered yet
const managerApproval = async (approval) => {
  const staff = await checkLogin(approval.email, approval.password);
  if (!staff || !staff.active || staff.role !== "manager") {
    throw new PharmacyError("That isn't a manager's email and password", { status: 403, code: "approval_refused" });
  }
  return { role: "manager", id: String(staff._id), name: staff.name };
};

export const createSale = async (input, actor) => {
  if (input.requestId) {
    const repeat = await saleModel.findOne({ requestId: input.requestId }).lean();
    if (repeat) return { sale: publicSale(repeat, actor), repeated: true };
  }
  const shift = await requireShift(actor);
  const { priced, subtotalPaisa } = await priceCart(input.items);

  const discountPaisa = input.discountPaisa || 0;
  if (discountPaisa > subtotalPaisa) throw new PharmacyError("The discount is more than the bill", { code: "invalid" });
  const limit = maxCashierDiscountPercent();
  if (!can(actor, "giveAnyDiscount") && discountPaisa * 100 > subtotalPaisa * limit) {
    throw new PharmacyError(`You can give up to ${limit}% discount. Ask the manager for more.`, { status: 403, code: "discount_limit" });
  }
  const totalPaisa = subtotalPaisa - discountPaisa;
  if (input.expectedTotalPaisa !== undefined && input.expectedTotalPaisa !== totalPaisa) {
    throw new PharmacyError("Prices have changed since this bill was started. Check the new total.", {
      status: 409,
      code: "price_changed",
      extra: { subtotalPaisa, totalPaisa },
    });
  }
  const method = input.paymentMethod;
  // Cash: what was handed over (change given back). Account: cash paid now, the rest
  // goes on the customer's khata. Card and online: the exact total.
  const cashReceivedPaisa = method === "cash" ? input.cashReceivedPaisa ?? totalPaisa : method === "account" ? input.cashReceivedPaisa ?? 0 : totalPaisa;
  if (method === "cash" && cashReceivedPaisa < totalPaisa) throw new PharmacyError("Cash received is less than the total", { code: "invalid" });
  if (method === "account" && cashReceivedPaisa > totalPaisa) throw new PharmacyError("Paid now is more than the bill", { code: "invalid" });
  const onAccountPaisa = method === "account" ? totalPaisa - cashReceivedPaisa : 0;
  let customer = null;
  if (input.customerId) {
    customer = await customerModel.findById(input.customerId).lean();
    if (!customer || !customer.active) throw notFound("Customer");
  }
  if (method === "account" && !customer) throw new PharmacyError("Choose the customer whose khata this goes on", { code: "invalid" });

  // Selling beyond the stock entered: a manager signed in, or one who approves here
  let approvedBy = null;
  if (input.allowNegative) {
    if (can(actor, "overrideNegativeStock")) approvedBy = actor;
    else if (input.managerApproval) approvedBy = await managerApproval(input.managerApproval);
    else throw new PharmacyError("A manager has to allow this", { status: 403, code: "approval_needed" });
  }

  await saleModel.init(); // the unique request id index exists before the first save
  const _id = new mongoose.Types.ObjectId();
  try {
    const sale = await inTransaction(async (session) => {
      await touchShift(shift._id, session);
      const saleNo = await nextNumber("sale", session);
      const ref = { kind: "sale", id: String(_id), no: String(saleNo) };
      // The sale first: its unique request id stops a double submit before stock moves
      await saleModel.create(
        [
          {
            _id,
            saleNo,
            shiftId: String(shift._id),
            by: actor,
            items: priced.map((l) => ({
              productId: String(l.product._id),
              name: l.product.name,
              strength: l.product.strength,
              unitName: l.product.unitName,
              packName: l.product.packName,
              unitsPerPack: l.product.unitsPerPack,
              qtyUnits: l.qtyUnits,
              unitPricePaisa: l.product.unitPricePaisa,
              packPricePaisa: l.product.packPricePaisa ?? l.product.unitPricePaisa * (l.product.unitsPerPack || 1),
              lineTotalPaisa: l.lineTotalPaisa,
            })),
            subtotalPaisa,
            discountPaisa,
            totalPaisa,
            paymentMethod: method,
            cashReceivedPaisa,
            changePaisa: method === "cash" ? cashReceivedPaisa - totalPaisa : 0,
            onAccountPaisa,
            ...(customer && { customerId: String(customer._id) }),
            customerName: customer?.name || input.customerName,
            customerPhone: customer?.phone || input.customerPhone,
            ...(input.requestId && { requestId: input.requestId }),
          },
        ],
        { session }
      );
      const set = {};
      let costPaisa = 0;
      let oversold = false;
      for (const [i, l] of priced.entries()) {
        const allocations = await takeStock(
          { productId: l.product._id, units: l.qtyUnits, type: "sale", ref, by: actor, allowNegative: Boolean(approvedBy) },
          session
        );
        const lineCost = Math.round(allocations.reduce((sum, a) => sum + a.qtyUnits * a.costPerUnitPaisa, 0));
        set[`items.${i}.allocations`] = allocations;
        set[`items.${i}.costPaisa`] = lineCost;
        costPaisa += lineCost;
        oversold ||= allocations.some((a) => a.negativeOverride);
      }
      set.costPaisa = costPaisa;
      // Dispensed against a doctor's prescription: count each line against it
      if (input.prescriptionId) {
        const rx = await dispenseAgainst({ prescriptionId: input.prescriptionId, lines: priced, sale: { _id, saleNo } }, session);
        Object.assign(set, { prescriptionId: input.prescriptionId, rxNo: rx.rxNo });
      }
      if (onAccountPaisa > 0) {
        await chargeAccount({ customerId: customer._id, amountPaisa: onAccountPaisa, ref, by: actor, overLimit: can(actor, "manageCredit") }, session);
      }
      if (oversold) Object.assign(set, { negativeOverride: true, approvedBy });
      return saleModel.findByIdAndUpdate(_id, { $set: set }, { new: true, session }).lean();
    });
    return { sale: publicSale(sale, actor), repeated: false };
  } catch (error) {
    // The same request arrived twice at once: the other one saved it
    if (isDuplicateKey(error) && input.requestId) {
      const repeat = await saleModel.findOne({ requestId: input.requestId }).lean();
      if (repeat) return { sale: publicSale(repeat, actor), repeated: true };
    }
    // Without transactions nothing is undone for us
    if (!(await supportsTransactions())) {
      await undoStock(_id);
      await undoAccount(_id);
      if (input.prescriptionId) await undoDispense({ prescriptionId: input.prescriptionId, lines: priced, saleId: _id });
      await saleModel.deleteOne({ _id });
    }
    throw error;
  }
};

export const getSale = async (id, actor) => {
  const sale = await saleModel.findById(id).lean();
  if (!sale) throw notFound("Sale");
  return publicSale(sale, actor);
};

// A receipt number typed at the counter (returns)
export const saleByNumber = async (saleNo, actor) => {
  const sale = await saleModel.findOne({ saleNo }).lean();
  if (!sale) throw notFound(`Bill ${saleNo}`);
  return publicSale(sale, actor);
};

// A shift's sales, newest first. Cashiers: only their own shift.
export const listSales = async ({ shiftId, limit = 50, cursor }, actor, ownShiftId) => {
  const filter = {};
  if (!can(actor, "viewReports")) filter.shiftId = ownShiftId || "none";
  else if (shiftId) filter.shiftId = shiftId;
  const size = Math.min(200, limit);
  const after = cursor && /^\d+_[a-f0-9]{24}$/.test(cursor) ? cursor.split("_") : null;
  const page = after
    ? { $and: [filter, { $or: [{ createdAt: { $lt: new Date(Number(after[0])) } }, { createdAt: new Date(Number(after[0])), _id: { $lt: new mongoose.Types.ObjectId(after[1]) } }] }] }
    : filter;
  const rows = await saleModel.find(page).sort({ createdAt: -1, _id: -1 }).limit(size + 1).select("-items.allocations").lean();
  const items = rows.slice(0, size);
  return { sales: items.map((s) => publicSale(s, actor)), nextCursor: rows.length > size ? `${items.at(-1).createdAt.getTime()}_${items.at(-1)._id}` : null };
};

// --- Held bills ---
export const holdBill = async ({ label, items }, actor) => {
  const { priced, subtotalPaisa } = await priceCart(items);
  const held = await heldBillModel.create({
    label,
    by: actor,
    items: priced.map((l) => ({ productId: String(l.product._id), name: l.product.name, qtyUnits: l.qtyUnits })),
    totalPaisa: subtotalPaisa,
  });
  return held.toObject();
};

export const listHeld = () => heldBillModel.find().sort({ createdAt: -1 }).limit(100).lean();

// Picked up at one counter: gone from the list at once (two counters can't both take it)
export const takeHeld = async (id) => {
  const held = await heldBillModel.findOneAndDelete({ _id: id }).lean();
  if (!held) throw new PharmacyError("This bill was already picked up or removed", { status: 404, code: "not_found" });
  return held;
};
