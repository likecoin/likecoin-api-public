import { Router } from 'express';
import uuidv4 from 'uuid/v4';
import {
  ARWEAVE_MAX_SIZE_V2,
  checkArweaveTxV2,
  estimateUploadToArweaveV2,
  pushArweaveSingleFileToIPFS,
} from '../../util/api/arweave';
import publisher from '../../util/gcloudPub';
import { API_HOSTNAME, ARWEAVE_GATEWAY, PUBSUB_TOPIC_MISC } from '../../constant';
import {
  ARWEAVE_EVM_TARGET_ADDRESS,
  ARWEAVE_LINK_INTERNAL_TOKEN,
} from '../../../config/config';
import { getPublicKey, signData as signArweaveData } from '../../util/arweave/signer';
import {
  createNewArweaveTx,
  createNewGcsUploadTx,
  getArweaveTxInfo,
  isArweaveTxOwner,
  markGcsTxCompleted,
  updateArweaveTxStatus,
  rotateArweaveTxAccessToken,
  resolveArweaveTxKey,
} from '../../util/api/arweave/tx';
import { getRemainingQuota, withReservedQuota } from '../../util/api/arweave/quota';
import { reconcilePendingIrysFunding, fundUploadIfNeeded } from '../../util/api/arweave/funding';
import {
  deleteStagedObject,
  getStagedUploadSignedUrl,
  ingestProtectedContent,
  promoteStagedObject,
  verifyStagedObject,
} from '../../util/api/arweave/ingest';
import { getProtectedContentUri, isEbookProtectedBucketEnabled } from '../../util/gcloudStorage';
import {
  ArweaveEstimateBodySchema,
  ArweaveEstimateResponseSchema,
  ArweaveGcsFinalizeResponseSchema,
  ArweaveGcsUploadInitBodySchema,
  ArweaveGcsUploadInitResponseSchema,
  ArweaveRegisterBodySchema,
  ArweaveRegisterResponseSchema,
  ArweaveSignPaymentBodySchema,
  ArweaveSignPaymentResponseSchema,
  ArweaveTxHashParamsSchema,
  ArweavePublicKeyResponseSchema,
  ArweaveLinkResponseSchema,
  ArweaveAccessTokenResponseSchema,
  ArweaveFundingReconcileBodySchema,
  ArweaveFundingReconcileResponseSchema,
} from '../../util/api/arweave/schemas';
import { jwtAuth, jwtOptionalAuth } from '../../middleware/jwt';
import { arweaveAdminAuth } from '../../middleware/arweave-admin-auth';
import { validateBody, validateParams } from '../../middleware/validate';
import { sendValidatedJSON } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';

const router = Router();

function getArweaveLinkV2Url(txHash: string): string {
  return `https://${API_HOSTNAME}/arweave/v2/link/${txHash}`;
}

router.get(
  '/v2/public_key',
  async (req, res, next) => {
    try {
      const publicKey = await getPublicKey();
      sendValidatedJSON(res, ArweavePublicKeyResponseSchema, { publicKey: publicKey.toString('base64') });
    } catch (error) {
      next(error);
    }
  },
);

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

