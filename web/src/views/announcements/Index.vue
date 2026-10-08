<template>
  <div class="announce-page">
    <SiteSearchBar placeholder="搜索帖子或校园服务" />

    <header class="announce-head">
      <div>
        <h1>校园公告</h1>
        <p>学校各部门发布的通知，自动同步到这里</p>
      </div>
      <button v-if="boards.length" data-cpu-button="text" type="button" class="announce-choose" @click="openChooser">
        <el-icon aria-hidden="true"><Setting /></el-icon>选择部门
      </button>
    </header>

    <nav v-if="boards.length" class="announce-tabs" aria-label="公告来源">
      <button data-cpu-button="option" type="button" :class="{ active: !activeSlug }" @click="selectSource('')">全部</button>
      <button
        data-cpu-button="option"
        v-for="b in tabBoards"
        :key="b.slug"
        type="button"
        :class="{ active: activeSlug === b.slug }"
        @click="selectSource(b.slug)"
      >
        {{ b.name }}
      </button>
    </nav>

    <p v-if="activeBoard" class="announce-source">
      <span>{{ sourceLine(activeBoard) }}</span>
      <a v-if="activeBoard.feedSource?.homepage" :href="activeBoard.feedSource.homepage" target="_blank" rel="noopener noreferrer">
        原网站<el-icon aria-hidden="true"><TopRight /></el-icon>
      </a>
    </p>

    <section class="announce-list" :aria-busy="loading">
      <div v-if="error && !items.length" class="announce-state">
        <span>{{ error }}</span>
        <el-button type="primary" plain @click="reload">重试</el-button>
      </div>
      <div v-else-if="loading && !items.length" class="announce-state" role="status">正在加载公告…</div>
      <div v-else-if="!items.length" class="announce-state">{{ activeSlug ? "这个部门还没有公告" : "所选部门还没有公告" }}</div>
      <template v-else>
        <router-link v-for="t in items" :key="t.id" :to="`/forum/topic/${t.id}`" class="announce-item">
          <b>{{ t.title }}</b>
          <span class="announce-item-foot">
            <span v-if="!activeSlug && t.board?.name">{{ t.board.name }}</span>
            <span v-if="!activeSlug && t.board?.name" aria-hidden="true">·</span>
            <time :datetime="t.createdAt">{{ fmtRelative(t.createdAt) }}</time>
            <em v-if="isFresh(t.createdAt)">新</em>
          </span>
        </router-link>
      </template>
    </section>

    <div v-if="items.length" class="announce-more">
      <span v-if="error">{{ error }}<button data-cpu-button="text" type="button" @click="loadMore">重试</button></span>
      <el-button v-else-if="hasMore" :loading="loading" @click="loadMore">加载更多</el-button>
      <span v-else>已经到底了</span>
    </div>

    <el-dialog
      :model-value="introOpen"
      title="校园公告更新了"
      width="min(440px, calc(100vw - 24px))"
      class="announce-intro"
      align-center
      append-to-body
      @close="dismissIntro"
    >
      <ol class="intro-items">
        <li>
          <strong>来源更全</strong>
          <p>除了教务处、学工处，现在还同步学校其他部门和各学院发布的通知。</p>
        </li>
        <li>
          <strong>只看你关心的</strong>
          <p>点右上角“选择部门”，勾选想看的部门和学院，“全部”和上方的标签就只显示它们。</p>
        </li>
        <li>
          <strong>学院通知要自己勾</strong>
          <p>学院默认不显示。个人资料里填了学院的，会自动带上自己学院的通知。</p>
        </li>
      </ol>
      <template #footer>
        <el-button @click="dismissIntro">知道了</el-button>
        <el-button type="primary" @click="dismissIntro(); openChooser()">去选择部门</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="chooserOpen" title="选择部门" width="min(440px, calc(100vw - 24px))" class="announce-chooser" append-to-body>
      <p class="chooser-hint">勾选的部门会出现在“全部”和上方的标签里。{{ auth.isLoggedIn ? "" : "登录后可以在各设备间同步。" }}</p>
      <div class="chooser-list">
        <template v-for="group in chooserGroups" :key="group.title">
          <h3 v-if="chooserGroups.length > 1" class="chooser-group">{{ group.title }}</h3>
          <label v-for="b in group.boards" :key="b.slug" class="chooser-row">
            <el-checkbox :model-value="draft.includes(b.slug)" @change="toggleDraft(b.slug)" />
            <span class="chooser-name">{{ b.name }}</span>
            <span class="chooser-count">{{ b.topicCount }} 条</span>
          </label>
        </template>
      </div>
      <template #footer>
        <div class="chooser-foot">
          <button data-cpu-button="text" type="button" :disabled="saving" @click="draft = defaultSlugs.slice()">恢复默认</button>
          <span>
            <el-button :disabled="saving" @click="chooserOpen = false">取消</el-button>
            <el-button type="primary" :loading="saving" :disabled="!draft.length" @click="saveChooser">保存</el-button>
          </span>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
