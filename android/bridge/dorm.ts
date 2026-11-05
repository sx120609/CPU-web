import { useAuthStore } from './adapters';
import { SiteError, siteRequest } from './site';

/**
 * The dorm timetable for the native screen (`/api/dorm`, docs/dorm-schedule.md):
 * the dorm and its members, everyone's timetable snapshot, and the user's own
 * snapshot going up. Everything belongs to the signed-in site account. Replies
 * are `{ data }` or `{ error, status }`.
 */
export function installAndroidDorm() {
  const host = window as any;
  if (host.CPUAndroidDorm) return;
  host.CPUAndroidDorm = async (payload: any) => {
    try {
      const auth = useAuthStore();
      const owner = auth?.user?.id;
      if (!auth?.isLoggedIn) throw new SiteError('请先登录', 401);
      const action = String(payload?.action || '');
      const body = payload?.body ?? {};
      let data: unknown;
      if (action === 'status') data = await siteRequest('GET', '/dorm');
      else if (action === 'schedules') data = await siteRequest('GET', '/dorm/schedules');
      else if (action === 'invite') data = await siteRequest('POST', '/dorm/invite', undefined, '宿舍码生成失败，请稍后重试');
      else if (action === 'cancelInvite') data = await siteRequest('DELETE', '/dorm/invite');
      else if (action === 'join') {
        data = await siteRequest('POST', '/dorm/join', { code: String(payload.code || '').trim().slice(0, 20) }, '加入失败，请检查宿舍码');
      } else if (action === 'settings') data = await siteRequest('PATCH', '/dorm', body);
      else if (action === 'leave') data = await siteRequest('DELETE', '/dorm');
      else if (action === 'remove') {
        const id = Number(payload?.userId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new SiteError('成员不存在', 400);
        data = await siteRequest('DELETE', `/dorm/members/${id}`);
      } else if (action === 'sync') data = await siteRequest('PUT', '/dorm/schedule', body);
      else throw new SiteError('不支持的宿舍课表操作', 400);
      if (owner !== useAuthStore()?.user?.id) throw new SiteError('账号已变化，请重试', 409);
      return { data };
    } catch (error) {
      return { error: error instanceof Error && error.message ? error.message : '请求失败，请稍后重试', status: error instanceof SiteError ? error.status : 0 };
    }
  };
}
