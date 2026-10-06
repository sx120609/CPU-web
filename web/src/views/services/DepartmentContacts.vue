<template>
  <div class="pk-page contacts-page">
    <header class="pk-head">
      <router-link class="pk-back" to="/services/tools"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>校园小工具</router-link>
      <div class="pk-title">
        <span class="pk-tile" style="--tone: #0f766e" aria-hidden="true"><el-icon><Phone /></el-icon></span>
        <div class="pk-title-copy">
          <h1>部门联系</h1>
          <p v-if="result">{{ result.meta.actualRecordCount }} 条公开资料 · 核对 {{ result.meta.asOf }}</p>
          <p v-else>查找部门、电话或办事窗口</p>
        </div>
        <router-link class="pk-pill" to="/search">问拾间AI<el-icon aria-hidden="true"><Right /></el-icon></router-link>
      </div>
    </header>

    <section class="pk-card search-panel" aria-label="查找部门联系">
      <form @submit.prevent="search">
        <label for="contact-query" class="sr-only">你想联系哪个部门，或办理什么事？</label>
        <div class="search-row">
          <div class="search-input">
            <el-icon aria-hidden="true"><Search /></el-icon>
            <input id="contact-query" v-model="form.q" type="search" maxlength="160" placeholder="部门、关键词或办事需求" enterkeyhint="search" />
          </div>
          <button data-cpu-button="primary" class="search-submit" type="submit" :disabled="loading && form.q.trim() === text(route.query.q).trim()">查询</button>
        </div>
        <div class="query-toolbar">
          <div class="quick-queries" role="group" aria-label="常见办事需求">
            <button v-for="text in ['补办校园卡', '宿舍报修', '教务咨询']" :key="text" data-cpu-button="surface" class="chip" type="button" @click="quickSearch(text)">{{ text }}</button>
          </div>
          <button data-cpu-button="surface" class="chip filter-toggle" type="button" :aria-expanded="showFilters" aria-controls="contact-filters" @click="showFilters = !showFilters">
            <el-icon aria-hidden="true"><Filter /></el-icon>筛选<span v-if="activeFilterCount" class="filter-count" aria-hidden="true">{{ activeFilterCount }}</span>
          </button>
        </div>
        <div v-show="showFilters" id="contact-filters" class="filters">
          <label>分类<select v-model="form.category" @change="search"><option value="">全部分类</option><option v-for="category in result?.categories ?? []" :key="category">{{ category }}</option></select></label>
          <label>校区<select v-model="form.campus" @change="search"><option value="">全部校区</option><option v-for="campus in result?.campuses ?? []" :key="campus">{{ campus }}</option></select></label>
          <label class="special-filter"><input v-model="form.includeSpecial" type="checkbox" @change="search" />包含历史、专项及待审查记录</label>
          <button data-cpu-button="surface" class="chip" type="button" @click="reset">清空筛选</button>
        </div>
      </form>
      <p class="search-help">口语需求由拾间AI理解，需登录并使用现有AI额度；精确部门名或号码直接查询。</p>
    </section>

    <details class="notice">
      <summary><el-icon aria-hidden="true"><InfoFilled /></el-icon>公开资料汇编，未认证、未拨测<el-icon class="notice-arrow" aria-hidden="true"><Right /></el-icon></summary>
      <p>这是公开资料汇编，未电话拨测，也未经学校认证。编辑者的默认展示标记是编者初筛建议，仅限来源说明的业务。历史、特殊范围和冲突号码需另行确认。<template v-if="result">本次资料包含 {{ result.meta.actualSourceCount }} 个来源，核对日期为 {{ result.meta.asOf }}。</template></p>
    </details>

    <section v-if="detail" ref="detailPanel" class="pk-card detail-panel" tabindex="-1" aria-labelledby="detail-title">
      <header class="detail-head">
        <div>
          <h2 id="detail-title" class="pk-h2">{{ detail.department }} · {{ detail.office }}</h2>
          <p class="pk-muted">{{ detail.purpose }} · {{ detail.campus || '来源未注明校区' }}</p>
        </div>
        <button data-cpu-button="surface" class="chip" type="button" @click="closeDetail"><el-icon aria-hidden="true"><Close /></el-icon>关闭详情</button>
      </header>
      <p><span class="pk-badge" :class="{ 'is-login': detail.warnings.length }">{{ detail.status }}</span></p>
      <p v-for="warning in detail.warnings" :key="warning" class="warning-text">{{ warning }}</p>
      <p v-if="detail.note" class="record-note">{{ detail.note }}</p>

      <div v-for="phone in detail.phones" :key="phone.number" class="phone-row">
        <strong>{{ phone.number }}</strong>
        <button data-cpu-button="surface" class="chip" type="button" @click="copy(phone.number)"><el-icon aria-hidden="true"><CopyDocument /></el-icon>复制号码</button>
        <a v-if="phone.dialUrl" class="chip chip--primary" :href="phone.dialUrl"><el-icon aria-hidden="true"><PhoneFilled /></el-icon>主动拨打</a>
      </div>
      <p v-if="!detail.phones.length" class="pk-muted">来源未列电话。</p>
      <div v-for="email in detail.emails" :key="email" class="phone-row"><span>{{ email }}</span><button data-cpu-button="surface" class="chip" type="button" @click="copy(email)">复制邮箱</button></div>
      <p v-if="detail.fax" class="pk-muted">传真：{{ detail.fax }}</p>

      <dl class="detail-fields">
        <div><dt>地址</dt><dd>{{ detail.address || '来源未注明' }}</dd></div>
        <div><dt>服务时间</dt><dd>{{ detail.serviceHours || '来源未注明，请向单位确认' }}</dd></div>
        <div><dt>公开联系人</dt><dd>{{ detail.contactName || '来源未注明' }}</dd></div>
        <div><dt>核验方式</dt><dd>{{ detail.verification }}</dd></div>
        <div><dt>实际拨测</dt><dd>{{ detail.lastLiveTestedAt || '未拨测' }}</dd></div>
      </dl>

      <h3>全部来源</h3>
      <ul class="source-list"><li v-for="source in detail.sources" :key="source.sourceId">
        <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a><span v-else>{{ source.title }}</span>
        <p>发布：{{ source.publishedDate || '未标日期' }} · 资料核对：{{ source.checkedAt }}</p><p v-if="source.note">{{ source.note }}</p>
      </li></ul>
      <p class="date-line">记录来源状态：{{ detail.evidenceStatus }} · 发布：{{ detail.sourceDate || '未标日期' }} · 核对：{{ detail.checkedAt }}</p>
      <div class="detail-actions">
        <a v-if="detail.onlineUrl" class="chip" :href="detail.onlineUrl" target="_blank" rel="noopener noreferrer">查看来源在线入口 ↗</a>
        <button data-cpu-button="surface" class="chip" type="button" @click="copyDetailLink">复制详情链接</button>
      </div>
    </section>
    <p v-if="detailError" role="alert" class="pk-notice is-danger state-line"><span>{{ detailError }}</span><button data-cpu-button="surface" class="chip" type="button" @click="closeDetail">关闭</button></p>

    <p v-if="loading" role="status" class="pk-card state-line"><span>{{ aiLoading ? "拾间AI正在理解需求并查找实际窗口…" : "正在查询部门联系资料…" }}</span><button data-cpu-button="surface" class="chip" type="button" @click="cancelSearch">取消</button></p>
    <section v-else-if="error" class="pk-card empty-panel" role="alert"><h2 class="pk-h2">联系资料暂时未能加载</h2><p class="pk-muted">{{ error }}</p><button data-cpu-button="surface" class="chip" type="button" @click="load">重试</button></section>
    <template v-else-if="result">
      <aside v-if="result.clarification" class="clarification"><strong>请确认适用窗口</strong><p>{{ result.clarification }}</p><p>下面是候选窗口，请核对业务和校区再联系。</p></aside>
      <div class="results-head"><h2 class="pk-h2">查询结果 <span>{{ result.total }} 条</span></h2><span>{{ form.includeSpecial ? '含历史、专项及待审查资料' : '默认隐藏历史及特殊资料' }}</span></div>
      <p v-if="result.hiddenSpecialCount" class="meta-line">另有 {{ result.hiddenSpecialCount }} 条历史、专项或待审查记录，可展开筛选查看。</p>
      <section v-if="!result.contacts.length" class="pk-card empty-panel"><h3 class="pk-h2">没有找到符合当前条件的公开窗口</h3><p class="pk-muted">试试部门简称或具体业务，也可清除校区筛选。空结果不表示该单位没有联系方式。</p><button data-cpu-button="surface" class="chip" type="button" @click="reset">清空筛选</button></section>
      <div class="results-grid">
        <article v-for="contact in result.contacts" :key="contact.id" class="pk-card contact-card">
          <header class="card-head">
            <div>
              <h3>{{ contact.department }}</h3>
              <p class="office">{{ contact.office }}</p>
            </div>
            <span class="pk-badge campus-badge"><el-icon aria-hidden="true"><Location /></el-icon>{{ contact.campus || '校区未注明' }}</span>
          </header>
          <p class="scope">业务：{{ contact.purpose }}</p>
          <p v-for="warning in contact.warnings" :key="warning" class="warning-text">{{ warning }}</p>
          <p v-if="contact.note && contact.warnings.length" class="record-note">{{ contact.note }}</p>
          <details v-else-if="contact.note" class="record-note"><summary>适用说明</summary><p>{{ contact.note }}</p></details>
          <div v-for="phone in contact.phones" :key="phone.number" class="phone-row">
            <strong>{{ phone.number }}</strong>
            <button data-cpu-button="surface" class="chip" type="button" @click="copy(phone.number)"><el-icon aria-hidden="true"><CopyDocument /></el-icon>复制</button>
            <a v-if="phone.dialUrl" class="chip chip--primary" :href="phone.dialUrl"><el-icon aria-hidden="true"><PhoneFilled /></el-icon>主动拨打</a>
          </div>
          <p v-if="!contact.phones.length" class="meta-line">来源未列电话，请查看详情。</p>
          <footer class="card-footer">
            <span class="pk-badge" :class="{ 'is-login': contact.warnings.length }">{{ contact.status }}</span>
            <span class="date-line">发布 {{ contact.sourceDate || '未标日期' }} · 核对 {{ contact.checkedAt }}</span>
            <span class="card-links">
              <a v-if="contact.sources[0]?.url" :href="contact.sources[0].url" :title="contact.sources[0].title" :aria-label="contact.sources[0].title" target="_blank" rel="noopener noreferrer">来源 ↗</a>
              <router-link :to="detailLocation(contact.id)" :aria-label="`查看${contact.department} ${contact.office}的范围与全部来源`">详情<el-icon aria-hidden="true"><Right /></el-icon></router-link>
            </span>
          </footer>
        </article>
      </div>
      <section v-if="result.gaps.length" class="pk-card pk-card--soft gap-panel"><h3 class="pk-h2">资料缺口与冲突说明</h3><article v-for="gap in result.gaps" :key="gap.unit"><h4>{{ gap.unit }} · {{ gap.status }}</h4><p>{{ gap.finding }}</p><p>{{ gap.action }}</p><a v-if="gap.url" :href="gap.url" target="_blank" rel="noopener noreferrer">查看来源入口 ↗</a><p class="date-line">资料核对：{{ gap.checkedAt }}</p></article></section>
      <nav v-if="result.total > result.limit" class="pagination" aria-label="结果分页"><button data-cpu-button="surface" class="chip" type="button" :disabled="result.offset === 0" @click="page(-1)">上一页</button><span>{{ Math.floor(result.offset / result.limit) + 1 }} / {{ Math.ceil(result.total / result.limit) }}</span><button data-cpu-button="surface" class="chip" type="button" :disabled="result.offset + result.limit >= result.total" @click="page(1)">下一页</button></nav>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, Close, CopyDocument, Filter, InfoFilled, Location, Phone, PhoneFilled, Right, Search } from "@element-plus/icons-vue";