// 从帖子返回时列表要原样还在（浏览器才能回到原来的滚动位置），所以已加载的内容留在模块里，十分钟内直接复用。
type ListSnapshot = { items: Topic[]; total: number; page: number; savedAt: number };
const SNAPSHOT_MS = 10 * 60 * 1000;
const listSnapshots = new Map<string, ListSnapshot>();
let boardsSnapshot: Board[] = [];

// 用户选的部门只记相对默认集合的增减，新出现的部门仍按默认处理。未登录时只存在本机。
type SourceOverrides = { include: string[]; exclude: string[] };
const OVERRIDES_KEY = "cpu-announcement-sources-v1";

function readLocalOverrides(): SourceOverrides | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "null");
    if (!parsed || !Array.isArray(parsed.include) || !Array.isArray(parsed.exclude)) return null;
    return { include: parsed.include.map(String), exclude: parsed.exclude.map(String) };
  } catch {
    return null;
  }
}

// 新功能说明只弹一次；用户已经自己选过部门的不用再讲。
const INTRO_KEY = "cpu-announcement-intro-v1";
let introSeen = false;

function shouldShowIntro() {
  if (introSeen) return false;
  try {
    return localStorage.getItem(INTRO_KEY) !== "1" && !localStorage.getItem(OVERRIDES_KEY);
  } catch {
    return false;
  }
}

function writeLocalOverrides(overrides: SourceOverrides | null) {
  try {
    if (overrides) localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    else localStorage.removeItem(OVERRIDES_KEY);
  } catch {
    // 存不下只影响下次打开时的初始选择。
  }
}
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Setting, TopRight } from "@element-plus/icons-vue";
import SiteSearchBar from "@/components/search/SiteSearchBar.vue";
import { announcementsApi } from "@/api/announcements";
import { boardApi, type Board } from "@/api/board";
import { topicApi, type Topic } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";

const PAGE_SIZE = 20;
const FRESH_MS = 2 * 24 * 60 * 60 * 1000;
const hiddenAnnouncementSlugs = new Set(["xinli-notice"]);

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const overrides = ref<SourceOverrides | null>(readLocalOverrides());
// 登录用户的默认部门由服务器给（会加上自己学院）；没取到时按板块自身的默认值。
const accountDefaults = ref<Set<string> | null>(null);
const chooserOpen = ref(false);
const draft = ref<string[]>([]);
const saving = ref(false);
const introOpen = ref(false);
const allBoards = ref<Board[]>(boardsSnapshot);
const items = ref<Topic[]>([]);
const total = ref(0);
const page = ref(0);
const loading = ref(false);
const error = ref("");
let loadSeq = 0;
let ready = false;

const boards = computed(() => allBoards.value.filter(isVisibleSource));
const activeSlug = computed(() => {
  const slug = typeof route.query.source === "string" ? route.query.source : "";
  return boards.value.some((b) => b.slug === slug) ? slug : "";
});
const activeBoard = computed(() => boards.value.find((b) => b.slug === activeSlug.value) || null);
const defaultSlugs = computed(() => boards.value.filter(isDefaultSource).map((b) => b.slug));
const selectedSlugs = computed(() => {
  const include = new Set(overrides.value?.include ?? []);
  const exclude = new Set(overrides.value?.exclude ?? []);
  return boards.value
    .filter((b) => (isDefaultSource(b) ? !exclude.has(b.slug) : include.has(b.slug)))
    .map((b) => b.slug);
});
// 从别处直接打开一个没选的部门时，它的标签也要在。
const tabBoards = computed(() => boards.value.filter((b) => selectedSlugs.value.includes(b.slug) || b.slug === activeSlug.value));
// 学院有十几个，在选择框里和学校部门分开列。
const chooserGroups = computed(() => {
  const isCollege = (b: Board) => /学院$|^体育部$/.test(b.name);
  return [
    { title: "学校部门", boards: boards.value.filter((b) => !isCollege(b)) },
    { title: "学院", boards: boards.value.filter(isCollege) },
  ].filter((group) => group.boards.length);
});
const listKey = computed(() => activeSlug.value || `all:${selectedSlugs.value.join(",")}`);
const hasMore = computed(() => page.value * PAGE_SIZE < total.value);

