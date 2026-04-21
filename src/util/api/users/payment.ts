import { FieldValue } from '../../firebase';

export function getPaymentUpdateFields(hasPriorPayment: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    lastPaidAt: FieldValue.serverTimestamp(),
  };
  if (!hasPriorPayment) {
    fields.firstPaidAt = FieldValue.serverTimestamp();
  }
  return fields;
}

export function getCustomerType(
  user: { firstPaidAt?: unknown } | null | undefined,
): 'new' | 'returning' {
  return user?.firstPaidAt ? 'returning' : 'new';
}
