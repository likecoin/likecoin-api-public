import { z } from 'zod';
import { CONTENT_TIERS } from '../../gcloudStorage';
import { EBOOK_CONTENT_TYPES } from './contentType';

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/i);

export const ArweaveEstimateBodySchema = z.object({
  fileSize: z.coerce.number().int().positive(),
  ipfsHash: z.string().optional(),
});

export const ArweaveSignPaymentBodySchema = z.object({
  fileSize: z.coerce.number().int().positive(),
  ipfsHash: z.string().min(1),
  txHash: z.string().optional(),
  signatureData: z.string().min(1),
  txToken: z.enum(['BASEETH', 'SPONSORED']).optional(),
});

export const ArweaveRegisterBodySchema = z.object({
  txHash: z.string().min(1),
  arweaveId: z.string().min(1),
  token: z.string().optional(),
  key: z.string().optional(),
  isRequireAuth: z.boolean().optional(),
  fileSHA256: Sha256HexSchema.optional(),
});

export const ArweaveTxHashParamsSchema = z.object({
  txHash: z.string().min(1),
});

// Cover types the open tier accepts. `image/svg+xml` is deliberately absent: SVG
// can carry script, and these objects are served under the content type they were
// stored with. Mirrors OPEN_IMAGE_FILE_TYPES in publish-3ook-com.
const OPEN_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const;

// GCS-direct upload (ADR 0001 Phase 3).
//
// `tier` picks the destination bucket and the rest of the flow: 'protected' is the
// private CMEK store and skips Arweave entirely; 'open' is the public mirror, which
// continues on to /v2/gcs/arweave/:txHash for the Arweave copy. Defaulted here so
// existing protected clients are unaffected and no handler restates the fallback.
export const ArweaveGcsUploadInitBodySchema = z.object({
  fileSize: z.coerce.number().int().positive(),
  fileSHA256: Sha256HexSchema,
  contentType: z.enum([...EBOOK_CONTENT_TYPES, ...OPEN_IMAGE_CONTENT_TYPES]),
  fileName: z.string().min(1).max(256).optional(),
  tier: z.enum(CONTENT_TIERS).default('protected'),
}).superRefine((body, ctx) => {
  // The protected tier only ever holds ebooks. A cover there would be a bug: CMEK
  // and a reader gate buy nothing for an image that has to render publicly, and it
  // would land in the Phase 4 key-destruction sweep's blast radius.
  if (body.tier === 'protected' && !(EBOOK_CONTENT_TYPES as readonly string[]).includes(body.contentType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contentType'],
      message: 'PROTECTED_TIER_REQUIRES_EBOOK',
    });
  }
});

// Server-side Arweave upload of an already-staged open-tier object. Payment
// mirrors /v2/sign_payment_data: a Base ETH tx the caller already broadcast, or
// SPONSORED against the daily quota.
export const ArweaveGcsArweaveBodySchema = z.object({
  ipfsHash: z.string().min(1),
  paymentTxHash: z.string().optional(),
  txToken: z.enum(['BASEETH', 'SPONSORED']).optional(),
});

export const ArweaveGcsUploadInitResponseSchema = z.object({
  id: z.string(),
  uploadUrl: z.string().url(),
});

export const ArweaveGcsFinalizeResponseSchema = z.object({
  id: z.string(),
  link: z.string().url(),
});

// No contentUri: the client only needs the arweaveId it puts on-chain, and the
// bucket path is internal.
export const ArweaveGcsArweaveResponseSchema = ArweaveGcsFinalizeResponseSchema.extend({
  arweaveId: z.string(),
});

export const ArweaveEstimateResponseSchema = z.object({
  arweaveId: z.string().optional(),
  ETH: z.string(),
  memo: z.string(),
  evmAddress: z.string(),
  remainingBytes: z.number().int().min(0).optional(),
  remainingUploads: z.number().int().min(0).optional(),
  isUnlimited: z.boolean().optional(),
});

export const ArweaveSignPaymentResponseSchema = z.object({
  token: z.string(),
  id: z.string(),
  arweaveId: z.string().optional(),
  isExists: z.boolean().optional(),
  signature: z.string().optional(),
});

export const ArweaveRegisterResponseSchema = z.object({
  link: z.string().url(),
  token: z.string().optional(),
  accessToken: z.string(),
  isRequireAuth: z.boolean(),
});

export const ArweavePublicKeyResponseSchema = z.object({
  publicKey: z.string(),
});

export const ArweaveLinkResponseSchema = z.object({
  arweaveId: z.string().optional(),
  txHash: z.string().optional(),
  key: z.string().optional(),
  // Absent for GCS-direct docs, which have no public Arweave copy; consumers
  // (ebook-cors parseNFTMetadataURL) already guard on `if (data.link)`.
  link: z.string().optional(),
  // True iff `link` alone serves readable content (not just present).
  // Encrypted docs without a resolved key still have a `link` but serve ciphertext;
  // consumers use false to avoid falling back to ciphertext.
  hasPublicCopy: z.boolean(),
  contentUri: z.string().optional(),
  contentType: z.string().optional(),
});

export const ArweaveAccessTokenResponseSchema = z.object({
  accessToken: z.string(),
});

export const ArweaveFundingReconcileBodySchema = z.object({
  dryRun: z.boolean().optional(),
  limit: z.coerce.number().int().positive().max(500)
    .optional(),
});

export const ArweaveFundingReconcileResponseSchema = z.object({
  success: z.boolean(),
  total: z.number().int().min(0),
  credited: z.number().int().min(0),
  results: z.array(z.object({
    id: z.string(),
    fundingTxHash: z.string(),
    credited: z.boolean(),
    error: z.string().optional(),
  })),
});
