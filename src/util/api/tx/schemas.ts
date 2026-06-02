import { z } from 'zod';

// Params schemas list every route :param. Query schemas use .passthrough()
// and keep fields .optional() because the handlers already coerce ts/count
// with Number()+NaN-fallback and validate addr via checkAddressValid.

export const TxHistoryUserParamsSchema = z.object({
  id: z.string().min(1),
});

export const TxHistoryAddrParamsSchema = z.object({
  addr: z.string().min(1),
});

export const TxHistoryQuerySchema = z.object({
  ts: z.union([z.string(), z.number()]).optional(),
  count: z.union([z.string(), z.number()]).optional(),
}).passthrough();

export const TxIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const TxIdQuerySchema = z.object({
  address: z.string().optional(),
}).passthrough();

// metadata is validated in-handler against TX_METADATA_TYPES; keep permissive.
export const TxMetadataBodySchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
