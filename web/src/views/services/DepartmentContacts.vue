<template>
  <div class="contacts-page">
    <header class="contacts-head">
      <router-link class="back-link" to="/services/tools">← 校园小工具</router-link>
      <div class="title-line"><el-icon aria-hidden="true"><Phone /></el-icon><h1>部门联系</h1></div>
      <p>从部门、关键词或办事需求，找到适合的公开联系窗口。</p>
      <p v-if="result" class="meta-line">资料核对 {{ result.meta.asOf }} · {{ result.meta.actualRecordCount }} 条记录 · {{ result.meta.actualSourceCount }} 个来源</p>
    </header>
    <section class="search-panel" aria-label="查找部门联系">
      <form @submit.prevent="search">
        <label for="contact-query">你想联系哪个部门，或办理什么事？</label>
        <div class="search-row">
          <input id="contact-query" v-model="form.q" type="search" maxlength="160" placeholder="例如：补办校园卡、宿舍报修、教务处" />
          <button class="primary-button" type="submit">查询</button>
        </div>
        <div class="filters">
          <label>分类<select v-model="form.category" @change="search"><option value="">全部分类</option><option v-for="category in result?.categories ?? []" :key="category">{{ category }}</option></select></label>
          <label>校区<select v-model="form.campus" @change="search"><option value="">全部校区</option><option v-for="campus in result?.campuses ?? []" :key="campus">{{ campus }}</option></select></label>
          <label class="special-filter"><input v-model="form.includeSpecial" type="checkbox" @change="search" />包含历史、专项及待审查记录</label>
        </div>
      </form>
      <div class="quick-queries" role="group" aria-label="常见需求">
        <button v-for="text in ['补办校园卡', '宿舍报修', '教务咨询']" :key="text" type="button" @click="quickSearch(text)">{{ text }}</button>
        <button type="button" @click="reset">清除筛选</button>
      </div>
    </section>
    <aside class="notice">这是公开资料汇编，未电话拨测，也未经学校认证。“建议默认展示”是编者初筛；号码只能用于所列业务。历史招生、暑期值班与冲突号码需另行确认。</aside>
    <section v-if="detail" ref="detailPanel" class="detail-panel" tabindex="-1" aria-labelledby="detail-title">
      <div class="section-title"><h2 id="detail-title">{{ detail.department }} · {{ detail.office }}</h2><button type="button" @click="closeDetail">关闭详情</button></div>
      <p class="scope">{{ detail.purpose }} · {{ detail.campus || '来源未注明校区' }}</p>
      <p class="status" :class="{ warning: detail.warnings.length }">{{ detail.status }}</p>
      <p v-for="warning in detail.warnings" :key="warning" class="warning-text">{{ warning }}</p>
      <p v-if="detail.note" class="record-note">{{ detail.note }}</p>
      <dl class="detail-fields">
        <dt>地址</dt><dd>{{ detail.address || '来源未注明' }}</dd>
        <dt>服务时间</dt><dd>{{ detail.serviceHours || '来源未注明；请向单位确认' }}</dd>
        <dt>公开联系人</dt><dd>{{ detail.contactName || '来源未注明' }}</dd>
        <dt>核验方式</dt><dd>{{ detail.verification }}</dd>
        <dt>实际拨测</dt><dd>{{ detail.lastLiveTestedAt || '未拨测' }}</dd>
      </dl>
      <div v-for="phone in detail.phones" :key="phone.number" class="phone-row"><strong>{{ phone.number }}</strong><button type="button" @click="copy(phone.number)">复制号码</button><a v-if="phone.dialUrl" :href="phone.dialUrl">主动拨打</a></div>
      <p v-if="!detail.phones.length">来源未列电话。</p>
      <div v-for="email in detail.emails" :key="email" class="phone-row"><span>{{ email }}</span><button type="button" @click="copy(email)">复制邮箱</button></div>
      <p v-if="detail.fax">传真：{{ detail.fax }}</p>
      <h3>公开来源</h3>
      <ul class="source-list"><li v-for="source in detail.sources" :key="source.sourceId">
        <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a><span v-else>{{ source.title }}</span>
        <p>发布：{{ source.publishedDate || '未标日期' }} · 资料核对：{{ source.checkedAt }}</p><p v-if="source.note">{{ source.note }}</p>
      </li></ul>
      <p>记录来源状态：{{ detail.evidenceStatus }} · 发布：{{ detail.sourceDate || '未标日期' }} · 核对：{{ detail.checkedAt }}</p>
      <a v-if="detail.onlineUrl" :href="detail.onlineUrl" target="_blank" rel="noopener noreferrer">查看来源办事入口 ↗</a>
      <button type="button" @click="copyDetailLink">复制详情链接</button>
    </section>
    <p v-if="detailError" role="alert" class="error">{{ detailError }} <button type="button" @click="closeDetail">关闭</button></p>
    <p v-if="loading" role="status">正在查询公开联系资料…</p>
    <section v-else-if="error" class="empty-panel" role="alert"><h2>联系资料暂时未能加载</h2><p>{{ error }}</p><button type="button" @click="load">重试</button></section>
    <template v-else-if="result">
      <aside v-if="result.clarification" class="clarification"><strong>先确认适用窗口</strong><p>{{ result.clarification }}</p><p>下列是候选窗口，请核对业务和校区后联系。</p></aside>
      <div class="section-title"><h2>查询结果 <span>{{ result.total }} 条</span></h2><router-link to="/search">向拾间AI描述办事需求 →</router-link></div>
      <p v-if="result.hiddenSpecialCount" class="meta-line">另有 {{ result.hiddenSpecialCount }} 条历史、专项或待审查记录，可通过筛选主动查看。</p>
      <section v-if="!result.contacts.length" class="empty-panel"><h3>没有找到适用于当前条件的公开窗口</h3><p>试试部门简称或具体业务，也可清除校区筛选。空结果不表示该单位没有联系方式。</p><button type="button" @click="reset">清除筛选</button></section>
      <div class="results-grid">
        <article v-for="contact in result.contacts" :key="contact.id" class="contact-card">
          <div class="card-meta"><span>{{ contact.category }}</span><span>{{ contact.campus || '校区未注明' }}</span></div>
          <h3>{{ contact.department }}</h3><p class="office">{{ contact.office }}</p><p class="scope">业务：{{ contact.purpose }}</p>
          <p class="status" :class="{ warning: contact.warnings.length }">{{ contact.status }}</p>
          <p v-for="warning in contact.warnings" :key="warning" class="warning-text">{{ warning }}</p><p v-if="contact.note" class="record-note">{{ contact.note }}</p>
          <div v-for="phone in contact.phones" :key="phone.number" class="phone-row"><strong>{{ phone.number }}</strong><button type="button" @click="copy(phone.number)">复制</button><a v-if="phone.dialUrl" :href="phone.dialUrl">主动拨打</a></div>
          <p v-if="!contact.phones.length">来源未列电话，请查看详情。</p>
          <p class="date-line">发布：{{ contact.sourceDate || '未标日期' }} · 核对：{{ contact.checkedAt }}</p>
          <a v-if="contact.sources[0]?.url" :href="contact.sources[0].url" target="_blank" rel="noopener noreferrer" class="source-link">{{ contact.sources[0].title }} ↗</a>
          <router-link :to="detailLocation(contact.id)" class="details-link">查看范围与全部来源 →</router-link>
        </article>
      </div>
      <section v-if="result.gaps.length" class="gap-panel"><h3>相关缺口与冲突说明</h3><article v-for="gap in result.gaps" :key="gap.unit"><h4>{{ gap.unit }} · {{ gap.status }}</h4><p>{{ gap.finding }}</p><p>{{ gap.action }}</p><a v-if="gap.url" :href="gap.url" target="_blank" rel="noopener noreferrer">查看来源入口 ↗</a><p class="date-line">资料核对：{{ gap.checkedAt }}</p></article></section>
      <nav v-if="result.total > result.limit" class="pagination" aria-label="结果分页"><button type="button" :disabled="result.offset === 0" @click="page(-1)">上一页</button><span>{{ Math.floor(result.offset / result.limit) + 1 }} / {{ Math.ceil(result.total / result.limit) }}</span><button type="button" :disabled="result.offset + result.limit >= result.total" @click="page(1)">下一页</button></nav>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Phone } from "@element-plus/icons-vue";
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
let requestVersion = 0;
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function errorText(value: unknown) { return (value as { response?: { data?: { message?: string } } })?.response?.data?.message || "请检查网络后重试。"; }
async function load() {
  const version = ++requestVersion;
  form.q = text(route.query.q).slice(0, 160); form.category = text(route.query.category); form.campus = text(route.query.campus); form.includeSpecial = route.query.includeSpecial === "1";
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
function reset() { form.q = ""; form.category = ""; form.campus = ""; form.includeSpecial = false; search(); }
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
.contacts-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; width: 100%; min-width: 0; max-width: 1120px; margin: 0 auto; color: var(--cpu-text); padding-bottom: max(24px, env(safe-area-inset-bottom)); font-size: 16px; line-height: 1.6; }
.contacts-page > * { min-width: 0; }
.contacts-head, .search-panel, .detail-panel, .empty-panel, .gap-panel { background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 16px; padding: 24px; }
.back-link, a { color: var(--cpu-button-primary); overflow-wrap: anywhere; }.title-line { display: flex; align-items: center; gap: 12px; margin-top: 12px; }.title-line .el-icon { font-size: 28px; }
h1, h2, h3, h4, p { margin: 0; }h1 { font-size: 28px; }h2 { font-size: 20px; }h3 { font-size: 18px; }p { margin-top: 8px; }
button, select, input[type="search"] { font: inherit; color: var(--cpu-text); background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 8px; min-height: 44px; padding: 8px 12px; }
button, select { cursor: pointer; }button:hover, button:active { background: var(--cpu-surface-subtle); }button:disabled { opacity: .45; cursor: default; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--cpu-primary); outline-offset: 3px; }
.primary-button { background: var(--cpu-button-primary); color: var(--cpu-button-on-primary); min-width: 88px; }.primary-button:hover { background: var(--cpu-button-primary); filter: brightness(.94); }
.search-panel form > label { font-weight: 650; }.search-row { display: flex; gap: 12px; margin-top: 8px; }.search-row input { flex: 1; min-width: 0; }
.filters, .quick-queries { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 16px; }.filters label { display: flex; align-items: center; gap: 8px; }.filters select { max-width: 240px; }
.special-filter { min-height: 44px; }.special-filter input { width: 20px; height: 20px; accent-color: var(--cpu-primary); }
.notice, .clarification { padding: 16px 20px; border: 1px solid var(--cpu-border-soft); border-left: 4px solid var(--cpu-primary); border-radius: 10px; background: var(--cpu-surface-subtle); }
.section-title { display: flex; gap: 16px; justify-content: space-between; align-items: center; flex-wrap: wrap; }.section-title h2 span { font-weight: 400; margin-left: 8px; }
.results-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }.contact-card { background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 12px; padding: 20px; min-width: 0; }
.card-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--cpu-text-secondary); font-size: 13px; margin-bottom: 12px; }.office { font-weight: 600; }
.scope, .meta-line, .date-line { color: var(--cpu-text-secondary); }.meta-line, .date-line, .source-list p { font-size: 14px; }
.status { display: inline-block; padding: 3px 8px; border-radius: 6px; background: var(--cpu-surface-subtle); font-size: 14px; border: 1px solid var(--cpu-border-soft); }.warning { font-weight: 650; }.warning-text, .record-note { border-left: 3px solid var(--cpu-border-soft); padding-left: 10px; font-size: 14px; }
.phone-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; overflow-wrap: anywhere; }.phone-row strong { font-size: 18px; margin-right: auto; }.phone-row a { display: inline-flex; align-items: center; min-height: 44px; padding: 8px; box-sizing: border-box; }
.source-link, .details-link { display: block; margin-top: 12px; }.details-link { min-height: 44px; display: flex; align-items: center; }
.detail-fields { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 8px 12px; }.detail-fields dt { color: var(--cpu-text-secondary); }.detail-fields dd { margin: 0; overflow-wrap: anywhere; }
.detail-panel h3 { margin-top: 20px; }.source-list { padding-left: 20px; }.source-list li { margin-bottom: 16px; }.gap-panel article + article { border-top: 1px solid var(--cpu-border-soft); margin-top: 16px; padding-top: 16px; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 16px; }.error { padding: 16px; border: 1px solid var(--cpu-border-soft); }
@media (max-width: 680px) { .contacts-page { gap: 16px; }.contacts-head, .search-panel, .detail-panel, .gap-panel, .empty-panel { padding: 16px; }.results-grid { grid-template-columns: 1fr; }.contact-card { padding: 16px; }.filters { align-items: stretch; }.filters label:not(.special-filter) { flex: 1 1 100%; }.filters select { flex: 1; max-width: none; min-width: 0; }h1 { font-size: 24px; }.phone-row strong { flex-basis: 100%; }.detail-fields { grid-template-columns: 80px minmax(0, 1fr); } }
</style>
