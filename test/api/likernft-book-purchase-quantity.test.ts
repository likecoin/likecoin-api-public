import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import {
  BookCartItemSchema,
  BookPurchaseNewBodySchema,
  MAX_PURCHASE_QUANTITY,
} from '../../src/util/api/likernft/book/schemas';

const BASE_URL = '/api/likernft/book/purchase';
const CLASS_ID = '0xquantitycap';

const post = (url: string, payload: Record<string, unknown>) => axiosist
  .post(url, payload)
  .catch((err) => (err as any).response);

describe('purchase quantity cap', () => {
  it('accepts the cap on single and cart purchases', () => {
    expect(BookPurchaseNewBodySchema.parse({ quantity: MAX_PURCHASE_QUANTITY }).quantity)
      .toBe(MAX_PURCHASE_QUANTITY);
    expect(BookCartItemSchema.parse({
      classId: CLASS_ID, priceIndex: 0, quantity: String(MAX_PURCHASE_QUANTITY),
    }).quantity).toBe(MAX_PURCHASE_QUANTITY);
  });

  it('rejects a single purchase over the cap with 400', async () => {
    const res = await post(`${BASE_URL}/${CLASS_ID}/new?price_index=0`, {
      quantity: MAX_PURCHASE_QUANTITY + 1,
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('INVALID_INPUT');
    expect(res.data.issues[0].path).toEqual(['quantity']);
  });

  it('rejects a cart item over the cap with 400', async () => {
    const res = await post(`${BASE_URL}/cart/new`, {
      items: [{ classId: CLASS_ID, priceIndex: 0, quantity: MAX_PURCHASE_QUANTITY + 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('INVALID_INPUT');
    expect(res.data.issues[0].path).toEqual(['items', 0, 'quantity']);
  });
});
