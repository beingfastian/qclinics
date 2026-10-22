// Medicines and other items, suppliers. Costs are shown only to those who may see
// them (manager, owner): cashiers never receive cost prices from the server.
import mongoose from "mongoose";
import { productModel, saltKeyOf } from "../models/productModel.js";
import { batchModel } from "../models/stockModels.js";
import { supplierModel } from "../models/purchaseModels.js";
import { PharmacyError, notFound } from "../http.js";
import { isDuplicateKey } from "../../../lib/transactions.js";
import { can } from "../permissions.js";

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const canSeeCost = (actor) => can(actor, "viewProfit") || can(actor, "manageStock");

const PAGE = 50;
const MAX_PAGE = 200;

export const publicProduct = (p, actor) => {
  const out = {
    _id: String(p._id),
    name: p.name,
    category: p.category,
    salt: p.salt,
    strength: p.strength,
    form: p.form,
    manufacturer: p.manufacturer,
    variant: p.variant,
    barcodes: p.barcodes || [],
    unitName: p.unitName,
    packName: p.packName,
    unitsPerPack: p.unitsPerPack,
    unitPricePaisa: p.unitPricePaisa,
    packPricePaisa: p.packPricePaisa ?? p.unitPricePaisa * p.unitsPerPack,
    trackExpiry: p.trackExpiry,
    reorderLevelUnits: p.reorderLevelUnits,
    active: p.active,
    stockUnits: p.stockUnits,
  };
  if (canSeeCost(actor)) out.lastCostPerUnitPaisa = p.lastCostPerUnitPaisa;
  return out;
};

const duplicateBarcode = () => new PharmacyError("This barcode is already used by another item", { status: 409, code: "barcode_taken" });

const checkBarcodes = async (barcodes, exceptId) => {
  if (!barcodes?.length) return;
  const other = await productModel.findOne({ barcodes: { $in: barcodes }, ...(exceptId && { _id: { $ne: exceptId } }) }).select("name").lean();
  if (other) throw new PharmacyError(`This barcode is already used by ${other.name}`, { status: 409, code: "barcode_taken" });
};

export const createProduct = async (input, actor) => {
  await checkBarcodes(input.barcodes);
  try {
    return publicProduct((await productModel.create(input)).toObject(), actor);
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateBarcode();
    throw error;
  }
};

export const updateProduct = async (id, input, actor) => {
  const product = await productModel.findById(id);
  if (!product) throw notFound("Item");
  if (input.barcodes) await checkBarcodes(input.barcodes, id);
  Object.assign(product, input);
  try {
    await product.save(); // runs the hooks that keep the search keys right
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateBarcode();
    throw error;
  }
  return publicProduct(product.toObject(), actor);
};

// Search by name or salt (start of the word, any case), or an exact barcode.
// One page, sorted by name; nextCursor for the next page.
export const listProducts = async ({ q, category, active, lowStock, limit, cursor }, actor) => {
  const filter = {};
  const text = String(q || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
  if (text) {
    const prefix = new RegExp(`^${escapeRegex(text)}`);
    filter.$or = [{ nameKey: prefix }, { saltKey: prefix }, { barcodes: String(q).trim() }];
  }
  if (category) filter.category = category;
  if (active !== undefined) filter.active = active;
  if (lowStock) filter.$expr = { $lte: ["$stockUnits", "$reorderLevelUnits"] };
  const size = Math.min(MAX_PAGE, limit || PAGE);
  const after = cursor && /^[^\n]*\n[a-f0-9]{24}$/.test(cursor) ? cursor.split("\n") : null;
  const page = after
    ? { $and: [filter, { $or: [{ nameKey: { $gt: after[0] } }, { nameKey: after[0], _id: { $gt: new mongoose.Types.ObjectId(after[1]) } }] }] }
    : filter;
  const rows = await productModel.find(page).sort({ nameKey: 1, _id: 1 }).limit(size + 1).lean();
  const items = rows.slice(0, size);
  return {
    products: items.map((p) => publicProduct(p, actor)),
    nextCursor: rows.length > size ? `${items.at(-1).nameKey}\n${items.at(-1)._id}` : null,
  };
};

// One item with its batches on the shelf (cost only for those who may see it)
export const getProduct = async (id, actor) => {
  const product = await productModel.findById(id).lean();
  if (!product) throw notFound("Item");
  const now = new Date();
  const batches = await batchModel.find({ productId: id, qtyUnits: { $gt: 0 } }).sort({ expiry: 1, createdAt: 1 }).lean();
  return {
    product: publicProduct(product, actor),
    batches: batches.map((b) => ({
      _id: String(b._id),
      batchNo: b.batchNo,
      expiry: b.expiry,
      expired: Boolean(b.expiry && b.expiry <= now),
      qtyUnits: b.qtyUnits,
      receivedAt: b.createdAt,
      ...(canSeeCost(actor) && { costPerUnitPaisa: b.costPerUnitPaisa }),
    })),
  };
};

export const productByBarcode = async (code, actor) => {
  const product = await productModel.findOne({ barcodes: String(code).trim() }).lean();
  if (!product) throw notFound("Item with this barcode");
  return publicProduct(product, actor);
};

// Same salt and strength (e.g. other brands of paracetamol 500 mg), in stock first
export const substitutes = async (id, actor) => {
  const product = await productModel.findById(id).select("salt strength saltKey").lean();
  if (!product) throw notFound("Item");
  const key = product.saltKey || saltKeyOf(product.salt, product.strength);
  if (!key) return { substitutes: [] };
  const rows = await productModel.find({ saltKey: key, active: true, _id: { $ne: product._id } }).sort({ stockUnits: -1, nameKey: 1 }).limit(50).lean();
  return { substitutes: rows.map((p) => publicProduct(p, actor)) };
};

// --- Suppliers ---
const publicSupplier = (s) => ({ _id: String(s._id), name: s.name, phone: s.phone, address: s.address, notes: s.notes, active: s.active });

export const listSuppliers = async ({ q, active }) => {
  const filter = {};
  const text = String(q || "").trim().toLowerCase().slice(0, 60);
  if (text) filter.nameKey = new RegExp(`^${escapeRegex(text)}`);
  if (active !== undefined) filter.active = active;
  return (await supplierModel.find(filter).sort({ nameKey: 1 }).limit(500).lean()).map(publicSupplier);
};

export const createSupplier = async (input) => publicSupplier((await supplierModel.create(input)).toObject());

export const updateSupplier = async (id, input) => {
  const supplier = await supplierModel.findById(id);
  if (!supplier) throw notFound("Supplier");
  Object.assign(supplier, input);
  await supplier.save();
  return publicSupplier(supplier.toObject());
};
