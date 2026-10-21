// Who may do what in the pharmacy. Checked on the server for every request (the
// staff app only hides buttons). The owner (admin login) may do everything.
//
//   manager  runs the pharmacy: medicines and prices, purchases, suppliers, stock
//            corrections, profit and reports, returns without a bill, selling
//            stock that isn't entered yet (logged), and selling at the counter
//   cashier  sells at the counter: their own shift, held bills, returns with a bill
export const ROLES = ["manager", "cashier"];

export const PERMISSIONS = {
  sell: ["manager", "cashier"],
  returnWithBill: ["manager", "cashier"],
  returnWithoutBill: ["manager"],
  manageStock: ["manager"],
  overrideNegativeStock: ["manager"],
  viewProfit: ["manager"],
  viewReports: ["manager"],
};

export const can = (actor, permission) =>
  actor?.role === "owner" || (PERMISSIONS[permission] || []).includes(actor?.role);

// Everything this actor may do, for the staff app to show the right screens
export const permissionsOf = (actor) => Object.keys(PERMISSIONS).filter((permission) => can(actor, permission));