import "@/styles/page-kit.css";
import { ElMessage } from "element-plus";
import { departmentContactsApi, type DepartmentContact, type DepartmentQueryResult } from "@/api/departmentContacts";
import { getToken } from "@/api/request";
const route = useRoute();
const router = useRouter();
const form = reactive({ q: "", category: "", campus: "", includeSpecial: false });
const result = ref<DepartmentQueryResult | null>(null);
const detail = ref<DepartmentContact | null>(null);
const error = ref("");
const detailError = ref("");
const loading = ref(false);
const aiLoading = ref(false);
const detailPanel = ref<HTMLElement | null>(null);
const showFilters = ref(false);
const activeFilterCount = computed(() => Number(Boolean(form.category)) + Number(Boolean(form.campus)) + Number(form.includeSpecial));
let requestVersion = 0;
let controller: AbortController | undefined;
let inFlightKey = "";
let semanticCache: { key: string; value: DepartmentQueryResult } | undefined;
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function errorText(value: unknown) { return (value as { response?: { data?: { message?: string } } })?.response?.data?.message || "请检查网络后重试。"; }
async function load() {
  const key = JSON.stringify([text(route.query.q).trim(), text(route.query.category), text(route.query.campus), route.query.includeSpecial === "1"]);
  if (loading.value && key === inFlightKey && !route.query.id) return;
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal;
  inFlightKey = key;
  const version = ++requestVersion;
  form.q = text(route.query.q).slice(0, 160); form.category = text(route.query.category); form.campus = text(route.query.campus); form.includeSpecial = route.query.includeSpecial === "1";
  if (form.category || form.campus || form.includeSpecial) showFilters.value = true;
  loading.value = true; aiLoading.value = false; error.value = ""; detailError.value = ""; detail.value = null; result.value = null;
  const id = text(route.query.id);
  const rawOffset = Number(text(route.query.offset));
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 && rawOffset <= 10000 ? rawOffset : 0;
  const [list, selected] = await Promise.allSettled([
    (async () => {
      if (semanticCache?.key === key) return semanticCache.value;
      const direct = await departmentContactsApi.query({ q: form.q, category: form.category, campus: form.campus, includeSpecial: form.includeSpecial ? "1" : "0", offset }, { signal });
      if (!form.q.trim() || direct.exactMatch) return direct;
      if (!getToken()) throw new Error("请登录后使用拾间AI理解口语需求；也可以输入完整部门名或号码直接查询。");
      if (version !== requestVersion || signal.aborted) throw new Error("已取消");
      aiLoading.value = true;
      const semantic = await departmentContactsApi.semantic({ q: form.q, category: form.category || undefined, campus: form.campus || undefined, includeSpecial: form.includeSpecial }, { signal });
      if (version === requestVersion) semanticCache = { key, value: semantic };
      return semantic;
    })(),
    id ? departmentContactsApi.detail(id) : Promise.resolve(null),
  ]);
  if (version !== requestVersion) return;
  if (list.status === "fulfilled") result.value = list.value;
  else { result.value = null; error.value = list.reason instanceof Error && !('response' in list.reason) ? list.reason.message : errorText(list.reason); }
  if (selected.status === "fulfilled") detail.value = selected.value;
  else detailError.value = errorText(selected.reason);
  loading.value = false; aiLoading.value = false; inFlightKey = "";
  if (detail.value) { await nextTick(); detailPanel.value?.focus(); }
}
watch(() => route.query, load, { immediate: true });
function cancelSearch() { requestVersion++; controller?.abort(); loading.value = false; aiLoading.value = false; inFlightKey = ""; result.value = null; error.value = "已取消查询，可修改需求后重新查询。"; }
onBeforeUnmount(() => { requestVersion++; controller?.abort(); });
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
.contacts-page { padding-bottom: max(8px, env(safe-area-inset-bottom)); font-size: 14px; line-height: 1.55; }
.contacts-page > * { min-width: 0; }
.contacts-page :is(section, details, aside, article) :is(h2, h3, h4, p),
.contacts-page > p { margin: 0; }
.contacts-page a:not(.pk-back):not(.pk-pill) { color: var(--cpu-primary); text-decoration: none; overflow-wrap: anywhere; }
.contacts-page :is(input, select):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