restore(listKey.value);
watch(listKey, (key) => {
  // 离开本页时地址里的 source 会消失，那不是在切换来源。
  if (!ready || route.name !== "announcements") return;
  if (!restore(key)) reload();
});

onMounted(async () => {
  // 来源只用来切换和显示说明；它加载失败时仍然可以看“全部”。
  const [boardList, preference] = await Promise.allSettled([
    boardApi.list({ suppressErrorMessage: true }),
    auth.isLoggedIn
      ? announcementsApi.preference({ suppressErrorMessage: true, suppressAuthMessage: true, suppressAuthRedirect: true })
      : Promise.reject(new Error("guest")),
  ]);
  // 来源加载失败时保留上一次的列表（可能为空）。
  if (boardList.status === "fulfilled") allBoards.value = boardsSnapshot = boardList.value;
  // 登录用户以服务器上的选择为准；取不到就先用本机记的。
  if (preference.status === "fulfilled" && boards.value.length) {
    accountDefaults.value = new Set(preference.value.defaults);
    overrides.value = preference.value.customized ? overridesFor(preference.value.selected) : null;
    writeLocalOverrides(overrides.value);
  }
  await nextTick();
  ready = true;
  if (!restore(listKey.value)) reload();
  // 有部门可选、而且用户没在服务器上选过，才值得打断一下。
  const customized = preference.status === "fulfilled" && preference.value.customized;
  introOpen.value = boards.value.length > 0 && !customized && shouldShowIntro();
});

function dismissIntro() {
  introOpen.value = false;
  introSeen = true;
  try {
    localStorage.setItem(INTRO_KEY, "1");
  } catch {
    // 存不下时本次会话内不再弹。
  }
}

function isDefaultSource(board: Board) {
  return accountDefaults.value ? accountDefaults.value.has(board.slug) : board.announceDefault !== false;
}

function overridesFor(selected: string[]): SourceOverrides {
  const chosen = new Set(selected);
  return {
    include: boards.value.filter((b) => !isDefaultSource(b) && chosen.has(b.slug)).map((b) => b.slug),
    exclude: boards.value.filter((b) => isDefaultSource(b) && !chosen.has(b.slug)).map((b) => b.slug),
  };
}

function openChooser() {
  draft.value = selectedSlugs.value.slice();
  chooserOpen.value = true;
}

function toggleDraft(slug: string) {
  draft.value = draft.value.includes(slug) ? draft.value.filter((s) => s !== slug) : [...draft.value, slug];
}

async function saveChooser() {
  if (!draft.value.length || saving.value) return;
  const next = overridesFor(draft.value);
  const isDefault = !next.include.length && !next.exclude.length;
  saving.value = true;
  try {
    if (auth.isLoggedIn) {
      if (isDefault) await announcementsApi.resetPreference({ suppressErrorMessage: true });
      else await announcementsApi.savePreference(draft.value, { suppressErrorMessage: true });
    }
    overrides.value = isDefault ? null : next;
    writeLocalOverrides(overrides.value);
    chooserOpen.value = false;
    // 当前停在一个刚被取消的部门上时，回到“全部”。
    if (activeSlug.value && !selectedSlugs.value.includes(activeSlug.value)) selectSource("");
  } catch (error_) {
    ElMessage.error(normalizeAnnouncementsError(error_).replace("公告加载失败", "保存失败"));
  } finally {
    saving.value = false;
  }
}

function restore(key: string) {
  const snapshot = listSnapshots.get(key);
  if (!snapshot || Date.now() - snapshot.savedAt > SNAPSHOT_MS) return false;
  loadSeq += 1;
  items.value = snapshot.items;
  total.value = snapshot.total;
  page.value = snapshot.page;
  loading.value = false;
  error.value = "";
  return true;
}

function isVisibleSource(board: Pick<Board, "slug" | "name" | "type">) {
  return board.type === "announce" && !hiddenAnnouncementSlugs.has(board.slug) && !board.name.includes("心理动态");
}

function selectSource(slug: string) {
  if (slug === activeSlug.value) return;
  router.replace({ query: { ...route.query, source: slug || undefined } });
}

function reload() {
  items.value = [];
  total.value = 0;
  page.value = 0;
  return loadMore();
}

