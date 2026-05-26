/* eslint-disable import/prefer-default-export */
import { z } from 'zod';
import { NFTBookListingInfoFilteredSchema } from '../likernft/book/schemas';

export const NFTAggregatedMetadataResponseSchema = z.object({
  classData: z.record(z.string(), z.unknown()).nullable().optional(),
  iscnData: z.record(z.string(), z.unknown()).nullable().optional(),
  ownerInfo: z.array(z.string()).nullable().optional(),
  bookstoreInfo: NFTBookListingInfoFilteredSchema.nullable().optional(),
});

export const NFTAggregatedMetadataQuerySchema = z.object({
  class_id: z.string().optional(),
  data: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough();
