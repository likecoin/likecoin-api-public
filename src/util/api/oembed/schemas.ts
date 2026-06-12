import { z } from 'zod';

// Fields stay .optional() because the handler throws specific errors
// (missing url, invalid domain/subdomain, invalid format) and defaults
// format to 'json'. .passthrough() preserves the query on reassignment.
export const OembedQuerySchema = z.object({
  url: z.string().optional(),
  format: z.string().optional(),
}).passthrough();

// The handler spreads arbitrary per-type oEmbed fields (title, html, width,
// thumbnail_url, ...) onto the base envelope, so keep the extras via .passthrough().
export const OembedResponseSchema = z.object({
  type: z.string(),
  version: z.string(),
  provider_name: z.string(),
  provider_url: z.string(),
}).passthrough();
