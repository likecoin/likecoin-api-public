import axios from 'axios';
import { TypedEthereumSigner } from 'arbundles';
import {
  Chain,
  HttpTransport,
  LocalAccount,
  parseEther,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { BUNDLR_MATIC_WALLET_PRIVATE_KEY } from '../../../config/secret';
import {
  ARWEAVE_IRYS_FUND_MULTIPLIER,
  ARWEAVE_IRYS_DEPOSIT_ADDRESS,
} from '../../../config/config';
import { getEVMClient, createEVMWalletClient } from '../evm/client';
import { sleep, scaleBigInt } from '../misc';
import { IS_TESTNET } from '../../constant';

// Irys node the base-eth balance/upload settles against. We talk to it over REST
// instead of @irys/sdk so the funding send/notify seam is ours — the SDK fused them
// into one throwing call and stranded deposits whose notify failed.
const IRYS_NODE_ENDPOINT = IS_TESTNET ? 'https://devnet.irys.xyz' : 'https://node1.irys.xyz';
const IRYS_TOKEN = 'base-eth';

// Known base-eth deposit address for each Irys node, used when no config pin is set
// and as a fallback if /info is unreachable. getIrysDepositAddress still verifies
// against /info when it can, so a node key rotation surfaces as a hard mismatch.
const DEFAULT_IRYS_DEPOSIT_ADDRESS = IS_TESTNET
  ? '0x853758425e953739F5438fd6fd0Efe04A477b039'
  : '0x62459D34409ABA55b85DD28284cc4e57e0C8ADea';
const EXPECTED_DEPOSIT_ADDRESS = ARWEAVE_IRYS_DEPOSIT_ADDRESS || DEFAULT_IRYS_DEPOSIT_ADDRESS;

// Fund a multiple of a single file's price when topping up, so one stranded credit
// can't drop the node balance below the next upload's price and 402 it. Floor at 1:
// a sub-1 multiple would top up below the upload's own price and 402 it immediately.
// The `|| 2` also covers the key missing from a deployed config.js: Number(undefined)
// is NaN, and NaN would otherwise survive Math.max and poison the multiplier.
const FUND_MULTIPLIER = Math.max(1, Number(ARWEAVE_IRYS_FUND_MULTIPLIER) || 2);

let signer: TypedEthereumSigner | null = null;
let fundingWalletClient: WalletClient<HttpTransport, Chain, LocalAccount> | undefined;
let depositAddress: string | undefined;

// Serialize funding ops so concurrent uploads don't race the funding wallet nonce,
// and so each queued top-up re-checks the balance after the previous credit lands.
let fundingLock: Promise<unknown> = Promise.resolve();

function normalizePrivateKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
}

function getFundingWalletClient(): WalletClient<HttpTransport, Chain, LocalAccount> {
  if (!fundingWalletClient) {
    if (!BUNDLR_MATIC_WALLET_PRIVATE_KEY) throw new Error('Private key is undefined!');
    fundingWalletClient = createEVMWalletClient(
      privateKeyToAccount(normalizePrivateKey(BUNDLR_MATIC_WALLET_PRIVATE_KEY)),
    );
  }
  return fundingWalletClient;
}

export async function initWallet(): Promise<TypedEthereumSigner> {
  if (!BUNDLR_MATIC_WALLET_PRIVATE_KEY) throw new Error('Private key is undefined!');
  const s = new TypedEthereumSigner(BUNDLR_MATIC_WALLET_PRIVATE_KEY);
  return s;
}

export async function getPublicKey() {
  if (!signer) signer = await initWallet();
  return signer.publicKey;
}

export async function signData(signatureData) {
  if (!signer) signer = await initWallet();
  return Buffer.from(await signer.sign(signatureData));
}

// Resolve the base-eth deposit address, verifying against /info when reachable so a
// node key rotation can't silently misroute funds. Falls back to the expected
// address (config pin or network default) if /info is unavailable.
async function getIrysDepositAddress(): Promise<string> {
  if (depositAddress) return depositAddress;
  let resolved: string | undefined;
  try {
    const { data } = await axios.get(`${IRYS_NODE_ENDPOINT}/info`);
    resolved = data?.addresses?.[IRYS_TOKEN];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to resolve Irys deposit address from /info, using default:', (err as Error).message);
  }
  if (resolved && resolved.toLowerCase() !== EXPECTED_DEPOSIT_ADDRESS.toLowerCase()) {
    throw new Error(`IRYS_DEPOSIT_ADDRESS_MISMATCH: node=${resolved} expected=${EXPECTED_DEPOSIT_ADDRESS}`);
  }
  // Only memoize a /info-verified address. On an outage we return the fallback
  // but leave the cache empty so the next call retries verification.
  if (resolved) depositAddress = resolved;
  return resolved || EXPECTED_DEPOSIT_ADDRESS;
}