/* 小号操作：复制、拨打、筛选、分页都用同一种胶囊。 */
.chip {
  display: inline-flex;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.contacts-page a.chip:not(.chip--primary) { color: var(--cpu-text-secondary); }
.chip:active { background: var(--cpu-surface-soft); }
.chip:disabled { opacity: .45; cursor: default; }
.contacts-page a.chip.chip--primary { border-color: transparent; background: var(--cpu-primary-soft); color: var(--cpu-primary); }
.chip .el-icon { font-size: 14px; }

.search-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.search-input {
  display: flex;
  min-width: 0;
  height: 46px;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 13px;
  background: var(--cpu-surface-soft);
  transition: border-color .15s;
}
.search-input:focus-within { border-color: var(--cpu-primary); }
.search-input > .el-icon { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: 17px; }
.search-input input {
  min-width: 0;
  height: 100%;
  flex: 1;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--cpu-text);
  font: inherit;
  /* 16px 以下 iOS 会在聚焦时放大页面 */
  font-size: 16px;
  appearance: none;
}
.contacts-page .search-input input:focus-visible { outline: 0; }
.search-input input::placeholder { color: var(--cpu-text-muted); }
.search-input input::-webkit-search-cancel-button { display: none; }
.search-submit { min-width: 76px; min-height: 46px; border-radius: 13px !important; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.query-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.quick-queries { display: flex; min-width: 0; flex: 1; flex-wrap: wrap; gap: 8px; }
.filter-toggle[aria-expanded="true"] { border-color: var(--cpu-primary); color: var(--cpu-primary); }
.filter-count { display: grid; min-width: 16px; height: 16px; place-items: center; border-radius: 50%; background: var(--cpu-primary); color: var(--cpu-button-on-primary); font-size: 10px; }
.filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--cpu-border-soft); }
.filters > label { display: grid; min-width: 0; gap: 4px; color: var(--cpu-text-secondary); font-size: 12px; }
.filters select { width: 100%; min-width: 0; min-height: 40px; padding: 0 10px; border: 1px solid var(--cpu-border-soft); border-radius: 10px; background: var(--cpu-card); color: var(--cpu-text); font: inherit; font-size: 14px; }
.filters .special-filter { display: flex; grid-column: 1 / -1; align-items: center; gap: 8px; min-height: 36px; font-size: 13px; }
.special-filter input { width: 18px; height: 18px; accent-color: var(--cpu-primary); }
.filters > .chip { justify-self: start; }
.contacts-page .search-help { margin-top: 10px; color: var(--cpu-text-muted); font-size: 11px; line-height: 1.6; }

