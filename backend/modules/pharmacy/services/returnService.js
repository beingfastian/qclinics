// Returns, refunded in cash from the shift's drawer. One save (a transaction).
//
// With a bill: lines of that sale, at the price the customer paid (their share of
// the bill discount taken off), never more than was sold; the stock goes back to
// the batches it came from. Two counters returning the same line at once can't
// both succeed (the returned count only moves while it stays within what was sold).
//
// Without a bill (managers only): the item and refund are entered at the counter;
// the stock goes back to the item's batch that expires last.
import mongoose from "mongoose";
import { returnModel, saleModel } from "../models/salesModels.js";
import { productModel } from "../models/productModel.js";
import { nextNumber } from "../models/stockModels.js";
import { putBack, undoStock } from "./stockService.js";
import { linePrice } from "./pricing.js";
import { requireShift, touchShift } from "./shiftService.js";
import { PharmacyError, notFound } from "../http.js";
import { can } from "../permissions.js";
import { inTransaction, isDuplicateKey, supportsTransactions } from "../../../lib/transactions.js";

const publicReturn = (r, actor) => {
  const out = { ...r, _id: String(r._id) };
  if (!can(actor, "viewProfit")) {
    delete out.costPaisa;
    out.items = r.items.map(({ costPaisa, ...item }) => item);
  }
  return out;
};

// What units [from, from + n) of a line refund: the line's share of the bill after
// its discount, split so that returning a line in parts adds up exactly to all of it
const refundFor = (sale, line, from, n) => {
  const net = sale.subtotalPaisa ? Math.round((line.lineTotalPaisa * sale.totalPaisa) / sale.subtotalPaisa) : 0;
  return Math.round((net * (from + n)) / line.qtyUnits) - Math.round((net * from) / line.qtyUnits);
};

// Which batches units [from, from + n) of a line go back to: the last ones taken
// first (the batch expiring latest), so a part return leaves the earlier ones sold
const batchesFor = (line, from, n) => {
  const parts = [];
  let skip = from;
  let left = n;
  for (const a of [...line.allocations].reverse()) {
    if (!left) break;
    const usable = a.qtyUnits - Math.min(skip, a.qtyUnits);
    skip = Math.max(0, skip - a.qtyUnits);
    const take = Math.min(usable, left);
    if (take > 0) {
      parts.push({ batchId: a.batchId, negativeOverride: a.negativeOverride, costPerUnitPaisa: a.costPerUnitPaisa, units: take });
      left -= take;
    }
  }
  return parts;
};

