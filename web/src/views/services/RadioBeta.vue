<template>
  <div class="radio-home-page">
    <section class="radio-home-shell" v-loading="loadingOverview">
      <header class="home-topbar">
        <div class="topbar-brand">
          <div class="brand-mark">
            <img :src="brandLogo" :alt="radioBrandName" class="brand-logo" />
          </div>
          <div class="brand-copy">
            <span class="brand-kicker">Campus Radio</span>
            <h1>{{ radioBrandTitle }}</h1>
            <p>沿用 VoiceHub 的前台结构，把排期、歌曲列表和点歌入口收敛成一套真正可用的广播站首页。</p>
          </div>
        </div>
        <div class="topbar-actions">
          <el-button v-if="canManage" plain @click="goConsole">进入控制台</el-button>
          <el-button v-else-if="loginRequired" plain @click="goLogin">登录后使用</el-button>
        </div>
      </header>

      <section class="hero-board">
        <div class="hero-main">
          <span class="hero-badge">复刻版前台</span>
          <h2>把药苑之声做成一套像广播站主页的前台，不再把后台硬塞进同一屏里。</h2>
          <p>
            这里保留你原系统的浅色业务壳和红色站标，同时按 VoiceHub 的方式拆成
            <strong>播出排期</strong>、<strong>歌曲列表</strong>、<strong>投稿歌曲</strong>
            三个主工作区。
          </p>
          <div class="hero-actions">
            <el-button type="primary" @click="switchTab('request')">我要点歌</el-button>
            <el-button plain @click="switchTab('songs')">看近期投稿</el-button>
          </div>
        </div>

        <div class="hero-side">
          <div class="hero-metric">
            <span>当前学期</span>
            <strong>{{ overview?.currentSemester?.name || "待配置" }}</strong>
            <small>{{ overview?.currentSemester?.code || "未设置当前学期" }}</small>
          </div>
          <div class="hero-metric-grid">
            <article>
              <b>{{ overview?.playTimes.length || 0 }}</b>
              <span>播出时段</span>
            </article>
            <article>
              <b>{{ overview?.scheduleItems.length || 0 }}</b>
              <span>节目栏目</span>
            </article>
            <article>
              <b>{{ overview?.recentRequests.length || 0 }}</b>
              <span>近期投稿</span>
            </article>
            <article>
              <b>{{ overview?.requestSummary.pending || 0 }}</b>
              <span>待处理</span>
            </article>
          </div>
        </div>
      </section>

      <section v-if="pageError" class="page-alert">
        <el-alert :title="pageError" type="warning" :closable="false" show-icon>
          <template #default>
            <div class="alert-actions">
              <el-button size="small" :loading="loadingOverview" @click="loadOverview">重试</el-button>
              <el-button v-if="loginRequired" size="small" plain @click="goLogin">去登录</el-button>
            </div>
          </template>
        </el-alert>
      </section>

      <nav class="section-tabs" aria-label="药苑之声前台主导航">
        <button
          v-for="item in publicTabs"
          :key="item.value"
          :class="['section-tab', { active: activeTab === item.value }]"
          type="button"
          @click="switchTab(item.value)"
        >
          <span class="tab-kicker">{{ item.kicker }}</span>
          <strong>{{ item.label }}</strong>
        </button>
      </nav>

      <section v-if="activeTab === 'schedule'" class="tab-panel schedule-panel">
        <article class="panel-card">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">Schedule</span>
              <h3>播出排期</h3>
              <p>按 VoiceHub 首页的排期视角展示一周时段，再把对应的栏目编排压到同一工作台里。</p>
            </div>
            <el-tag type="success" effect="plain" round>{{ overview?.playTimes.length || 0 }} 个时段</el-tag>
          </div>
          <div v-if="playTimeGroups.length" class="weekday-board">
            <article v-for="group in playTimeGroups" :key="group.weekday" class="weekday-card">
              <div class="weekday-head">
                <strong>{{ group.label }}</strong>
                <span>{{ group.items.length }} 个时段</span>
              </div>
              <div class="weekday-list">
                <div v-for="item in group.items" :key="item.id" class="weekday-item">
                  <div class="weekday-time">{{ item.startTime }} - {{ item.endTime }}</div>
                  <div class="weekday-copy">
                    <b>{{ item.name }}</b>
                    <small>{{ item.location || "地点待补充" }}</small>
                  </div>
                </div>
              </div>
            </article>
          </div>
          <el-empty v-else description="还没有配置播出时段" />
        </article>

        <article class="panel-card">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">Programs</span>
              <h3>栏目编排</h3>
              <p>公开页只显示已发布节目，让前台更像真实电台站点，而不是后台数据表。</p>
            </div>
            <el-tag type="warning" effect="plain" round>{{ overview?.scheduleItems.length || 0 }} 个节目</el-tag>
          </div>
          <div v-if="overview?.scheduleItems.length" class="program-grid">
            <article v-for="item in overview?.scheduleItems" :key="item.id" class="program-card">
              <div class="program-head">
                <span class="program-slot">{{ item.playTime ? `${weekdayLabel(item.playTime.weekday)} ${item.playTime.startTime}` : "待排期" }}</span>
                <el-tag :type="scheduleStatusTag(item.status)" size="small" round>{{ scheduleStatusText(item.status) }}</el-tag>
              </div>
              <h4>{{ item.title }}</h4>
              <p v-if="item.subtitle" class="program-subtitle">{{ item.subtitle }}</p>
              <p v-if="item.summary" class="program-summary">{{ item.summary }}</p>
              <div class="program-meta">
                <span>{{ item.hostNames || "主持人待补充" }}</span>
                <span>{{ item.requestEnabled ? "可点歌" : "暂不开放点歌" }}</span>
              </div>
              <div v-if="item.tags.length" class="tag-row">
                <span v-for="tag in item.tags" :key="tag" class="tag-chip">{{ tag }}</span>
              </div>
            </article>
          </div>
          <el-empty v-else description="还没有发布节目安排" />
        </article>
      </section>

      <section v-else-if="activeTab === 'songs'" class="tab-panel songs-panel">
        <article class="panel-card">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">Requests</span>
              <h3>歌曲列表</h3>
              <p>这里展示最近投稿记录和审核状态，延续 VoiceHub 的歌曲列表语义，但样式回到你原系统的业务界面里。</p>
            </div>
            <el-button plain @click="switchTab('request')">去投稿</el-button>
          </div>

          <div class="songs-toolbar">
            <label class="toolbar-field">
              <span>搜索</span>
              <input v-model.trim="songFilters.query" type="text" placeholder="按歌曲名、歌手、栏目搜索" />
            </label>
            <label class="toolbar-field compact">
              <span>状态</span>
              <select v-model="songFilters.status">
                <option value="all">全部状态</option>
                <option value="pending">待处理</option>
                <option value="approved">已通过</option>
                <option value="fulfilled">已播出</option>
                <option value="rejected">已拒绝</option>
              </select>
            </label>
            <label class="toolbar-field compact">
              <span>音源</span>
              <select v-model="songFilters.provider">
                <option value="all">全部音源</option>
                <option value="netease">网易云</option>
                <option value="qq">QQ 音乐</option>
              </select>
            </label>
          </div>

          <div v-if="songPreview.streamUrl || songPreview.notice" class="song-preview-bar">
            <div class="preview-meta">
              <strong>{{ songPreview.title }}</strong>
              <span>{{ songPreview.subtitle }}</span>
            </div>
            <audio ref="songPreviewAudioRef" :src="songPreview.streamUrl" controls preload="none" />
            <small v-if="songPreview.notice">{{ songPreview.notice }}</small>
          </div>

          <div v-if="filteredRecentRequests.length" class="song-list-grid">
            <article v-for="item in filteredRecentRequests" :key="item.id" class="song-record-card">
              <div class="song-record-main">
                <div class="song-record-avatar">
                  <img
                    v-if="item.sourceSelection?.cover"
                    :src="item.sourceSelection.cover"
                    :alt="item.songTitle"
                    referrerpolicy="no-referrer"
                  />
                  <span v-else>{{ sourceAvatarText(item.songTitle) }}</span>
                </div>
                <div class="song-record-copy">
                  <div class="song-record-head">
                    <h4>{{ item.songTitle }}</h4>
                    <el-tag :type="requestStatusTag(item.status)" size="small" round>{{ requestStatusText(item.status) }}</el-tag>
                  </div>
                  <p>{{ item.artist || "歌手待补充" }}</p>
                  <div class="song-record-meta">
                    <span>投稿人：{{ item.nickname || "匿名" }}</span>
                    <span v-if="item.scheduleItem">栏目：{{ item.scheduleItem.title }}</span>
                    <span v-if="item.sourceProvider">音源：{{ musicProviderLabel(item.sourceProvider) }}</span>
                    <span>{{ formatDateTime(item.createdAt) }}</span>
                  </div>
                </div>
              </div>
              <div class="song-record-actions">
                <el-button v-if="item.sourceSelection" plain @click="previewRecentRequestSource(item)">试听</el-button>
                <el-button type="primary" plain @click="reuseRequest(item)">继续投稿</el-button>
              </div>
            </article>
          </div>
          <el-empty v-else description="还没有符合筛选条件的投稿记录" />
        </article>
      </section>

      <section v-else ref="requestSectionRef" class="tab-panel request-panel">
        <article class="panel-card rules-card">
          <div class="panel-head compact">
            <div>
              <span class="panel-kicker">Guidelines</span>
              <h3>投稿须知</h3>
            </div>
          </div>
          <ol class="rules-list">
            <li>歌曲名和歌手尽量填写准确，方便后续审核和排期。</li>
            <li>如果系统已经搜到对应音源，优先锁定音源再提交，后台就能直接试听和复核。</li>
            <li>投稿后不代表立即播出，管理员仍会按时段、内容和版权可用性进行处理。</li>
            <li>系统只做搜索、解析和播放中转，不存储第三方平台的音乐文件。</li>
            <li>若你已登录，后台会直接关联你的账号；未登录时也可以用昵称投稿。</li>
          </ol>
        </article>

        <article class="panel-card composer-card">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">Request</span>
              <h3>投稿歌曲</h3>
              <p>这里沿用 VoiceHub 的“先搜歌、再锁音源、最后补投稿信息”的工作流。</p>
            </div>
            <div class="provider-pills">
              <button
                v-for="item in providerOptions"
                :key="item.value"
                :class="['provider-pill', { active: musicSearch.providerMode === item.value }]"
                type="button"
                @click="musicSearch.providerMode = item.value"
              >
                {{ item.label }}
              </button>
            </div>
          </div>

          <div v-if="loginRequired && !hasToken" class="login-block">
            <p>{{ radioBrandName }} 当前要求登录后使用，登录后点歌记录和后台审核都会直接关联到你的账号。</p>
            <el-button type="primary" @click="goLogin">去登录</el-button>
          </div>

          <div class="search-box">
            <label class="toolbar-field">
              <span>歌曲搜索</span>
              <input
                v-model.trim="musicSearch.keyword"
                type="text"
                placeholder="输入歌曲名、歌手或两者一起搜"
                @keyup.enter.prevent="searchMusic"
              />
            </label>
            <el-button plain :loading="musicSearch.loading" @click="searchMusic">搜索音源</el-button>
          </div>

          <p v-if="musicSearchHint" class="search-hint">{{ musicSearchHint }}</p>

          <div v-if="selectedSource" class="selected-source-card">
            <div class="selected-source-main">
              <div class="selected-source-cover">
                <img
                  v-if="selectedSource.cover"
                  :src="selectedSource.cover"
                  :alt="selectedSource.name"
                  referrerpolicy="no-referrer"
                />
                <span v-else>{{ sourceAvatarText(selectedSource.name) }}</span>
              </div>
              <div class="selected-source-copy">
                <strong>{{ selectedSource.name }}</strong>
                <span>{{ selectedSource.artist || "歌手未知" }}</span>
                <small>{{ musicProviderLabel(selectedSource.provider) }} · {{ formatDurationMs(selectedSource.duration) }}</small>
              </div>
            </div>
            <div class="selected-source-actions">
              <el-button plain :loading="requestPreview.loading" @click="previewSelectedSource">试听</el-button>
              <el-button plain @click="clearSelectedSource">取消锁定</el-button>
            </div>
          </div>

          <div v-if="musicSearch.error" class="search-feedback error">{{ musicSearch.error }}</div>
          <div v-else-if="musicSearch.searched && !musicSearch.results.length" class="search-feedback empty">没有搜到可用结果，可以直接手填歌曲信息提交。</div>

          <div v-if="musicSearch.results.length" class="search-results">
            <article v-for="item in musicSearch.results" :key="resultTrackKey(item)" class="search-result-card">
              <div class="search-result-main">
                <div class="search-result-cover">
                  <img v-if="item.cover" :src="item.cover" :alt="item.name" referrerpolicy="no-referrer" />
                  <span v-else>{{ sourceAvatarText(item.name) }}</span>
                </div>
                <div class="search-result-copy">
                  <div class="search-result-head">
                    <strong>{{ item.name }}</strong>
                    <el-tag size="small" round>{{ musicProviderLabel(item.provider) }}</el-tag>
                  </div>
                  <span>{{ item.artist || "歌手未知" }}</span>
                  <small>{{ item.album || "专辑未知" }} · {{ formatDurationMs(item.duration) }}</small>
                </div>
              </div>
              <div class="search-result-actions">
                <el-button plain :loading="requestPreview.loading && requestPreview.trackKey === resultTrackKey(item)" @click="previewSearchResult(item)">试听</el-button>
                <el-button type="primary" @click="pickSearchResult(item)">锁定</el-button>
              </div>
            </article>
          </div>

          <div v-if="requestPreview.streamUrl" class="request-preview-player">
            <div class="preview-meta">
              <strong>{{ requestPreview.title }}</strong>
              <span>{{ requestPreview.subtitle }}</span>
            </div>
            <audio ref="requestPreviewAudioRef" :src="requestPreview.streamUrl" controls preload="none" />
            <small v-if="requestPreview.notice">{{ requestPreview.notice }}</small>
          </div>

          <form class="request-form" @submit.prevent="submitRequest">
            <div class="form-grid">
              <label class="form-field">
                <span>昵称</span>
                <input v-model.trim="requestForm.nickname" type="text" maxlength="40" placeholder="不填则使用账号昵称或匿名" />
              </label>
              <label class="form-field">
                <span>投稿栏目</span>
                <select v-model="requestForm.scheduleItemId">
                  <option :value="null">暂不指定栏目</option>
                  <option v-for="item in requestablePrograms" :key="item.id" :value="item.id">{{ item.title }}</option>
                </select>
              </label>
              <label class="form-field">
                <span>歌曲名</span>
                <input v-model.trim="requestForm.songTitle" type="text" maxlength="120" placeholder="例如：晴天" />
              </label>
              <label class="form-field">
                <span>歌手</span>
                <input v-model.trim="requestForm.artist" type="text" maxlength="120" placeholder="例如：周杰伦" />
              </label>
              <label class="form-field">
                <span>联系方式</span>
                <input v-model.trim="requestForm.contact" type="text" maxlength="120" placeholder="可选，便于联系你确认信息" />
              </label>
              <label class="form-field">
                <span>点歌祝福</span>
                <input v-model.trim="requestForm.dedication" type="text" maxlength="200" placeholder="想送给谁，可以写在这里" />
              </label>
            </div>
            <label class="form-field">
              <span>留言补充</span>
              <textarea v-model.trim="requestForm.message" maxlength="1000" placeholder="想补充的说明、原因或者节目语境都可以写在这里" />
            </label>
            <div class="form-actions">
              <span v-if="selectedSource" class="source-lock-note">已锁定 {{ musicProviderLabel(selectedSource.provider) }} 音源，后台可直接试听</span>
              <el-button type="primary" native-type="submit" :loading="submittingRequest" :disabled="loginRequired && !hasToken">提交投稿</el-button>
            </div>
          </form>
        </article>
      </section>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  radioApi,
  type RadioMusicProvider,
  type RadioMusicSearchMode,
  type RadioMusicSearchResult,
  type RadioMusicSelection,
  type RadioOverview,
  type RadioPlayTime,
  type RadioPublicSongRequest,
  type RadioScheduleItem,
} from "@/api/radio";
import { getToken } from "@/api/request";
import { toolsApi } from "@/api/tools";
import brandLogo from "@/assets/brands/yaoyuanzhisheng-seal.png";
import {
  formatDurationMs,
  musicProviderLabel,
  radioBrandName,
  radioBrandTitle,
  requestStatusTag,
  requestStatusText,
  responseMessage,
  responseStatus,
  resultTrackKey,
  scheduleStatusTag,
  scheduleStatusText,
  sourceAvatarText,
  toSourceSelection,
  weekdayLabel,
  weekdayOptions,
} from "@/views/services/radio-beta/shared";

