const stores = new Map<string, Map<string, { count: number; resetAt: number }>>();

function getStore(namespace: string) {
  let s = stores.get(namespace);
  if (!s) {
    s = new Map();
    stores.set(namespace, s);
  }
  return s;
}

export function checkRateLimit(
  namespace: string,
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const store = getStore(namespace);
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetInMs: windowMs };
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, resetInMs: entry.resetAt - now };
  }

  return { allowed: true, remaining: maxRequests - entry.count, resetInMs: entry.resetAt - now };
}

export function resetRateLimit(namespace: string, key: string) {
  getStore(namespace).delete(key);
}
