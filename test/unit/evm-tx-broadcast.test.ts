import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { sendWriteContractWithNonce } from '../../src/util/evm/tx';
import { LIKE_COIN_V3_ABI } from '../../src/constant/contract/likecoinV3';
import { makeMockWalletClient } from '../stub/evmWallet';

// vi.mock is hoisted above these imports; the `mock`-prefixed names are
// whitelisted by Vitest's factory scope check.
const mockGetTransactionCount = vi.fn();
const mockSimulateContract = vi.fn();
const mockWaitForTransactionReceipt = vi.fn();

vi.mock('../../src/util/evm/client', () => ({
  getEVMClient: () => ({
    getTransactionCount: mockGetTransactionCount,
    simulateContract: mockSimulateContract,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  }),
  getEVMWalletAccount: vi.fn(),
  getEVMWalletClient: vi.fn(),
}));

const ACCOUNT = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const TO = '0x1111111111111111111111111111111111111111';
const BROADCAST_HASH = '0xaaaa000000000000000000000000000000000000000000000000000000000000';
const MINED_HASH = '0xbbbb000000000000000000000000000000000000000000000000000000000000';

function makeWalletClient() {
  return makeMockWalletClient({
    address: ACCOUNT,
    chain: { id: 8453 },
    sendRawTransaction: async () => BROADCAST_HASH,
  });
}

function makeParams() {
  return {
    chain: { id: 8453 },
    address: TO,
    abi: LIKE_COIN_V3_ABI,
    account: { address: ACCOUNT },
    functionName: 'transfer',
    args: [TO, 1n],
  } as any;
}

describe('sendWriteContractWithNonce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTransactionCount.mockResolvedValue(7);
    mockSimulateContract.mockResolvedValue({});
    mockWaitForTransactionReceipt.mockResolvedValue({ transactionHash: MINED_HASH });
  });

  it('waits for the receipt by default and reports the mined hash', async () => {
    const res = await sendWriteContractWithNonce(makeWalletClient(), makeParams());

    expect(mockWaitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(res.transactionHash).toBe(MINED_HASH);
    expect(res.result).toMatchObject({ transactionHash: MINED_HASH });
  });

  it('returns the broadcast hash without waiting when waitForReceipt is false', async () => {
    const res = await sendWriteContractWithNonce(
      makeWalletClient(),
      makeParams(),
      { waitForReceipt: false },
    );

    expect(mockWaitForTransactionReceipt).not.toHaveBeenCalled();
    expect(res.transactionHash).toBe(BROADCAST_HASH);
    expect(res.result).toBeNull();
    expect(res.nonce).toBe(7);
  });

  it('still simulates before broadcasting, so a reverting call never goes on the wire', async () => {
    mockSimulateContract.mockRejectedValue(new Error('ERC20InsufficientBalance'));
    const walletClient = makeWalletClient();

    await expect(sendWriteContractWithNonce(
      walletClient,
      makeParams(),
      { waitForReceipt: false },
    )).rejects.toThrow('ERC20InsufficientBalance');
    expect(walletClient.sendRawTransaction).not.toHaveBeenCalled();
  });
});
