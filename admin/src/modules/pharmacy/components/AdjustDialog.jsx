import { useState } from "react";
import { toast } from "react-toastify";
import { Button, Field, Input, Modal, Segmented } from "../../../components/ui";
import { pharmacyPost, errorText, stockText, expiryText } from "../api";

// Manager correction on one batch. Counted more or less than the system says, or
// stock to write off (expired, damaged). Always with a reason; kept in the history.
const AdjustDialog = ({ product, batch, onClose, onSaved }) => {
  const [type, setType] = useState("adjustment");
  const [direction, setDirection] = useState("remove");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const n = Number(qty);
    const problems = {};
    if (!Number.isInteger(n) || n < 1) problems.qty = "Enter how many";
    else if ((type !== "adjustment" || direction === "remove") && n > batch.qtyUnits) problems.qty = `This batch has only ${batch.qtyUnits}`;
    if (!reason.trim()) problems.reason = "Write the reason";
    setErrors(problems);
    if (Object.keys(problems).length) return;
    const deltaUnits = type === "adjustment" && direction === "add" ? n : -n;
    setBusy(true);
    try {
      const data = await pharmacyPost("/stock/adjust", { batchId: batch._id, deltaUnits, type, reason: reason.trim() });
      toast.success(data.message);
      onSaved();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Correct stock"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="adjust-form" loading={busy}>Save correction</Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">
        {product.name}, batch {batch.batchNo || "—"} ({expiryText(batch.expiry)}): {stockText(batch.qtyUnits, product)} in the system
      </p>
      <form id="adjust-form" onSubmit={save} noValidate className="space-y-3">
        <Segmented
          label="Kind of correction"
          value={type}
          onChange={setType}
          options={[
            { value: "adjustment", label: "Count correction" },
            { value: "expired", label: "Expired" },
            { value: "damaged", label: "Damaged" },
          ]}
        />
        {type === "adjustment" && (
          <Segmented
            label="Add or take off"
            value={direction}
            onChange={setDirection}
            size="sm"
            options={[
              { value: "remove", label: "Fewer on the shelf" },
              { value: "add", label: "More on the shelf" },
            ]}
          />
        )}
        <Field label={`How many ${product.unitName}s`} htmlFor="adj-qty" required error={errors.qty}>
          <Input id="adj-qty" type="number" min="1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} invalid={Boolean(errors.qty)} autoFocus />
        </Field>
        <Field label="Reason" htmlFor="adj-reason" required error={errors.reason}>
          <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} invalid={Boolean(errors.reason)} placeholder="e.g. Counted on shelf, strip torn" />
        </Field>
      </form>
    </Modal>
  );
};

export default AdjustDialog;
