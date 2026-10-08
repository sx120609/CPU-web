import { getStore } from '@edgeone/pages-blob';
import { normalizeConfig } from '../src/config.mjs';
import raw from './site-config.mjs';
import { createHandler } from './handler.mjs';

export function handle(context, route) {
  const env = { ...process.env, ...context.env };
  const config = normalizeConfig(raw, { env });
  return createHandler({
    config,
    secret: env.STATUS_TRIGGER_SECRET,
    region: typeof context.server?.region === 'string' && /^[a-z]{2}-[a-z]+$/.test(context.server.region) ? context.server.region : null,
    requiredRegion: env.STATUS_REQUIRED_REGION || null,
    // The deployed runtime supplies project-scoped identity to the official SDK.
    // Never request or accept a general Tencent Cloud management API key here.
    getStore: () => getStore({ name: 'cpu-status', consistency: 'strong' }),
  })(context.request, route);
}