async function loadMore() {
  const seq = ++loadSeq;
  const slug = activeSlug.value;
  const key = listKey.value;
  // 来源列表没取到时不带部门筛选，至少能看到全部公告。
  const boardsFilter = selectedSlugs.value.length ? selectedSlugs.value.join(",") : undefined;
  const nextPage = page.value + 1;
  loading.value = true;
  error.value = "";
  try {
    const result = await topicApi.list(
      slug
        ? { board: slug, page: nextPage, size: PAGE_SIZE }
        : { type: "announce", boards: boardsFilter, page: nextPage, size: PAGE_SIZE },
      { suppressErrorMessage: true },
    );
    if (seq !== loadSeq) return;
    const known = new Set(items.value.map((t) => t.id));
    const hidden = (t: Topic) => !slug && Boolean(t.board) && !isVisibleSource({ ...t.board!, type: "announce" });
    items.value = [...items.value, ...result.list.filter((t) => !known.has(t.id) && !hidden(t))];
    total.value = result.total;
    page.value = nextPage;
    // 快照的时间是第一页取回的时间，翻页不延长它。
    const savedAt = nextPage === 1 ? Date.now() : listSnapshots.get(key)?.savedAt ?? Date.now();
    listSnapshots.set(key, { items: items.value, total: total.value, page: page.value, savedAt });
  } catch (error_) {
    if (seq !== loadSeq) return;
    error.value = normalizeAnnouncementsError(error_);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function sourceLine(board: Board) {
  const parts = [board.description, board.feedSource?.homepage ? `同步自 ${shortHost(board.feedSource.homepage)}` : ""];
  if (board.feedSource?.lastRunAt) parts.push(`${fmtRelative(board.feedSource.lastRunAt)}更新`);
  return parts.filter(Boolean).join(" · ");
}

function isFresh(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < FRESH_MS;
}

function shortHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeAnnouncementsError(error_: unknown) {
  const response = (error_ as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (response?.status && response.status < 500) return response.data?.message || "公告加载失败";
  return "公告加载失败，请稍后再试";
}
</script>

<style scoped>
/* 和论坛列表页同一套：冷灰页面上的白色分组，行与行之间一条细线。 */
.announce-page { display: flex; max-width: 860px; margin: 0 auto; flex-direction: column; gap: 12px; color: var(--cpu-text); font-size: var(--cpu-fs-m); line-height: 1.6; }

.announce-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 0 4px; }
.announce-choose { display: inline-flex; min-height: 32px; flex: none; align-items: center; gap: 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); cursor: pointer; }
.announce-head h1 { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; }
.announce-head p { margin: 2px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }

.announce-tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.announce-tabs::-webkit-scrollbar { display: none; }
.announce-tabs button { display: inline-flex; min-height: 36px; flex: 0 0 auto; align-items: center; padding: 0 12px; font-size: var(--cpu-fs-m); cursor: pointer; }

.announce-source { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.announce-source span { min-width: 0; }
.announce-source a { display: inline-flex; flex: none; align-items: center; gap: 2px; color: var(--cpu-primary); text-decoration: none; white-space: nowrap; }

.announce-list { overflow: hidden; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.announce-item { display: block; padding: 12px 16px; color: inherit; text-decoration: none; }
.announce-item + .announce-item { box-shadow: inset 0 1px 0 var(--cpu-border-soft); }
.announce-item:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.announce-item b { display: -webkit-box; overflow: hidden; font-weight: 500; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; text-wrap: pretty; }
.announce-item-foot { display: flex; align-items: center; gap: 5px; margin-top: 2px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.announce-item-foot em { height: 16px; padding: 0 4px; border-radius: var(--cpu-radius-s); background: var(--cpu-accent-soft); color: var(--cpu-accent); font-style: normal; font-weight: 500; line-height: 16px; }

.announce-state { display: flex; min-height: 160px; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); text-align: center; }
.announce-more { display: flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.announce-more button[data-cpu-button="text"] { margin-left: 8px; }

.intro-items { margin: 0; padding-inline-start: 20px; }
.intro-items li + li { margin-top: 10px; }
.intro-items strong { font-weight: 600; }
.intro-items p { margin: 2px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }

.chooser-hint { margin: 0 0 8px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.chooser-list { max-height: min(56vh, 420px); overflow-y: auto; }
.chooser-group { margin: 12px 0 2px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-weight: 500; }
.chooser-group:first-child { margin-top: 0; }
.chooser-row { display: flex; min-height: 40px; align-items: center; gap: 10px; cursor: pointer; }
.chooser-row + .chooser-row { box-shadow: inset 0 1px 0 var(--cpu-border-soft); }
.chooser-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chooser-count { flex: none; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.chooser-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

@media (hover: hover) {
  .announce-item:hover { background: var(--cpu-surface-soft); }
}
</style>
