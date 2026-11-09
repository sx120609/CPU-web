<template>
  <div class="cl">
    <section class="cl-card cl-search" aria-label="查询物质">
      <form class="cl-form" role="search" @submit.prevent="submit()">
        <div class="cl-input-wrap">
          <input
            ref="inputRef"
            v-model="query"
            class="cl-input"
            type="search"
            maxlength="120"
            autocomplete="off"
            spellcheck="false"
            autocapitalize="off"
            enterkeyhint="search"
            placeholder="中文名、英文名、CAS 号或 CID"
            aria-label="物质名称、CAS 号或 CID"
            :aria-expanded="showSuggestions"
            aria-controls="cl-suggest"
            @input="onInput"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.esc="suggestions = []"
            @blur="hideSoon"
          />
          <ul v-if="showSuggestions" id="cl-suggest" class="cl-suggest" role="listbox">
            <li v-for="(item, index) in suggestions" :key="item.cid" role="option" :aria-selected="index === active">
              <button type="button" :class="{ 'is-active': index === active }" @mousedown.prevent="pick(item)">
                <b>{{ item.zh }}</b><span>{{ item.en }}</span><small v-if="item.cas">{{ item.cas }}</small>
              </button>
            </li>
          </ul>
        </div>
        <button class="cl-submit" type="submit" :disabled="loading || !query.trim()">{{ loading ? "查询中…" : "查询" }}</button>
      </form>
      <div class="cl-examples">
        <span>试试</span>
        <button v-for="example in examples" :key="example" type="button" @click="submit(example)">{{ example }}</button>
      </div>
    </section>

    <section v-if="error" class="cl-card cl-state is-error" role="alert">
      <p>{{ error }}</p>
      <button type="button" class="cl-link" @click="submit(lastQuery)">重试</button>
    </section>
    <section v-else-if="loading && !detail" class="cl-card cl-state" role="status">正在向 PubChem 查询，首次查询一种物质通常要几秒…</section>
    <section v-else-if="message" class="cl-card cl-state" role="status"><p>{{ message }}</p></section>

    <!-- 没有确定结果时，候选放在最前面让人挑；有结果时放到结果后面，不把结果往下推。 -->
    <section v-if="otherCandidates.length" class="cl-card cl-candidates" :style="{ order: detail ? 1 : 0 }" aria-label="物质库中的其他匹配">
      <h2 class="cl-h2">{{ detail ? "物质库里的相近条目" : "物质库里的匹配" }}</h2>
      <div class="cl-chips">
        <button v-for="item in otherCandidates" :key="item.cid" type="button" class="cl-chip" @click="openCid(item)">
          {{ item.zh }}<small>{{ item.en }}</small>
        </button>
      </div>
    </section>

    <template v-if="detail">
      <section class="cl-card cl-hero" :aria-busy="loading">
        <div class="cl-hero-main">
          <h2 class="cl-name">{{ detail.zh || detail.title }}</h2>
          <p class="cl-sub">
            <span v-if="detail.zh">{{ detail.title }}</span>
            <span v-if="detail.aliases.length">又名 {{ detail.aliases.join("、") }}</span>
          </p>
          <p v-if="detail.iupacName" class="cl-iupac">IUPAC：{{ detail.iupacName }}</p>
        </div>
        <img class="cl-structure" :src="structureUrl" :alt="`${detail.title} 的二维结构式`" width="180" height="180" loading="eager" data-image-eager="true" @error="structureFailed = true" v-show="!structureFailed" />
      </section>

      <section class="cl-card">
        <h2 class="cl-h2">标识与计算性质</h2>
        <dl class="cl-grid">
          <div v-for="item in identity" :key="item.label" class="cl-cell">
            <dt>{{ item.label }}</dt>
            <dd>
              <span v-if="item.formula" class="cl-value"><template v-for="(part, index) in formulaParts(item.value)" :key="index"><sub v-if="part.sub">{{ part.text }}</sub><template v-else>{{ part.text }}</template></template></span>
              <span v-else class="cl-value" :class="{ 'is-mono': item.mono }">{{ item.value }}</span>
              <button v-if="item.copy" type="button" class="cl-copy" :aria-label="`复制${item.label}`" @click="copy(item.copy, item.label)">复制</button>
            </dd>
          </div>
        </dl>
        <div v-if="detail.smiles" class="cl-smiles">
          <dt>SMILES</dt>
          <dd><code>{{ detail.smiles }}</code><button type="button" class="cl-copy" aria-label="复制 SMILES" @click="copy(detail.smiles, 'SMILES')">复制</button></dd>
        </div>
      </section>

      <section class="cl-card">
        <h2 class="cl-h2">实验理化数据</h2>
        <p v-if="!experimentalRows.length" class="cl-muted">PubChem 没有收录这个物质的实验数据。</p>
        <dl v-else class="cl-exp">
          <div v-for="row in experimentalRows" :key="row.key" class="cl-exp-row">
            <dt>{{ row.label }}</dt>
            <dd>
              <p v-for="(item, index) in row.values" :key="index">{{ item.value }}<small v-if="item.source">{{ item.source }}</small></p>
            </dd>
          </div>
        </dl>
      </section>

      <section class="cl-card">
        <h2 class="cl-h2">GHS 危险性</h2>
        <p v-if="!detail.ghs.signal && !detail.ghs.hazards.length" class="cl-muted">PubChem 没有这个物质的 GHS 分类信息，不代表它没有危险，请以试剂瓶标签和 SDS 为准。</p>
        <template v-else>
          <div class="cl-ghs-head">
            <span v-if="detail.ghs.signal" class="cl-signal" :class="{ 'is-danger': detail.ghs.signal === 'Danger' }">{{ signalLabel }}</span>
            <span v-for="item in detail.ghs.pictograms" :key="item.code" class="cl-picto">{{ item.code }} {{ pictogramLabel(item.code) }}</span>
          </div>
          <ul class="cl-hazards">
            <li v-for="item in detail.ghs.hazards" :key="item.code"><b>{{ item.code }}</b>{{ item.text }}</li>
          </ul>
          <p class="cl-muted">汇总自 PubChem 收录的各方申报，不同来源的分类可能不同，使用前请核对 SDS。</p>
        </template>
      </section>

      <section v-if="detail.synonyms.length" class="cl-card">
        <h2 class="cl-h2">其他名称</h2>
        <p class="cl-synonyms">{{ detail.synonyms.join(" · ") }}</p>
      </section>

      <p v-if="detail.partial" class="cl-note" role="status">部分数据这次没有取到，稍后再查可能会补全。</p>
    </template>

    <footer class="cl-foot">
      <p>
        数据来自本地物质库<template v-if="meta">（{{ meta.count ?? "" }} 条，{{ meta.updatedAt }} 更新）</template>和美国 NCBI 的
        <a :href="detail?.pubchemUrl || 'https://pubchem.ncbi.nlm.nih.gov/'" target="_blank" rel="noopener noreferrer">PubChem</a>
        公开数据库，仅供学习参考，不能作为实验或生产的判定依据。
      </p>
      <p>
        工具原型「化合索检器」由惟省同学开发，以 MIT 协议开源于
        <a href="https://gitee.com/a-quiet-province/pubchem-compound-fetcher" target="_blank" rel="noopener noreferrer">Gitee</a>。
      </p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { compoundLookupApi, type CompoundDetail, type CompoundLibraryMeta, type ExperimentalKey, type LibraryCompound } from "@/api/compoundLookup";

