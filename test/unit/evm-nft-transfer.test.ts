import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem';
import { LIKE_NFT_CLASS_ABI } from '../../src/constant/contract/likeNFT';
import { verifyNFTTransferTxHash } from '../../src/util/evm/nft';
import { ValidationError } from '../../src/util/ValidationError';

// vi.mock is hoisted above these imports; the `mock`-prefixed name is
// whitelisted by Vitest's factory scope check.
const mockWaitForTransactionReceipt = vi.fn();

vi.mock('../../src/util/evm/client', () => ({
  getEVMClient: () => ({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  }),
  getEVMWalletAccount: vi.fn(),
  getEVMWalletClient: vi.fn(),
}));

const CLASS_ID = '0x1234567890abcdef1234567890abcdef12345678';
const BUYER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const OTHER = '0x9999999999999999999999999999999999999999';
const TX_HASH = '0xdeadbeef00000000000000000000000000000000000000000000000000000000';

function makeTransferLog({
  address = CLASS_ID, from = '0x0000000000000000000000000000000000000000', to, tokenId,
}) {
  return {
    address,
    topics: encodeEventTopics({
      abi: LIKE_NFT_CLASS_ABI,
      eventName: 'Transfer',
      args: { from: getAddress(from), to: getAddress(to), tokenId: BigInt(tokenId) },
    }),
    data: '0x',
  };
}

// batchTransferWithMemo (the manual seller send path) emits TransferWithMemo,
// whose indexed args match Transfer plus a non-indexed `memo` string in data.
function makeTransferWithMemoLog({
  address = CLASS_ID, from = getAddress(CLASS_ID), to, tokenId, memo = 'gift',
}) {
  return {
    address,
    topics: encodeEventTopics({
      abi: LIKE_NFT_CLASS_ABI,
      eventName: 'TransferWithMemo',
      args: { from: getAddress(from), to: getAddress(to), tokenId: BigInt(tokenId) },
    }),
    data: encodeAbiParameters([{ type: 'string', name: 'memo' }], [memo]),
  };
}

describe('verifyNFTTransferTxHash', () => {
  beforeEach(() => {
    mockWaitForTransactionReceipt.mockReset();
  });

  it('resolves with the token id on a matching transfer', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [makeTransferLog({ to: BUYER, tokenId: 5 })],
    });
    const tokenIds = await verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER,
    });
    expect(tokenIds).toEqual([5n]);
  });

  it('accepts TransferWithMemo (batchTransferWithMemo manual send path)', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [makeTransferWithMemoLog({ to: BUYER, tokenId: 7 })],
    });
    const tokenIds = await verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER,
    });
    expect(tokenIds).toEqual([7n]);
  });

  it('counts one NFT once when Transfer and TransferWithMemo both fire for it', async () => {
    const bothLogs = [
      makeTransferLog({ to: BUYER, tokenId: 7 }),
      makeTransferWithMemoLog({ to: BUYER, tokenId: 7 }),
    ];
    mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: bothLogs });
    expect(await verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER,
    })).toEqual([7n]);

    mockWaitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: bothLogs });
    await expect(verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER, quantity: 2,
    })).rejects.toMatchObject({ message: 'DELIVERY_TX_NFT_MISMATCH' });
  });

  it('throws DELIVERY_TX_FAILED when the receipt reverted', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue({ status: 'reverted', logs: [] });
    await expect(verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER,
    })).rejects.toSatisfy((err) => err instanceof ValidationError && err.message === 'DELIVERY_TX_FAILED');
  });

  it('throws DELIVERY_TX_NFT_MISMATCH when the transfer went to another wallet', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [makeTransferLog({ to: OTHER, tokenId: 5 })],
    });
    await expect(verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER,
    })).rejects.toMatchObject({ message: 'DELIVERY_TX_NFT_MISMATCH' });
  });

  it('throws DELIVERY_TX_NFT_MISMATCH when a Transfer came from an unrelated contract', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [makeTransferLog({ address: OTHER, to: BUYER, tokenId: 5 })],
    });
    await expect(verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER,
    })).rejects.toMatchObject({ message: 'DELIVERY_TX_NFT_MISMATCH' });
  });

  it('requires at least `quantity` matching transfers', async () => {
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [makeTransferLog({ to: BUYER, tokenId: 5 })],
    });
    await expect(verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER, quantity: 2,
    })).rejects.toMatchObject({ message: 'DELIVERY_TX_NFT_MISMATCH' });

    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [
        makeTransferLog({ to: BUYER, tokenId: 5 }),
        makeTransferLog({ to: BUYER, tokenId: 6 }),
      ],
    });
    const tokenIds = await verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER, quantity: 2,
    });
    expect(tokenIds).toEqual([5n, 6n]);
  });

  it('throws DELIVERY_TX_HASH_INVALID for a malformed txHash without hitting the RPC', async () => {
    await expect(verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: '0xdeadbeef', toWallet: BUYER,
    })).rejects.toSatisfy((err) => err instanceof ValidationError && err.message === 'DELIVERY_TX_HASH_INVALID');
    expect(mockWaitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it('propagates RPC errors as non-ValidationError (route tolerates these)', async () => {
    mockWaitForTransactionReceipt.mockRejectedValue(new Error('RPC timeout'));
    await expect(verifyNFTTransferTxHash({
      classId: CLASS_ID, txHash: TX_HASH, toWallet: BUYER,
    })).rejects.toSatisfy((err) => err instanceof Error && !(err instanceof ValidationError));
  });
});