type PublicTab = "schedule" | "songs" | "request";
type PreviewTarget = "request" | "songs";

const router = useRouter();
const route = useRoute();

const publicTabs: Array<{ value: PublicTab; label: string; kicker: string }> = [
  { value: "schedule", label: "播出排期", kicker: "Schedule" },
  { value: "songs", label: "歌曲列表", kicker: "Songs" },
  { value: "request", label: "投稿歌曲", kicker: "Request" },
];

const providerOptions: Array<{ value: RadioMusicSearchMode; label: string }> = [
  { value: "all", label: "全部音源" },
  { value: "netease", label: "网易云" },
  { value: "qq", label: "QQ 音乐" },
];

const loadingOverview = ref(false);
const submittingRequest = ref(false);
const loginRequired = ref(false);
const canManage = ref(false);
const pageError = ref("");
const overview = ref<RadioOverview | null>(null);
const activeTab = ref<PublicTab>("schedule");
const hasToken = computed(() => Boolean(getToken()));
const requestSectionRef = ref<HTMLElement | null>(null);
const requestPreviewAudioRef = ref<HTMLAudioElement | null>(null);
const songPreviewAudioRef = ref<HTMLAudioElement | null>(null);

const requestForm = reactive<{
  nickname: string;
  scheduleItemId: number | null;
  songTitle: string;
  artist: string;
  dedication: string;
  contact: string;
  message: string;
}>({
  nickname: "",
  scheduleItemId: null,
  songTitle: "",
  artist: "",
  dedication: "",
  contact: "",
  message: "",
});

