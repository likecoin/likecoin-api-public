import { z } from 'zod';

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
  fileSHA256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

export const ArweaveTxHashParamsSchema = z.object({
  txHash: z.string().min(1),
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
  link: z.string(),
});

export const ArweaveAccessTokenResponseSchema = z.object({
  accessToken: z.string(),
});
