import { useAuthStore, useJwxtStore } from './adapters';
import { siteRequest } from './site';
import { courseEditKey, courseWeeksOverlap, normalizeScheduleEditsState } from '../../web/src/utils/scheduleEdits';
import { buildCustomCourseItem, saveCustomCourseEdit, deleteCourseEdit, restoreOriginalCourseEdit } from '../../web/src/views/schedule/courseEditor';
import { buildCourseFamilyKey } from '../../web/src/views/schedule/viewModels';
import { MAX_SMALL_SLOT } from '../../web/src/views/schedule/slots';
import { MAX_SCHEDULE_PRIORITY, normalizeSchedulePriority, schedulePriorityKey } from '../../server/src/shared/schedulePriority';

type Arrangement = { day: number; slots: number[]; weekList: number[] };

/** The runs of consecutive periods, in order: [1, 2, 5, 6, 9] → [1, 2], [5, 6], [9, 9]. */
function slotRuns(slots: number[]) {
  const runs: Array<[number, number]> = [];
  for (const slot of [...new Set(slots)].sort((a,b)=>a-b)) {
    const last = runs[runs.length-1];
    if (last && last[1] + 1 === slot) last[1] = slot; else runs.push([slot, slot]);
  }
  return runs;
}

/**
 * The display priority to save: the course goes in front of every ranked one,
 * or loses its rank. Values are packed again when they would pass the limit.
 */
function nextPriority(current: Record<string, number>, name: string, preferred: boolean) {
  const key = schedulePriorityKey(name);
  const next = { ...current };
  if (!key) return next;
  if (!preferred) { delete next[key]; return next; }
  const own = next[key] || 0;
  if (own > 0 && !Object.entries(next).some(([other, value]) => other !== key && value >= own)) return next;
  delete next[key];
  let top = Math.max(0, ...Object.values(next)) + 1;
  if (top > MAX_SCHEDULE_PRIORITY) {
    Object.entries(next).sort((a,b)=>a[1]-b[1] || a[0].localeCompare(b[0])).forEach(([other], index) => { next[other] = index + 1; });
    top = Object.keys(next).length + 1;
  }
  next[key] = top;
  return next;
}

