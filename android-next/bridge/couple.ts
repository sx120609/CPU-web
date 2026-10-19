import { useAuthStore } from './adapters';
import { SiteError, siteRequest } from './site';

/**
 * The couple timetable for the native grid (`/api/couple`): who the user is
 * bound to, the partner's timetable snapshot, and the user's own snapshot going
 * up. Everything belongs to the signed-in site account. Replies are `{ data }`
 * or `{ error, status }`.
 */
export function installAndroidCouple() {
  const host = window as any;
  if (host.CPUAndroidCouple) return;
  host.CPUAndroidCouple = async (payload: any) => {
    try {
      const auth = useAuthStore();
      const owner = auth?.user?.id;
      if (!auth?.isLoggedIn) throw new SiteError('请先登录', 401);
      const action = String(payload?.action || '');
      let data: unknown;
      if (action === 'status') data = await siteRequest('GET', '/couple');
      else if (action === 'schedules') data = await siteRequest('GET', '/couple/schedules');
      else if (action === 'invite') data = await siteRequest('POST', '/couple/invite', undefined, '邀请码生成失败，请稍后重试');
      else if (action === 'cancelInvite') data = await siteRequest('DELETE', '/couple/invite');
      else if (action === 'accept') {
        data = await siteRequest('POST', '/couple/accept', { code: String(payload.code || '').trim().slice(0, 20) }, '绑定失败，请检查邀请码');
      } else if (action === 'unbind') data = await siteRequest('DELETE', '/couple');
      else if (action === 'settings') data = await siteRequest('PATCH', '/couple', payload.body ?? {});
      else if (action === 'sync') data = await siteRequest('PUT', '/couple/schedule', payload.body ?? {});
      else throw new SiteError('不支持的情侣课表操作', 400);
      if (owner !== useAuthStore()?.user?.id) throw new SiteError('账号已变化，请重试', 409);
      return { data };
    } catch (error) {
      return { error: error instanceof Error && error.message ? error.message : '请求失败，请稍后重试', status: error instanceof SiteError ? error.status : 0 };
    }
  };
}
