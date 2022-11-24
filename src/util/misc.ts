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