export const createReturn = async (input, actor) => {
  if (input.requestId) {
    const repeat = await returnModel.findOne({ requestId: input.requestId }).lean();
    if (repeat) return { return: publicReturn(repeat, actor), repeated: true };
  }
  const withoutBill = !input.saleId;
  if (withoutBill && !can(actor, "returnWithoutBill")) {
    throw new PharmacyError("Returns without a bill need the manager", { status: 403, code: "forbidden" });
  }
  if (withoutBill && !input.reason) throw new PharmacyError("Write the reason for a return without a bill", { code: "invalid" });
  const shift = await requireShift(actor);

  let sale = null;
  let lines;
  if (!withoutBill) {
    sale = await saleModel.findById(input.saleId).lean();
    if (!sale) throw notFound("Bill");
    const wanted = new Map();
    for (const item of input.items) wanted.set(item.saleItemId, (wanted.get(item.saleItemId) || 0) + item.qtyUnits);
    lines = [...wanted].map(([saleItemId, qtyUnits]) => {
      const line = sale.items.find((l) => String(l._id) === saleItemId);
      if (!line) throw new PharmacyError("That item isn't on this bill", { code: "invalid" });
      const left = line.qtyUnits - line.returnedUnits;
      if (qtyUnits > left) {
        throw new PharmacyError(left ? `Only ${left} ${line.unitName}s of ${line.name} can still be returned` : `${line.name} was already returned`, {
          status: 409,
          code: "over_return",
          extra: { saleItemId, returnableUnits: left },
        });
      }
      return { line, qtyUnits, refundPaisa: refundFor(sale, line, line.returnedUnits, qtyUnits) };
    });
  } else {
    const products = new Map((await productModel.find({ _id: { $in: input.items.map((i) => i.productId) } }).lean()).map((p) => [String(p._id), p]));
    lines = input.items.map((item) => {
      const product = products.get(item.productId);
      if (!product) throw notFound("Item");
      return { product, qtyUnits: item.qtyUnits, refundPaisa: item.refundPaisa ?? linePrice(product, item.qtyUnits) };
    });
  }
  const totalRefundPaisa = lines.reduce((sum, l) => sum + l.refundPaisa, 0);

  await returnModel.init();
  const _id = new mongoose.Types.ObjectId();
  const counted = []; // returned counts moved on the sale (undone by hand without transactions)
  try {
    const saved = await inTransaction(async (session) => {
      counted.length = 0;
      await touchShift(shift._id, session);
      const returnNo = await nextNumber("return", session);
      const ref = { kind: "return", id: String(_id), no: String(returnNo) };
      await returnModel.create(
        [
          {
            _id,
            returnNo,
            shiftId: String(shift._id),
            by: actor,
            ...(sale && { saleId: String(sale._id), saleNo: sale.saleNo }),
            withoutBill,
            items: lines.map((l) => ({
              productId: l.line?.productId || String(l.product._id),
              name: l.line?.name || l.product.name,
              unitName: l.line?.unitName || l.product.unitName,
              ...(l.line && { saleItemId: String(l.line._id) }),
              qtyUnits: l.qtyUnits,
              refundPaisa: l.refundPaisa,
            })),
            totalRefundPaisa,
            reason: input.reason,
            ...(input.requestId && { requestId: input.requestId }),
          },
        ],
        { session }
      );
      const set = {};
      let costPaisa = 0;
      for (const [i, l] of lines.entries()) {
        let lineCost = 0;
        if (l.line) {
          // Only while it stays within what was sold (another counter may have just returned it)
          const moved = await saleModel.findOneAndUpdate(
            { _id: sale._id, items: { $elemMatch: { _id: l.line._id, returnedUnits: { $lte: l.line.qtyUnits - l.qtyUnits } } } },
            { $inc: { "items.$.returnedUnits": l.qtyUnits, refundedPaisa: l.refundPaisa } },
            { session, projection: { items: { $elemMatch: { _id: l.line._id } } } }
          ).lean();
          if (!moved) throw new PharmacyError(`${l.line.name} was already returned`, { status: 409, code: "over_return" });
          counted.push(l);
          const product = { _id: l.line.productId };
          for (const part of batchesFor(l.line, moved.items[0].returnedUnits, l.qtyUnits)) {
            await putBack({ product, ...part, units: part.units, ref, by: actor }, session);
            lineCost += part.units * part.costPerUnitPaisa;
          }
        } else {
          const back = await putBack({ product: l.product, units: l.qtyUnits, ref, by: actor }, session);
          lineCost = l.qtyUnits * back.costPerUnitPaisa;
        }
        set[`items.${i}.costPaisa`] = Math.round(lineCost);
        costPaisa += Math.round(lineCost);
      }
      set.costPaisa = costPaisa;
      return returnModel.findByIdAndUpdate(_id, { $set: set }, { new: true, session }).lean();
    });
    return { return: publicReturn(saved, actor), repeated: false };
  } catch (error) {
    if (isDuplicateKey(error) && input.requestId) {
      const repeat = await returnModel.findOne({ requestId: input.requestId }).lean();
      if (repeat) return { return: publicReturn(repeat, actor), repeated: true };
    }
    if (!(await supportsTransactions())) {
      await undoStock(_id);
      for (const l of counted) {
        await saleModel.updateOne({ _id: sale._id, "items._id": l.line._id }, { $inc: { "items.$.returnedUnits": -l.qtyUnits, refundedPaisa: -l.refundPaisa } });
      }
      await returnModel.deleteOne({ _id });
    }
    throw error;
  }
};

export const getReturn = async (id, actor) => {
  const r = await returnModel.findById(id).lean();
  if (!r) throw notFound("Return");
  return publicReturn(r, actor);
};