router.post(
  '/v2/sign_payment_data',
  jwtOptionalAuth('write:iscn'),
  validateBody(ArweaveSignPaymentBodySchema),
  async (req, res, next) => {
    try {
      const {
        fileSize, ipfsHash, txHash, signatureData, txToken = 'BASEETH',
      } = req.body;

      const isSponsored = txToken === 'SPONSORED';
      if (isSponsored && !req.user?.wallet) {
        throw new ValidationError('MISSING_USER', 401);
      }
      if (!isSponsored && !txHash) {
        throw new Error('MISSING_TX_HASH');
      }

      const estimate = await estimateUploadToArweaveV2(
        fileSize,
        ipfsHash,
        { margin: 0, checkDuplicate: false },
      );
      const {
        ETH,
        arweaveId,
        isExists,
      } = estimate;

      let token: string;
      let uploadId: string;

      if (isSponsored) {
        const { wallet } = req.user!;
        uploadId = `sponsored-${uuidv4()}`;
        token = await withReservedQuota(wallet, fileSize, ETH, async () => {
          const newToken = await createNewArweaveTx(uploadId, {
            ipfsHash,
            fileSize,
            ownerWallet: wallet,
            isSponsored: true,
            sponsoredETH: ETH,
          });
          // Sponsored uploads carry no payment to pass through; the standing Irys
          // balance buffer covers them.
          return newToken;
        });
      } else {
        uploadId = txHash;
        const { paidETH } = await checkArweaveTxV2({
          fileSize, ipfsHash, txHash, ETH, txToken,
        });
        try {
          token = await createNewArweaveTx(txHash, {
            ipfsHash,
            fileSize,
            ownerWallet: req.user?.wallet || '',
          });
        } catch (error) {
          if ((error as Error)?.message.includes('ALREADY_EXISTS')) {
            // eslint-disable-next-line no-console
            console.warn(error);
            res.status(429).send('TX_HASH_ALREADY_USED');
            return;
          }
          throw error;
        }
        fundUploadIfNeeded(uploadId, paidETH);
      }

      // TODO: verify signatureData match filesize if possible
      const signature = await signArweaveData(Buffer.from(signatureData, 'base64'));
      const signatureHex = signature && signature.toString('base64');

      sendValidatedJSON(res, ArweaveSignPaymentResponseSchema, {
        token,
        id: uploadId,
        arweaveId,
        isExists,
        signature: signatureHex,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: isSponsored ? 'arweaveSponsoredSigningV2' : 'arweaveSigningV2',
        ipfsHash,
        arweaveId,
        ETH,
        txHash: uploadId,
        ...(isSponsored ? { wallet: req.user!.wallet } : {}),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/v2/register',
  jwtOptionalAuth('write:iscn'),
  validateBody(ArweaveRegisterBodySchema),
  async (req, res, next) => {
    try {
      const {
        txHash, arweaveId, token, key, isRequireAuth = true, fileSHA256,
      } = req.body;
      if (isRequireAuth && !req.user?.wallet) throw new ValidationError('MISSING_USER', 401);
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      const { ownerWallet, authToken } = tx;
      const userWallet = req.user?.wallet || '';
      // Token match first: it needs no Firestore read, unlike the owner lookup.
      const isAuthed = !!(authToken && authToken === token)
        || (await isArweaveTxOwner(userWallet, ownerWallet));
      if (!isAuthed) throw new ValidationError('INVALID_TOKEN', 403);
      if (tx.status !== 'pending') throw new ValidationError('TX_ALREADY_REGISTERED', 409);
      const accessToken = await updateArweaveTxStatus(txHash, {
        arweaveId,
        ownerWallet: req.user?.wallet || '',
        key,
        isRequireAuth,
        fileSHA256,
      });
      sendValidatedJSON(res, ArweaveRegisterResponseSchema, {
        link: getArweaveLinkV2Url(txHash),
        token,
        accessToken,
        isRequireAuth,
      });
      const {
        ipfsHash, fileSize,
      } = tx;
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveIdRegisterStartV2',
        ipfsHash,
        arweaveId,
        txHash,
      });
      await pushArweaveSingleFileToIPFS({ arweaveId, ipfsHash, fileSize });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveIdRegisterCompleteV2',
        ipfsHash,
        arweaveId,
        txHash,
      });
      // Dual-store protected uploads into the private CMEK bucket (Phase 3).
      // Best-effort: a failure here leaves Arweave as the only copy, which is
      // today's status quo; Phase 4's re-ingest sweep catches stragglers.
      if (key) {
        try {
          const ingested = await ingestProtectedContent(txHash, {
            arweaveId, key, ipfsHash, fileSize, fileSHA256,
          });
          if (ingested) {
            publisher.publish(PUBSUB_TOPIC_MISC, req, {
              logType: 'arweaveProtectedIngestCompleteV2',
              arweaveId,
              txHash,
              contentBucketPath: ingested.contentBucketPath,
              fileSHA256: ingested.fileSHA256,
            });
          }
        } catch (error) {
          publisher.publish(PUBSUB_TOPIC_MISC, req, {
            logType: 'arweaveProtectedIngestErrorV2',
            arweaveId,
            txHash,
            error: (error as Error).message,
          });
        }
      }
    } catch (error) {
      next(error);
    }
  },
);

