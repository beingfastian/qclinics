// Same sums as the server (backend modules/pharmacy/services/pricing.js and
// returnService.refundFor), so the counter shows the right total as items are added.
// The server always prices the bill itself; this is only for the screen.

// Full packs at the pack price, the rest at the unit price
export const linePrice = (product, qtyUnits) => {
  const per = product.unitsPerPack || 1;
  const packPrice = product.packPricePaisa ?? product.unitPricePaisa * per;
  if (per <= 1 || !product.packName) return qtyUnits * product.unitPricePaisa;
  const packs = Math.floor(qtyUnits / per);
  return packs * packPrice + (qtyUnits - packs * per) * product.unitPricePaisa;
};

// What returning units [from, from + n) of a bill line refunds (its share of the bill after discount)
export const refundFor = (sale, line, from, n) => {
  const net = sale.subtotalPaisa ? Math.round((line.lineTotalPaisa * sale.totalPaisa) / sale.subtotalPaisa) : 0;
  return Math.round((net * (from + n)) / line.qtyUnits) - Math.round((net * from) / line.qtyUnits);
};

// Notes a customer is likely to hand over for this total (Rs): exact, then round-ups
export const cashSuggestions = (totalPaisa) => {
  const rupees = Math.ceil(totalPaisa / 100);
  const out = new Set([rupees]);
  for (const step of [10, 50, 100, 500, 1000, 5000]) {
    const up = Math.ceil(rupees / step) * step;
    if (up >= rupees) out.add(up);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5).map((r) => r * 100);
};
