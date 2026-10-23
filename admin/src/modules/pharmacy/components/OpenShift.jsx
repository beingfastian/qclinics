import { useState } from "react";
import { toast } from "react-toastify";
import { FaCashRegister } from "react-icons/fa";
import { Button, Card, Field, Input, Page } from "../../../components/ui";
import { pharmacyPost, errorText, toPaisa } from "../api";

// Before the first sale: count the cash in the drawer. At closing, the drawer
// should hold this plus cash sales minus cash refunds.
const OpenShift = ({ onOpened }) => {
  const [cash, setCash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async (e) => {
    e.preventDefault();
    const openingCashPaisa = toPaisa(cash);
    if (!cash.trim() || openingCashPaisa === null) return setError("Count the cash in the drawer and enter it (0 if empty)");
    setBusy(true);
    try {
      const data = await pharmacyPost("/shifts/open", { openingCashPaisa });
      toast.success(data.message);
      onOpened(data.shift);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page narrow>
      <Card className="mx-auto mt-8 max-w-md">
        <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-slate-900">
          <FaCashRegister className="text-primary-700" aria-hidden="true" /> Open your shift
        </h1>
        <p className="mb-4 text-sm text-slate-600">Count the cash in the drawer before the first sale. You’ll count it again when you close.</p>
        <form onSubmit={open} noValidate className="space-y-3">
          <Field label="Cash in the drawer (Rs)" htmlFor="sh-open" required error={error}>
            <Input id="sh-open" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} invalid={Boolean(error)} autoFocus />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Open shift</Button>
        </form>
      </Card>
    </Page>
  );
};

export default OpenShift;
