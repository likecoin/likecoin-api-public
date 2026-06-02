import { z } from 'zod';

// class_id / iscn_id are resolved by the fetchISCNPrefixAndClassId middleware,
// which throws MISSING_ISCN_OR_CLASS_ID itself; keep them optional and use
// .passthrough() so the middleware still sees them after req.query reassignment.
export const LikernftClassQuerySchema = z.object({
  class_id: z.string().optional(),
  iscn_id: z.string().optional(),
}).passthrough();

export const LikernftHistoryQuerySchema = z.object({
  class_id: z.string().optional(),
  iscn_id: z.string().optional(),
  nft_id: z.string().optional(),
  tx_hash: z.string().optional(),
}).passthrough();

export const LikernftClassIdParamsSchema = z.object({
  classId: z.string().min(1),
});

// size is parsed + clamped in-handler; keep permissive.
export const LikernftImageQuerySchema = z.object({
  size: z.string().optional(),
}).passthrough();

export const LikernftUserStatsParamsSchema = z.object({
  wallet: z.string().min(1),
});