export function installAndroidEditor() {
  const host = window as any;
  if (host.CPUAndroidEditor) return;
  const sessions = new Map<string, any>();
  const identity = () => JSON.stringify([useAuthStore()?.user?.id, useAuthStore()?.academicIdentity]);
  async function request(method: string, semester: string, edits?: any) {
    const auth = useAuthStore(); const jwxt = useJwxtStore();
    if (!auth?.isLoggedIn || !jwxt?.isLoggedIn) throw Error('请先完成教务授权');
    if (auth.academicIdentity === 'graduate') throw Error('研究生课表暂不支持个人课程修改');
    const data = await siteRequest(method, '/jwxt/schedule-edits'+(method==='GET'?'?semester='+encodeURIComponent(semester):''),
      method==='PUT'?{semester,edits}:undefined, '课程修改暂时无法保存');
    // `priority` is kept beside the normalized state: the shared normalizer drops it.
    return { ...normalizeScheduleEditsState(data?.edits), priority: normalizeSchedulePriority(data?.edits?.priority) ?? {} };
  }
  host.CPUAndroidEditor = async (payload: any) => {
    try {
      if (payload.action === 'priority') {
        const owner = identity();
        const state = await request('GET',payload.semester);
        if (identity() !== owner) throw Error('账号已变化，请重新载入当前账号课表');
        return { priority: state.priority };
      }
      if (payload.action === 'open') {
        const owner = identity();
        const baseline = await request('GET',payload.semester);
        if (identity() !== owner) throw Error('账号已变化，请重新打开课程');
        const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessions.clear(); sessions.set(session,{owner,baseline,semester:payload.semester});
        return { session, priority:baseline.priority, hidden:baseline.hidden.map(key=>({key,label:key.split('|')[5] || '已隐藏课程'})) };
      }
      const session = sessions.get(payload.session);
      if (!session || session.owner !== identity()) throw Error('编辑会话已失效，请重新打开课程');
      const current = await request('GET',session.semester);
      if (session.owner !== identity()) throw Error('账号已变化，请重新打开课程');
      if (JSON.stringify(current) !== JSON.stringify(session.baseline)) throw Error('课表已在其他页面修改，请重新打开后再保存');
      const block = payload.original ? {...payload.original,index:0} : null;
      const key = block ? courseEditKey(block.day,block.bigSlot,block.course) : '';
      const family = (day:number,bigSlot:number,course:any) => buildCourseFamilyKey(day,bigSlot,course);
      // Hiding or editing a block leaves the rows of the same course that meet in other weeks alone.
      const sourceKeys = (day:number,bigSlot:number,course:any,options:{overlappingWeeksOnly?:boolean}={}) => {
        const keys = new Set<string>(); const target=family(day,bigSlot,course);
        for(const cell of payload.cells || []) for(const item of cell.courses || []) {
          if (family(cell.day,cell.bigSlot,item) !== target) continue;
          if (options.overlappingWeeksOnly && !courseWeeksOverlap(item,course)) continue;
          keys.add(item.sourceKey || courseEditKey(cell.day,cell.bigSlot,item));
        }
        if(course.sourceKey) keys.add(course.sourceKey);
        return keys;
      };
      const helpers = {editingBlock:block,editingCourseKey:key,courseFamilyKey:family,courseFamilySourceKeys:sourceKeys};
      let next: { hidden: string[]; custom: any[] } = current;
      let priority: Record<string, number> = current.priority;
      if (payload.action === 'save') {
        const form=payload.form;
        if (!form?.name?.trim() || form.name.trim().length>120) throw Error('请填写不超过 120 字的课程名称');
        // One "when it meets" group per arrangement; the single day/start/end form is one group.
        const arrangements: Arrangement[] = Array.isArray(form.arrangements) && form.arrangements.length ? form.arrangements : [{
          day: form.day, weekList: form.weekList,
          slots: Number.isInteger(form.startSlot) && Number.isInteger(form.endSlot) && form.endSlot >= form.startSlot && form.endSlot - form.startSlot < 64
            ? Array.from({length: form.endSlot - form.startSlot + 1}, (_,index)=>form.startSlot+index) : [],
        }];
        if (arrangements.length > 12) throw Error('上课时间最多 12 组');
        const items: any[] = [];
        arrangements.forEach((arrangement, index) => {
          const title = arrangements.length > 1 ? `上课时间 ${index + 1}：` : '';
          const slots = Array.isArray(arrangement.slots) ? arrangement.slots.map(Number) : [];
          if (!Number.isInteger(arrangement.day) || arrangement.day<1 || arrangement.day>7 || !slots.length ||
            slots.some(slot=>!Number.isInteger(slot) || slot<1 || slot>MAX_SMALL_SLOT)) throw Error(title+'请检查星期和节次范围');
          const weekList = [...new Set<number>((arrangement.weekList || []).map(Number))].sort((a,b)=>a-b);
          if (!weekList.length || weekList.some(n=>!Number.isInteger(n)||n<1||n>64)) throw Error(title+'请选择有效教学周');
          for (const [startSlot, endSlot] of slotRuns(slots)) {
            // The first run is the block being edited and keeps its identity;
            // every further run is saved as a plain custom item of the same course.
            const primary = !items.length;
            const existing = primary && block?.course.customId ? current.custom.find(item=>item.id===block.course.customId) : null;
            items.push(buildCustomCourseItem({...form,day:arrangement.day,startSlot,endSlot},
              {weekList,existing,editingCourseKey:primary?key:''}).item);
          }
        });
        next=saveCustomCourseEdit(current,items[0],helpers);
        if (items.length > 1) next={hidden:next.hidden,custom:[...next.custom,...items.slice(1)]};
        if (typeof form.preferred === 'boolean') priority=nextPriority(priority,form.name,form.preferred);
      } else if (payload.action === 'delete' && block) next=deleteCourseEdit(current,block,helpers);
      else if (payload.action === 'restore' && block?.course.sourceKey) next=restoreOriginalCourseEdit(current,block,{...helpers,sourceKey:block.course.sourceKey,customId:block.course.customId});
      else if (payload.action === 'restoreHidden' && current.hidden.includes(payload.key)) {
        next={...current,hidden:current.hidden.filter(key=>key!==payload.key)};
      } else throw Error('不支持的课程修改操作');
      // Always sent: a save without the field keeps the stored map, so it could never be cleared.
      await request('PUT',session.semester,{hidden:next.hidden,custom:next.custom,priority});
      if (session.owner !== identity()) throw Error('账号已变化，请重新载入当前账号课表');
      sessions.delete(payload.session);
      return {saved:true,priority};
    } catch(error) { return {error:error instanceof Error ? error.message : '课程操作失败'}; }
  };
}
