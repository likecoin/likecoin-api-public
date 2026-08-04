import uuidv4 from 'uuid/v4';
import { FieldValue, iscnArweaveTxCollection } from '../../firebase';
import { unwrapKey, isKMSEnabled } from '../../kms';
import { getUserWalletsByWallet } from '../users/getPublicInfo';
import { ValidationError } from '../../ValidationError';
import { isAlreadyExistsError } from '../../misc';
import type { ArweaveTxData } from '../../../types/transaction';
import type { ContentTier } from '../../gcloudStorage';

// GCS-direct upload doc (ADR 0001 Phase 3): no content key ever exists, and no
// legacy `token` — the flow is JWT-owner-gated end to end. fileSHA256 is the
// client-declared plaintext anchor finalize verifies against. `tier` picks the
// bucket: 'protected' skips Arweave entirely, 'open' also gets a server-side
// Arweave upload for provenance (the Phase 3 amendment).
export async function createNewGcsUploadTx(docId: string, {
  fileSize,
  fileSHA256,
  contentType,
  fileName,
  ownerWallet,
  tier = 'protected',
}: {
  fileSize: number;
  fileSHA256: string;
  contentType: string;
  fileName?: string;
  ownerWallet: string;
  tier?: ContentTier;
}): Promise<void> {
  const data: ArweaveTxData = {
    source: 'gcs',
    tier,
    status: 'pending',
    fileSize,
    fileSHA256: fileSHA256.toLowerCase(),
    contentType,
    ...(fileName ? { fileName } : {}),
    ownerWallet,
    timestamp: FieldValue.serverTimestamp(),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  };
  await iscnArweaveTxCollection.doc(docId).create(data);
}

