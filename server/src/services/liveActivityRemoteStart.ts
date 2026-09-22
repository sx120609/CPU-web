import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from './jwxtSessionCrypto';
import { getApnsConfig } from './apnsConfig';
import { appleReferenceSeconds, sendLiveActivityPayload } from './apnsClient';
import { currentTiming, endChannelKey, timingVersion } from './liveActivitySchedule';
import { parseCoursePlan, type Occurrence } from './liveActivityTimeline';
export { parseCoursePlan } from './liveActivityTimeline';
const PURPOSE = 'live-activity-start-token';
const EVENT = 'course-start-v2';
const protectedStates = ['submitting', 'submitted', 'submissionUnknown', 'terminal', 'local'];
type Snapshot = { input: any; courses: Occurrence[]; acceptedAt: number };
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 7419))::text`;
}
function installation(userId: number, input: any) {
  if (typeof input?.installationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.installationId)
    || typeof input.accountScope !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.accountScope)) throw new Error('设备或账号隔离标识无效');
  return { userId, installationId: input.installationId };
}
function capability(d: { id: string; userId: number; installationId: string | null }) {
  return encryptJwxtSensitiveJson('live-activity-revoke', 'v2', { id: d.id, userId: d.userId, installationId: d.installationId });
}
async function cancelUnsubmitted(tx: Prisma.TransactionClient, deviceId: string, detail: string) {
  await tx.liveActivityPlan.updateMany({ where: { deviceId, state: { in: ['pending', 'claimed'] } }, data: { state: 'cancelled', detail, claimedUntil: null } });
}
async function materialize(tx: Prisma.TransactionClient, device: any, snapshot: Snapshot) {
  const now = Date.now() / 1000;
  const history = await tx.liveActivityPlan.findMany({ where: { deviceId: device.id } });
  const protectedIds = new Set(history.filter(r => protectedStates.includes(r.state)).map(r => r.itemID));
  const edges: Occurrence[] = [...history.flatMap(r => { try { return [JSON.parse(r.payload)]; } catch { return []; } }), ...snapshot.courses];
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of edges) if ([c.occurrenceId, ...(c.supersedes || [])].some(id => protectedIds.has(id))) {
      for (const id of [c.occurrenceId, ...(c.supersedes || [])]) if (!protectedIds.has(id)) { protectedIds.add(id); changed = true; }
    }
  }
  for (const c of snapshot.courses) {
    if (c.end <= now || c.plannedStart > now + 48 * 3600) continue;
    const prior = history.find(r => r.itemID === c.occurrenceId);
    if (prior && (protectedStates.includes(prior.state) || prior.revision === device.planRevision)) continue;
    const blocked = protectedIds.has(c.occurrenceId) || c.end - c.plannedStart >= 8 * 3600 || c.plannedStart >= c.end;
    const data = { event: EVENT, fireAt: new Date(c.plannedStart * 1000), expiresAt: new Date(c.expiresAt * 1000),
      payload: JSON.stringify(c), revision: device.planRevision, state: blocked ? 'terminal' : 'pending',
      detail: blocked ? '实例已提交、已终止或超过活动时长' : '', nextAttemptAt: new Date(), claimedUntil: null };
    await tx.liveActivityPlan.upsert({ where: { deviceId_itemID: { deviceId: device.id, itemID: c.occurrenceId } },
      create: { deviceId: device.id, itemID: c.occurrenceId, ...data }, update: data });
  }
}
export async function syncRemoteStarts(userId: number, input: any) {
  const identity = installation(userId, input);
  if (!/^(?:[a-fA-F0-9]{2}){16,256}$/.test(input.token || '')) throw new Error('启动 token 无效');
  const config = await getApnsConfig();
  if (!['sandbox', 'production'].includes(input.environment) || !config.configured || input.bundleID !== config.bundleID) throw new Error('APNs 配置不匹配');
  const timing = await currentTiming();
  if (input.scheduleId !== timing.scheduleId || input.scheduleVersion !== timing.id) throw new Error('作息版本已改变，请重新同步');
  const courses = parseCoursePlan(input, timing.periods);
  const tokenHash = hash(input.token.toLowerCase());
  const digest = hash(JSON.stringify([input.scheduleId, input.scheduleVersion, input.coverageStart, input.coverageEndExclusive, input.leadMinutes,
    input.items, input.busyIntervals, input.environment, input.bundleID, input.accountScope, tokenHash]));
  return prisma.$transaction(async tx => {
    await lock(tx, `${userId}:${identity.installationId}`);
    let device = await tx.liveActivityDevice.findUnique({ where: { userId_installationId: identity } });
    if (device?.launchMode === 'local') throw new Error('设备已切换本地预约，旧远程请求不能恢复计划');
    if (device && (input.planRevision < device.planRevision || input.planRevision === device.planRevision && digest !== device.planDigest)) throw new Error(`计划版本冲突:${device.planRevision}`);
    if (device && device.planRevision === input.planRevision) return { deviceID: device.id, revoke: capability(device), planRevision: device.planRevision };
    const snapshot: Snapshot = { input: { ...input, token: undefined, replaces: undefined }, courses, acceptedAt: Date.now() / 1000 };
    await tx.liveActivityDevice.updateMany({ where: { startTokenHash: tokenHash, NOT: identity }, data: { startTokenHash: null, startTokenCiphertext: null, enabled: false } });
    const data = { ...identity, accountScope: input.accountScope, enabled: true, startTokenHash: tokenHash,
      startTokenCiphertext: encryptJwxtSensitiveJson(PURPOSE, tokenHash, { token: input.token.toLowerCase() }),
      environment: input.environment, bundleID: input.bundleID, planDigest: digest, planRevision: input.planRevision,
      planSnapshot: JSON.stringify(snapshot), lastError: null };
    device = await tx.liveActivityDevice.upsert({ where: { userId_installationId: identity }, create: data, update: data });
    await cancelUnsubmitted(tx, device.id, '已被完整计划替换');
    await materialize(tx, device, snapshot);
    return { deviceID: device.id, revoke: capability(device), planRevision: device.planRevision, scheduledThrough: courses.at(-1)?.dateKey ?? null };
  }, { timeout: 30000 });
}
export async function revokeRemoteStarts(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('撤销凭据无效');
  const { value: d } = decryptJwxtSensitiveJson<{ id: string; userId: number; installationId: string }>('live-activity-revoke', 'v2', value);
  await prisma.$transaction(async tx => {
    await lock(tx, `${d.userId}:${d.installationId}`);
    await tx.liveActivityDevice.updateMany({ where: { id: d.id, userId: d.userId }, data: { enabled: false, planSnapshot: null } });
    await cancelUnsubmitted(tx, d.id, '功能关闭或退出账号');
  });
}
export async function remoteDeviceState(userId: number, input: any) {
  const identity = installation(userId, input);
  const device = await prisma.liveActivityDevice.findUnique({ where: { userId_installationId: identity } });
  return { planRevision: device?.planRevision ?? 0, launchMode: device?.launchMode ?? "unregistered" };
}
export async function switchToLocal(userId: number, input: any) {
  const identity = installation(userId, input);
  if (typeof input.handoffId !== 'string' || !input.handoffId || input.handoffId.length > 128) throw new Error('交接 ID 无效');
  const config = await getApnsConfig();
  if (input.bundleID !== config.bundleID || !['sandbox', 'production'].includes(input.environment)) throw new Error('设备配置无效');
  return prisma.$transaction(async tx => {
    await lock(tx, `${userId}:${identity.installationId}`);
    let device = await tx.liveActivityDevice.findUnique({ where: { userId_installationId: identity } });
    if (device?.handoffResult) {
      // Retrying handoff never clears its history. Re-enabling local operation
      // only reactivates the device binding, never any remote plan.
      await tx.liveActivityDevice.update({ where: { id: device.id }, data: { enabled: true } });
      return JSON.parse(device.handoffResult);
    }
    device = await tx.liveActivityDevice.upsert({ where: { userId_installationId: identity },
      create: { ...identity, accountScope: input.accountScope, bundleID: input.bundleID, environment: input.environment, launchMode: 'local', modeRevision: 1 },
      update: { launchMode: 'local', modeRevision: { increment: 1 }, planSnapshot: null } });
    await cancelUnsubmitted(tx, device.id, '已切换本地预约');
    const records = await tx.liveActivityPlan.findMany({ where: { deviceId: device.id, state: { in: protectedStates } } });
    const result = { deviceID: device.id, handoffId: input.handoffId, modeRevision: device.modeRevision, revoke: capability(device),
      records: records.map(r => ({ ...JSON.parse(r.payload), state: r.state })) };
    await tx.liveActivityDevice.update({ where: { id: device.id }, data: { handoffId: input.handoffId, handoffResult: JSON.stringify(result) } });
    return result;
  });
}
export async function takeOverOccurrence(userId: number, input: any) {
  const identity = installation(userId, input);
  const timing = await currentTiming();
  const config = await getApnsConfig();
  return prisma.$transaction(async tx => {
    await lock(tx, `${userId}:${identity.installationId}`);
    const device = await tx.liveActivityDevice.findUnique({ where: { userId_installationId: identity } });
    if (!device || !device.enabled || device.planRevision !== input.planRevision) throw new Error('设备或计划版本已改变');
    const row = await tx.liveActivityPlan.findUnique({ where: { deviceId_itemID: { deviceId: device.id, itemID: input.occurrenceId } } });
    if (!row || row.state === 'terminal') throw new Error('本次课程不可恢复');
    const c = JSON.parse(row.payload) as Occurrence;
    const snapshot = device.planSnapshot ? JSON.parse(device.planSnapshot) as Snapshot : null;
    const version = snapshot?.input.scheduleVersion || input.scheduleVersion;
    if (version !== timing.id || c.end <= Date.now() / 1000 || c.plannedStart > Date.now() / 1000) throw new Error('本次课程尚不能恢复，请同步作息');
    if (!protectedStates.includes(row.state)) await tx.liveActivityPlan.update({ where: { id: row.id }, data: { state: 'local', detail: '前台恢复已接管' } });
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(742091, 1)::text`;
    await tx.liveActivityScheduleVersion.updateMany({ where: { id: version, broadcastUntil: { lt: new Date(c.end * 1000) } }, data: { broadcastUntil: new Date(c.end * 1000) } });
    return { occurrenceId: c.occurrenceId, state: protectedStates.includes(row.state) ? row.state : 'local', channelID: config.channels[endChannelKey(device.environment, version, c.endPeriod)] || null, scheduleVersion: version };
  });
}
export function remoteStartPayload(c: Occurrence, channel: string, now: number, accountScope: string, scheduleVersion: string) {
  return { aps: { timestamp: Math.floor(now), event: 'start', 'input-push-channel': channel,
    'attributes-type': 'ScheduleLiveActivityAttributes',
    attributes: { semester: '', week: 0, dateKey: c.dateKey, occurrenceId: c.occurrenceId, accountScope,
      scheduleId: 'main-campus', scheduleVersion, broadcastWindow: String(c.endPeriod), broadcastChannel: channel,
      reservationStart: appleReferenceSeconds(c.start), reservationEnd: appleReferenceSeconds(c.end), reminderDate: appleReferenceSeconds(c.plannedStart) },
    'content-state': { protocolVersion: 2, scheduleId: 'main-campus', scheduleVersion, eventType: 'start', eventTime: appleReferenceSeconds(now),
      phase: now >= c.start ? 'inProgress' : 'upcoming', courseName: '', teacher: '', location: '',
      startDate: appleReferenceSeconds(c.start), endDate: appleReferenceSeconds(c.end), updatedAt: appleReferenceSeconds(now), broadcastDateKey: c.dateKey },
    'stale-date': Math.floor(c.end), alert: { title: '课程提醒', body: '课表实时活动已开始' } } };
}
export const START_BATCH_SIZE = Math.max(1, Math.min(10000, Number(process.env.LIVE_ACTIVITY_START_BATCH) || 2000));
const START_CONCURRENCY = Math.max(1, Math.min(128, Number(process.env.LIVE_ACTIVITY_START_CONCURRENCY) || 64));
let lastMaterialized = 0;
let materializing: Promise<void> | undefined;
async function refillWindow(timingId: string) {
  let cursor: string | undefined;
  while (true) {
    const devices = await prisma.liveActivityDevice.findMany({ where: { enabled: true, launchMode: 'remote', planSnapshot: { not: null } },
      orderBy: { id: 'asc' }, take: 250, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!devices.length) break;
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(12, devices.length) }, async () => {
      while (index < devices.length) {
        const d = devices[index++];
        await prisma.$transaction(async tx => {
          await lock(tx, `${d.userId}:${d.installationId}`);
          const current = await tx.liveActivityDevice.findUnique({ where: { id: d.id } });
          if (!current?.enabled || current.launchMode !== 'remote' || !current.planSnapshot) return;
          const snapshot = JSON.parse(current.planSnapshot) as Snapshot;
          if (snapshot.input.scheduleVersion !== timingId) { await cancelUnsubmitted(tx, d.id, '作息已改变，需要重同步'); return; }
          await materialize(tx, current, snapshot);
        }, { timeout: 30000 });
      }
    }));
    cursor = devices.at(-1)!.id;
    if (devices.length < 250) break;
  }
}
export async function tickRemoteStarts(send = sendLiveActivityPayload) {
  const config = await getApnsConfig();
  if (!config.configured) return;
  const timing = await currentTiming();
  if (!materializing && Date.now() - lastMaterialized >= 60000) {
    materializing = refillWindow(timing.id).catch(error => { console.warn('[apns] window refill failed', error?.message); })
      .finally(() => { lastMaterialized = Date.now(); materializing = undefined; });
  }
  await prisma.liveActivityPlan.updateMany({ where: { state: 'submitting', updatedAt: { lt: new Date(Date.now() - 60000) } }, data: { state: 'submissionUnknown', detail: '提交后未收到确定结果' } });
  const rows = await prisma.liveActivityPlan.findMany({ where: { event: EVENT, state: 'pending', fireAt: { lte: new Date() }, nextAttemptAt: { lte: new Date() }, device: { enabled: true, launchMode: 'remote' } },
    orderBy: { fireAt: 'asc' }, take: START_BATCH_SIZE, include: { device: true } });
  let index = 0;
  const delays: number[] = [];
  const outcomes: Record<string, number> = {};
  const results = await Promise.allSettled(Array.from({ length: Math.min(START_CONCURRENCY, rows.length) }, async () => {
    while (index < rows.length) {
      const candidate = rows[index++];
      const ready = await prisma.$transaction(async tx => {
        await lock(tx, `${candidate.device.userId}:${candidate.device.installationId}`);
        const row = await tx.liveActivityPlan.findUnique({ where: { id: candidate.id }, include: { device: true } });
        if (!row || row.state !== 'pending' || !row.device.enabled || row.device.launchMode !== 'remote' || row.revision !== row.device.planRevision || row.nextAttemptAt > new Date()) return null;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(742091, 1)::text`;
        const published = await tx.schedulePeriodConfig.findUnique({ where: { id: 1 } });
        if (!published || timingVersion(JSON.parse(published.periods)) !== timing.id) return null;
        const snapshot = JSON.parse(row.device.planSnapshot || '{}') as Snapshot;
        const c = JSON.parse(row.payload) as Occurrence;
        if (snapshot.input?.scheduleVersion !== timing.id || row.expiresAt <= new Date() || c.end * 1000 <= Date.now()) {
          outcomes.expired = (outcomes.expired || 0) + 1;
          await tx.liveActivityPlan.update({ where: { id: row.id }, data: { state: 'cancelled', detail: '计划过期或作息已改变' } }); return null;
        }
        const channel = config.channels[endChannelKey(row.device.environment, timing.id, c.endPeriod)];
        if (!channel) {
          await tx.liveActivityPlan.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() + 30000), detail: "等待结束频道" } });
          return null;
        }
        const { value } = decryptJwxtSensitiveJson<{ token: string }>(PURPOSE, row.device.startTokenHash!, row.device.startTokenCiphertext!);
        await tx.liveActivityScheduleVersion.updateMany({ where: { id: timing.id, broadcastUntil: { lt: new Date(c.end * 1000) } }, data: { broadcastUntil: new Date(c.end * 1000) } });
        // Persist intent before external I/O; a transaction rollback after APNs
        // acceptance must never make the same occurrence eligible again.
        await tx.liveActivityPlan.update({ where: { id: row.id }, data: { state: 'submitting' } });
        return { row, c, channel, token: value.token };
      });
      if (!ready) continue;
      const { row, c, channel, token } = ready;
      let state = 'submitted', detail = '';
      delays.push(Date.now() - row.fireAt.getTime());
      try {
        await send({ token, environment: row.device.environment as 'production' | 'sandbox', bundleID: row.device.bundleID,
          payload: remoteStartPayload(c, channel, Date.now() / 1000, row.device.accountScope!, timing.id), config });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        detail = String(error?.message || error).slice(0, 500);
        state = !status ? 'submissionUnknown' : status === 429 || status >= 500 || status === 408 ? 'pending' : 'terminal';
        if (['BadDeviceToken', 'Unregistered'].includes(error?.apnsReason)) await prisma.liveActivityDevice.updateMany({ where: { id: row.deviceId, startTokenHash: row.device.startTokenHash }, data: { enabled: false, lastError: error.apnsReason } });
      }
      outcomes[state] = (outcomes[state] || 0) + 1;
      await prisma.liveActivityPlan.updateMany({ where: { id: row.id, state: { in: ['submitting', 'submissionUnknown'] } }, data: { state, detail, attempts: { increment: 1 },
        ...(state === 'submitted' ? { sentAt: new Date() } : {}), nextAttemptAt: new Date(Date.now() + Math.min(60000, 5000 * 2 ** Math.min(row.attempts, 4))) } });
    }
  }));
  for (const r of results) if (r.status === 'rejected') throw r.reason;
  if (rows.length) {
    delays.sort((a, b) => a - b);
    console.info('[apns] remote-start-batch', JSON.stringify({ due: rows.length, outcomes,
      submitDelayP50Ms: delays[Math.floor(delays.length * 0.5)] ?? null,
      submitDelayP95Ms: delays[Math.floor(delays.length * 0.95)] ?? null,
      submitDelayP99Ms: delays[Math.floor(delays.length * 0.99)] ?? null }));
  }
  return rows.length;
}
