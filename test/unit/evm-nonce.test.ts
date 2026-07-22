import {
  describe, expect, it, vi, beforeEach,
} from 'vitest';

const getTransactionCount = vi.fn();

vi.mock('../../src/util/evm/client', () => ({
  getEVMClient: () => ({ getTransactionCount }),
  createEVMWalletClient: vi.fn(),
  getEVMWalletClient: vi.fn(),
  getEVMWalletAccount: vi.fn(),
  evmChain: {},
}));

// eslint-disable-next-line import/first
import { sendTransactionWithNonce } from '../../src/util/evm/tx';
// eslint-disable-next-line import/first
import { db, txCollection } from '../../src/util/firebase';

const ADDRESS = '0x2DF219F258f33217dA9b4c29992eA3696dF9e5CC';
const TO = '0x62459D34409ABA55b85DD28284cc4e57e0C8ADea';

function counterRef() {
  return txCollection.doc(`!counter_${ADDRESS}`);
}

function createWalletClient(sendRawTransaction: () => Promise<string>) {
  return {
    account: { address: ADDRESS },
    prepareTransactionRequest: vi.fn(async (req) => req),
    signTransaction: vi.fn(async () => '0xsigned'),
    sendRawTransaction: vi.fn(sendRawTransaction),
  } as any;
}

async function getStoredNonce(): Promise<number | undefined> {
  return ((await counterRef().get()).data() as any)?.value;
}

describe('sendTransactionWithNonce', () => {
  beforeEach(async () => {
    getTransactionCount.mockResolvedValue(100);
    // The stub's tx collection is JSON-backed and survives resetTestData, so drop
    // any counter a previous test left behind.
    if (await getStoredNonce() !== undefined) await counterRef().delete();
  });

  it('reserves from the shared counter so a stale on-chain count is not reused', async () => {
    const requests: any[] = [];
    const walletClient = createWalletClient(async () => '0xhash');
    walletClient.prepareTransactionRequest = vi.fn(async (req) => {
      requests.push(req);
      return req;
    });

    // The on-chain count stays at 100 across both sends, as it does while the first
    // tx is still unconfirmed — only the shared counter separates the two nonces.
    await sendTransactionWithNonce(walletClient, { to: TO, value: 1n });
    await sendTransactionWithNonce(walletClient, { to: TO, value: 1n });

    expect(requests.map((r) => r.nonce)).toEqual([100, 101]);
    expect(await getStoredNonce()).toBe(102);
  });

  it('rolls the counter back when the send never broadcasts', async () => {
    const walletClient = createWalletClient(async () => { throw new Error('RPC_DOWN'); });

    await expect(sendTransactionWithNonce(walletClient, { to: TO, value: 1n }))
      .rejects.toThrow('RPC_DOWN');
    expect(await getStoredNonce()).toBe(100);
  });

  it('returns the hash even when the post-broadcast counter write fails', async () => {
    const walletClient = createWalletClient(async () => '0xhash');
    const runTransaction = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction')
      .mockImplementationOnce((fn: any) => runTransaction(fn)) // reserve
      .mockImplementationOnce(async () => { throw new Error('FIRESTORE_DOWN'); }); // commit

    // The funds are already on the wire, so a counter write failure must not
    // surface as a send failure and strand the hash.
    await expect(sendTransactionWithNonce(walletClient, { to: TO, value: 1n }))
      .resolves.toBe('0xhash');
    vi.mocked(db.runTransaction).mockRestore();
  });
});