.notice { padding: 0 2px; color: var(--cpu-text-secondary); font-size: 12px; }
.notice summary { display: flex; min-height: 30px; align-items: center; gap: 5px; cursor: pointer; list-style: none; }
.notice summary::-webkit-details-marker { display: none; }
.notice-arrow { margin-left: auto; transition: transform .15s; }
.notice[open] .notice-arrow { transform: rotate(90deg); }
.contacts-page .notice p { margin-top: 6px; padding: 12px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-surface-soft); font-size: 13px; line-height: 1.7; }

.state-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--cpu-text-secondary); font-size: 13px; }
.empty-panel { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.clarification { padding: 12px 14px; border: 1px solid var(--cpu-border-soft); border-left: 3px solid var(--cpu-primary); border-radius: 12px; background: var(--cpu-surface-soft); font-size: 13px; }
.contacts-page .clarification p { margin-top: 4px; }
.clarification > p:last-child { color: var(--cpu-text-secondary); font-size: 12px; }

.results-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; padding: 4px 2px 0; }
.results-head h2 span { margin-left: 4px; color: var(--cpu-text-muted); font-size: 13px; font-weight: 400; }
.results-head > span,
.meta-line,
.date-line { color: var(--cpu-text-muted); font-size: 12px; }
.results-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; }