// GCS-direct upload (ADR 0001 Phase 3, no-Arweave path): protected books put
// plaintext straight into the private CMEK bucket via a signed resumable URL.
// Inert until EBOOK_PROTECTED_BUCKET is configured — that env is the
// kill-switch, so the endpoints ship dark.
router.post(
  '/v2/gcs/upload_init',
  jwtAuth('write:iscn'),
  validateBody(ArweaveGcsUploadInitBodySchema),
  async (req, res, next) => {
    try {
      if (!isEbookProtectedBucketEnabled()) throw new ValidationError('PROTECTED_BUCKET_NOT_CONFIGURED', 501);
      const {
        fileSize, fileSHA256, contentType, fileName,
      } = req.body;
      if (fileSize > ARWEAVE_MAX_SIZE_V2) throw new ValidationError('FILE_SIZE_LIMIT_EXCEEDED');
      const { wallet } = req.user;
      const id = `gcs-${uuidv4()}`;
      // GCS-direct skips the Arweave fee entirely, so the sponsored-upload
      // quota is all that stands between write:iscn and unlimited free
      // private storage.
      const uploadUrl = await withReservedQuota(wallet, fileSize, '0', async () => {
        await createNewGcsUploadTx(id, {
          fileSize, fileSHA256, contentType, fileName, ownerWallet: wallet,
        });
        return getStagedUploadSignedUrl(id, contentType);
      });
      sendValidatedJSON(res, ArweaveGcsUploadInitResponseSchema, { id, uploadUrl });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'arweaveGcsUploadInitV2',
        wallet,
        txHash: id,
        fileSize,
        contentType,
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
      if (!isEbookProtectedBucketEnabled()) throw new ValidationError('PROTECTED_BUCKET_NOT_CONFIGURED', 501);
      const { txHash } = req.params as Record<string, string>;
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      if (tx.source !== 'gcs') throw new ValidationError('NOT_GCS_UPLOAD', 400);
      if (!(await isArweaveTxOwner(req.user.wallet, tx.ownerWallet))) throw new ValidationError('NOT_OWNER', 403);
      if (tx.status !== 'pending') throw new ValidationError('TX_ALREADY_REGISTERED', 409);
      const { computedSHA256 } = await verifyStagedObject(txHash, {
        fileSize: tx.fileSize,
        fileSHA256: tx.fileSHA256,
      });
      const contentBucketPath = await promoteStagedObject(txHash, {
        contentType: tx.contentType || 'application/octet-stream',
        fileSHA256: computedSHA256,
      });
      await markGcsTxCompleted(txHash, { contentBucketPath });
      sendValidatedJSON(res, ArweaveGcsFinalizeResponseSchema, {
        id: txHash,
        link: getArweaveLinkV2Url(txHash),
      });
      // Best-effort and self-swallowing, so it stays off the response path;
      // only the mark-complete-before-delete ordering matters.
      deleteStagedObject(txHash);
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

router.get(
  '/v2/link/:txHash',
  jwtOptionalAuth('read:iscn'),
  validateParams(ArweaveTxHashParamsSchema),
  async (req, res, next) => {
    try {
      const { txHash } = req.params as Record<string, string>;
      const { token } = req.query as Record<string, string>;
      if (!txHash) throw new ValidationError('MISSING_TX_HASH');
      const tx = await getArweaveTxInfo(txHash);
      if (!tx) throw new ValidationError('TX_NOT_FOUND', 404);
      const {
        arweaveId, token: docToken, isRequireAuth, ownerWallet,
        accessToken: docAccessToken,
      } = tx;
      if (isRequireAuth) {
        if (!req.user?.wallet && !token) throw new ValidationError('MISSING_USER', 401);
        // Guard on `token`: a doc without `token` would otherwise match a
        // tokenless request on undefined === undefined and skip auth entirely.
        // Checked before the owner lookup, which costs a Firestore read.
        const isTokenAuthed = !!token
          && [docToken, ARWEAVE_LINK_INTERNAL_TOKEN, docAccessToken].includes(token);
        if (!isTokenAuthed && !(await isArweaveTxOwner(req.user?.wallet, ownerWallet))) {
          throw new ValidationError('INVALID_TOKEN', 403);
        }
      }
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
        // Advertise the private-bucket plaintext copy (ADR 0001 Phase 3) so
        // readers with bucket access can go GCS-first; key + link remain the
        // fallback. contentType rides along so they can skip a metadata call.
        const contentUri = getProtectedContentUri(tx.contentBucketPath);
        sendValidatedJSON(res, ArweaveLinkResponseSchema, {
          arweaveId,
          txHash,
          key,
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
