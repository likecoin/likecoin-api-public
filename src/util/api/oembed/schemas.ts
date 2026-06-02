/* eslint-disable import/prefer-default-export */
import { z } from 'zod';

// Fields stay .optional() because the handler throws specific errors
// (missing url, invalid domain/subdomain, invalid format) and defaults
// format to 'json'. .passthrough() preserves the query on reassignment.
export const OembedQuerySchema = z.object({
  url: z.string().optional(),
  format: z.string().optional(),
}).passthrough();
