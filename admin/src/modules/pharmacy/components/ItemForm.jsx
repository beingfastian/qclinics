import { useState } from "react";
import { toast } from "react-toastify";
import { Button, Field, Input, Modal, Select } from "../../../components/ui";
import { pharmacyPost, pharmacyPut, errorText, toPaisa, toRupeesText } from "../api";

// Add or edit an item. Prices are typed in rupees and sent in paisa. Stock isn't
// typed here: it comes from purchases (and corrections), so it always has a batch.
const FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "drops", "cream", "ointment", "inhaler", "sachet", "other"];
const CATEGORIES = [
  ["medicine", "Medicine"],
  ["surgical", "Surgical"],
  ["cosmetic", "Cosmetic"],
  ["baby", "Baby care"],
  ["other", "Other"],
];

const fromProduct = (p) => ({
  name: p?.name || "",
  category: p?.category || "medicine",
  salt: p?.salt || "",
  strength: p?.strength || "",
  form: p?.form || "tablet",
  manufacturer: p?.manufacturer || "",
  variant: p?.variant || "",
  barcodes: (p?.barcodes || []).join(", "),
  unitName: p?.unitName || "tablet",
  packName: p?.packName || "strip",
  unitsPerPack: String(p?.unitsPerPack || 10),
  unitPrice: toRupeesText(p?.unitPricePaisa),
  packPrice: toRupeesText(p?.packPricePaisa),
  reorderLevelUnits: String(p?.reorderLevelUnits ?? 0),
  trackExpiry: p?.trackExpiry ?? true,
  active: p?.active ?? true,
});

