import { FieldValue } from '../../firebase';

export default function getPaymentUpdateFields(hasPriorPayment: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    lastPaidAt: FieldValue.serverTimestamp(),
  };
  if (!hasPriorPayment) {
    fields.firstPaidAt = FieldValue.serverTimestamp();
  }
  return fields;
}
