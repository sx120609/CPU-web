import { authorized } from './auth.mjs';
import { performance } from 'node:perf_hooks';
import { loadCheckpoint, runTick } from './engine.mjs';
import { CONTENT_SECURITY_POLICY, renderPage } from '../src/page.mjs';
import { buildView } from '../src/view.mjs';

const BASE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...BASE, 'Content-Type': 'application/json; charset=utf-8', ...extra } });

export function createHandler({ config, getStore, secret, now = Date.now, tick = runTick, region = null, requiredRegion = null }) {
  async function execute(request, route) {
    if (route === 'tick') {
      if (request.method !== 'POST') return json({ code: 'method_not_allowed' }, 405, { Allow: 'POST' });
      // Authenticate before instantiating Blob or causing any network work.
      if (!authorized(request, secret)) return json({ code: 'unauthorized' }, 401);
      if (requiredRegion && region !== requiredRegion) return json({ code: 'wrong_execution_region', region }, 503);
      try {
        const began = performance.now();
        const result = await tick({ store: getStore(), config, now, region });
        return json({ ...result, executionMs: Math.round(performance.now() - began), runtime: process.version, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }, result.status, result.status === 409 ? { 'Retry-After': '60' } : {});
      } catch {
        return json({ code: 'monitor_update_failed' }, 503);
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json({ code: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
    try {
      const checkpoint = await loadCheckpoint(getStore());
      const view = buildView(checkpoint.state, config, now());
      if (route === 'health') {
        const times = config.checks.map(c => checkpoint.state.checks[c.id]?.lastSampleAt ?? 0);
        const lastSampleAt = Math.min(...times);
        const ok = lastSampleAt > 0 && now() - lastSampleAt <= 180000;
        return json({ ok, lastSampleAt: lastSampleAt || null, region }, ok ? 200 : 503);
      }
      if (route === 'status') {
        const origin = request.headers.get('origin');
        return json({ ...view, generatedAt: now(), monitor: checkpoint.lastExecution ?? null }, 200, { Vary: 'Origin', ...(config.corsOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) });
      }
      if (route === 'page') return new Response(request.method === 'HEAD' ? null : renderPage(view), { headers: { ...BASE, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CONTENT_SECURITY_POLICY, 'X-Frame-Options': 'DENY' } });
      return json({ code: 'not_found' }, 404);
    } catch {
      // Never present a storage outage as a healthy empty monitor.
      return json({ code: 'status_data_unavailable' }, 503);
    }
  }
  return async function handle(request, route) {
    const response = await execute(request, route);
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  };
}
