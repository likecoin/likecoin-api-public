import crypto from 'crypto';
import {
  estimateUploadToArweaveV2,
  checkArweaveTxV2,
  pushArweaveSingleFileToIPFS,
} from './index';
import { signDataItemStream, uploadSignedDataItemToIrys } from '../../arweave/upload';
import { IPFS_KEY } from '../../arweave';
import {
  deleteStagedObject,
  getStagedHashingReadStream,
  getStagedReadStream,
  promoteStagedObject,
  verifyStagedObjectSize,
} from './ingest';
import { claimArweaveTxPayment, markGcsTxCompleted } from './tx';
import { rollbackQuota, withReservedQuota } from './quota';
import { fundUploadIfNeeded } from './funding';
import { ValidationError } from '../../ValidationError';
import type { ArweaveTxData } from '../../../types/transaction';

export interface OpenUploadResult {
  arweaveId: string;
  contentBucketPath: string;
  fileSHA256: string;
  isSponsored: boolean;
}

/**
 * Finish an open-tier GCS upload by making its Arweave copy server-side
 * (ADR 0001 Phase 3 amendment).
 *
 * Verify → charge → upload → promote → complete, blocking on the Irys receipt so
 * the arweaveId the caller puts on-chain is always one the node has taken custody
 * of. Verification runs first: a size or hash mismatch is the client's bug and
 * must not cost the caller a payment or a quota slot.
 *
 * Signing an ANS-104 DataItem needs the payload hashed before the signature
 * exists, so the object is read once to sign and once to send rather than held in
 * memory. In-region GCS reads are cheap; resident bytes per request are not.
 */
export async function uploadStagedObjectToArweave(txHash: string, tx: ArweaveTxData, {
  wallet,
  ipfsHash,
  paymentTxHash,
  txToken = 'BASEETH',
}: {
  wallet: string;
  ipfsHash: string;
  paymentTxHash?: string;
  txToken?: string;
}): Promise<OpenUploadResult> {
  const contentType = tx.contentType || 'application/octet-stream';
  const isSponsored = txToken === 'SPONSORED';
  if (!isSponsored && !paymentTxHash) throw new ValidationError('MISSING_TX_HASH');

  // Size first, so a client size bug costs one round-trip instead of a full read.
  // The generation pins every later read to this exact version: the caller still
  // holds a live resumable URL for the same path, and signing one payload while
  // uploading another would publish an invalid item under an id we then put
  // on-chain.
  const { stagedSize: fileSize, generation } = await verifyStagedObjectSize(
    txHash,
    'open',
    tx.fileSize,
  );

  // Pass 1 — sign. The payload is tee'd through a hash so the provenance anchor is
  // checked from the same read. The quote and the payment check need no bytes, so
  // they run alongside it, and a failure there aborts the read part-way.
  const hash = crypto.createHash('sha256');
  const pricePromise = estimateUploadToArweaveV2(
    fileSize,
    ipfsHash,
    // No margin and no dedup check: this is the price the caller was quoted and
    // already paid against, and a duplicate would still need its own DataItem
    // because the object name we promote to is the id we sign.
    { margin: 0, checkDuplicate: false },
  );
  const signingStream = getStagedHashingReadStream(txHash, 'open', hash, generation);
  const [item, { ETH }] = await Promise.all([
    signDataItemStream(signingStream, {
      // anchorSeed makes the DataItem id a function of this upload, so a retry
      // after a crash between upload and mark-complete lands on the same id
      // rather than paying for a second copy under a different name.
      anchorSeed: txHash,
      tags: [
        { name: 'App-Name', value: 'publish.3ook.com' },
        { name: 'App-Version', value: '2.0' },
        { name: 'User-Agent', value: 'likecoin-api-public' },
        { name: IPFS_KEY, value: ipfsHash },
        { name: 'Content-Type', value: contentType },
      ],
    }),
    pricePromise,
    ...(isSponsored ? [] : [pricePromise.then(({ ETH: quoted }) => checkArweaveTxV2({
      fileSize, ipfsHash, txHash: paymentTxHash, ETH: quoted, txToken,
    }))]),
  ]).catch((error) => {
    // Promise.all rejects on the first failure but cancels nothing, so without
    // this a rejected quote or payment would still read the whole object.
    if (!signingStream.destroyed) signingStream.destroy();
    throw error;
  });
  const computedSHA256 = hash.digest('hex');
  if (tx.fileSHA256 && tx.fileSHA256.toLowerCase() !== computedSHA256) {
    throw new ValidationError('PLAINTEXT_HASH_MISMATCH');
  }

  // Pass 2 — send. Signing is free and local, so nothing has been spent yet.
  const runUpload = async () => {
    const arweaveId = await uploadSignedDataItemToIrys(
      item,
      getStagedReadStream(txHash, 'open', generation),
      fileSize,
    );
    const contentBucketPath = await promoteStagedObject(txHash, 'open', {
      contentType,
      fileSHA256: computedSHA256,
      arweaveId,
      ipfsHash,
      generation,
    });
    await markGcsTxCompleted(txHash, {
      contentBucketPath,
      arweaveId,
      isRequireAuth: false,
    });
    return { arweaveId, contentBucketPath };
  };

  let uploaded: { arweaveId: string; contentBucketPath: string };
  if (isSponsored) {
    // upload_init already reserved this file's bytes and count; release that so
    // the reservation below is the one with the real ETH cost attached.
    await rollbackQuota(wallet, fileSize, '0');
    uploaded = await withReservedQuota(wallet, fileSize, ETH, runUpload);
  } else {
    // The payment was verified alongside pass 1; claiming it is what makes one
    // payment settle exactly one upload, so it must happen before any spend.
    await claimArweaveTxPayment(paymentTxHash as string, { uploadId: txHash, ownerWallet: wallet });
    // A paying caller must not also burn their sponsored allowance, so release
    // what upload_init reserved to bound staging abuse.
    await rollbackQuota(wallet, fileSize, '0');
    uploaded = await runUpload();
    // Pass-through funding refills the standing balance this upload drew on.
    // After the upload on purpose, so a funding fault cannot strand a caller who
    // already paid and whose bytes are already safe in GCS.
    fundUploadIfNeeded(txHash, ETH);
  }

  // Off the response path: the staged object is read a third time, and the IPFS
  // client's own 30s ceiling can outlive what the caller should wait for. The
  // delete is chained behind it so the read cannot lose its source. A factory,
  // not a stream, because each replica needs its own.
  pushArweaveSingleFileToIPFS({
    arweaveId: uploaded.arweaveId,
    ipfsHash,
    getStream: () => getStagedReadStream(txHash, 'open', generation),
  })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(`IPFS replication failed for ${uploaded.arweaveId}:`, (error as Error).message);
    })
    // Best-effort and self-swallowing; the staging/ lifecycle rule sweeps leftovers.
    .finally(() => deleteStagedObject(txHash, 'open'));

  return { ...uploaded, fileSHA256: computedSHA256, isSponsored };
}

export default uploadStagedObjectToArweave;
