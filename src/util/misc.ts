export function sleep(time) {
  return new Promise((resolve) => { setTimeout(resolve, time); });
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