// Complete a GCS-direct upload: the ingest markers plus the lifecycle fields
// (status, isRequireAuth, accessToken) — without isRequireAuth the link
// endpoint would serve the doc unauthenticated.
// Open records pass isRequireAuth: false — their bytes are public on Arweave
// anyway, so gating the mirror would leave the fallback more available than it.
export async function markGcsTxCompleted(txHash: string, {
  contentBucketPath,
  arweaveId,
  isRequireAuth = true,
}: {
  contentBucketPath: string;
  arweaveId?: string;
  isRequireAuth?: boolean;
}): Promise<void> {
  await iscnArweaveTxCollection.doc(txHash).update({
    status: 'complete',
    isRequireAuth,
    accessToken: uuidv4(),
    contentBucketPath,
    ...(arweaveId ? { arweaveId } : {}),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}

export async function getArweaveTxInfo(txHash: string): Promise<ArweaveTxData | undefined> {
  const doc = await iscnArweaveTxCollection.doc(txHash).get();
  return doc.data();
}

// Consume a Base payment exactly once.
//
// GCS-direct docs are keyed on gcs-<uuid>, so the doc id carries no uniqueness
// against the payment, and checkArweaveTxV2 is pure read-only verification that
// happily passes the same hash twice — without this claim a caller could stage a
// file N times and settle all N against one payment.
export async function claimArweaveTxPayment(paymentTxHash: string, {
  uploadId,
  ownerWallet,
}: {
  uploadId: string;
  ownerWallet?: string;
}): Promise<void> {
  try {
    await iscnArweaveTxCollection.doc(paymentTxHash).create({
      status: 'payment',
      uploadId,
      ...(ownerWallet ? { ownerWallet } : {}),
      timestamp: FieldValue.serverTimestamp(),
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) throw new ValidationError('TX_HASH_ALREADY_USED', 429);
    throw error;
  }
}

// Whether reqUserWallet owns a tx stamped with ownerWallet. Matches directly,
// or across a Cosmos↔EVM migration: a legacy upload owned by a like1… wallet is
// still owned by the same identity now authenticating with its migrated evmWallet
// (or vice versa). The user-record lookup runs only when the direct match fails.
export async function isArweaveTxOwner(
  reqUserWallet?: string,
  ownerWallet?: string,
): Promise<boolean> {
  if (!reqUserWallet || !ownerWallet) return false;
  const target = reqUserWallet.toLowerCase();
  if (target === ownerWallet.toLowerCase()) return true;
  let wallets: Awaited<ReturnType<typeof getUserWalletsByWallet>>;
  try {
    wallets = await getUserWalletsByWallet(ownerWallet);
  } catch (err) {
    // ownerWallet not a resolvable address — treat as no match, not a 400.
    // Anything else (Firestore failure) must surface rather than read as a 403.
    if (err instanceof ValidationError) return false;
    throw err;
  }
  if (!wallets) return false;
  return [wallets.evmWallet, wallets.likeWallet, wallets.cosmosWallet]
    .some((w) => !!w && w.toLowerCase() === target);
}

// Load a GCS-direct upload doc that `reqUserWallet` owns and that is still
// awaiting its finalize step, for the given tier. Shared by the two finalize
// routes so a caller cannot reach either one through the other's tier.
export async function getOwnedPendingGcsTx(
  txHash: string,
  reqUserWallet: string,
  tier: ContentTier,
): Promise<ArweaveTxData> {
  const tx = await getArweaveTxInfo(txHash);
  if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
  if (tx.source !== 'gcs') throw new ValidationError('NOT_GCS_UPLOAD', 400);
  // Open records finalize at /v2/gcs/arweave/:txHash — their object name is the
  // arweaveId, which does not exist until that upload confirms.
  if ((tx.tier || 'protected') !== tier) {
    throw new ValidationError(tier === 'protected' ? 'USE_ARWEAVE_FINALIZE' : 'NOT_OPEN_GCS_UPLOAD', 400);
  }
  if (!(await isArweaveTxOwner(reqUserWallet, tx.ownerWallet))) throw new ValidationError('NOT_OWNER', 403);
  if (tx.status !== 'pending') throw new ValidationError('TX_ALREADY_REGISTERED', 409);
  return tx;
}

// Record a protected-content ingest: the plaintext's path in the private
// bucket, its MIME type (so readers skip a GCS metadata round-trip), and the
// plaintext hash only when computed server-side (client supplied no anchor).
export async function markArweaveTxIngested(txHash: string, {
  contentBucketPath,
  contentType,
  fileSHA256,
}: {
  contentBucketPath: string;
  contentType: string;
  fileSHA256?: string;
}): Promise<void> {
  await iscnArweaveTxCollection.doc(txHash).update({
    contentBucketPath,
    contentType,
    ...(fileSHA256 ? { fileSHA256: fileSHA256.toLowerCase() } : {}),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}

// Dual-read: KMS-wrapped `encryptedKey` (AAD = txHash) vs legacy plaintext `key`.
// Gate unwrap on isKMSEnabled() — a passthrough unwrapKey returns ciphertext
// verbatim, so a KMS-written doc read without KMS yields '' not leaked ciphertext.
export async function resolveArweaveTxKey(
  tx: ArweaveTxData,
  txHash: string,
): Promise<string> {
  if (tx.encryptedKey && isKMSEnabled()) return unwrapKey(tx.encryptedKey, txHash);
  return tx.key || '';
}

// Kept beside resolveArweaveTxKey so the pair of key-bearing fields is named in
// one place: a copy that missed a newly added field would report an encrypted
// doc as plaintext, and callers use that to decide whether ciphertext is safe.
export function isArweaveTxEncrypted(tx: ArweaveTxData): boolean {
  return !!(tx.encryptedKey || tx.key);
}

// Persist the funding top-up tx on the upload doc BEFORE notifying the Irys indexer,
// so a crash/5xx between send and notify still leaves a replayable record.
export async function setArweaveTxFundingSent(docId: string, {
  fundingTxHash,
  fundingETH,
}: {
  fundingTxHash: string;
  fundingETH: string;
}): Promise<void> {
  await iscnArweaveTxCollection.doc(docId).update({
    fundingTxHash,
    fundingETH,
    fundingStatus: 'sent',
    fundingTimestamp: FieldValue.serverTimestamp(),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}

export async function markArweaveTxFundingCredited(docId: string): Promise<void> {
  await iscnArweaveTxCollection.doc(docId).update({
    fundingStatus: 'credited',
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}

// Uploads whose funding was sent but never confirmed credited — the reconcile job
// re-notifies these (idempotent) newest-first.
export async function getPendingFundingArweaveTxs(
  limit = 100,
): Promise<Array<{ id: string; fundingTxHash: string }>> {
  const snapshot = await iscnArweaveTxCollection
    .where('fundingStatus', '==', 'sent')
    .orderBy('fundingTimestamp', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, fundingTxHash: doc.data()?.fundingTxHash }))
    .filter((d): d is { id: string; fundingTxHash: string } => !!d.fundingTxHash);
}

export async function rotateArweaveTxAccessToken(txHash: string): Promise<string> {
  const accessToken = uuidv4();
  await iscnArweaveTxCollection.doc(txHash).update({
    accessToken,
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
  return accessToken;
}

export async function getArweaveTxAccessToken(txHash: string): Promise<string | undefined> {
  const doc = await iscnArweaveTxCollection.doc(txHash).get();
  const data = doc.data();
  return data?.accessToken;
}