.contact-card { display: flex; flex-direction: column; gap: 8px; padding: 16px; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.card-head > div { min-width: 0; }
.card-head h3 { font-size: 16px; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.contacts-page .office { margin-top: 2px; color: var(--cpu-text-secondary); font-size: 13px; font-weight: 550; }
.campus-badge { gap: 3px; }
.campus-badge .el-icon { font-size: 12px; }
.scope { color: var(--cpu-text-secondary); font-size: 13px; overflow-wrap: anywhere; }
.warning-text { padding: 6px 10px; border-radius: 8px; background: color-mix(in srgb, var(--cpu-gold) 11%, var(--cpu-card)); color: var(--cpu-text-secondary); font-size: 12px; }
.record-note { color: var(--cpu-text-secondary); font-size: 12px; }
.record-note summary { min-height: 24px; cursor: pointer; }
.contacts-page .record-note p { margin-top: 4px; }

.phone-row { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; background: var(--cpu-surface-soft); overflow-wrap: anywhere; }
.phone-row :is(strong, span) { min-width: 0; flex: 1; }
.phone-row strong { flex: 1 0 auto; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.01em; white-space: nowrap; }
.card-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--cpu-border-soft); }
.card-links { display: inline-flex; gap: 14px; margin-left: auto; font-size: 13px; font-weight: 550; }
.card-links a { display: inline-flex; min-height: 30px; align-items: center; gap: 2px; }

