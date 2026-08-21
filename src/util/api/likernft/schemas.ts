import { z } from 'zod';

// class_id / iscn_id are resolved by the fetchISCNPrefixAndClassId middleware,
// which throws MISSING_ISCN_OR_CLASS_ID itself; keep them optional and use
// .passthrough() so the middleware still sees them after req.query reassignment.
export const LikernftClassQuerySchema = z.object({
  class_id: z.string().optional(),
  iscn_id: z.string().optional(),
}).passthrough();

export const LikernftClassIdParamsSchema = z.object({
  classId: z.string().min(1),
});

// size is parsed + clamped in-handler; keep permissive.
export const LikernftImageQuerySchema = z.object({
  size: z.string().optional(),
}).passthrough();

// Mirrors filterLikeNFTISCNData's fixed output (src/util/ValidationHelper.ts).
export const LikeNFTISCNDataResponseSchema = z.object({
  iscnId: z.string(),
  classId: z.string(),
  nextNewNFTId: z.number().optional(),
  totalCount: z.number().optional(),
  currentPrice: z.number().optional(),
  basePrice: z.number().optional(),
  soldCount: z.number().optional(),
  classUri: z.string().optional(),
  creatorWallet: z.string().optional(),
  ownerWallet: z.string().optional(),
});

// Mirrors filterLikeNFTMetadata; .passthrough() because it spreads arbitrary
// remaining metadata keys (`[key: string]: any`) alongside the OpenSea fields.
export const LikeNFTMetadataResponseSchema = z.object({
  image: z.string().optional(),
  external_url: z.string().optional(),
  description: z.string().optional(),
  name: z.string().optional(),
  background_color: z.string().optional(),
  animation_url: z.string().optional(),
  youtube_url: z.string().optional(),
  iscn_id: z.string().optional(),
  iscn_owner: z.string().optional(),
  iscn_record_timestamp: z.string().optional(),
  iscn_stakeholders: z.any(),
}).passthrough();
