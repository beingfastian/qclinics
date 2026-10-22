// Items, suppliers, purchases and stock. Who may do what (permissions.js):
//   sell        look items up (name, salt, barcode), substitutes, stock alerts
//   manageStock add/edit items and suppliers, purchases, corrections, stock history
// Cost prices only reach those who may see them (see catalogService.canSeeCost).
import { validate } from "../../../lib/validate.js";
import { handle } from "../http.js";
import { authPharmacy } from "../auth.js";
import * as catalog from "../services/catalogService.js";
import * as purchases from "../services/purchaseService.js";
import * as stock from "../services/stockViews.js";
import {
  idParam,
  createProductSchema,
  updateProductSchema,
  productListSchema,
  createSupplierSchema,
  updateSupplierSchema,
  supplierListSchema,
  createPurchaseSchema,
  purchaseListSchema,
  adjustSchema,
  expiringSchema,
  movementListSchema,
} from "../validation.js";

const actorRef = (req) => ({ role: req.actor.role, ...(req.actor.id && { id: req.actor.id }), name: req.actor.name });

export const mountStockRoutes = (router) => {
  // --- Items ---
  router.get("/products", authPharmacy("sell"), validate(productListSchema, "query"), handle(async (req) => catalog.listProducts(req.validatedQuery, req.actor)));
  router.get("/products/barcode/:code", authPharmacy("sell"), handle(async (req) => ({ product: await catalog.productByBarcode(req.params.code, req.actor) })));
  router.get("/products/:id", authPharmacy("sell"), validate(idParam, "params"), handle(async (req) => catalog.getProduct(req.params.id, req.actor)));
  router.get("/products/:id/substitutes", authPharmacy("sell"), validate(idParam, "params"), handle(async (req) => catalog.substitutes(req.params.id, req.actor)));
  router.post("/products", authPharmacy("manageStock"), validate(createProductSchema), handle(async (req) => ({ product: await catalog.createProduct(req.body, req.actor), message: "Item added" })));
  router.put(
    "/products/:id",
    authPharmacy("manageStock"),
    validate(idParam, "params"),
    validate(updateProductSchema),
    handle(async (req) => ({ product: await catalog.updateProduct(req.params.id, req.body, req.actor), message: "Item saved" }))
  );

  // --- Suppliers ---
  router.get("/suppliers", authPharmacy("manageStock"), validate(supplierListSchema, "query"), handle(async (req) => ({ suppliers: await catalog.listSuppliers(req.validatedQuery) })));
  router.post("/suppliers", authPharmacy("manageStock"), validate(createSupplierSchema), handle(async (req) => ({ supplier: await catalog.createSupplier(req.body), message: "Supplier added" })));
  router.put(
    "/suppliers/:id",
    authPharmacy("manageStock"),
    validate(idParam, "params"),
    validate(updateSupplierSchema),
    handle(async (req) => ({ supplier: await catalog.updateSupplier(req.params.id, req.body), message: "Supplier saved" }))
  );

  // --- Purchases ---
  router.post(
    "/purchases",
    authPharmacy("manageStock"),
    validate(createPurchaseSchema),
    handle(async (req) => {
      const { purchase, repeated } = await purchases.createPurchase(req.body, actorRef(req));
      return { purchase, repeated, message: `Purchase ${purchase.purchaseNo} saved` };
    })
  );
  router.get("/purchases", authPharmacy("manageStock"), validate(purchaseListSchema, "query"), handle(async (req) => purchases.listPurchases(req.validatedQuery)));
  router.get("/purchases/:id", authPharmacy("manageStock"), validate(idParam, "params"), handle(async (req) => ({ purchase: await purchases.getPurchase(req.params.id) })));

  // --- Stock ---
  router.get("/stock/expiring", authPharmacy("sell"), validate(expiringSchema, "query"), handle(async (req) => ({ batches: await stock.expiring(req.validatedQuery, req.actor) })));
  router.get("/stock/low", authPharmacy("sell"), handle(async () => ({ products: await stock.lowStock() })));
  router.get("/stock/movements", authPharmacy("manageStock"), validate(movementListSchema, "query"), handle(async (req) => stock.movements(req.validatedQuery)));
  router.post(
    "/stock/adjust",
    authPharmacy("manageStock"),
    validate(adjustSchema),
    handle(async (req) => ({ movement: await stock.adjust(req.body, actorRef(req)), message: "Stock corrected" }))
  );
};
