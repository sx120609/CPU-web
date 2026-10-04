<template>
  <div class="contacts-page">
    <header class="contacts-head">
      <router-link class="back-link" to="/services/tools"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>校园小工具</router-link>
      <div class="title-line">
        <span class="title-icon" aria-hidden="true"><el-icon><Phone /></el-icon></span>
        <div class="title-copy">
          <h1>部门联系</h1>
          <p v-if="result">{{ result.meta.actualRecordCount }} 条公开资料 · 核对 {{ result.meta.asOf }}</p>
          <p v-else>查找部门、电话或办事窗口</p>
        </div>
        <router-link class="ai-entry" to="/search">问拾间AI<el-icon aria-hidden="true"><Right /></el-icon></router-link>
      </div>
    </header>
    <section class="search-panel" aria-label="查找部门联系">
      <form @submit.prevent="search">
        <label for="contact-query" class="sr-only">你想联系哪个部门，或办理什么事？</label>
        <div class="search-row">
          <div class="search-input">
            <el-icon aria-hidden="true"><Search /></el-icon>
            <input id="contact-query" v-model="form.q" type="search" maxlength="160" placeholder="部门、关键词或办事需求" />
          </div>
          <button class="primary-button" type="submit">查询</button>
        </div>
        <div class="query-toolbar">
          <div class="quick-queries" role="group" aria-label="常见办事需求">
            <button v-for="text in ['补办校园卡', '宿舍报修', '教务咨询']" :key="text" type="button" @click="quickSearch(text)">{{ text }}</button>
          </div>
          <button class="filter-toggle" type="button" :aria-expanded="showFilters" aria-controls="contact-filters" @click="showFilters = !showFilters">
            <el-icon aria-hidden="true"><Filter /></el-icon>筛选<span v-if="activeFilterCount" class="filter-count" aria-hidden="true">{{ activeFilterCount }}</span>
          </button>
        </div>
        <div v-show="showFilters" id="contact-filters" class="filters">
          <label>分类<select v-model="form.category" @change="search"><option value="">全部分类</option><option v-for="category in result?.categories ?? []" :key="category">{{ category }}</option></select></label>
          <label>校区<select v-model="form.campus" @change="search"><option value="">全部校区</option><option v-for="campus in result?.campuses ?? []" :key="campus">{{ campus }}</option></select></label>
          <label class="special-filter"><input v-model="form.includeSpecial" type="checkbox" @change="search" />包含历史、专项及待审查记录</label>
          <button class="reset-button" type="button" @click="reset">清空筛选</button>
        </div>
      </form>
    </section>
    <details class="notice">
      <summary><el-icon aria-hidden="true"><InfoFilled /></el-icon>公开资料汇编，未认证、未拨测<el-icon class="notice-arrow" aria-hidden="true"><Right /></el-icon></summary>
      <p>这是公开资料汇编，未电话拨测，也未经学校认证。编辑者的默认展示标记是编者初筛建议，仅限来源说明的业务。历史、特殊范围和冲突号码需另行确认。<template v-if="result">本次资料包含 {{ result.meta.actualSourceCount }} 个来源，核对日期为 {{ result.meta.asOf }}。</template></p>
    </details>
    <section v-if="detail" ref="detailPanel" class="detail-panel" tabindex="-1" aria-labelledby="detail-title">
      <div class="section-title"><h2 id="detail-title">{{ detail.department }} · {{ detail.office }}</h2><button type="button" @click="closeDetail">关闭详情</button></div>
      <p class="scope">{{ detail.purpose }} · {{ detail.campus || '来源未注明校区' }}</p>
      <p class="status" :class="{ warning: detail.warnings.length }">{{ detail.status }}</p>
      <p v-for="warning in detail.warnings" :key="warning" class="warning-text">{{ warning }}</p>
      <p v-if="detail.note" class="record-note">{{ detail.note }}</p>
      <dl class="detail-fields">
        <dt>地址</dt><dd>{{ detail.address || '来源未注明' }}</dd>
        <dt>服务时间</dt><dd>{{ detail.serviceHours || '来源未注明，请向单位确认' }}</dd>
        <dt>公开联系人</dt><dd>{{ detail.contactName || '来源未注明' }}</dd>
        <dt>核验方式</dt><dd>{{ detail.verification }}</dd>
        <dt>实际拨测</dt><dd>{{ detail.lastLiveTestedAt || '未拨测' }}</dd>
      </dl>
      <div v-for="phone in detail.phones" :key="phone.number" class="phone-row"><strong>{{ phone.number }}</strong><button type="button" @click="copy(phone.number)">复制号码</button><a v-if="phone.dialUrl" :href="phone.dialUrl">主动拨打</a></div>
      <p v-if="!detail.phones.length">来源未列电话。</p>
      <div v-for="email in detail.emails" :key="email" class="phone-row"><span>{{ email }}</span><button type="button" @click="copy(email)">复制邮箱</button></div>
      <p v-if="detail.fax">传真：{{ detail.fax }}</p>
      <h3>全部来源</h3>
      <ul class="source-list"><li v-for="source in detail.sources" :key="source.sourceId">
        <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a><span v-else>{{ source.title }}</span>
        <p>发布：{{ source.publishedDate || '未标日期' }} · 资料核对：{{ source.checkedAt }}</p><p v-if="source.note">{{ source.note }}</p>
      </li></ul>
      <p>记录来源状态：{{ detail.evidenceStatus }} · 发布：{{ detail.sourceDate || '未标日期' }} · 核对：{{ detail.checkedAt }}</p>
      <a v-if="detail.onlineUrl" :href="detail.onlineUrl" target="_blank" rel="noopener noreferrer">查看来源在线入口 ↗</a>
      <button type="button" @click="copyDetailLink">复制详情链接</button>
    </section>
    <p v-if="detailError" role="alert" class="error">{{ detailError }} <button type="button" @click="closeDetail">关闭</button></p>
    <p v-if="loading" role="status">正在查询部门联系资料…</p>
    <section v-else-if="error" class="empty-panel" role="alert"><h2>联系资料暂时未能加载</h2><p>{{ error }}</p><button type="button" @click="load">重试</button></section>
    <template v-else-if="result">
      <aside v-if="result.clarification" class="clarification"><strong>请确认适用窗口</strong><p>{{ result.clarification }}</p><p>下面是候选窗口，请核对业务和校区再联系。</p></aside>
      <div class="section-title results-head"><h2>查询结果 <span>{{ result.total }} 条</span></h2><span>{{ form.includeSpecial ? '含历史、专项及待审查资料' : '默认隐藏历史及特殊资料' }}</span></div>
      <p v-if="result.hiddenSpecialCount" class="meta-line">另有 {{ result.hiddenSpecialCount }} 条历史、专项或待审查记录，可展开筛选查看。</p>
      <section v-if="!result.contacts.length" class="empty-panel"><h3>没有找到符合当前条件的公开窗口</h3><p>试试部门简称或具体业务，也可清除校区筛选。空结果不表示该单位没有联系方式。</p><button type="button" @click="reset">清空筛选</button></section>
      <div class="results-grid">
        <article v-for="contact in result.contacts" :key="contact.id" class="contact-card">
          <div class="card-head"><h3>{{ contact.department }}</h3><span class="campus-badge">{{ contact.campus || '校区未注明' }}</span></div>
          <p class="office">{{ contact.office }}</p>
          <p class="scope">业务：{{ contact.purpose }}</p>
          <p v-for="warning in contact.warnings" :key="warning" class="warning-text">{{ warning }}</p>
          <p v-if="contact.note && contact.warnings.length" class="record-note">{{ contact.note }}</p>
          <details v-else-if="contact.note" class="record-note"><summary>适用说明</summary><p>{{ contact.note }}</p></details>
          <div v-for="phone in contact.phones" :key="phone.number" class="phone-row">
            <strong>{{ phone.number }}</strong><button type="button" @click="copy(phone.number)"><el-icon aria-hidden="true"><CopyDocument /></el-icon>复制</button><a v-if="phone.dialUrl" :href="phone.dialUrl">主动拨打</a>
          </div>
          <p v-if="!contact.phones.length" class="meta-line">来源未列电话，请查看详情。</p>
          <p class="date-line">发布 {{ contact.sourceDate || '未标日期' }} · 核对 {{ contact.checkedAt }}</p>
          <div class="card-footer">
            <span class="status" :class="{ warning: contact.warnings.length }">{{ contact.status }}</span>
            <a v-if="contact.sources[0]?.url" :href="contact.sources[0].url" :title="contact.sources[0].title" :aria-label="contact.sources[0].title" target="_blank" rel="noopener noreferrer" class="source-link">来源 ↗</a>
            <router-link :to="detailLocation(contact.id)" class="details-link" :aria-label="`查看${contact.department} ${contact.office}的范围与全部来源`">详情<el-icon aria-hidden="true"><Right /></el-icon></router-link>
          </div>
        </article>
      </div>
      <section v-if="result.gaps.length" class="gap-panel"><h3>资料缺口与冲突说明</h3><article v-for="gap in result.gaps" :key="gap.unit"><h4>{{ gap.unit }} · {{ gap.status }}</h4><p>{{ gap.finding }}</p><p>{{ gap.action }}</p><a v-if="gap.url" :href="gap.url" target="_blank" rel="noopener noreferrer">查看来源入口 ↗</a><p class="date-line">资料核对：{{ gap.checkedAt }}</p></article></section>
      <nav v-if="result.total > result.limit" class="pagination" aria-label="结果分页"><button type="button" :disabled="result.offset === 0" @click="page(-1)">上一页</button><span>{{ Math.floor(result.offset / result.limit) + 1 }} / {{ Math.ceil(result.total / result.limit) }}</span><button type="button" :disabled="result.offset + result.limit >= result.total" @click="page(1)">下一页</button></nav>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, CopyDocument, Filter, InfoFilled, Phone, Right, Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { departmentContactsApi, type DepartmentContact, type DepartmentQueryResult } from "@/api/departmentContacts";
