import { useAuthStore } from './adapters';
import { SiteError, siteRequest } from './site';

const SEMESTER = /^\d{4}-\d{4}-[12]$/;
/** The server takes at most 12000 characters of one tool result. */
const LIMIT = 11000;
/** A site read is cut to this many characters. */
const SITE_LIMIT = 8000;
/** Paths the server lets 拾间AI read (it checks them again). */
const SITE_PATH = /^\/(?:topics|boards|search|home|user|lost-found|courses|likes|messages|direct-messages)(?:[/?][^\s#\\]{0,290})?$/;
/** Fields an answer never needs: pictures, styling, review bookkeeping. */
const DROPPED = /^(?:avatar|avatarUrl|cover|coverUrl|images?|imageUrls?|thumbnail|icon|color|profileTheme|profileFrame|verification|vipActive|reputationLevel|imageReview|videoReview|feedSource|metadataRaw|rawPayload)$/i;
/** Fields that carry the text itself get more room than the rest. */
const LONG_TEXT = /^(?:content|description|body|text|summary|answer)$/i;

/** The rows as compact JSON, dropping the oldest rows until it fits. */
function pack(header: Record<string, unknown>, rows: unknown[]) {
  let kept = rows;
  let text = JSON.stringify({ ...header, rows: kept });
  while (text.length > LIMIT && kept.length > 1) {
    kept = kept.slice(Math.ceil(kept.length / 10));
    text = JSON.stringify({ ...header, truncated: true, rows: kept });
  }
  return text;
}

function plainText(value: string) {
  if (!/[<&]/.test(value)) return value;
  const doc = new DOMParser().parseFromString(value, 'text/html');
  return (doc.body.textContent || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Any site reply cut down for a model: no pictures or styling, short strings, short lists. */
function compact(value: unknown, items: number, textLength: number, key = '', depth = 0): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const text = plainText(value).trim();
    const limit = LONG_TEXT.test(key) ? textLength : Math.min(textLength, 200);
    if (!text) return undefined;
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }
  if (typeof value !== 'object') return value;
  if (depth > 6) return undefined;
  if (Array.isArray(value)) {
    const list = value.slice(0, items).map((item) => compact(item, items, textLength, key, depth + 1)).filter((item) => item !== undefined);
    return list.length ? list : undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED.test(name)) continue;
    const next = compact(child, items, textLength, name, depth + 1);
    if (next !== undefined) out[name] = next;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A site read as JSON under the limit, tightening the cuts until it fits. */
function packSite(path: string, data: unknown) {
  for (const [items, textLength] of [[20, 1500], [12, 600], [8, 300], [5, 150], [3, 80]]) {
    const text = JSON.stringify({ path, data: compact(data, items, textLength) ?? null });
    if (text.length <= SITE_LIMIT) return text;
  }
  return JSON.stringify({ path, truncated: true, data: String(JSON.stringify(compact(data, 3, 80))).slice(0, SITE_LIMIT - 200) });
}

function requireSignIn() {
  if (!useAuthStore()?.isLoggedIn) throw new SiteError('请先登录', 401);
}

function errorReply(error: unknown) {
  return { error: error instanceof Error && error.message ? error.message : '读取失败，请稍后重试', status: error instanceof SiteError ? error.status : 0 };
}

/**
 * Data for 拾间AI in personal mode (`CPUAndroidAgentData`), read with the
 * page's own sign-in and cut down to what an answer needs: grades and exams
 * from the education session, or any site path the server allows. Replies are
 * `{ data }` (a JSON string) or `{ error, status }`.
 */
export function installAndroidAgentData() {
  const host = window as any;
  if (host.CPUAndroidAgentData) return;
  host.CPUAndroidAgentData = async (payload: any) => {
    try {
      requireSignIn();
      if (payload?.source === 'site') {
        const path = String(payload?.path || '');
        if (!SITE_PATH.test(path)) throw new SiteError('不支持读取这个页面', 400);
        const data = await siteRequest('GET', path, undefined, '读取失败，请稍后重试');
        return { data: packSite(path, data) };
      }
      const semester = SEMESTER.test(String(payload?.semester || '')) ? String(payload.semester) : '';
      const query = semester ? '?semester=' + encodeURIComponent(semester) : '';
      if (payload?.source === 'grades') {
        const result: any = await siteRequest('GET', '/jwxt/grades' + query, undefined, '成绩暂时读不到，请先在教务页完成授权');
        const list: any[] = Array.isArray(result?.parsed?.list) ? result.parsed.list : [];
        const rows = list.map((row) => ({
          s: String(row?.semester || ''), c: String(row?.courseName || ''), sc: String(row?.score || ''),
          cr: typeof row?.credits === 'number' ? row.credits : null, g: typeof row?.gpa === 'number' ? row.gpa : null,
          t: String(row?.courseAttr || ''),
        })).filter((row) => row.c);
        return { data: pack({ source: 'grades', semester: semester || '全部', fields: 's=学期 c=课程 sc=总成绩 cr=学分 g=绩点(5分制) t=课程性质' }, rows) };
      }
      if (payload?.source === 'exams') {
        const result: any = await siteRequest('GET', '/jwxt/exams' + query, undefined, '考试安排暂时读不到，请先在教务页完成授权');
        const list: any[] = Array.isArray(result?.parsed?.list) ? result.parsed.list : [];
        const rows = list.map((row) => ({
          c: String(row?.courseName || ''), t: String(row?.examTime || ''), p: String(row?.location || ''),
          seat: String(row?.seat || ''), k: String(row?.examType || row?.examName || ''),
        })).filter((row) => row.c);
        return { data: pack({ source: 'exams', semester: semester || '当前', fields: 'c=课程 t=考试时间 p=地点 seat=座位 k=类型' }, rows) };
      }
      if (payload?.source === 'context') {
        // Who the user is and where they can post, for every question.
        const [me, boards]: any[] = await Promise.all([
          siteRequest('GET', '/user/me', undefined, '').catch(() => null),
          siteRequest('GET', '/boards', undefined, '').catch(() => []),
        ]);
        const user = me?.user || me;
        return {
          data: JSON.stringify({
            me: typeof user?.id === 'number' ? { id: user.id, nickname: String(user.nickname || user.username || '').slice(0, 40) } : null,
            boards: (Array.isArray(boards) ? boards : [])
              .filter((board: any) => board && !board.readOnly && board.type !== 'announce' && /^[a-z0-9-]{1,40}$/.test(String(board.slug)))
              .slice(0, 40)
              .map((board: any) => ({ slug: board.slug, name: String(board.name || board.slug).slice(0, 40), type: String(board.type || 'normal'), anonymous: Boolean(board.anonymousEnabled) })),
          }),
        };
      }
      throw new SiteError('不支持的数据', 400);
    } catch (error) {
      return errorReply(error);
    }
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A forum submission waits for its review for up to about twelve seconds. */
async function settle(first: any, poll: () => Promise<any>) {
  let current = first;
  for (let attempt = 0; attempt < 8 && current?.submissionResult?.status === 'pending'; attempt += 1) {
    await wait(1500);
    current = await poll().catch(() => current);
  }
  const status = String(current?.submissionResult?.status || 'published');
  if (status === 'blocked_ai' || status === 'failed') {
    throw new SiteError(current?.submissionResult?.reason || '内容没有通过审核', 422);
  }
  return { item: current, status };
}

function submissionId() {
  return 'next-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Site actions 拾间AI proposed and the user confirmed (`CPUAndroidAgentAct`),
 * sent as the page itself would send them. Replies are `{ ok, ... }` or
 * `{ error, status }`; posts and replies wait for their review result.
 */
export function installAndroidAgentActions() {
  const host = window as any;
  if (host.CPUAndroidAgentAct) return;
  host.CPUAndroidAgentAct = async (payload: any) => {
    try {
      requireSignIn();
      const id = Number(payload?.id);
      switch (payload?.type) {
        case 'forum.post': {
          const sid = submissionId();
          const created = await siteRequest('POST', '/topics', {
            boardSlug: String(payload.board), title: String(payload.title), content: String(payload.content), anonymous: Boolean(payload.anonymous), submissionId: sid,
          }, '发帖失败，请稍后重试');
          const { item, status } = await settle(created, () => siteRequest('GET', `/topics/submissions/${encodeURIComponent(sid)}`));
          return { ok: true, id: item?.id, status, link: item?.id ? `/forum/topic/${item.id}` : '' };
        }
        case 'forum.reply': {
          const sid = submissionId();
          const created = await siteRequest('POST', '/replies', {
            topicId: Number(payload.topicId), content: String(payload.content), anonymous: Boolean(payload.anonymous), submissionId: sid,
            ...(payload.parentReplyId ? { parentReplyId: Number(payload.parentReplyId) } : {}),
          }, '回复失败，请稍后重试');
          const { item, status } = await settle(created, () => siteRequest('GET', `/replies/submissions/${encodeURIComponent(sid)}`));
          return { ok: true, id: item?.id, status, link: `/forum/topic/${Number(payload.topicId)}` };
        }
        case 'forum.like': {
          const target = payload.target === 'reply' ? 'reply' : 'topic';
          const result: any = await siteRequest('POST', `/likes/${target}/${id}`, undefined, '点赞失败，请稍后重试');
          return { ok: true, liked: Boolean(result?.liked), likeCount: Number(result?.likeCount || 0) };
        }
        case 'dm.send': {
          await siteRequest('POST', `/direct-messages/with/${Number(payload.userId)}/messages`, { content: String(payload.content) }, '私信发送失败，请稍后重试');
          return { ok: true, link: '/messages?tab=private' };
        }
        case 'messages.readAll': {
          await siteRequest('POST', '/messages/read-all', undefined, '操作失败，请稍后重试');
          return { ok: true };
        }
        case 'lostfound.post': {
          const result: any = await siteRequest('POST', '/lost-found/items', {
            kind: payload.kind, itemName: payload.itemName, description: payload.description || '', campus: payload.campus,
            location: payload.location, happenedAt: payload.happenedAt, storageLocation: payload.storageLocation || '', contact: payload.contact,
          }, '发布失败，请稍后重试');
          return { ok: true, id: result?.id, status: result?.review?.status || 'published', link: '/lost-found' };
        }
        case 'topic.delete':
          await siteRequest('DELETE', `/topics/${id}`, undefined, '删除失败，请稍后重试');
          return { ok: true };
        case 'reply.delete':
          await siteRequest('DELETE', `/replies/${id}`, undefined, '删除失败，请稍后重试');
          return { ok: true };
        default:
          throw new SiteError('不支持的操作', 400);
      }
    } catch (error) {
      return errorReply(error);
    }
  };
}