const route = useRoute();
const router = useRouter();
const examples = ["阿司匹林", "50-78-2", "caffeine", "二氯甲烷"];

const EXPERIMENTAL_LABELS: Array<[ExperimentalKey, string]> = [
  ["physicalDescription", "性状"],
  ["meltingPoint", "熔点"],
  ["boilingPoint", "沸点"],
  ["density", "密度"],
  ["solubility", "溶解度"],
  ["pka", "解离常数 pKa"],
  ["logP", "实验 logP"],
  ["flashPoint", "闪点"],
];
const PICTOGRAMS: Record<string, string> = {
  GHS01: "爆炸物", GHS02: "易燃", GHS03: "氧化性", GHS04: "压缩气体", GHS05: "腐蚀性",
  GHS06: "急性毒性", GHS07: "刺激性/有害", GHS08: "健康危害", GHS09: "环境危害",
};

const inputRef = ref<HTMLInputElement>();
const query = ref("");
const lastQuery = ref("");
const loading = ref(false);
const error = ref("");
const message = ref<string | null>(null);
const detail = ref<CompoundDetail | null>(null);
const candidates = ref<LibraryCompound[]>([]);
const suggestions = ref<LibraryCompound[]>([]);
const active = ref(-1);
const meta = ref<CompoundLibraryMeta | null>(null);
const structureFailed = ref(false);
let suggestTimer = 0;
let hideTimer = 0;
let requestSeq = 0;

