import { useAuthStore } from './adapters';
import { SiteError, siteRequest } from './site';

const SEMESTER = /^\d{4}-\d{4}-[12]$/;
/** The server takes at most 12000 characters of one tool result. */
const LIMIT = 11000;

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

/**
 * Academic data for 拾间AI in personal mode (`CPUAndroidAgentData`), read with
 * the page's own sign-in and education session and cut down to what an answer
 * needs. Replies are `{ data }` (a JSON string) or `{ error, status }`.
 */
export function installAndroidAgentData() {
  const host = window as any;
  if (host.CPUAndroidAgentData) return;
  host.CPUAndroidAgentData = async (payload: any) => {
    try {
      if (!useAuthStore()?.isLoggedIn) throw new SiteError('请先登录', 401);
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
      throw new SiteError('不支持的数据', 400);
    } catch (error) {
      return { error: error instanceof Error && error.message ? error.message : '读取失败，请稍后重试', status: error instanceof SiteError ? error.status : 0 };
    }
  };
}
