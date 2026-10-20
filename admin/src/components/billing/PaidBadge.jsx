import { Badge } from "../ui";

// Lab request paid at reception or not (billing on). Cancelled requests show nothing.
export const PaidBadge = ({ order }) => {
  if (order.status === "cancelled") return null;
  return order.payment?.receiptNo ? (
    <Badge tone="success" title={`Receipt ${order.payment.receiptNo}`}>Paid</Badge>
  ) : (
    <Badge tone="warning" title="Lab charges are collected at reception">Not paid</Badge>
  );
};
