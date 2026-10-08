import { httpRequest, runCheck } from '../src/probe.mjs';

// Share only simultaneous, byte-identical reads. Settled requests are removed:
// a retry always goes back to the server, and no response crosses tick boundaries.
export function createSharedProbe({ request = httpRequest } = {}) {
  const active = new Map();
  const stats = { requests: 0, shared: 0 };
  const sharedRequest = (url, options = {}) => {
    const key = JSON.stringify([url, options.method ?? 'GET', Object.entries(options.headers ?? {}).sort(), options.timeoutMs, options.followRedirects ?? true, options.headersOnly ?? false]);
    if (active.has(key)) { stats.shared += 1; return active.get(key); }
    stats.requests += 1;
    const pending = Promise.resolve().then(() => request(url, options)).finally(() => active.delete(key));
    active.set(key, pending);
    return pending;
  };
  return { stats, request: sharedRequest, probe: check => runCheck(check, { request: sharedRequest }) };
}
