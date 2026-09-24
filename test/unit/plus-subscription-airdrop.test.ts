import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { userCollection } from '../../src/util/firebase';
import { payPlusSubscriptionAirdrop } from '../../src/util/api/plus/airdrop';

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
// A seeded fixture user, since the stub only keeps subcollections of existing docs.
const LIKER_ID = 'testing';
const WALLET = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const TX_HASH = '0xdeadbeef00000000000000000000000000000000000000000000000000000000';
const RAW_TX = '0xf86c808504a817c800825208';
const NONCE = 7;

function makeArgs(invoiceId: string, amountPaidUSD = 69.99) {
  return {
    likerId: LIKER_ID,
    invoiceId,
    subscriptionId: 'sub_1',
    wallet: WALLET,
    amountPaidUSD,
    billingReason: 'subscription_cycle',
  };
}

async function getRecord(invoiceId: string) {
  const doc = await userCollection.doc(LIKER_ID).collection('plusAirdrops').doc(invoiceId).get();
  return doc.data() as any;
}

describe('payPlusSubscriptionAirdrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransferLIKE.mockResolvedValue({
      txHash: TX_HASH, rawSignedTx: RAW_TX, nonce: NONCE,
    });
    mockGetBalance.mockResolvedValue(10n ** 12n);
  });

  it('transfers 1% of the settled USD and records it per invoice', async () => {
    const txHash = await payPlusSubscriptionAirdrop(makeArgs('in_paid'));

    expect(txHash).toBe(TX_HASH);
    // $69.99 -> $0.6999 -> 699.9 LIKE, floored
    expect(mockTransferLIKE).toHaveBeenCalledWith(WALLET, 699n * (10n ** 6n));
    expect(await getRecord('in_paid')).toMatchObject({
      invoiceId: 'in_paid',
      subscriptionId: 'sub_1',
      airdropStatus: 'done',
      airdropLIKE: 699,
      airdropWallet: WALLET,
      airdropTxHash: TX_HASH,
      airdropRawTx: RAW_TX,
      airdropNonce: NONCE,
    });
  });

  it('pays nothing for a trial invoice and leaves no record', async () => {
    const txHash = await payPlusSubscriptionAirdrop(makeArgs('in_trial', 0));

    expect(txHash).toBeNull();
    expect(mockTransferLIKE).not.toHaveBeenCalled();
    expect(await getRecord('in_trial')).toBeUndefined();
  });

  it('does not pay out to a legacy cosmos wallet', async () => {
    const txHash = await payPlusSubscriptionAirdrop({
      ...makeArgs('in_cosmos'),
      wallet: 'like1ca0zlqxjqv5gek5qxm602umtkmu88564hpyws4',
    });

    expect(txHash).toBeNull();
    expect(mockTransferLIKE).not.toHaveBeenCalled();
  });

  it('pays only once when the invoice webhook is delivered twice', async () => {
    const first = await payPlusSubscriptionAirdrop(makeArgs('in_retry'));
    const second = await payPlusSubscriptionAirdrop(makeArgs('in_retry'));

    expect(first).toBe(TX_HASH);
    expect(second).toBeNull();
    expect(mockTransferLIKE).toHaveBeenCalledTimes(1);
  });

  it('skips the transfer when the API wallet is short of LIKE, leaving no record', async () => {
    mockGetBalance.mockResolvedValue(1n);
    const txHash = await payPlusSubscriptionAirdrop(makeArgs('in_broke'));

    expect(txHash).toBeNull();
    expect(mockTransferLIKE).not.toHaveBeenCalled();
    expect(await getRecord('in_broke')).toBeUndefined();
  });

  it('marks the invoice failed and swallows a chain error', async () => {
    mockTransferLIKE.mockRejectedValue(new Error('nonce too low'));
    const txHash = await payPlusSubscriptionAirdrop(makeArgs('in_chainfail'));

    expect(txHash).toBeNull();
    expect(await getRecord('in_chainfail')).toMatchObject({
      airdropStatus: 'failed',
      airdropError: 'nonce too low',
    });
  });
});