const songFilters = reactive({
  query: "",
  status: "all" as "all" | RadioPublicSongRequest["status"],
  provider: "all" as "all" | RadioMusicProvider,
});

const musicSearch = reactive({
  keyword: "",
  providerMode: "all" as RadioMusicSearchMode,
  loading: false,
  searched: false,
  error: "",
  results: [] as RadioMusicSearchResult[],
  sharedLogin: {
    netease: false,
    qq: false,
  },
});

const selectedSource = ref<RadioMusicSearchResult | null>(null);

const requestPreview = reactive({
  loading: false,
  trackKey: "",
  streamUrl: "",
  title: "",
  subtitle: "",
  notice: "",
});

const songPreview = reactive({
  loading: false,
  trackKey: "",
  streamUrl: "",
  title: "",
  subtitle: "",
  notice: "",
});

const playTimeGroups = computed(() => {
  const map = new Map<number, RadioPlayTime[]>();
  for (const item of overview.value?.playTimes ?? []) {
    const list = map.get(item.weekday) ?? [];
    list.push(item);
    map.set(item.weekday, list);
  }
  return weekdayOptions
    .map((option) => ({
      weekday: option.value,
      label: option.label,
      items: (map.get(option.value) ?? [])
        .slice()
        .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.sortOrder - right.sortOrder),
    }))
    .filter((group) => group.items.length);
});

