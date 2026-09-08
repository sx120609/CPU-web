import { useAuthStore, useJwxtStore } from './adapters';
import { courseEditKey, normalizeScheduleEditsState } from '../../web/src/utils/scheduleEdits';
import { buildCustomCourseItem, saveCustomCourseEdit, deleteCourseEdit, restoreOriginalCourseEdit } from '../../web/src/views/schedule/courseEditor';
import { buildCourseFamilyKey } from '../../web/src/views/schedule/viewModels';

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
      return normalizeScheduleEditsState(result.data?.edits);
    } finally { clearTimeout(timeout); }
  }
  host.CPUHarmonyEditor = async (payload: any) => {
    try {
      if (payload.action === 'open') {
        const owner = identity();
        const baseline = await request('GET',payload.semester);
        if (identity() !== owner) throw Error('账号已变化，请重新打开课程');
        const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessions.clear(); sessions.set(session,{owner,baseline,semester:payload.semester});
        return { session, hidden:baseline.hidden.map(key=>({key,label:key.split('|')[5] || '已隐藏课程'})) };
      }
      const session = sessions.get(payload.session);
      if (!session || session.owner !== identity()) throw Error('编辑会话已失效，请重新打开课程');
      const current = await request('GET',session.semester);
      if (session.owner !== identity()) throw Error('账号已变化，请重新打开课程');
      if (JSON.stringify(current) !== JSON.stringify(session.baseline)) throw Error('课表已在其他页面修改，请重新打开后再保存');
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
      if (payload.action === 'save') {
        const form=payload.form;
        if (!form?.name?.trim() || form.name.trim().length>120) throw Error('请填写不超过 120 字的课程名称');
        if (!Number.isInteger(form.day) || form.day<1 || form.day>7 || !Number.isInteger(form.startSlot) ||
          !Number.isInteger(form.endSlot) || form.startSlot<1 || form.endSlot>11 || form.endSlot<form.startSlot) throw Error('请检查星期和节次范围');
        const weekList = [...new Set<number>((form.weekList || []).map(Number))].sort((a,b)=>a-b);
        if (!weekList.length || weekList.some(n=>!Number.isInteger(n)||n<1||n>64)) throw Error('请选择有效教学周');
        const existing=block?.course.customId ? current.custom.find(item=>item.id===block.course.customId) : null;
        const {item}=buildCustomCourseItem(form,{weekList,existing,editingCourseKey:key});
        next=saveCustomCourseEdit(current,item,helpers);
      } else if (payload.action === 'delete' && block) next=deleteCourseEdit(current,block,helpers);
      else if (payload.action === 'restore' && block?.course.sourceKey) next=restoreOriginalCourseEdit(current,block,{...helpers,sourceKey:block.course.sourceKey,customId:block.course.customId});
      else if (payload.action === 'restoreHidden' && current.hidden.includes(payload.key)) {
        next={...current,hidden:current.hidden.filter(key=>key!==payload.key)};
      } else throw Error('不支持的课程修改操作');
      await request('PUT',session.semester,next);
      if (session.owner !== identity()) throw Error('账号已变化，请重新载入当前账号课表');
      sessions.delete(payload.session);
      return {saved:true};
    } catch(error) { return {error:error instanceof Error ? error.message : '课程操作失败'}; }
  };
}
