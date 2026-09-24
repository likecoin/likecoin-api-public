import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { likeNFTBookCartCollection } from '../../src/util/firebase';
import {
  calculateBookAirdropAmountInLIKE,
  payBookPurchaseAirdrop,
} from '../../src/util/api/likernft/book/airdrop';
import { payLIKEAirdrop } from '../../src/util/airdrop';
import type { TransactionFeeInfo } from '../../src/util/api/likernft/book/type';

// vi.mock is hoisted above these imports; the `mock`-prefixed names are
// whitelisted by Vitest's factory scope check.
const mockTransferLIKE = vi.fn();
const mockGetBalance = vi.fn();

vi.mock('../../src/util/evm/likeCoin', () => ({
  transferLIKE: (...args: unknown[]) => mockTransferLIKE(...args),
  getAPIWalletLIKEBalance: () => mockGetBalance(),
  // Real implementation: whole LIKE -> 6-decimal base units.
  LIKEToTokenAmount: (amount: number) => BigInt(Math.floor(amount)) * (10n ** 6n),
}));

// test/setup.ts mocks likePrice globally; getLIKEPrice() resolves to 0.001 USD.
const LIKE_PRICE = 0.001;
const WALLET = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const TX_HASH = '0xdeadbeef00000000000000000000000000000000000000000000000000000000';
const RAW_TX = '0xf86c808504a817c800825208';
const NONCE = 42;

function makeFeeInfo(
  priceInDecimal: number,
  customPriceDiffInDecimal = 0,
): TransactionFeeInfo {
  return {
    priceInDecimal,
    customPriceDiffInDecimal,
    originalPriceInDecimal: priceInDecimal - customPriceDiffInDecimal,
    stripeFeeAmount: 0,
    likerLandTipFeeAmount: 0,
    likerLandFeeAmount: 0,
    likerLandCommission: 0,
    channelCommission: 0,
    likerLandArtFee: 0,
    royaltyToSplit: 0,
  };
}

async function seedCart(cartId: string, data: Record<string, unknown> = {}) {
  await likeNFTBookCartCollection.doc(cartId).create({ status: 'paid', ...data } as any);
}

async function getCart(cartId: string) {
  return (await likeNFTBookCartCollection.doc(cartId).get()).data() as any;
}

describe('calculateBookAirdropAmountInLIKE', () => {
  it('returns 1% of the net price converted to whole LIKE', () => {
    // $10.00 -> $0.10 -> 100 LIKE at $0.001
    expect(calculateBookAirdropAmountInLIKE(1000, 0, LIKE_PRICE)).toBe(100);
  });

  it('excludes the custom-price tip from the base', () => {
    // $15.00 paid of which $5.00 is a tip -> 1% of $10.00
    expect(calculateBookAirdropAmountInLIKE(1500, 500, LIKE_PRICE)).toBe(100);
  });

  it('floors to whole LIKE rather than rounding up', () => {
    // $1.99 -> $0.0199 -> 19.9 LIKE
    expect(calculateBookAirdropAmountInLIKE(199, 0, LIKE_PRICE)).toBe(19);
  });

  it('returns 0 when the payout would be under one LIKE', () => {
    // $0.05 -> $0.0005 -> 0.5 LIKE
    expect(calculateBookAirdropAmountInLIKE(5, 0, LIKE_PRICE)).toBe(0);
  });

  it('returns 0 for free carts and tip-only carts', () => {
    expect(calculateBookAirdropAmountInLIKE(0, 0, LIKE_PRICE)).toBe(0);
    expect(calculateBookAirdropAmountInLIKE(500, 500, LIKE_PRICE)).toBe(0);
  });

  it('returns 0 on an unusable LIKE price or ratio', () => {
    expect(calculateBookAirdropAmountInLIKE(1000, 0, 0)).toBe(0);
    expect(calculateBookAirdropAmountInLIKE(1000, 0, LIKE_PRICE, 0)).toBe(0);
  });
});

