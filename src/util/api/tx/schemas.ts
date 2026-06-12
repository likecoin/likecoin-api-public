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

// Mirrors filterTxData's output. For multi-recipient txs (filterMultipleTxData)
// to/toId become arrays and amount is wrapped into Coin objects via LIKEToAmount,
// so keep those unions; status/ts optional for legacy rows.
const CoinSchema = z.object({
  denom: z.string(),
  amount: z.union([z.string(), z.number()]),
});
const TxAmountSchema = z.union([
  z.string(),
  z.number(),
  CoinSchema,
  z.array(z.union([z.string(), z.number(), CoinSchema])),
]);

export const TxDataResponseSchema = z.object({
  from: z.string().optional(),
  fromId: z.string().optional(),
  to: z.union([z.string(), z.array(z.string())]).optional(),
  toId: z.union([z.string(), z.array(z.string())]).optional(),
  value: TxAmountSchema.optional(),
  amount: TxAmountSchema.optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  remarks: z.string().optional(),
  httpReferrer: z.string().optional(),
  completeTs: z.number().optional(),
  ts: z.number().optional(),
  txHash: z.string().optional(),
});

export const TxHistoryListResponseSchema = z.array(
  TxDataResponseSchema.extend({ id: z.string() }),
);
