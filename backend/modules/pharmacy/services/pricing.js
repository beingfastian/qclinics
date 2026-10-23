// What a quantity of an item costs the customer. Full packs at the pack price,
// the rest at the unit price: 12 tablets of a Rs 30 strip of 10 at Rs 3.50 each
// = Rs 30 + 2 x Rs 3.50 = Rs 37. The staff app works it out the same way
// (admin/src/modules/pharmacy/pricing.js) to show the total as items are added.
export const linePrice = (product, qtyUnits) => {
  const per = product.unitsPerPack || 1;
  const packPrice = product.packPricePaisa ?? product.unitPricePaisa * per;
  if (per <= 1 || !product.packName) return qtyUnits * product.unitPricePaisa;
  const packs = Math.floor(qtyUnits / per);
  return packs * packPrice + (qtyUnits - packs * per) * product.unitPricePaisa;
};