// Price for `bytes` in atomic units (wei). Read as text to keep full precision for
// large files (JSON number parsing would lose precision past 2^53).
export async function getPrice(bytes: number): Promise<bigint> {
  const { data } = await axios.get(`${IRYS_NODE_ENDPOINT}/price/${IRYS_TOKEN}/${bytes}`, {
    responseType: 'text',
    transformResponse: (d) => d,
  });
  return BigInt(String(data).trim().replace(/^"|"$/g, '').split('.')[0]);
}

// Node-credited balance of our funding wallet in atomic units (wei).
async function getLoadedBalance(): Promise<bigint> {
  const account = getFundingWalletClient().account.address;
  const { data } = await axios.get(`${IRYS_NODE_ENDPOINT}/account/balance/${IRYS_TOKEN}`, {
    params: { address: account },
  });
  const raw = (data && typeof data === 'object') ? (data.balance ?? '0') : data;
  return BigInt(String(raw).split('.')[0] || '0');
}

// Notify the indexer that `txHash` funded the node, retrying since the credit is
// what strands. Idempotent: a re-notify of an already-credited tx is treated as
// success (the sweep/reconcile relies on this).
export async function notifyIrys(txHash: string): Promise<void> {
  const url = `${IRYS_NODE_ENDPOINT}/account/balance/${IRYS_TOKEN}`;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await axios.post(url, { tx_id: txHash }, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) return;
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
      if (/already (been )?processed/i.test(body)) return;
      lastError = new Error(`IRYS_NOTIFY_FAILED status=${res.status} body=${body}`);
    } catch (err) {
      // A thrown error is a transient network fault (timeout/reset) — the credit is
      // exactly what strands, so retry these too rather than aborting the loop.
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    // eslint-disable-next-line no-await-in-loop
    if (attempt < 4) await sleep(1000 * (attempt + 1));
  }
  throw lastError || new Error('IRYS_NOTIFY_FAILED');
}

// Send a no-calldata ETH transfer (sidesteps the SDK getFee()/createTx() gas-timing
// bug), wait for 2 confirmations, persist via onSent, then notify the node.
async function performFunding(
  requiredWei: bigint,
  topUpWei: bigint,
  onSent?: (txHash: string) => Promise<void> | void,
): Promise<string | null> {
  // A top-up queued ahead of us may have already credited enough cushion.
  const balance = await getLoadedBalance();
  if (balance >= requiredWei) return null;
  const walletClient = getFundingWalletClient();
  const to = await getIrysDepositAddress();
  const txHash = await walletClient.sendTransaction({
    to: to as `0x${string}`,
    value: topUpWei,
  });
  await getEVMClient().waitForTransactionReceipt({ hash: txHash, confirmations: 2 });
  if (onSent) {
    try {
      await onSent(txHash);
    } catch (err) {
      // Persist failed, so reconcile can't find this deposit. Notify now (best
      // effort) to credit it immediately, then surface the persistence error.
      await notifyIrys(txHash).catch(() => undefined);
      throw err;
    }
  }
  await notifyIrys(txHash);
  return txHash;
}

// Top up the Irys node balance to cover `requiredAmount` ETH, funding FUND_MULTIPLIER×
// the price as a cushion. `onSent` fires after the send confirms but before the indexer
// notify, so callers can durably persist the funding tx id (persist-before-notify).
export async function fund(
  requiredAmount: string,
  { onSent }: {
    onSent?: (txHash: string) => Promise<void> | void;
  } = {},
): Promise<string | null> {
  const fundAmountWei = parseEther(requiredAmount);
  const currentBalance = await getLoadedBalance();

  // Cushion already covers this upload — skip funding to keep the tx (and stranding) count down.
  if (currentBalance >= fundAmountWei) return null;

  const topUpWei = scaleBigInt(fundAmountWei, FUND_MULTIPLIER);
  const run = fundingLock.then(() => performFunding(fundAmountWei, topUpWei, onSent));
  // Keep the lock chained regardless of this send's outcome.
  fundingLock = run.catch(() => undefined);
  return run;
}