describe('payBookPurchaseAirdrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransferLIKE.mockResolvedValue({
      txHash: TX_HASH, rawSignedTx: RAW_TX, nonce: NONCE,
    });
    mockGetBalance.mockResolvedValue(10n ** 12n);
  });

  it('transfers the airdrop and records it on the cart', async () => {
    await seedCart('cart-paid');
    const txHash = await payBookPurchaseAirdrop({
      cartId: 'cart-paid',
      wallet: WALLET,
      feeInfo: makeFeeInfo(1000),
    });

    expect(txHash).toBe(TX_HASH);
    expect(mockTransferLIKE).toHaveBeenCalledWith(WALLET, 100n * (10n ** 6n));
    expect(await getCart('cart-paid')).toMatchObject({
      airdropStatus: 'done',
      airdropLIKE: 100,
      airdropWallet: WALLET,
      airdropTxHash: TX_HASH,
      // Kept so a broadcast that never mines can be re-sent rather than rebuilt.
      airdropRawTx: RAW_TX,
      airdropNonce: NONCE,
    });
  });

  it('pays nothing for a free cart and leaves no marker', async () => {
    await seedCart('cart-free');
    const txHash = await payBookPurchaseAirdrop({
      cartId: 'cart-free',
      wallet: WALLET,
      feeInfo: makeFeeInfo(0),
    });

    expect(txHash).toBeNull();
    expect(mockTransferLIKE).not.toHaveBeenCalled();
    expect((await getCart('cart-free')).airdropStatus).toBeUndefined();
  });

  it('skips a payout that floors to zero LIKE without taking the slot', async () => {
    await seedCart('cart-dust');
    const txHash = await payBookPurchaseAirdrop({
      cartId: 'cart-dust',
      wallet: WALLET,
      feeInfo: makeFeeInfo(5),
    });

    expect(txHash).toBeNull();
    expect(mockTransferLIKE).not.toHaveBeenCalled();
    expect((await getCart('cart-dust')).airdropStatus).toBeUndefined();
  });

  it.each([
    ['no wallet', undefined],
    ['a legacy cosmos wallet', 'like1ca0zlqxjqv5gek5qxm602umtkmu88564hpyws4'],
    ['a malformed wallet', '0xnope'],
  ])('does not pay out with %s', async (_label, wallet) => {
    await seedCart('cart-nowallet');
    const txHash = await payBookPurchaseAirdrop({
      cartId: 'cart-nowallet',
      wallet: wallet as string | undefined,
      feeInfo: makeFeeInfo(1000),
    });

    expect(txHash).toBeNull();
    expect(mockTransferLIKE).not.toHaveBeenCalled();
    await likeNFTBookCartCollection.doc('cart-nowallet').delete();
  });

  it('pays only once when the webhook is delivered twice', async () => {
    await seedCart('cart-retry');
    const args = {
      cartId: 'cart-retry',
      wallet: WALLET,
      feeInfo: makeFeeInfo(1000),
    };
    const first = await payBookPurchaseAirdrop(args);
    const second = await payBookPurchaseAirdrop(args);

    expect(first).toBe(TX_HASH);
    expect(second).toBeNull();
    expect(mockTransferLIKE).toHaveBeenCalledTimes(1);
    expect((await getCart('cart-retry')).airdropLIKE).toBe(100);
  });

  it('skips the transfer when the API wallet is short of LIKE, leaving the cart payable', async () => {
    mockGetBalance.mockResolvedValue(1n);
    await seedCart('cart-broke');
    const txHash = await payBookPurchaseAirdrop({
      cartId: 'cart-broke',
      wallet: WALLET,
      feeInfo: makeFeeInfo(1000),
    });

    expect(txHash).toBeNull();
    expect(mockTransferLIKE).not.toHaveBeenCalled();
    // No marker: a refill must leave this cart payable rather than forfeited.
    expect((await getCart('cart-broke')).airdropStatus).toBeUndefined();
  });

  it('marks the cart failed and swallows a chain error', async () => {
    mockTransferLIKE.mockRejectedValue(new Error('nonce too low'));
    await seedCart('cart-chainfail');
    const txHash = await payBookPurchaseAirdrop({
      cartId: 'cart-chainfail',
      wallet: WALLET,
      feeInfo: makeFeeInfo(1000),
    });

    expect(txHash).toBeNull();
    expect(await getCart('cart-chainfail')).toMatchObject({
      airdropStatus: 'failed',
      airdropError: 'nonce too low',
    });
  });

  it('keeps the broadcast on the failed record when the done write fails', async () => {
    // A fake ref, since the Firestore stub can't fail a single write.
    const update = vi.fn()
      .mockRejectedValueOnce(new Error('deadline exceeded'))
      .mockResolvedValue(undefined);
    const txHash = await payLIKEAirdrop({
      ref: { path: 'carts/cart-writefail', update } as any,
      claimSlot: async () => true,
      wallet: WALLET,
      amountUSD: 10,
      ratio: 0.01,
      logType: 'BookPurchaseAirdrop',
    });

    expect(txHash).toBeNull();
    expect(update).toHaveBeenLastCalledWith({
      airdropStatus: 'failed',
      airdropError: 'deadline exceeded',
      airdropTxHash: TX_HASH,
      airdropRawTx: RAW_TX,
      airdropNonce: NONCE,
    });
  });
});
