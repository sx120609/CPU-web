import { useAuthStore, useJwxtStore } from './adapters';
import { courseEditKey, normalizeScheduleEditsState } from '../../web/src/utils/scheduleEdits';
import { buildCustomCourseItem, saveCustomCourseEdit, deleteCourseEdit, restoreOriginalCourseEdit } from '../../web/src/views/schedule/courseEditor';
import { buildCourseFamilyKey } from '../../web/src/views/schedule/viewModels';
import { MAX_SMALL_SLOT } from '../../web/src/views/schedule/slots';

type PriorityMap = Record<string, number>;

// The display priority of overlapping courses (server/src/shared/schedulePriority.ts). It travels
// with the schedule edits but apart from `normalizeScheduleEditsState`, which the other clients share.
const priorityKey = (name: unknown) => String(name ?? '').trim().replace(/\s+/g, ' ');
function normalizePriority(input: unknown): PriorityMap {
  const result: PriorityMap = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
    const key = priorityKey(rawKey); const value = Number(rawValue);
    if (key && key.length <= 80 && Number.isInteger(value) && value >= 1 && value <= 9999) result[key] = value;
  }
  return result;
}

// [1, 2, 5, 6, 9] → [1, 2], [5, 6], [9, 9]
function slotRuns(slots: number[]) {
  const runs: number[][] = [];
  for (const slot of [...new Set(slots)].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && last[1] + 1 === slot) last[1] = slot; else runs.push([slot, slot]);
  }
  return runs;
}