const requestablePrograms = computed<RadioScheduleItem[]>(() =>
  (overview.value?.scheduleItems ?? []).filter((item) => item.requestEnabled)
);

const filteredRecentRequests = computed(() => {
  const query = songFilters.query.trim().toLowerCase();
  return (overview.value?.recentRequests ?? []).filter((item) => {
    if (songFilters.status !== "all" && item.status !== songFilters.status) return false;
    if (songFilters.provider !== "all" && item.sourceProvider !== songFilters.provider) return false;
    if (!query) return true;
    const text = [
      item.songTitle,
      item.artist || "",
      item.nickname || "",
      item.scheduleItem?.title || "",
    ].join(" ").toLowerCase();
    return text.includes(query);
  });
});

const musicSearchHint = computed(() => {
  const hints: string[] = [];
  if (!musicSearch.sharedLogin.netease) hints.push("网易云当前按公共匿名能力解析");
  if (!musicSearch.sharedLogin.qq) hints.push("QQ 音乐未配置共享登录，部分歌曲可能只能搜到但无法试听");
  return hints.join("；");
});

onMounted(async () => {
  const initialTab = String(route.query.tab || "");
  if (initialTab === "schedule" || initialTab === "songs" || initialTab === "request") {
    activeTab.value = initialTab;
  }
  await Promise.all([loadOverview(), initPermission()]);
});