const showSuggestions = computed(() => suggestions.value.length > 0);
const otherCandidates = computed(() => candidates.value.filter((item) => item.cid !== detail.value?.cid));
// 结构图经本站转发并缓存：各端（含校园网、App 内 WebView）不必直连 PubChem。
const structureUrl = computed(() => compoundLookupApi.structureUrl(detail.value?.cid ?? 0));
const signalLabel = computed(() => ({ Danger: "危险", Warning: "警告" } as Record<string, string>)[detail.value?.ghs.signal ?? ""] ?? detail.value?.ghs.signal);

const pictogramLabel = (code: string) => PICTOGRAMS[code] ?? "";
const formulaParts = (formula: string) => (formula.match(/\d+|\D+/gu) ?? []).map((text) => ({ text, sub: /^\d/u.test(text) }));

const identity = computed(() => {
  const d = detail.value;
  if (!d) return [];
  const rows: Array<{ label: string; value: string; formula?: boolean; copy?: string; mono?: boolean }> = [];
  if (d.formula) rows.push({ label: "分子式", value: d.formula, formula: true, copy: d.formula });
  if (d.molecularWeight) rows.push({ label: "分子量", value: `${d.molecularWeight} g/mol`, copy: d.molecularWeight });
  if (d.cas) rows.push({ label: "CAS 号", value: d.cas, copy: d.cas, mono: true });
  rows.push({ label: "PubChem CID", value: String(d.cid), copy: String(d.cid), mono: true });
  if (d.exactMass) rows.push({ label: "精确质量", value: d.exactMass });
  if (d.xlogp !== null) rows.push({ label: "XLogP3（计算）", value: String(d.xlogp) });
  if (d.tpsa !== null) rows.push({ label: "TPSA", value: `${d.tpsa} Å²` });
  if (d.hBondDonors !== null && d.hBondAcceptors !== null) rows.push({ label: "氢键供体 / 受体", value: `${d.hBondDonors} / ${d.hBondAcceptors}` });
  if (d.rotatableBonds !== null) rows.push({ label: "可旋转键", value: String(d.rotatableBonds) });
  return rows;
});

const experimentalRows = computed(() => {
  const d = detail.value;
  if (!d) return [];
  return EXPERIMENTAL_LABELS.map(([key, label]) => ({ key, label, values: d.experimental[key] ?? [] })).filter((row) => row.values.length);
});

function errorText(err: unknown) {
  const text = (err as { message?: string })?.message;
  return text && !/^Request failed|Network Error/u.test(text) ? text : "查询失败，请检查网络后重试";
}

function syncUrl(value: string) {
  if (route.query.q === value) return;
  void router.replace({ query: { ...route.query, q: value || undefined } });
}

