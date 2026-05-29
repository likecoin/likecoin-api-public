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

export function removeUndefinedObjectKey(obj) {
  return Object.keys(obj).reduce((acc, key) => {
    const a = acc;
    if (obj[key] !== undefined) a[key] = obj[key];
    return a;
  }, {});
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