async function initPermission() {
  canManage.value = false;
  try {
    const toolMetas = await toolsApi.tools({ suppressErrorMessage: true });
    const current = toolMetas.find((item) => item.code === "radio_beta");
    if (current?.requireLogin && !hasToken.value) loginRequired.value = true;
    canManage.value = Boolean(current?.canManage);
  } catch {
    canManage.value = false;
  }
  if (!hasToken.value) return;
  try {
    const perms = await toolsApi.myPermissions({
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    canManage.value = canManage.value
      || perms.toolCodes.includes("radio_beta")
      || perms.adminToolCodes.includes("radio_beta");
  } catch {
    // ignore
  }
}

async function loadOverview() {
  loadingOverview.value = true;
  pageError.value = "";
  loginRequired.value = false;
  try {
    overview.value = await radioApi.overview();
  } catch (error) {
    overview.value = null;
    const status = responseStatus(error);
    if (status === 401) {
      loginRequired.value = true;
      pageError.value = `${radioBrandName}当前需要登录后使用。`;
      return;
    }
    pageError.value = responseMessage(error) || `${radioBrandName}概览加载失败`;
  } finally {
    loadingOverview.value = false;
  }
}

async function submitRequest() {
  if (!requestForm.songTitle.trim()) {
    ElMessage.warning("请先填写歌曲名");
    return;
  }
  submittingRequest.value = true;
  try {
    await radioApi.submitRequest({
      nickname: requestForm.nickname || undefined,
      scheduleItemId: requestForm.scheduleItemId,
      songTitle: requestForm.songTitle,
      artist: requestForm.artist || undefined,
      sourceSelection: selectedSource.value ? toSourceSelection(selectedSource.value) : undefined,
      dedication: requestForm.dedication || undefined,
      contact: requestForm.contact || undefined,
      message: requestForm.message || undefined,
    });
    ElMessage.success(`投稿已提交，${radioBrandName}后台现在能直接查看并试听这条记录了`);
    requestForm.nickname = "";
    requestForm.scheduleItemId = null;
    requestForm.songTitle = "";
    requestForm.artist = "";
    requestForm.dedication = "";
    requestForm.contact = "";
    requestForm.message = "";
    selectedSource.value = null;
    musicSearch.keyword = "";
    musicSearch.results = [];
    musicSearch.searched = false;
    musicSearch.error = "";
    resetPreviewState("request");
    await loadOverview();
  } catch (error) {
    const status = responseStatus(error);
    if (status === 401) {
      loginRequired.value = true;
      goLogin();
      return;
    }
    ElMessage.error(responseMessage(error) || "投稿提交失败");
  } finally {
    submittingRequest.value = false;
  }
}

async function searchMusic() {
  const query = musicSearch.keyword.trim() || [requestForm.songTitle, requestForm.artist].filter(Boolean).join(" ").trim();
  if (!query) {
    ElMessage.warning("先输入歌名或歌手再搜索");
    return;
  }
  musicSearch.loading = true;
  musicSearch.searched = false;
  musicSearch.error = "";
  try {
    const payload = await radioApi.searchMusic({
      q: query,
      provider: musicSearch.providerMode,
      limit: 12,
    });
    musicSearch.keyword = query;
    musicSearch.results = payload.results;
    musicSearch.sharedLogin = payload.sharedLogin;
    musicSearch.searched = true;
  } catch (error) {
    musicSearch.results = [];
    musicSearch.sharedLogin = { netease: false, qq: false };
    musicSearch.searched = true;
    musicSearch.error = responseMessage(error) || "音源搜索失败";
  } finally {
    musicSearch.loading = false;
  }
}

function switchTab(tab: PublicTab) {
  activeTab.value = tab;
  if (tab === "request") {
    nextTick(() => requestSectionRef.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

function pickSearchResult(item: RadioMusicSearchResult) {
  selectedSource.value = item;
  requestForm.songTitle = item.name;
  requestForm.artist = item.artist;
}

function clearSelectedSource() {
  selectedSource.value = null;
  resetPreviewState("request");
}

function reuseRequest(item: RadioPublicSongRequest) {
  requestForm.songTitle = item.songTitle;
  requestForm.artist = item.artist || "";
  requestForm.scheduleItemId = item.scheduleItemId ?? null;
  if (item.sourceSelection && item.sourceProvider && item.sourceTrackId) {
    selectedSource.value = {
      ...item.sourceSelection,
      provider: item.sourceProvider,
      trackId: item.sourceTrackId,
      name: item.songTitle,
      artist: item.artist || "",
      fee: 0,
      playable: true,
    };
  }
  switchTab("request");
}

async function previewSearchResult(item: RadioMusicSearchResult) {
  await previewSource(item, item.name, item.artist || "", "request");
}

async function previewSelectedSource() {
  if (!selectedSource.value) {
    ElMessage.warning("当前还没有锁定音源");
    return;
  }
  await previewSource(selectedSource.value, selectedSource.value.name, selectedSource.value.artist || "", "request");
}

async function previewRecentRequestSource(item: RadioPublicSongRequest) {
  const selection = item.sourceSelection;
  if (!selection) {
    ElMessage.warning("这条投稿没有锁定音源");
    return;
  }
  await previewSource(selection, item.songTitle, item.artist || "", "songs");
}

async function previewSource(
  selection: RadioMusicSelection | RadioMusicSearchResult,
  title: string,
  artist: string,
  target: PreviewTarget,
) {
  const state = target === "songs" ? songPreview : requestPreview;
  state.loading = true;
  state.trackKey = resultTrackKey(selection);
  state.notice = "";
  try {
    const resolved = await radioApi.resolveMusic({
      provider: selection.provider,
      trackId: selection.trackId,
      mediaMid: selection.mediaMid ?? undefined,
      quality: "standard",
    });
    if (!resolved.streamUrl) {
      state.streamUrl = "";
      state.title = title;
      state.subtitle = [musicProviderLabel(selection.provider), artist].filter(Boolean).join(" · ");
      state.notice = resolved.message || "当前音源没有返回可播放地址";
      ElMessage.warning(state.notice);
      return;
    }
    state.streamUrl = resolved.streamUrl;
    state.title = title;
    state.subtitle = [musicProviderLabel(selection.provider), artist].filter(Boolean).join(" · ");
    state.notice = resolved.trial ? "当前返回的是试听片段。" : (resolved.message || "");
    pauseOtherPreview(target);
    await nextTick();
    const audio = target === "songs" ? songPreviewAudioRef.value : requestPreviewAudioRef.value;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // ignore
      }
      audio.load();
      await audio.play().catch(() => undefined);
    }
  } catch (error) {
    state.streamUrl = "";
    state.notice = responseMessage(error) || "试听解析失败";
    ElMessage.error(state.notice);
  } finally {
    state.loading = false;
  }
}

function pauseOtherPreview(target: PreviewTarget) {
  const refs = target === "songs"
    ? [requestPreviewAudioRef.value]
    : [songPreviewAudioRef.value];
  for (const audio of refs) {
    if (!audio) continue;
    try {
      audio.pause();
    } catch {
      // ignore
    }
  }
}

function resetPreviewState(target: PreviewTarget) {
  const state = target === "songs" ? songPreview : requestPreview;
  state.loading = false;
  state.trackKey = "";
  state.streamUrl = "";
  state.title = "";
  state.subtitle = "";
  state.notice = "";
}

function goLogin() {
  router.push({ name: "login", query: { redirect: route.fullPath } });
}

function goConsole() {
  router.push({ name: "service-radio-beta-console" });
}

function formatDateTime(value?: string | null) {
  if (!value) return "时间待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
</script>

<style scoped>
.radio-home-page {
  --radio-red: #b43225;
  --radio-ink: #24362b;
  --radio-soft: #f7f3eb;
  --radio-panel: rgba(255, 255, 255, 0.94);
  --radio-line: rgba(84, 98, 77, 0.16);
  --radio-green: #2f7d4f;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.radio-home-shell {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px;
  border-radius: 24px;
  border: 1px solid var(--radio-line);
  background:
    radial-gradient(circle at top left, rgba(180, 50, 37, 0.12), transparent 28%),
    radial-gradient(circle at top right, rgba(47, 125, 79, 0.14), transparent 30%),
    linear-gradient(180deg, rgba(248, 245, 239, 0.94) 0%, rgba(255, 255, 255, 0.98) 45%, rgba(246, 248, 242, 0.96) 100%);
  box-shadow: 0 22px 48px rgba(36, 54, 43, 0.08);
}

.home-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 18px;
}

.brand-mark {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 116px;
  height: 116px;
  padding: 14px;
  border-radius: 30px;
  background: rgba(255, 249, 247, 0.95);
  border: 1px solid rgba(180, 50, 37, 0.14);
  box-shadow: 0 14px 26px rgba(180, 50, 37, 0.08);
}

.brand-logo {
  width: 100%;
  height: auto;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 720px;
}

.brand-kicker,
.panel-kicker,
.tab-kicker {
  color: var(--radio-red);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.brand-copy h1,
.hero-main h2,
.panel-head h3,
.song-record-head h4,
.program-card h4 {
  margin: 0;
  color: var(--radio-ink);
}

.brand-copy h1 {
  font-size: 34px;
  line-height: 1.1;
}

.brand-copy p,
.hero-main p,
.panel-head p,
.program-summary,
.rules-list,
.song-record-copy p {
  margin: 0;
  color: #54624d;
  line-height: 1.8;
}

.topbar-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.hero-board {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.85fr);
  gap: 18px;
}

.hero-main,
.hero-side,
.panel-card {
  border-radius: 22px;
  border: 1px solid var(--radio-line);
  background: var(--radio-panel);
}

.hero-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 24px;
}

.hero-badge {
  align-self: flex-start;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(180, 50, 37, 0.1);
  color: var(--radio-red);
  font-size: 12px;
  font-weight: 700;
}

.hero-main h2 {
  font-size: 30px;
  line-height: 1.2;
}

.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.hero-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  background:
    linear-gradient(180deg, rgba(255, 248, 246, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.hero-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hero-metric span,
.hero-metric small,
.hero-metric-grid span,
.song-record-meta,
.program-meta,
.selected-source-copy span,
.selected-source-copy small,
.search-result-copy span,
.search-result-copy small,
.preview-meta span,
.search-hint,
.source-lock-note,
.request-preview-player small,
.song-preview-bar small {
  color: #5c6a5b;
}

.hero-metric strong {
  font-size: 24px;
  color: var(--radio-ink);
}

.hero-metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.hero-metric-grid article {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(247, 243, 235, 0.72);
}

.hero-metric-grid b {
  font-size: 28px;
  color: var(--radio-red);
  line-height: 1;
}

.page-alert {
  margin-top: -4px;
}

.alert-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.section-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.section-tab {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid var(--radio-line);
  background: rgba(255, 255, 255, 0.78);
  color: var(--radio-ink);
  cursor: pointer;
  text-align: left;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.section-tab strong {
  font-size: 17px;
}

.section-tab.active {
  border-color: rgba(180, 50, 37, 0.3);
  background: linear-gradient(135deg, rgba(180, 50, 37, 0.08) 0%, rgba(255, 255, 255, 0.96) 100%);
  box-shadow: 0 12px 24px rgba(180, 50, 37, 0.08);
  transform: translateY(-1px);
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.schedule-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
}

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.panel-head.compact {
  margin-bottom: -6px;
}

.panel-head h3 {
  font-size: 24px;
  line-height: 1.2;
}

.weekday-board,
.program-grid,
.song-list-grid,
.search-results {
  display: grid;
  gap: 14px;
}

.weekday-board {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.weekday-card,
.program-card,
.song-record-card,
.search-result-card,
.selected-source-card,
.request-preview-player,
.song-preview-bar {
  border-radius: 18px;
  border: 1px solid var(--radio-line);
  background: rgba(255, 255, 255, 0.92);
}

.weekday-card {
  padding: 16px;
}

.weekday-head,
.song-record-head,
.program-head,
.search-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.weekday-head strong,
.song-record-head h4,
.search-result-copy strong {
  font-size: 16px;
}

.weekday-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.weekday-item {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(247, 243, 235, 0.68);
}

.weekday-time,
.program-slot {
  color: var(--radio-green);
  font-weight: 700;
}

.weekday-copy,
.song-record-copy,
.selected-source-copy,
.search-result-copy,
.preview-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.weekday-copy b,
.selected-source-copy strong,
.preview-meta strong {
  color: var(--radio-ink);
}

.weekday-copy small {
  color: #6d786c;
}

.program-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.program-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  background:
    radial-gradient(circle at top right, rgba(47, 125, 79, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(249, 251, 247, 0.92) 0%, rgba(255, 255, 255, 0.96) 100%);
}

.program-card h4 {
  font-size: 20px;
}

.program-subtitle {
  margin: -4px 0 0;
  color: #38604c;
  font-weight: 600;
}

.program-meta,
.song-record-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  font-size: 12px;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-chip {
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(47, 125, 79, 0.1);
  color: var(--radio-green);
  font-size: 12px;
}

.songs-toolbar,
.search-box,
.form-grid,
.song-record-main,
.selected-source-main,
.search-result-main {
  display: grid;
  gap: 14px;
}

.songs-toolbar {
  grid-template-columns: minmax(0, 1.3fr) repeat(2, minmax(140px, 0.5fr));
}

.toolbar-field,
.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toolbar-field span,
.form-field span {
  font-size: 13px;
  font-weight: 600;
  color: #5b6a58;
}

.toolbar-field input,
.toolbar-field select,
.form-field input,
.form-field select,
.form-field textarea {
  width: 100%;
  min-height: 44px;
  padding: 11px 12px;
  border-radius: 12px;
  border: 1px solid var(--radio-line);
  background: rgba(255, 255, 255, 0.96);
  color: var(--radio-ink);
  font: inherit;
  outline: none;
}

.form-field textarea {
  min-height: 128px;
  resize: vertical;
}

.toolbar-field input:focus,
.toolbar-field select:focus,
.form-field input:focus,
.form-field select:focus,
.form-field textarea:focus {
  border-color: rgba(180, 50, 37, 0.3);
  box-shadow: 0 0 0 4px rgba(180, 50, 37, 0.08);
}

.toolbar-field.compact {
  min-width: 0;
}

.song-list-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.song-record-card,
.selected-source-card,
.search-result-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
}

.song-record-main,
.selected-source-main,
.search-result-main {
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  flex: 1 1 auto;
}

.song-record-avatar,
.selected-source-cover,
.search-result-cover {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  overflow: hidden;
  background: rgba(180, 50, 37, 0.1);
  color: var(--radio-red);
  font-size: 26px;
  font-weight: 700;
  display: grid;
  place-items: center;
}

.song-record-avatar img,
.selected-source-cover img,
.search-result-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.song-record-actions,
.selected-source-actions,
.search-result-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.rules-card,
.composer-card {
  min-height: 100%;
}

.request-panel {
  display: grid;
  grid-template-columns: minmax(280px, 0.82fr) minmax(0, 1.18fr);
}

.rules-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-left: 18px;
}

.provider-pills {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.provider-pill {
  padding: 9px 14px;
  border-radius: 999px;
  border: 1px solid var(--radio-line);
  background: rgba(247, 243, 235, 0.72);
  color: var(--radio-ink);
  cursor: pointer;
  font: inherit;
}

.provider-pill.active {
  border-color: rgba(180, 50, 37, 0.24);
  background: rgba(180, 50, 37, 0.1);
  color: var(--radio-red);
  font-weight: 700;
}

.login-block,
.search-feedback,
.song-preview-bar,
.request-preview-player {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}

.login-block {
  border-radius: 18px;
  border: 1px solid rgba(245, 158, 11, 0.26);
  background: rgba(245, 158, 11, 0.08);
}

.search-feedback {
  border-radius: 16px;
}

.search-feedback.error {
  background: rgba(220, 38, 38, 0.08);
  color: #b42318;
}

.search-feedback.empty {
  background: rgba(47, 125, 79, 0.08);
  color: var(--radio-green);
}

.request-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.source-lock-note {
  font-size: 13px;
}

@media (max-width: 1180px) {
  .schedule-panel,
  .request-panel,
  .hero-board,
  .song-list-grid {
    grid-template-columns: 1fr;
  }

  .songs-toolbar,
  .form-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 860px) {
  .radio-home-shell {
    padding: 16px;
    border-radius: 20px;
  }

  .home-topbar,
  .topbar-brand,
  .panel-head,
  .song-record-card,
  .selected-source-card,
  .search-result-card {
    flex-direction: column;
    align-items: stretch;
  }

  .section-tabs,
  .weekday-board,
  .program-grid,
  .songs-toolbar,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .brand-mark {
    width: 88px;
    height: 88px;
    padding: 12px;
  }

  .brand-copy h1 {
    font-size: 28px;
  }

  .hero-main h2,
  .panel-head h3 {
    font-size: 22px;
  }
}

@media (max-width: 640px) {
  .song-record-main,
  .selected-source-main,
  .search-result-main,
  .weekday-item {
    grid-template-columns: 1fr;
  }

  .hero-actions,
  .song-record-actions,
  .selected-source-actions,
  .search-result-actions,
  .form-actions,
  .provider-pills,
  .topbar-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-metric-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