const ItemForm = ({ product, onClose, onSaved }) => {
  const editing = Boolean(product);
  const [form, setForm] = useState(() => fromProduct(product));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const problems = {};
    const unitPricePaisa = toPaisa(form.unitPrice);
    const packPricePaisa = toPaisa(form.packPrice);
    const unitsPerPack = Number(form.unitsPerPack);
    const reorderLevelUnits = Number(form.reorderLevelUnits || 0);
    if (!form.name.trim()) problems.name = "Enter the item name";
    if (unitPricePaisa === null || !form.unitPrice.trim()) problems.unitPricePaisa = "Enter the price (e.g. 3.50)";
    if (packPricePaisa === null) problems.packPricePaisa = "Enter a price like 30 or 30.50";
    if (!Number.isInteger(unitsPerPack) || unitsPerPack < 1) problems.unitsPerPack = "At least 1";
    if (!Number.isInteger(reorderLevelUnits) || reorderLevelUnits < 0) problems.reorderLevelUnits = "A whole number";
    setErrors(problems);
    if (Object.keys(problems).length) return;

    const body = {
      name: form.name.trim(),
      category: form.category,
      salt: form.salt,
      strength: form.strength,
      form: form.form,
      manufacturer: form.manufacturer,
      variant: form.variant,
      barcodes: [...new Set(form.barcodes.split(/[\s,]+/).filter(Boolean))],
      unitName: form.unitName.trim() || "unit",
      packName: form.packName.trim(),
      unitsPerPack,
      unitPricePaisa,
      ...(form.packPrice.trim() && { packPricePaisa }),
      trackExpiry: form.trackExpiry,
      reorderLevelUnits,
      ...(editing && { active: form.active }),
    };
    setBusy(true);
    try {
      const data = editing ? await pharmacyPut(`/products/${product._id}`, body) : await pharmacyPost("/products", body);
      toast.success(data.message);
      onSaved(data.product);
    } catch (error) {
      setErrors(error?.response?.data?.fields || {});
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const perPack = Number(form.unitsPerPack) || 1;
  const unitPaisa = toPaisa(form.unitPrice);
  return (
    <Modal
      title={editing ? `Edit ${product.name}` : "Add item"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="item-form" loading={busy}>
            {editing ? "Save" : "Add item"}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={save} noValidate className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="it-name" required error={errors.name} className="sm:col-span-2">
          <Input id="it-name" value={form.name} onChange={set("name")} invalid={Boolean(errors.name)} placeholder="e.g. Panadol" autoComplete="off" autoFocus />
        </Field>
        <Field label="Salt (formula)" htmlFor="it-salt" hint="Used to find substitutes">
          <Input id="it-salt" value={form.salt} onChange={set("salt")} placeholder="e.g. Paracetamol" autoComplete="off" />
        </Field>
        <Field label="Strength" htmlFor="it-strength">
          <Input id="it-strength" value={form.strength} onChange={set("strength")} placeholder="e.g. 500 mg" autoComplete="off" />
        </Field>
        <Field label="Type" htmlFor="it-category">
          <Select id="it-category" value={form.category} onChange={set("category")}>
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Form" htmlFor="it-form">
          <Select id="it-form" value={form.form} onChange={set("form")}>
            {FORMS.map((f) => (
              <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Company" htmlFor="it-maker">
          <Input id="it-maker" value={form.manufacturer} onChange={set("manufacturer")} autoComplete="off" />
        </Field>
        <Field label="Size / variant" htmlFor="it-variant" hint="For items like diapers: Small, Medium">
          <Input id="it-variant" value={form.variant} onChange={set("variant")} autoComplete="off" />
        </Field>
        <Field label="Sold by the" htmlFor="it-unit" hint="The smallest unit you sell" error={errors.unitName}>
          <Input id="it-unit" value={form.unitName} onChange={set("unitName")} placeholder="tablet, bottle, piece" autoComplete="off" />
        </Field>
        <Field label="Pack name" htmlFor="it-pack" hint="Leave empty if it isn't sold in packs">
          <Input id="it-pack" value={form.packName} onChange={set("packName")} placeholder="strip, box" autoComplete="off" />
        </Field>
        <Field label={`${form.unitName || "Units"} in one ${form.packName || "pack"}`} htmlFor="it-per" required error={errors.unitsPerPack}>
          <Input id="it-per" type="number" min="1" inputMode="numeric" value={form.unitsPerPack} onChange={set("unitsPerPack")} invalid={Boolean(errors.unitsPerPack)} />
        </Field>
        <Field label={`Price of one ${form.unitName || "unit"} (Rs)`} htmlFor="it-price" required error={errors.unitPricePaisa}>
          <Input id="it-price" inputMode="decimal" value={form.unitPrice} onChange={set("unitPrice")} invalid={Boolean(errors.unitPricePaisa)} placeholder="3.50" />
        </Field>
        {form.packName && perPack > 1 && (
          <Field
            label={`Price of one ${form.packName} (Rs)`}
            htmlFor="it-packprice"
            error={errors.packPricePaisa}
            hint={unitPaisa ? `Empty: ${perPack} × ${form.unitPrice || 0} = Rs ${(unitPaisa * perPack) / 100}` : "Empty: worked out from the unit price"}
          >
            <Input id="it-packprice" inputMode="decimal" value={form.packPrice} onChange={set("packPrice")} invalid={Boolean(errors.packPricePaisa)} />
          </Field>
        )}
        <Field label={`Warn when stock is at or below (${form.unitName || "units"})`} htmlFor="it-reorder" error={errors.reorderLevelUnits}>
          <Input id="it-reorder" type="number" min="0" inputMode="numeric" value={form.reorderLevelUnits} onChange={set("reorderLevelUnits")} />
        </Field>
        <Field label="Barcodes" htmlFor="it-barcodes" hint="Scan into this box; separate several with commas" error={errors.barcodes} className="sm:col-span-2">
          <Input
            id="it-barcodes"
            value={form.barcodes}
            onChange={set("barcodes")}
            // A scanner ends with Enter: add a comma instead of submitting the form
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (form.barcodes.trim() && !/,\s*$/.test(form.barcodes)) setForm({ ...form, barcodes: `${form.barcodes.trim()}, ` });
              }
            }}
            autoComplete="off"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={form.trackExpiry} onChange={set("trackExpiry")} className="h-4 w-4" />
          Has an expiry date (asked on every purchase)
        </label>
        {editing && (
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={form.active} onChange={set("active")} className="h-4 w-4" />
            In use (turned off items don’t show at the counter)
          </label>
        )}
      </form>
    </Modal>
  );
};

export default ItemForm;
