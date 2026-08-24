import { Router } from 'express';
import { pipeline } from 'stream';
import uuidv4 from 'uuid/v4';
import {
  ARWEAVE_MAX_SIZE_V2,
  estimateUploadToArweaveV2,
} from '../../util/api/arweave';
import publisher from '../../util/gcloudPub';
import { API_HOSTNAME, ARWEAVE_GATEWAY, PUBSUB_TOPIC_MISC } from '../../constant';
import {
  ARWEAVE_EVM_TARGET_ADDRESS,
} from '../../../config/config';
import {
  createNewGcsUploadTx,
  getArweaveTxInfo,
  getOwnedPendingGcsTx,
  isArweaveTxOwner,
  markGcsTxCompleted,
  rotateArweaveTxAccessToken,
  resolveArweaveTxKey,
  isArweaveTxEncrypted,
  assertArweaveTxAccess,
} from '../../util/api/arweave/tx';
import { getRemainingQuota, withReservedQuota } from '../../util/api/arweave/quota';
import { reconcilePendingIrysFunding } from '../../util/api/arweave/funding';
import {
  deleteStagedObject,
  getStagedUploadSignedUrl,
  promoteStagedObject,
  verifyStagedObject,
} from '../../util/api/arweave/ingest';
import { uploadStagedObjectToArweave } from '../../util/api/arweave/openUpload';
import { getTierContentUri, getTierFileStream, isEbookTierBucketEnabled } from '../../util/gcloudStorage';
import {
  ArweaveEstimateBodySchema,
  ArweaveEstimateResponseSchema,
  ArweaveGcsArweaveBodySchema,
  ArweaveGcsArweaveResponseSchema,
  ArweaveGcsFinalizeResponseSchema,
  ArweaveGcsUploadInitBodySchema,
  ArweaveGcsUploadInitResponseSchema,
  ArweaveTxHashParamsSchema,
  ArweaveLinkResponseSchema,
  ArweaveAccessTokenResponseSchema,
  ArweaveFundingReconcileBodySchema,
  ArweaveFundingReconcileResponseSchema,
} from '../../util/api/arweave/schemas';
import { jwtAuth, jwtOptionalAuth } from '../../middleware/jwt';
import { arweaveAdminAuth } from '../../middleware/arweave-admin-auth';
import { validateBody, validateParams } from '../../middleware/validate';
import { isNotFoundError } from '../../util/misc';
import { sendValidatedJSON } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';

const router = Router();

// A read that fails after the metadata probe — a deleted generation, revoked
// access — must answer 404 like the pre-flight checks, not 500.
function toContentError(error: unknown): unknown {
  return isNotFoundError(error) ? new ValidationError('CONTENT_OBJECT_NOT_FOUND', 404) : error;
}

function getArweaveLinkV2Url(txHash: string): string {
  return `https://${API_HOSTNAME}/arweave/v2/link/${txHash}`;
}

router.post(
  '/v2/estimate',
  jwtOptionalAuth('write:iscn'),
  validateBody(ArweaveEstimateBodySchema),
  async (req, res, next) => {
    try {
      const { fileSize, ipfsHash } = req.body;
      const [{ arweaveId, ETH }, quota] = await Promise.all([
        estimateUploadToArweaveV2(fileSize, ipfsHash),
        req.user?.wallet ? getRemainingQuota(req.user.wallet) : Promise.resolve(null),
      ]);

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveEstimateV2',
        ipfsHash,
        arweaveId,
        ETH,
      });
      const result: {
        arweaveId?: string;
        ETH: string;
        memo: string;
        evmAddress: string;
        remainingBytes?: number;
        remainingUploads?: number;
        isUnlimited?: boolean;
      } = {
        arweaveId,
        ETH,
        memo: JSON.stringify({ ipfs: ipfsHash, fileSize }),
        evmAddress: ARWEAVE_EVM_TARGET_ADDRESS,
      };
      if (quota) {
        result.isUnlimited = quota.isUnlimited;
        if (!quota.isUnlimited) {
          result.remainingBytes = quota.remainingBytes;
          result.remainingUploads = quota.remainingUploads;
        }
      }
      sendValidatedJSON(res, ArweaveEstimateResponseSchema, result);
    } catch (error) {
      next(error);
    }
  },
);