const route = useRoute();
const router = useRouter();
const form = reactive({ q: "", category: "", campus: "", includeSpecial: false });
const result = ref<DepartmentQueryResult | null>(null);
const detail = ref<DepartmentContact | null>(null);
const error = ref("");
const detailError = ref("");
const loading = ref(false);
const detailPanel = ref<HTMLElement | null>(null);
const showFilters = ref(false);
const activeFilterCount = computed(() => Number(Boolean(form.category)) + Number(Boolean(form.campus)) + Number(form.includeSpecial));
let requestVersion = 0;
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function errorText(value: unknown) { return (value as { response?: { data?: { message?: string } } })?.response?.data?.message || "请检查网络后重试。"; }
async function load() {
  const version = ++requestVersion;
  form.q = text(route.query.q).slice(0, 160); form.category = text(route.query.category); form.campus = text(route.query.campus); form.includeSpecial = route.query.includeSpecial === "1";
  if (form.category || form.campus || form.includeSpecial) showFilters.value = true;
  loading.value = true; error.value = ""; detailError.value = ""; detail.value = null;
  const id = text(route.query.id);
  const rawOffset = Number(text(route.query.offset));
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 && rawOffset <= 10000 ? rawOffset : 0;
  const [list, selected] = await Promise.allSettled([
    departmentContactsApi.query({ q: form.q, category: form.category, campus: form.campus, includeSpecial: form.includeSpecial ? "1" : "0", offset }),
    id ? departmentContactsApi.detail(id) : Promise.resolve(null),
  ]);
  if (version !== requestVersion) return;
  if (list.status === "fulfilled") result.value = list.value;
  else { result.value = null; error.value = errorText(list.reason); }
  if (selected.status === "fulfilled") detail.value = selected.value;
  else detailError.value = errorText(selected.reason);
  loading.value = false;
  if (detail.value) { await nextTick(); detailPanel.value?.focus(); }
}
watch(() => route.query, load, { immediate: true });
function search() {
  const query = { q: form.q.trim() || undefined, category: form.category || undefined, campus: form.campus || undefined, includeSpecial: form.includeSpecial ? "1" : undefined };
  if (route.query.q === query.q && route.query.category === query.category && route.query.campus === query.campus && route.query.includeSpecial === query.includeSpecial && !route.query.offset && !route.query.id) void load();
  else void router.push({ path: route.path, query });
}
function quickSearch(q: string) { form.q = q; search(); }
function reset() { showFilters.value = false; form.q = ""; form.category = ""; form.campus = ""; form.includeSpecial = false; search(); }
function detailLocation(id: string) { return { path: route.path, query: { ...route.query, id } }; }
async function closeDetail() { await router.replace({ path: route.path, query: { ...route.query, id: undefined } }); document.getElementById("contact-query")?.focus(); }
function page(direction: number) { if (result.value) void router.push({ path: route.path, query: { ...route.query, id: undefined, offset: Math.max(0, result.value.offset + direction * result.value.limit).toString() } }); }
async function copy(value: string) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const input = document.createElement("textarea"); input.value = value; input.style.position = "fixed"; input.style.opacity = "0"; document.body.append(input);
      try { input.select(); if (!document.execCommand("copy")) throw new Error("copy"); } finally { input.remove(); }
    }
    ElMessage.success("已复制");
  } catch { ElMessage.error("复制失败，请长按号码或手动选择复制"); }
}
function copyDetailLink() { if (detail.value) void copy(new URL(detail.value.detailUrl, window.location.origin).href); }
</script>

