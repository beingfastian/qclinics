// Khata and labels. Who may do what (permissions.js):
//   sell          customers: find, add, edit (not the credit limit), see their
//                 account, take payments at the counter
//   manageCredit  credit limits; paying suppliers
//   manageStock   supplier accounts; shop barcodes for labels
import { validate } from "../../../lib/validate.js";
import { handle } from "../http.js";
import { authPharmacy } from "../auth.js";
import * as khata from "../services/khataService.js";
import { assignShopBarcode } from "../services/catalogService.js";
import { idParam, createCustomerSchema, updateCustomerSchema, customerListSchema, statementSchema, customerPaymentSchema, supplierPaymentSchema } from "../validation.js";

const actorRef = (req) => ({ role: req.actor.role, ...(req.actor.id && { id: req.actor.id }), name: req.actor.name });
const money = (paisa) => `Rs ${(paisa / 100).toLocaleString("en-PK")}`;

export const mountKhataRoutes = (router) => {
  // --- Customers ---
  router.get("/customers", authPharmacy("sell"), validate(customerListSchema, "query"), handle(async (req) => khata.listCustomers(req.validatedQuery)));
  router.post("/customers", authPharmacy("sell"), validate(createCustomerSchema), handle(async (req) => ({ customer: await khata.createCustomer(req.body, actorRef(req)), message: "Customer added" })));
  router.get("/customers/:id", authPharmacy("sell"), validate(idParam, "params"), handle(async (req) => ({ customer: await khata.getCustomer(req.params.id) })));
  router.put(
    "/customers/:id",
    authPharmacy("sell"),
    validate(idParam, "params"),
    validate(updateCustomerSchema),
    handle(async (req) => ({ customer: await khata.updateCustomer(req.params.id, req.body, actorRef(req)), message: "Customer saved" }))
  );
  router.get(
    "/customers/:id/statement",
    authPharmacy("sell"),
    validate(idParam, "params"),
    validate(statementSchema, "query"),
    handle(async (req) => khata.statement(req.params.id, req.validatedQuery))
  );
  router.post(
    "/customers/:id/payments",
    authPharmacy("sell"),
    validate(idParam, "params"),
    validate(customerPaymentSchema),
    handle(async (req) => {
      const { entry, customer, repeated } = await khata.receivePayment(req.params.id, req.body, actorRef(req));
      return { entry, customer, repeated, message: `${money(-entry.amountPaisa)} received from ${customer.name}` };
    })
  );

  // --- Suppliers ---
  router.get("/suppliers/:id/statement", authPharmacy("manageStock"), validate(idParam, "params"), handle(async (req) => khata.supplierStatement(req.params.id)));
  router.post(
    "/suppliers/:id/payments",
    authPharmacy("manageCredit"),
    validate(idParam, "params"),
    validate(supplierPaymentSchema),
    handle(async (req) => {
      const { payment, repeated } = await khata.paySupplier(req.params.id, req.body, actorRef(req));
      return { payment, repeated, message: `${money(payment.amountPaisa)} paid` };
    })
  );

  // --- Labels: a shop barcode for an item that has none ---
  router.post("/products/:id/shop-barcode", authPharmacy("manageStock"), validate(idParam, "params"), handle(async (req) => ({ product: await assignShopBarcode(req.params.id, req.actor), message: "Barcode added" })));
};