// GCS-direct upload (ADR 0001 Phase 3): bytes go straight into the tier's bucket
// via a signed resumable URL. Inert until that tier's bucket env is configured, so
// each tier ships dark behind its own kill-switch.
router.post(
  '/v2/gcs/upload_init',
  jwtAuth('write:iscn'),
  validateBody(ArweaveGcsUploadInitBodySchema),
  async (req, res, next) => {
    try {
      const {
        fileSize, fileSHA256, contentType, fileName, tier,
      } = req.body;
      if (!isEbookTierBucketEnabled(tier)) throw new ValidationError(`${tier.toUpperCase()}_BUCKET_NOT_CONFIGURED`, 501);
      if (fileSize > ARWEAVE_MAX_SIZE_V2) throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
      const { wallet } = req.user;
      const id = `gcs-${uuidv4()}`;
      // Both tiers: staging costs the caller nothing up front, so the quota is all
      // that stands between write:iscn and unbounded free storage. The open tier
      // releases this once /v2/gcs/arweave settles the real charge; an abandoned
      // upload keeps it, which is exactly the rate limit we want.
      const uploadUrl = await withReservedQuota(wallet, fileSize, '0', async () => {
        await createNewGcsUploadTx(id, {
          fileSize, fileSHA256, contentType, fileName, ownerWallet: wallet, tier,
        });
        return getStagedUploadSignedUrl(id, tier, contentType);
      });
      sendValidatedJSON(res, ArweaveGcsUploadInitResponseSchema, { id, uploadUrl });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveGcsUploadInitV2',
        wallet,
        txHash: id,
        fileSize,
        contentType,
        tier,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/v2/gcs/finalize/:txHash',
  jwtAuth('write:iscn'),
  validateParams(ArweaveTxHashParamsSchema),
  async (req, res, next) => {
    try {
      if (!isEbookTierBucketEnabled('protected')) throw new ValidationError('PROTECTED_BUCKET_NOT_CONFIGURED', 501);
      const { txHash } = req.params as Record<string, string>;
      const tx = await getOwnedPendingGcsTx(txHash, req.user.wallet, 'protected');
      const { computedSHA256, generation } = await verifyStagedObject(txHash, 'protected', {
        fileSize: tx.fileSize,
        fileSHA256: tx.fileSHA256,
      });
      const contentBucketPath = await promoteStagedObject(txHash, 'protected', {
        contentType: tx.contentType || 'application/octet-stream',
        fileSHA256: computedSHA256,
        generation,
      });
      await markGcsTxCompleted(txHash, { contentBucketPath });
      sendValidatedJSON(res, ArweaveGcsFinalizeResponseSchema, {
        id: txHash,
        link: getArweaveLinkV2Url(txHash),
      });
      // Best-effort and self-swallowing, so it stays off the response path;
      // only the mark-complete-before-delete ordering matters.
      deleteStagedObject(txHash, 'protected');
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveGcsFinalizeV2',
        wallet: req.user.wallet,
        txHash,
        contentBucketPath,
        fileSHA256: computedSHA256,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Open tier (ADR 0001 Phase 3 amendment): verify the staged upload, then make the
// Arweave copy server-side, blocking on the node's receipt before returning the
// arweaveId the client puts on-chain. One endpoint rather than finalize + upload,
// so no intermediate state is left for the staging/ lifecycle rule to sweep.
router.post(
  '/v2/gcs/arweave/:txHash',
  jwtAuth('write:iscn'),
  validateParams(ArweaveTxHashParamsSchema),
  validateBody(ArweaveGcsArweaveBodySchema),
  async (req, res, next) => {
    try {
      if (!isEbookTierBucketEnabled('open')) throw new ValidationError('OPEN_BUCKET_NOT_CONFIGURED', 501);
      const { txHash } = req.params as Record<string, string>;
      const { ipfsHash, paymentTxHash, txToken } = req.body;
      const { wallet } = req.user;
      const tx = await getOwnedPendingGcsTx(txHash, wallet, 'open');
      const {
        arweaveId, contentBucketPath, fileSHA256, isSponsored,
      } = await uploadStagedObjectToArweave(txHash, tx, {
        wallet, ipfsHash, paymentTxHash, txToken,
      });
      sendValidatedJSON(res, ArweaveGcsArweaveResponseSchema, {
        id: txHash,
        arweaveId,
        link: `${ARWEAVE_GATEWAY}/${arweaveId}`,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveGcsArweaveUploadV2',
        wallet,
        txHash,
        arweaveId,
        ipfsHash,
        fileSize: tx.fileSize,
        contentBucketPath,
        fileSHA256,
        isSponsored,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/v2/link/:txHash',
  jwtOptionalAuth('read:iscn'),
  validateParams(ArweaveTxHashParamsSchema),
  async (req, res, next) => {
    try {
      const { txHash } = req.params as Record<string, string>;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      await assertArweaveTxAccess(tx, {
        wallet: req.user?.wallet,
        token: (req.query as Record<string, string>).token,
      });
      const { arweaveId } = tx;
      // GCS-direct docs have no arweaveId: interpolating undefined would mint
      // a syntactically valid gateway/undefined URL that every consumer down
      // to the ebook-cors cache key would silently accept.
      const link = arweaveId ? new URL(`${ARWEAVE_GATEWAY}/${arweaveId}`) : null;
      // A browser's */*;q=0.8 satisfies accepts('application/json'), so plain negotiation
      // hands it the key below. Take the JSON branch only when JSON outranks HTML; every
      // programmatic caller (*/*, no header, axios, explicit JSON) still lands there.
      if (req.accepts(['application/json', 'text/html']) === 'application/json') {
        // The key must never reach the browser: a redirect target lands in history, the
        // Referer chain and the gateway's access logs. Only the JSON branch may carry it
        // (ebook-cors reads it back off `link`).
        const key = await resolveArweaveTxKey(tx, txHash);
        if (key && link) {
          link.searchParams.set('key', key);
        }
        // Advertise the GCS plaintext copy (ADR 0001 Phase 3) so readers with
        // bucket access can go GCS-first; key + link remain the fallback.
        // contentType rides along so they can skip a metadata call. Tier picks
        // the bucket — open-tier records point at the DRM-free mirror, which
        // ebook-cors can also derive itself from an ar:// target.
        const contentUri = getTierContentUri(tx.tier || 'protected', tx.contentBucketPath);
        // A KMS-written doc read with KMS off resolves no key, so `link` still
        // goes out but serves ciphertext; only this route can tell that apart
        // from a genuinely unencrypted doc (see schemas.ts).
        const hasPublicCopy = !!link && (!isArweaveTxEncrypted(tx) || !!key);
        sendValidatedJSON(res, ArweaveLinkResponseSchema, {
          arweaveId,
          txHash,
          key,
          hasPublicCopy,
          ...(link ? { link: link.toString() } : {}),
          ...(contentUri ? { contentUri, contentType: tx.contentType } : {}),
        });
        return;
      }
      // No public copy exists to redirect a browser to.
      if (!link) throw new ValidationError('NO_PUBLIC_COPY', 404);
      res.redirect(link.toString());
    } catch (error) {
      next(error);
    }
  },
);

// Owner-authed passthrough of the ingested plaintext (ADR 0001 Phase 3).
// Protected-tier docs have no arweaveId, so /v2/link can only advertise a gs://
// contentUri no browser can fetch; this is how a publisher reads back their own
// file. Streamed rather than signed: a signed URL is pasteable for its whole TTL,
// which the ADR rules out for protected content.
router.get(
  '/v2/content/:txHash',
  jwtOptionalAuth('read:iscn'),
  validateParams(ArweaveTxHashParamsSchema),
  async (req, res, next) => {
    try {
      const { txHash } = req.params as Record<string, string>;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      await assertArweaveTxAccess(tx, {
        wallet: req.user?.wallet,
        token: (req.query as Record<string, string>).token,
      });
      const tier = tx.tier || 'protected';
      if (!isEbookTierBucketEnabled(tier)) throw new ValidationError(`${tier.toUpperCase()}_BUCKET_NOT_CONFIGURED`, 501);
      // Ingest decrypts on the way in, so the bucket copy is plaintext even for a
      // legacy doc that still carries an encryptedKey — no key is read here.
      if (!tx.contentBucketPath) throw new ValidationError('NO_INGESTED_COPY', 404);
      const { stream, contentType, size } = await getTierFileStream(tier, tx.contentBucketPath);
      // Answer from the source's own error, not pipeline's callback: pipeline
      // destroys `res` before calling back, so a status written there is composed
      // into a dead socket and the caller only ever sees a connection reset.
      // req.destroyed filters the reader who cancelled before the first byte, which
      // reaches both handlers as ERR_STREAM_PREMATURE_CLOSE with headers unsent.
      stream.once('error', (err) => {
        if (!res.headersSent && !req.destroyed) next(toContentError(err));
      });
      // jwtOptionalAuth already set no-store, so the bytes stop at the browser.
      res.set('Content-Type', tx.contentType || contentType || 'application/octet-stream');
      if (size !== undefined) res.set('Content-Length', String(size));
      // Express routes HEAD here too, and res.write() silently discards a HEAD body
      // while still draining the source — a whole-object read of GCS egress per call.
      if (req.method === 'HEAD') {
        stream.destroy();
        res.end();
        return;
      }
      // pipeline, not pipe: pipe only unpipes on a client abort, leaving the GCS
      // read open.
      pipeline(stream, res, (err) => {
        if (err && !res.headersSent && !req.destroyed) next(toContentError(err));
      });
    } catch (error) {
      next(toContentError(error));
    }
  },
);

router.post(
  '/v2/access_token/:txHash',
  jwtAuth('write:iscn'),
  validateParams(ArweaveTxHashParamsSchema),
  async (req, res, next) => {
    try {
      const { txHash } = req.params as Record<string, string>;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      const { ownerWallet, status } = tx;
      if (!(await isArweaveTxOwner(req.user.wallet, ownerWallet))) throw new ValidationError('NOT_OWNER', 403);
      if (status !== 'complete') throw new ValidationError('TX_NOT_COMPLETE', 409);
      const accessToken = await rotateArweaveTxAccessToken(txHash);
      sendValidatedJSON(res, ArweaveAccessTokenResponseSchema, { accessToken });
    } catch (error) {
      next(error);
    }
  },
);

// Admin/cron: re-notify Irys funding sends that were broadcast but never confirmed
// credited. Idempotent; `dryRun` lists only.
router.post(
  '/v2/admin/funding/reconcile',
  arweaveAdminAuth,
  validateBody(ArweaveFundingReconcileBodySchema),
  async (req, res, next) => {
    try {
      const { dryRun = false, limit } = req.body;
      const result = await reconcilePendingIrysFunding({ dryRun, limit });
      sendValidatedJSON(res, ArweaveFundingReconcileResponseSchema, { success: true, ...result });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveFundingReconcileV2',
        dryRun,
        total: result.total,
        credited: result.credited,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
