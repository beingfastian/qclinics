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

// --- The counter: shifts, sales, held bills, returns ---
const qty = z.number({ invalid_type_error: "Enter a quantity" }).int("Whole units only").min(1, "At least 1").max(100_000);
const cartItems = z
  .array(z.object({ productId: objectId, qtyUnits: qty, rxLine: z.number().int().min(0).max(200).optional() }))
  .min(1, "The bill is empty")
  .max(200);
const requestId = z.string().trim().min(8).max(80).optional();

export const openShiftSchema = z.object({ openingCashPaisa: paisa });
export const closeShiftSchema = z.object({ countedCashPaisa: paisa, note: text(300).default("") });
export const shiftListSchema = z.object({ limit: limitQuery, cursor: z.string().max(100).optional() });

export const createSaleSchema = z.object({
  items: cartItems,
  discountPaisa: paisa.default(0),
  paymentMethod: z.enum(["cash", "card", "online", "account"]).default("cash"),
  cashReceivedPaisa: paisa.optional(),
  expectedTotalPaisa: paisa.optional(),
  customerName: text(80).default(""),
  customerPhone: text(30).default(""),
  allowNegative: z.boolean().default(false),
  managerApproval: z.object({ email: z.string().trim().max(120), password: z.string().max(100) }).optional(),
  customerId: objectId.optional(),
  prescriptionId: objectId.optional(),
  requestId,
});
export const saleListSchema = z.object({ shiftId: objectId.optional(), limit: limitQuery, cursor: z.string().max(100).optional() });
export const saleNoParam = z.object({ no: z.coerce.number().int().min(1).max(1e9) });

export const holdBillSchema = z.object({ label: text(60).default(""), items: cartItems });

export const createReturnSchema = z
  .object({
    saleId: objectId.optional(),
    items: z
      .array(
        z.object({
          saleItemId: objectId.optional(),
          productId: objectId.optional(),
          qtyUnits: qty,
          refundPaisa: paisa.optional(),
        })
      )
      .min(1, "Choose what is returned")
      .max(200),
    reason: text(200).default(""),
    requestId,
  })
  .refine((r) => r.items.every((i) => (r.saleId ? i.saleItemId : i.productId)), "Each line needs the bill line (with a bill) or the item (without)");

// --- Reports: local days "yyyy-mm-dd", both included ---
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-23")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a real date");
export const reportRangeSchema = z.object({ from: isoDay, to: isoDay });
export const itemsReportSchema = reportRangeSchema.extend({
  sort: z.enum(["revenue", "units", "profit"]).default("revenue"),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

// --- Khata ---
const creditLimit = paisa.nullable();
const customerFields = z.object({
  name: z.string().trim().min(1, "Enter the customer's name").max(80),
  phone: text(30),
  address: text(200),
  notes: text(300),
  creditLimitPaisa: creditLimit,
  active: z.boolean(),
});
export const createCustomerSchema = customerFields.extend({
  phone: text(30).default(""),
  address: text(200).default(""),
  notes: text(300).default(""),
  creditLimitPaisa: creditLimit.optional(),
  active: z.boolean().default(true),
});
export const updateCustomerSchema = customerFields.partial().refine((value) => Object.keys(value).length > 0, "Nothing to change");
export const customerListSchema = z.object({ q: text(60).optional(), owing: boolQuery, limit: limitQuery });
export const statementSchema = z.object({ limit: limitQuery, cursor: z.string().max(100).optional() });
export const customerPaymentSchema = z.object({
  amountPaisa: paisa.refine((v) => v > 0, "Enter the amount"),
  method: z.enum(["cash", "card", "online"]).default("cash"),
  note: text(200).default(""),
  requestId,
});
export const supplierPaymentSchema = z.object({
  amountPaisa: paisa.refine((v) => v > 0, "Enter the amount"),
  method: z.enum(["cash", "bank", "cheque", "online"]).default("cash"),
  reference: text(60).default(""),
  note: text(200).default(""),
  paidOn: optionalDate,
  fromDrawer: z.boolean().default(false),
  requestId,
});

// --- Prescriptions from the hospital's doctors ---
export const rxListSchema = z.object({
  status: z.enum(["open", "waiting", "partly", "dispensed", "closed", "cancelled", "all"]).default("open"),
  q: text(60).optional(),
  limit: limitQuery,
  cursor: z.string().max(100).optional(),
});
export const rxCloseSchema = z.object({ note: z.string().trim().min(1, "Write why it's closed").max(200) });
