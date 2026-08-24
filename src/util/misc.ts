import { timingSafeEqual } from 'crypto';

export function sleep(time) {
  return new Promise((resolve) => { setTimeout(resolve, time); });
}

// Constant-time string compare for server-side secrets vs caller input.
// `timingSafeEqual` throws on unequal-length buffers, so length must short-circuit first.
// Use for webhook auth, Bearer tokens, and other timing-sensitive comparisons.
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// Firestore create() — or a batch commit containing one — rejects an existing doc
// with gRPC ALREADY_EXISTS. The numeric code leads because the message format
// varies by SDK/gRPC version; the substring is only a fallback for older shapes.
const GRPC_ALREADY_EXISTS = 6;

export function isAlreadyExistsError(error: unknown): boolean {
  const err = error as { code?: number; message?: string } | undefined;
  return err?.code === GRPC_ALREADY_EXISTS || !!err?.message?.includes('ALREADY_EXISTS');
}

// GCS reports a missing object as an HTTP 404 on the error itself. Callers that
// already proved a doc exists use this to answer 404 rather than 500 when the
// bucket copy is gone.
export function isNotFoundError(error: unknown): boolean {
  return (error as { code?: number } | undefined)?.code === 404;
}

// Multiply a bigint amount by a float factor in fixed-point (1e6) space,
// avoiding float precision loss on large wei amounts.
export function scaleBigInt(amount: bigint, factor: number): bigint {
  return (amount * BigInt(Math.round(factor * 1e6))) / 1000000n;
}

export function maskString(
  str: string | undefined,
  {
    start = 8,
    end = 4,
  } = {},
): string | undefined {
  if (!str || str.length <= start + end) return str;
  return `${str.slice(0, start)}*****${str.slice(-end)}`;
}

export function splitByComma(value?: string): string[] {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Covers the five XML predefined entities, so this is safe for both HTML email
// bodies and XML/SVG. `&` must go first or the entities below get double-encoded.
// `&#39;` rather than `&apos;`: the numeric form is valid in XML and in HTML4.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
