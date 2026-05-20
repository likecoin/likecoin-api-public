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
});