async function submit(value = query.value) {
  const text = value.trim();
  if (!text) return;
  query.value = text;
  lastQuery.value = text;
  suggestions.value = [];
  // 手机上收起软键盘，结果不被挡住。
  if (window.matchMedia?.("(pointer: coarse)").matches) inputRef.value?.blur();
  const seq = ++requestSeq;
  loading.value = true;
  error.value = "";
  message.value = null;
  syncUrl(text);
  try {
    const result = await compoundLookupApi.lookup(text);
    if (seq !== requestSeq) return;
    detail.value = result.detail;
    structureFailed.value = false;
    candidates.value = result.candidates;
    message.value = result.message;
  } catch (err) {
    if (seq !== requestSeq) return;
    error.value = errorText(err);
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

async function openCid(item: LibraryCompound) {
  query.value = item.zh;
  lastQuery.value = item.zh;
  suggestions.value = [];
  const seq = ++requestSeq;
  loading.value = true;
  error.value = "";
  message.value = null;
  syncUrl(item.zh);
  try {
    const result = await compoundLookupApi.byCid(item.cid);
    if (seq !== requestSeq) return;
    detail.value = result;
    structureFailed.value = false;
  } catch (err) {
    if (seq !== requestSeq) return;
    error.value = errorText(err);
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

function onInput() {
  window.clearTimeout(suggestTimer);
  active.value = -1;
  const text = query.value.trim();
  if (!text) { suggestions.value = []; return; }
  suggestTimer = window.setTimeout(async () => {
    try {
      const list = await compoundLookupApi.suggest(text);
      if (query.value.trim() === text && document.activeElement === inputRef.value) suggestions.value = list;
    } catch { suggestions.value = []; }
  }, 160);
}

function move(step: number) {
  if (!suggestions.value.length) return;
  active.value = (active.value + step + suggestions.value.length) % suggestions.value.length;
  query.value = suggestions.value[active.value].zh;
}

function pick(item: LibraryCompound) {
  void openCid(item).then(() => { candidates.value = []; });
}

function hideSoon() {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => { suggestions.value = []; }, 120);
}

// 安卓／鸿蒙／iOS 壳的 WebView 里 navigator.clipboard 可能不存在或被拒，退回 execCommand。
function legacyCopy(text: string) {
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  try {
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } finally {
    input.remove();
  }
}

async function copy(text: string, label: string) {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch { /* 走下面的兜底 */ }
  if (!copied) {
    try { copied = legacyCopy(text); } catch { copied = false; }
  }
  if (copied) ElMessage.success(`已复制${label}`);
  else ElMessage.warning("复制失败，请长按文字手动复制");
}

onMounted(() => {
  compoundLookupApi.meta().then((value) => { meta.value = value; }).catch(() => undefined);
  const initial = typeof route.query.q === "string" ? route.query.q : "";
  if (initial) void submit(initial);
});
onBeforeUnmount(() => {
  window.clearTimeout(suggestTimer);
  window.clearTimeout(hideTimer);
});
</script>

<style scoped>
.cl { display: grid; gap: 12px; }
.cl-card {
  padding: 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  min-width: 0;
}
.cl-h2 { margin: 0 0 10px; color: var(--cpu-text); font-size: var(--cpu-fs-l); font-weight: 700; }
.cl-muted { margin: 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }

.cl-form { display: flex; gap: 8px; }
.cl-input-wrap { position: relative; flex: 1; min-width: 0; }
.cl-input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface);
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  box-sizing: border-box;
}
.cl-input:focus { outline: 2px solid var(--cpu-primary); outline-offset: -1px; border-color: transparent; }
.cl-submit {
  flex: none;
  height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-primary-dark);
  color: #fff;
  font-size: var(--cpu-fs-m);
  font-weight: 600;
  cursor: pointer;
}
.cl-submit:disabled { opacity: 0.55; cursor: default; }
.cl-suggest {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}
.cl-suggest button {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--cpu-radius-s);
  background: none;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  text-align: left;
  cursor: pointer;
}
.cl-suggest button.is-active, .cl-suggest button:hover { background: var(--cpu-surface-soft); }
.cl-suggest b { flex: none; white-space: nowrap; }
.cl-suggest span { flex: 1; min-width: 0; overflow: hidden; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); white-space: nowrap; text-overflow: ellipsis; }
.cl-suggest small { flex: none; margin-left: auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-variant-numeric: tabular-nums; }