<style scoped>
.contacts-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; width: 100%; min-width: 0; max-width: 1080px; margin: 0 auto; color: var(--cpu-text); padding-bottom: max(24px, env(safe-area-inset-bottom)); font-size: 14px; line-height: 1.5; }
.contacts-page > * { min-width: 0; }
h1, h2, h3, h4, p { margin: 0; }
a { color: var(--cpu-primary); text-decoration: none; overflow-wrap: anywhere; }
a:hover { text-decoration: underline; }
button, select, input[type="search"] { font: inherit; color: var(--cpu-text); background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 8px; min-height: 40px; padding: 7px 10px; }
button, select { cursor: pointer; }button:hover { background: var(--cpu-surface-soft); }button:disabled { opacity: .45; cursor: default; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.contacts-head { padding: 0 2px; }
.back-link { display: inline-flex; min-height: 28px; align-items: center; gap: 4px; font-size: 12px; color: var(--cpu-text-secondary); }
.title-line { display: flex; align-items: center; gap: 10px; padding-top: 4px; }
.title-icon { display: grid; flex: 0 0 auto; width: 36px; height: 36px; place-items: center; border-radius: 10px; background: var(--cpu-surface-soft); color: var(--cpu-primary); font-size: 20px; }
.title-copy { min-width: 0; flex: 1; }.title-copy h1 { font-size: 20px; line-height: 1.35; font-weight: 650; }.title-copy p { margin-top: 3px; color: var(--cpu-text-muted); font-size: 12px; }
.ai-entry { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 3px; min-height: 36px; padding: 0 8px; border: 1px solid var(--cpu-border-soft); border-radius: 8px; background: var(--cpu-card); font-size: 12px; font-weight: 600; }
.search-panel, .detail-panel, .empty-panel, .gap-panel { background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 12px; padding: 12px; }
.search-panel { box-shadow: var(--cpu-shadow-sm); }.search-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }.search-input { position: relative; min-width: 0; }.search-input > .el-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--cpu-text-muted); font-size: 16px; pointer-events: none; }.search-input input { width: 100%; min-width: 0; padding-left: 34px; box-sizing: border-box; background: var(--cpu-surface-soft); }
.primary-button { background: var(--cpu-button-primary); color: var(--cpu-button-on-primary); min-width: 64px; font-size: 13px; font-weight: 600; }.primary-button:hover { background: var(--cpu-button-primary); filter: brightness(.94); }
.query-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }.quick-queries { display: flex; flex: 1; flex-wrap: wrap; gap: 6px; min-width: 0; }.quick-queries button, .filter-toggle { min-height: 32px; padding: 4px 8px; background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: 12px; }.filter-toggle { display: inline-flex; align-items: center; gap: 4px; }.filter-toggle[aria-expanded="true"] { color: var(--cpu-primary); border-color: var(--cpu-primary); }.filter-count { display: grid; min-width: 16px; height: 16px; place-items: center; border-radius: 50%; background: var(--cpu-primary); color: var(--cpu-button-on-primary); font-size: 11px; }
.filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding-top: 10px; margin-top: 10px; border-top: 1px solid var(--cpu-border-soft); }.filters > label { min-width: 0; display: grid; gap: 4px; color: var(--cpu-text-secondary); font-size: 12px; }.filters select { width: 100%; min-width: 0; padding-inline: 8px; }.filters .special-filter { display: flex; grid-column: 1 / -1; align-items: center; gap: 7px; min-height: 36px; }.special-filter input { width: 18px; height: 18px; accent-color: var(--cpu-primary); }.filters .reset-button { justify-self: start; min-height: 32px; font-size: 12px; }
.notice { padding: 0 2px; color: var(--cpu-text-secondary); font-size: 12px; }.notice summary { display: flex; align-items: center; gap: 5px; min-height: 28px; cursor: pointer; list-style: none; }.notice summary::-webkit-details-marker { display: none; }.notice summary > .notice-arrow { margin-left: auto; transition: transform .15s; }.notice[open] .notice-arrow { transform: rotate(90deg); }.notice p { margin-top: 6px; padding: 10px; border: 1px solid var(--cpu-border-soft); border-radius: 8px; background: var(--cpu-surface-soft); font-size: 13px; line-height: 1.6; }
.section-title { display: flex; gap: 8px; justify-content: space-between; align-items: center; flex-wrap: wrap; }.section-title h2 { font-size: 16px; font-weight: 650; }.section-title h2 span { color: var(--cpu-text-muted); font-size: 13px; font-weight: 400; margin-left: 5px; }.results-head { padding-inline: 2px; }.results-head > span { font-size: 12px; color: var(--cpu-text-muted); }
.results-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 10px; }.contact-card { display: flex; flex-direction: column; gap: 5px; background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 12px; padding: 12px; min-width: 0; }.card-head { display: flex; align-items: flex-start; gap: 8px; }.card-head h3 { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 15px; line-height: 1.4; font-weight: 650; }.campus-badge { flex: 0 0 auto; padding: 1px 6px; border-radius: 5px; background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: 11px; line-height: 20px; }.office { font-size: 13px; font-weight: 600; }.scope { color: var(--cpu-text-secondary); font-size: 13px; overflow-wrap: anywhere; }.category-line, .meta-line, .date-line { color: var(--cpu-text-muted); font-size: 12px; }.category-line { font-size: 11px; }
.status { display: inline-block; align-self: start; padding: 2px 6px; border-radius: 5px; background: var(--cpu-surface-soft); font-size: 11px; color: var(--cpu-text-secondary); }.status.warning { background: color-mix(in srgb, var(--cpu-warning, #b97920) 10%, var(--cpu-card)); color: var(--cpu-text); }.warning-text { padding-left: 7px; border-left: 2px solid var(--cpu-warning, #b97920); color: var(--cpu-text-secondary); font-size: 12px; }.record-note { color: var(--cpu-text-secondary); font-size: 12px; }.record-note summary { cursor: pointer; min-height: 24px; }.record-note p { margin-top: 4px; }
.phone-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; overflow-wrap: anywhere; }.phone-row strong { flex: 1; min-width: 0; font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }.phone-row button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 36px; padding: 5px 7px; font-size: 12px; }.phone-row a { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 5px; font-size: 12px; }.phone-row .el-icon { font-size: 14px; }
.card-footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 4px; margin-top: auto; border-top: 1px solid var(--cpu-border-soft); }.card-footer .status { align-self: center; }.source-link, .details-link { display: inline-flex; align-items: center; gap: 2px; min-height: 32px; font-size: 12px; }.source-link { margin-left: auto; }.details-link { padding-left: 3px; }.date-line { font-size: 11px; line-height: 1.6; }
.clarification { padding: 10px 12px; border: 1px solid var(--cpu-border-soft); border-left: 3px solid var(--cpu-primary); border-radius: 10px; background: var(--cpu-surface-soft); font-size: 13px; }.clarification p { margin-top: 4px; }.clarification > p:last-child { color: var(--cpu-text-secondary); font-size: 12px; }
.detail-panel { padding: 16px; }.detail-panel p { margin-top: 7px; }.detail-panel .phone-row { margin-top: 10px; }.detail-panel .section-title button { font-size: 12px; }.detail-panel h3 { margin-top: 16px; font-size: 15px; }.detail-panel > button { margin-top: 8px; font-size: 12px; }.detail-fields { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 7px 10px; font-size: 13px; }.detail-fields dt { color: var(--cpu-text-secondary); }.detail-fields dd { margin: 0; overflow-wrap: anywhere; }.source-list { padding-left: 18px; font-size: 13px; }.source-list li { margin-bottom: 12px; }.source-list p { font-size: 12px; color: var(--cpu-text-muted); }
.empty-panel h2, .empty-panel h3, .gap-panel h3 { font-size: 15px; }.empty-panel p, .gap-panel p { margin-top: 6px; color: var(--cpu-text-secondary); font-size: 13px; }.empty-panel button { margin-top: 10px; font-size: 13px; }.gap-panel h4 { margin-top: 8px; font-size: 13px; }.gap-panel article + article { border-top: 1px solid var(--cpu-border-soft); margin-top: 10px; padding-top: 6px; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 12px; font-size: 13px; }.pagination button { font-size: 12px; }.error { padding: 10px; border: 1px solid var(--cpu-border-soft); }
@media (max-width: 640px) { .contacts-page { gap: 10px; }.title-copy h1 { font-size: 18px; }.search-panel { padding: 10px; }.search-row input { min-height: 44px; font-size: 16px; }.filters select { min-height: 44px; font-size: 16px; }.primary-button { min-height: 44px; }.contact-card { border-radius: 11px; }.phone-row button, .phone-row a { min-height: 40px; }.detail-panel { padding: 12px; }.detail-fields { grid-template-columns: 72px minmax(0, 1fr); }.title-copy p { font-size: 11px; }.ai-entry { padding-inline: 6px; }.quick-queries button, .filter-toggle { min-height: 36px; }.card-head h3 { font-size: 14px; } }
@media (max-width: 360px) { .title-icon { display: none; }.ai-entry { font-size: 11px; }.query-toolbar { gap: 4px; }.quick-queries { gap: 4px; }.quick-queries button, .filter-toggle { padding-inline: 6px; font-size: 11px; } }
@media (prefers-reduced-motion: reduce) { .notice summary > .notice-arrow { transition: none; } }
</style>