.detail-panel { display: flex; flex-direction: column; gap: 10px; border-color: color-mix(in srgb, var(--cpu-primary) 26%, var(--cpu-border-soft)); }
.detail-panel:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.detail-head > div { min-width: 0; }
.contacts-page .detail-panel h3 { margin-top: 6px; font-size: 14px; font-weight: 650; }
.detail-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin: 2px 0 0; }
.detail-fields > div { padding: 10px 12px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; }
.detail-fields dt { color: var(--cpu-text-muted); font-size: 12px; }
.detail-fields dd { margin: 2px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.source-list { margin: 0; padding-left: 18px; font-size: 13px; }
.source-list li + li { margin-top: 10px; }
.source-list p { color: var(--cpu-text-muted); font-size: 12px; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.contacts-page .gap-panel h4 { margin-top: 10px; font-size: 13px; }
.contacts-page .gap-panel p { margin-top: 4px; color: var(--cpu-text-secondary); font-size: 13px; }
.gap-panel article + article { margin-top: 12px; padding-top: 4px; border-top: 1px solid var(--cpu-border-soft); }
.pagination { display: flex; align-items: center; justify-content: center; gap: 14px; color: var(--cpu-text-secondary); font-size: 13px; font-variant-numeric: tabular-nums; }

@media (max-width: 640px) {
  .chip { min-height: 36px; }
  .detail-head { flex-direction: column; }
  .card-footer .date-line { order: 3; flex-basis: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .notice-arrow,
  .search-input { transition: none; }
}
</style>
