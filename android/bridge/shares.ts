import { useAuthStore } from './adapters';
import { SiteError, siteRequest } from './site';

const CODE = /^[A-Z2-9]{8}$/;

/**
 * Share codes for the native timetable (`/api/schedule-shares`). Publishing
 * and revoking go through the signed-in site account; reading a code needs no
 * account. Replies are `{ data }` or `{ error, status }`.
 */
export function installAndroidShares() {
  const host = window as any;
  if (host.CPUAndroidShares) return;
  host.CPUAndroidShares = async (payload: any) => {
    try {
      const auth = useAuthStore();
      const owner = auth?.user?.id;
      const code = String(payload.code || '').trim().toUpperCase();
      const signedIn = () => { if (!auth?.isLoggedIn) throw new SiteError('请先登录', 401); };
      let data: unknown;
      if (payload.action === 'mine') { signedIn(); data = await siteRequest('GET', '/schedule-shares/mine'); }
      else if (payload.action === 'publish') {
        signedIn();
        const nickname = String(auth.user?.nickname || '').trim().slice(0, 40);
        data = await siteRequest('POST', '/schedule-shares', { ...payload.body, ...(nickname ? { ownerName: nickname } : {}) }, '课表分享失败');
      } else if (!CODE.test(code)) throw new SiteError('分享码无效', 400);
      else if (payload.action === 'revoke') { signedIn(); data = await siteRequest('DELETE', '/schedule-shares/'+code); }
      else if (payload.action === 'meta') data = await siteRequest('GET', '/schedule-shares/'+code+'/meta');
      else if (payload.action === 'get') data = await siteRequest('GET', '/schedule-shares/'+code);
      else throw new SiteError('不支持的共享课表操作', 400);
      if (owner !== useAuthStore()?.user?.id) throw new SiteError('账号已变化，请重试', 409);
      return { data };
    } catch (error) {
      return { error: error instanceof Error && error.message ? error.message : '请求失败，请稍后重试', status: error instanceof SiteError ? error.status : 0 };
    }
  };
}