export function installHarmonyEditor() {
  const host = window as any;
  if (host.CPUHarmonyEditor) return;
  const sessions = new Map<string, any>();
  const identity = () => JSON.stringify([useAuthStore()?.user?.id, useAuthStore()?.academicIdentity]);
  async function request(method: string, semester: string, edits?: any) {
    const auth = useAuthStore(); const jwxt = useJwxtStore();
    if (!auth?.isLoggedIn || !jwxt?.isLoggedIn) throw Error('请先完成教务授权');
    if (auth.academicIdentity === 'graduate') throw Error('研究生课表暂不支持个人课程修改');
    const headers: Record<string,string> = { 'X-CPU-Auth-Mode':'cookie', 'X-CPU-Client':'harmony-app', 'Content-Type':'application/json' };
    if (auth.token && auth.token !== '__cpu_cookie_session__') headers.Authorization = `Bearer ${auth.token}`;
    if (jwxt.token && jwxt.token !== '__cpu_jwxt_cookie_session__') headers['X-Jwxt-Token'] = jwxt.token;
    if (method === 'PUT') {
      const cookie = (name:string) => document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1) || '';
      headers['X-CSRF-Token'] = decodeURIComponent(cookie('__Host-cpu-csrf') || cookie('cpu-csrf'));
    }
    const controller = new AbortController(); const timeout = setTimeout(()=>controller.abort(),30000);
    try {
      const response = await fetch('/api/jwxt/schedule-edits'+(method==='GET'?'?semester='+encodeURIComponent(semester):''), {
        method, credentials:'same-origin', headers, signal:controller.signal,
        ...(method==='PUT'?{body:JSON.stringify({semester,edits})}:{})
      });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw Error(result.message || '课程修改暂时无法保存');
      return { edits: normalizeScheduleEditsState(result.data?.edits), priority: normalizePriority(result.data?.edits?.priority) };
    } finally { clearTimeout(timeout); }
  }
  host.CPUHarmonyEditor = async (payload: any) => {
    try {
      if (payload.action === 'priority') {
        // Read-only: which overlapping courses show first. Needs no editing session.
        return { priority: (await request('GET', payload.semester)).priority };
      }
      if (payload.action === 'open') {
        const owner = identity();
        const loaded = await request('GET',payload.semester);
        if (identity() !== owner) throw Error('账号已变化，请重新打开课程');
        const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessions.clear(); sessions.set(session,{owner,baseline:loaded.edits,priority:loaded.priority,semester:payload.semester});
        return { session, priority: loaded.priority,
          hidden:loaded.edits.hidden.map(key=>({key,label:key.split('|')[5] || '已隐藏课程'})) };
      }
      const session = sessions.get(payload.session);
      if (!session || session.owner !== identity()) throw Error('编辑会话已失效，请重新打开课程');
      const loaded = await request('GET',session.semester);
      const current = loaded.edits;
      if (session.owner !== identity()) throw Error('账号已变化，请重新打开课程');
      if (JSON.stringify(current) !== JSON.stringify(session.baseline) ||
        JSON.stringify(loaded.priority) !== JSON.stringify(session.priority)) throw Error('课表已在其他页面修改，请重新打开后再保存');
      const block = payload.original ? {...payload.original,index:0} : null;
      const key = block ? courseEditKey(block.day,block.bigSlot,block.course) : '';
      const family = (day:number,bigSlot:number,course:any) => buildCourseFamilyKey(day,bigSlot,course);
      const sourceKeys = (day:number,bigSlot:number,course:any) => {
        const keys = new Set<string>(); const target=family(day,bigSlot,course);
        for(const cell of payload.cells || []) for(const item of cell.courses || []) {
          if (family(cell.day,cell.bigSlot,item) === target) keys.add(item.sourceKey || courseEditKey(cell.day,cell.bigSlot,item));
        }
        if(course.sourceKey) keys.add(course.sourceKey);
        return keys;
      };
      const helpers = {editingBlock:block,editingCourseKey:key,courseFamilyKey:family,courseFamilySourceKeys:sourceKeys};
      let next = current;
      let priority = loaded.priority;
      if (payload.action === 'save') {
        const form=payload.form;
        if (!form?.name?.trim() || form.name.trim().length>120) throw Error('请填写不超过 120 字的课程名称');
        // One "when it meets" group per arrangement; a bridge caller that sends a single block is one group.
        const groups: any[] = Array.isArray(form.arrangements) && form.arrangements.length ? form.arrangements : [{
          day: form.day, weekList: form.weekList,
          slots: Number.isInteger(form.startSlot) && Number.isInteger(form.endSlot) && form.endSlot >= form.startSlot && form.endSlot - form.startSlot < 64
            ? Array.from({ length: form.endSlot - form.startSlot + 1 }, (_, index) => form.startSlot + index) : [form.startSlot, form.endSlot],
        }];
        if (groups.length > 12) throw Error('上课时间太多，请分成几门课程保存');
        const blocks: Array<{ day: number; startSlot: number; endSlot: number; weekList: number[] }> = [];
        for (const group of groups) {
          const slots = (Array.isArray(group.slots) ? group.slots : []).map(Number);
          if (!Number.isInteger(group.day) || group.day<1 || group.day>7 || !slots.length ||
            slots.some((slot: number) => !Number.isInteger(slot) || slot<1 || slot>MAX_SMALL_SLOT)) throw Error('请检查星期和节次范围');
          const weekList = [...new Set<number>((group.weekList || []).map(Number))].sort((a,b)=>a-b);
          if (!weekList.length || weekList.some(n=>!Number.isInteger(n)||n<1||n>64)) throw Error('请选择有效教学周');
          for (const [startSlot, endSlot] of slotRuns(slots)) blocks.push({ day: group.day, startSlot, endSlot, weekList });
        }
        // The first block keeps the identity of the course being edited, and for an official course
        // stays tied to the original it replaces. Every further block is a plain custom item.
        const existing=block?.course.customId ? current.custom.find(item=>item.id===block.course.customId) : null;
        const {item}=buildCustomCourseItem({...form,...blocks[0]},{weekList:blocks[0].weekList,existing,editingCourseKey:key});
        next=saveCustomCourseEdit(current,item,helpers);
        for (const extra of blocks.slice(1)) {
          next={...next,custom:[...next.custom,buildCustomCourseItem({...form,...extra},{weekList:extra.weekList}).item]};
        }
        if (typeof form.preferred === 'boolean') {
          const name = priorityKey(form.name); priority = {...priority};
          const own = priority[name] ?? 0;
          if (!form.preferred) delete priority[name];
          else if (own <= 0 || Object.entries(priority).some(([other, value]) => other !== name && value >= own)) {
            // In front of every course that already has a priority.
            priority[name] = Math.min(9999, Math.max(0, ...Object.values(priority)) + 1);
          }
        }
      } else if (payload.action === 'delete' && block) next=deleteCourseEdit(current,block,helpers);
      else if (payload.action === 'restore' && block?.course.sourceKey) next=restoreOriginalCourseEdit(current,block,{...helpers,sourceKey:block.course.sourceKey,customId:block.course.customId});
      else if (payload.action === 'restoreHidden' && current.hidden.includes(payload.key)) {
        next={...current,hidden:current.hidden.filter(key=>key!==payload.key)};
      } else throw Error('不支持的课程修改操作');
      // A save that omits `priority` keeps the stored map on the server, so it is only sent when
      // there is one to keep or one was just cleared.
      const changed = JSON.stringify(priority) !== JSON.stringify(loaded.priority);
      await request('PUT',session.semester,Object.keys(priority).length || changed ? {...next,priority} : next);
      if (session.owner !== identity()) throw Error('账号已变化，请重新载入当前账号课表');
      sessions.delete(payload.session);
      return {saved:true,priority};
    } catch(error) { return {error:error instanceof Error ? error.message : '课程操作失败'}; }
  };
}
