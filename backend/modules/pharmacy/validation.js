import mongoose from "mongoose";
import { z } from "zod";
import { ROLES } from "./permissions.js";
import { CATEGORIES, FORMS } from "./models/productModel.js";

// Request shapes for the pharmacy API (see lib/validate.js). Text is trimmed and
// limited in length; anything not listed is dropped.
const name = z.string().trim().min(1, "Enter a name").max(80);
const phone = z.string().trim().max(30);
const password = z.string().min(8, "At least 8 characters").max(100);

export const objectId = z.string().refine((value) => mongoose.isValidObjectId(value), "Not found");
export const idParam = z.object({ id: objectId });

export const createStaffSchema = z.object({
  name,
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(120),
  password,
  phone: phone.default(""),
  role: z.enum(ROLES, { errorMap: () => ({ message: "Choose manager or cashier" }) }),
});

export const updateStaffSchema = z
  .object({
    name: name.optional(),
    phone: phone.optional(),
    role: z.enum(ROLES, { errorMap: () => ({ message: "Choose manager or cashier" }) }).optional(),
    active: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");

// --- Stock: items, suppliers, purchases, corrections ---
// Money is in paisa (whole numbers): Rs 12.50 is 1250.
const paisa = z.number({ invalid_type_error: "Enter an amount" }).int("Whole paisa only").min(0, "Can't be negative").max(10_000_000_000);
const count = (max = 1_000_000) => z.number({ invalid_type_error: "Enter a number" }).int("Whole numbers only").min(0, "Can't be negative").max(max);
const text = (max) => z.string().trim().max(max);
const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.date({ invalid_type_error: "Enter a valid date" }).optional()
);
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true").optional();
const limitQuery = z.coerce.number().int().min(1).max(200).optional();

// No defaults here, so an update never resets fields it didn't send
const productFields = z.object({
  name: z.string().trim().min(1, "Enter the item name").max(120),
  category: z.enum(CATEGORIES),
  salt: text(120),
  strength: text(40),
  form: z.enum(FORMS),
  manufacturer: text(80),
  variant: text(40),
  barcodes: z
    .array(z.string().trim().min(1).max(64))
    .max(10)
    .refine((codes) => new Set(codes).size === codes.length, "The same barcode is listed twice"),
  unitName: z.string().trim().min(1).max(20),
  packName: text(20),
  unitsPerPack: z.number().int().min(1, "At least 1").max(10000),
  unitPricePaisa: paisa,
  packPricePaisa: paisa,
  trackExpiry: z.boolean(),
  reorderLevelUnits: count(),
  active: z.boolean(),
});

export const createProductSchema = productFields.extend({
  category: z.enum(CATEGORIES).default("medicine"),
  salt: text(120).default(""),
  strength: text(40).default(""),
  form: z.enum(FORMS).default("other"),
  manufacturer: text(80).default(""),
  variant: text(40).default(""),
  barcodes: productFields.shape.barcodes.default([]),
  unitName: z.string().trim().min(1).max(20).default("unit"),
  packName: text(20).default(""),
  unitsPerPack: z.number().int().min(1, "At least 1").max(10000).default(1),
  packPricePaisa: paisa.optional(),
  trackExpiry: z.boolean().default(true),
  reorderLevelUnits: count().default(0),
  active: z.boolean().default(true),
});

export const updateProductSchema = productFields.partial().refine((value) => Object.keys(value).length > 0, "Nothing to change");

export const productListSchema = z.object({
  q: text(60).optional(),
  category: z.enum(CATEGORIES).optional(),
  active: boolQuery,
  lowStock: boolQuery,
  limit: limitQuery,
  cursor: z.string().max(200).optional(),
});

const supplierFields = z.object({
  name: z.string().trim().min(1, "Enter the supplier name").max(120),
  phone: text(30),
  address: text(200),
  notes: text(300),
  active: z.boolean(),
});
export const createSupplierSchema = supplierFields.extend({
  phone: text(30).default(""),
  address: text(200).default(""),
  notes: text(300).default(""),
  active: z.boolean().default(true),
});
export const updateSupplierSchema = supplierFields.partial().refine((value) => Object.keys(value).length > 0, "Nothing to change");
export const supplierListSchema = z.object({ q: text(60).optional(), active: boolQuery });

export const createPurchaseSchema = z.object({
  supplierId: objectId,
  invoiceNo: text(60).default(""),
  invoiceDate: optionalDate,
  items: z
    .array(
      z.object({
        productId: objectId,
        batchNo: text(40).default(""),
        expiry: optionalDate,
        packs: count().default(0),
        looseUnits: count().default(0),
        bonusUnits: count().default(0),
        packCostPaisa: paisa,
        discountPaisa: paisa.default(0),
      })
    )
    .min(1, "Add at least one item")
    .max(200),
  paidPaisa: paisa.default(0),
  notes: text(300).default(""),
  requestId: z.string().trim().min(8).max(80).optional(),
});
export const purchaseListSchema = z.object({ supplierId: objectId.optional(), limit: limitQuery, cursor: z.string().max(100).optional() });

export const adjustSchema = z.object({
  batchId: objectId,
  deltaUnits: z.number().int("Whole units only").min(-1_000_000).max(1_000_000).refine((v) => v !== 0, "Enter how many to add or take off"),
  type: z.enum(["adjustment", "expired", "damaged"]),
  reason: z.string().trim().min(1, "Write the reason").max(200),
});
export const expiringSchema = z.object({ days: z.coerce.number().int().min(1).max(730).default(90) });
export const movementListSchema = z.object({ productId: objectId, limit: limitQuery, cursor: z.string().max(100).optional() });