.cl-examples { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.cl-examples button, .cl-chip {
  padding: 3px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.cl-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cl-chip small { margin-left: 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }

.cl-state { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-m); }
.cl-state p { margin: 0; }
.cl-state.is-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--cpu-danger); }
.cl-link { border: 0; background: none; color: var(--cpu-primary-dark); font-size: var(--cpu-fs-m); cursor: pointer; }

.cl-hero { display: flex; align-items: center; gap: 16px; }
.cl-hero-main { flex: 1; min-width: 0; }
.cl-name { margin: 0; color: var(--cpu-text); font-size: var(--cpu-fs-xxl); font-weight: 700; overflow-wrap: anywhere; }
.cl-sub { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-m); }
.cl-iupac { margin: 6px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); overflow-wrap: anywhere; }
.cl-structure { flex: none; width: 140px; height: 140px; border-radius: var(--cpu-radius-m); background: #fff; object-fit: contain; }

.cl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin: 0; }
.cl-cell { padding: 8px 10px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); min-width: 0; }
.cl-cell dt, .cl-smiles dt { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.cl-cell dd, .cl-smiles dd { display: flex; align-items: center; gap: 6px; margin: 2px 0 0; color: var(--cpu-text); font-size: var(--cpu-fs-m); min-width: 0; }
.cl-value { overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.cl-smiles code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Roboto Mono", "Courier New", monospace; }
.cl-copy { flex: none; margin-left: auto; padding: 0 4px; border: 0; background: none; color: var(--cpu-primary-dark); font-size: var(--cpu-fs-xs); cursor: pointer; }
.cl-smiles { margin-top: 8px; padding: 8px 10px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); }
.cl-smiles code { font-size: var(--cpu-fs-s); overflow-wrap: anywhere; word-break: break-all; }

.cl-exp { margin: 0; }
.cl-exp-row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; padding: 8px 0; border-top: 1px solid var(--cpu-border-soft); }
.cl-exp-row:first-child { border-top: 0; padding-top: 0; }
.cl-exp-row dt { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); font-weight: 600; }
.cl-exp-row dd { margin: 0; }
.cl-exp-row p { margin: 0 0 4px; color: var(--cpu-text); font-size: var(--cpu-fs-s); line-height: 1.5; overflow-wrap: anywhere; }
.cl-exp-row small { display: block; overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); white-space: nowrap; text-overflow: ellipsis; }

.cl-ghs-head { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.cl-signal, .cl-picto { padding: 2px 10px; border-radius: var(--cpu-radius-pill); font-size: var(--cpu-fs-s); font-weight: 600; }
.cl-signal { background: #fff4e0; color: #9a5b00; }
.cl-signal.is-danger { background: var(--cpu-danger-soft); color: var(--cpu-danger); }
.cl-picto { background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-weight: 500; }
.cl-hazards { display: grid; gap: 4px; margin: 0 0 8px; padding: 0; list-style: none; color: var(--cpu-text); font-size: var(--cpu-fs-m); }
.cl-hazards b { display: inline-block; min-width: 46px; margin-right: 6px; font-variant-numeric: tabular-nums; }
.cl-synonyms { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; overflow-wrap: anywhere; }
.cl-note { margin: 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }

/* 不能写成 :global(html[...]) .cl-signal：Vue 会把整条选择器当成 :global 里的部分，规则落到 <html> 上，深色模式下整页画布变红。 */
html[data-theme="dark"] .cl-signal { background: rgb(217 119 6 / 18%); color: #fbbf24; }
html[data-theme="dark"] .cl-signal.is-danger { background: var(--cpu-danger-soft); color: var(--cpu-danger); }
.cl-foot { order: 2; padding: 4px 4px 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.7; }
.cl-foot p { margin: 0; }
.cl-foot a { color: var(--cpu-primary-dark); }

@media (max-width: 640px) {
  .cl-card { padding: 12px; }
  .cl-hero { flex-direction: column; align-items: stretch; gap: 12px; }
  .cl-structure { align-self: center; width: 150px; height: 150px; }
  .cl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cl-exp-row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}
</style>
