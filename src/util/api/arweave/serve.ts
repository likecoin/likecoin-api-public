import type { NextFunction, Request, Response } from 'express';
import { pipeline } from 'stream';
import { type ContentTier, getTierFileStream } from '../../gcloudStorage';
import { isNotFoundError } from '../../misc';
import { ValidationError } from '../../ValidationError';

// A read that fails after the metadata probe — a deleted generation, revoked
// access — must answer 404 like the pre-flight checks, not 500.
export function toContentError(error: unknown): unknown {
  return isNotFoundError(error) ? new ValidationError('CONTENT_OBJECT_NOT_FOUND', 404) : error;
}

// `headers` are applied only once the object is open, so a failed read never
// leaves a cacheable header on its error response.
export async function serveTierFile(
  req: Request,
  res: Response,
  next: NextFunction,
  {
    tier, objectPath, contentType, headers,
  }: {
    tier: ContentTier;
    objectPath: string;
    contentType?: string;
    headers?: Record<string, string>;
  },
): Promise<void> {
  const {
    stream, contentType: bucketContentType, size,
  } = await getTierFileStream(tier, objectPath);
  // Answer from the source's own error, not pipeline's callback: pipeline
  // destroys `res` before calling back, so a status written there is composed
  // into a dead socket and the caller only ever sees a connection reset.
  // req.destroyed filters the reader who cancelled before the first byte, which
  // reaches both handlers as ERR_STREAM_PREMATURE_CLOSE with headers unsent.
  stream.once('error', (err) => {
    if (!res.headersSent && !req.destroyed) next(toContentError(err));
  });
  res.set('Content-Type', contentType || bucketContentType || 'application/octet-stream');
  if (size !== undefined) res.set('Content-Length', String(size));
  if (headers) res.set(headers);
  // Express routes HEAD here too, and res.write() silently discards a HEAD body
  // while still draining the source — a whole-object read of GCS egress per call.
  if (req.method === 'HEAD') {
    stream.destroy();
    res.end();
    return;
  }
  // pipeline, not pipe: pipe only unpipes on a client abort, leaving the GCS
  // read open.
  pipeline(stream, res, (err) => {
    if (err && !res.headersSent && !req.destroyed) next(toContentError(err));
  });
}
