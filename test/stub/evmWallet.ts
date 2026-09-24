import { vi } from 'vitest';

// Minimal wallet client for driving broadcastOnReservedNonce in src/util/evm/tx.ts.
// prepareTransactionRequest echoes the request back so the reserved nonce survives
// into the signed tx, which is what the nonce assertions read.
export function makeMockWalletClient({
  address,
  sendRawTransaction = async () => '0xhash',
  chain,
}: {
  address: string;
  sendRawTransaction?: () => Promise<string>;
  chain?: { id: number };
}) {
  return {
    account: { address },
    chain,
    prepareTransactionRequest: vi.fn(async (req) => req),
    signTransaction: vi.fn(async () => '0xsigned'),
    sendRawTransaction: vi.fn(sendRawTransaction),
  } as any;
}

export default makeMockWalletClient;
