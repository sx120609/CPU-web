<template>
  <div class="voicehub-home">
    <div class="ellipse-effect" />

    <div class="main-content" v-loading="loadingOverview">
      <div class="top-bar">
        <div class="logo-section">
          <div class="logo-link">
            <img alt="药苑之声 Logo" class="logo-image" :src="brandLogo" />
          </div>

          <div class="logo-divider-container">
            <div class="logo-divider" />
            <div class="school-mark">
              <span class="school-kicker">VoiceHub Front</span>
              <strong>{{ radioBrandTitle }}</strong>
            </div>
          </div>
        </div>

        <div class="user-section">
          <button v-if="canManage" class="action-chip" type="button" @click="goConsole">
            管理后台
          </button>
          <button
            v-else-if="loginRequired"
            class="action-chip primary"
            type="button"
            @click="goLogin"
          >
            登录后使用
          </button>
          <button v-else class="action-chip primary" type="button" @click="switchTab('request')">
            立即投稿
          </button>
        </div>
      </div>

      <div class="site-title">
        <div class="title-container">
          <p class="eyebrow">中国药科大学广播站</p>
          <h1 class="main-title">药苑之声 beta</h1>
          <div class="title-divider" />
          <div class="sub-title-row">
            <span>{{ overview?.currentSemester?.name || "当前学期待配置" }}</span>
            <span>{{ overview?.playTimes.length || 0 }} 个播出时段</span>
            <span>{{ overview?.scheduleItems.length || 0 }} 个栏目</span>
            <span>{{ overview?.recentRequests.length || 0 }} 条近期投稿</span>
          </div>
        </div>
      </div>

      <div v-if="pageError" class="status-banner warning">
        <div class="status-banner-copy">
          <strong>{{ pageError }}</strong>
          <p>可以直接重试，或者先登录后再继续使用投稿和试听功能。</p>
        </div>
        <div class="status-banner-actions">
          <button class="mini-btn" type="button" @click="loadOverview">重试</button>
          <button v-if="loginRequired" class="mini-btn ghost" type="button" @click="goLogin">
            去登录
          </button>
        </div>
      </div>

      <div class="content-area">
        <div class="tabs-row">
          <button
            v-for="item in publicTabs"
            :key="item.value"
            :class="['section-tab', { active: activeTab === item.value }]"
            type="button"
            @click="switchTab(item.value)"
          >
            <span class="tab-kicker">{{ item.kicker }}</span>
            <span class="tab-text">{{ item.label }}</span>
          </button>
        </div>

        <div class="tab-content-container">
          <Transition mode="out-in" name="tab-fade">
            <div v-if="activeTab === 'schedule'" key="schedule" class="tab-pane schedule-tab-pane">
              <div class="schedule-columns">
                <section class="surface-card">
                  <div class="panel-heading">
                    <div>
                      <span class="panel-kicker">Weekly Slots</span>
                      <h2>播出排期</h2>
                      <p>按星期梳理当前学期的固定时段，让听众先看到什么时候播。</p>
                    </div>
                    <span class="meta-chip">{{ overview?.playTimes.length || 0 }} 个时段</span>
                  </div>

                  <div v-if="playTimeGroups.length" class="weekday-grid">
                    <article v-for="group in playTimeGroups" :key="group.weekday" class="weekday-panel">
                      <div class="weekday-head">
                        <strong>{{ group.label }}</strong>
                        <span>{{ group.items.length }} 个时段</span>
                      </div>

                      <div class="weekday-list">
                        <div v-for="item in group.items" :key="item.id" class="weekday-item">
                          <span class="time-pill">{{ item.startTime }} - {{ item.endTime }}</span>
                          <div class="weekday-copy">
                            <strong>{{ item.name }}</strong>
                            <p>{{ item.location || "地点待补充" }}</p>
                          </div>
                        </div>
                      </div>
                    </article>
                  </div>

                  <div v-else class="empty-state">当前还没有配置播出时段。</div>
                </section>

                <section class="surface-card">
                  <div class="panel-heading">
                    <div>
                      <span class="panel-kicker">Programs</span>
                      <h2>栏目编排</h2>
                      <p>前台只展示已经整理好的栏目内容，而不是后台原始数据表。</p>
                    </div>
                    <span class="meta-chip">{{ overview?.scheduleItems.length || 0 }} 个栏目</span>
                  </div>

                  <div v-if="overview?.scheduleItems.length" class="program-list">
                    <article v-for="item in overview?.scheduleItems" :key="item.id" class="program-card">
                      <div class="program-top">
                        <span class="slot-label">
                          {{
                            item.playTime
                              ? `${weekdayLabel(item.playTime.weekday)} ${item.playTime.startTime}`
                              : "待排期"
                          }}
                        </span>
                        <span :class="['status-pill', scheduleStatusTag(item.status)]">
                          {{ scheduleStatusText(item.status) }}
                        </span>
                      </div>

                      <h3>{{ item.title }}</h3>
                      <p v-if="item.subtitle" class="program-subtitle">{{ item.subtitle }}</p>
                      <p class="program-summary">{{ item.summary || "该栏目尚未补充简介。" }}</p>

                      <div class="program-meta">
                        <span>{{ item.hostNames || "主持人待补充" }}</span>
                        <span>{{ item.requestEnabled ? "开放点歌" : "暂不开放点歌" }}</span>
                      </div>

                      <div v-if="item.tags.length" class="tag-list">
                        <span v-for="tag in item.tags" :key="tag" class="tag-chip">{{ tag }}</span>
                      </div>
                    </article>
                  </div>

                  <div v-else class="empty-state">当前还没有发布栏目。</div>
                </section>
              </div>
            </div>

            <div v-else-if="activeTab === 'songs'" key="songs" class="tab-pane">
              <section class="surface-card">
                <div class="panel-heading">
                  <div>
                    <span class="panel-kicker">Song Requests</span>
                    <h2>歌曲列表</h2>
                    <p>公开查看近期投稿、审核状态和已锁定音源，前台也能直接试听。</p>
                  </div>
                  <button class="mini-btn ghost" type="button" @click="switchTab('request')">
                    去投稿
                  </button>
                </div>

                <div class="list-toolbar">
                  <label class="filter-field filter-wide">
                    <span>搜索</span>
                    <input
                      v-model.trim="songFilters.query"
                      type="text"
                      placeholder="按歌曲名、歌手、栏目搜索"
                    />
                  </label>

                  <label class="filter-field">
                    <span>状态</span>
                    <select v-model="songFilters.status">
                      <option value="all">全部状态</option>
                      <option value="pending">待处理</option>
                      <option value="approved">已通过</option>
                      <option value="fulfilled">已播出</option>
                      <option value="rejected">已拒绝</option>
                    </select>
                  </label>

                  <label class="filter-field">
                    <span>音源</span>
                    <select v-model="songFilters.provider">
                      <option value="all">全部音源</option>
                      <option value="netease">网易云</option>
                      <option value="qq">QQ 音乐</option>
                    </select>
                  </label>
                </div>

                <div v-if="songPreview.streamUrl || songPreview.notice" class="audio-player">
                  <div class="audio-top">
                    <div class="audio-meta">
                      <strong>{{ songPreview.title }}</strong>
                      <span>{{ songPreview.subtitle }}</span>
                    </div>
                    <button class="text-link" type="button" @click="closePreview('songs')">
                      关闭试听
                    </button>
                  </div>
                  <audio ref="songPreviewAudioRef" :src="songPreview.streamUrl" controls preload="none" />
                  <small v-if="songPreview.notice" class="audio-notice">{{ songPreview.notice }}</small>
                </div>

                <div v-if="filteredRecentRequests.length" class="request-list">
                  <article v-for="item in filteredRecentRequests" :key="item.id" class="request-row">
                    <div class="request-cover">
                      <img
                        v-if="item.sourceSelection?.cover"
                        :src="item.sourceSelection.cover"
                        :alt="item.songTitle"
                        referrerpolicy="no-referrer"
                      />
                      <span v-else>{{ sourceAvatarText(item.songTitle) }}</span>
                    </div>

                    <div class="request-copy">
                      <div class="request-title-row">
                        <h3>{{ item.songTitle }}</h3>
                        <span :class="['status-pill', requestStatusTag(item.status)]">
                          {{ requestStatusText(item.status) }}
                        </span>
                      </div>
                      <p>{{ item.artist || "歌手待补充" }}</p>
                      <div class="request-meta">
                        <span>投稿人：{{ item.nickname || "匿名" }}</span>
                        <span v-if="item.scheduleItem">栏目：{{ item.scheduleItem.title }}</span>
                        <span v-if="item.sourceProvider">音源：{{ musicProviderLabel(item.sourceProvider) }}</span>
                        <span>{{ formatDateTime(item.createdAt) }}</span>
                      </div>
                    </div>

                    <div class="request-actions">
                      <button
                        v-if="item.sourceSelection"
                        class="mini-btn ghost"
                        type="button"
                        @click="previewRecentRequestSource(item)"
                      >
                        试听
                      </button>
                      <button class="mini-btn primary" type="button" @click="reuseRequest(item)">
                        继续投稿
                      </button>
                    </div>
                  </article>
                </div>

                <div v-else class="empty-state">当前没有符合筛选条件的投稿。</div>
              </section>
            </div>

            <div v-else key="request" ref="requestSectionRef" class="tab-pane request-pane">
              <div class="request-form">
                <section class="rules-section">
                  <h2 class="section-title">投稿须知</h2>
                  <div class="rules-content-desktop">
                    <p>1. 歌曲名和歌手尽量填写准确，方便后台快速核对。</p>
                    <p>2. 优先先锁定音源再提交，管理员就可以直接试听和审核。</p>
                    <p>3. 投稿并不代表立即播出，仍会按排期和内容规则处理。</p>
                    <p>4. 系统只做搜索、解析和播放中转，不存储第三方音乐文件。</p>
                    <p>5. 已登录用户会自动关联账号，未登录时也可以用昵称投稿。</p>
                  </div>
                </section>

                <section class="form-container">
                  <form class="song-request-form" @submit.prevent="submitRequest">
                    <div class="form-header-row">
                      <div class="search-section">
                        <div class="search-label">歌曲搜索</div>
                        <div class="search-input-group">
                          <input
                            v-model.trim="musicSearch.keyword"
                            class="search-input"
                            type="text"
                            placeholder="输入歌曲名、歌手或两者一起搜"
                            @keyup.enter.prevent="searchMusic"
                          />
                          <button
                            class="search-button"
                            type="button"
                            :disabled="musicSearch.loading"
                            @click="searchMusic"
                          >
                            {{ musicSearch.loading ? "搜索中..." : "搜索" }}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="search-results-container">
                      <div v-if="loginRequired && !hasToken" class="login-entry">
                        <div class="login-desc">
                          <p class="login-title">{{ radioBrandName }} 当前要求登录后使用</p>
                          <p class="login-hint">登录后，投稿记录和后台审核都会直接关联到你的账号。</p>
                        </div>
                        <button class="mini-btn primary" type="button" @click="goLogin">去登录</button>
                      </div>

                      <div class="platform-selection-container">
                        <div class="platform-selection">
                          <button
                            v-for="item in providerOptions"
                            :key="item.value"
                            :class="['platform-btn', { active: musicSearch.providerMode === item.value }]"
                            type="button"
                            @click="musicSearch.providerMode = item.value"
                          >
                            {{ item.label }}
                          </button>
                        </div>

                        <div v-if="musicSearchHint" class="source-status-display">
                          <div class="status-header">
                            <span class="status-title">音源说明</span>
                            <span class="status-summary">当前解析状态</span>
                          </div>
                          <p class="status-copy">{{ musicSearchHint }}</p>
                        </div>
                      </div>

                      <div v-if="selectedSource" class="selected-source-banner">
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
                            <small>
                              {{ musicProviderLabel(selectedSource.provider) }}
                              ·
                              {{ formatDurationMs(selectedSource.duration) }}
                            </small>
                          </div>
                        </div>
                        <div class="selected-source-actions">
                          <button
                            class="mini-btn ghost"
                            type="button"
                            :disabled="requestPreview.loading"
                            @click="previewSelectedSource"
                          >
                            试听
                          </button>
                          <button class="mini-btn ghost" type="button" @click="clearSelectedSource">
                            取消锁定
                          </button>
                        </div>
                      </div>

                      <div v-if="requestPreview.streamUrl || requestPreview.notice" class="audio-player request-audio">
                        <div class="audio-top">
                          <div class="audio-meta">
                            <strong>{{ requestPreview.title }}</strong>
                            <span>{{ requestPreview.subtitle }}</span>
                          </div>
                          <button class="text-link" type="button" @click="closePreview('request')">
                            关闭试听
                          </button>
                        </div>
                        <audio ref="requestPreviewAudioRef" :src="requestPreview.streamUrl" controls preload="none" />
                        <small v-if="requestPreview.notice" class="audio-notice">{{ requestPreview.notice }}</small>
                      </div>

                      <div class="results-content">
                        <div v-if="musicSearch.error" class="status-inline error">
                          {{ musicSearch.error }}
                        </div>

                        <div v-else-if="musicSearch.results.length" class="results-list">
                          <article
                            v-for="item in musicSearch.results"
                            :key="resultTrackKey(item)"
                            class="result-item"
                          >
                            <div class="result-cover">
                              <img
                                v-if="item.cover"
                                :src="item.cover"
                                :alt="item.name"
                                referrerpolicy="no-referrer"
                              />
                              <span v-else>{{ sourceAvatarText(item.name) }}</span>
                            </div>

                            <div class="result-info">
                              <h3 class="result-title">{{ item.name }}</h3>
                              <p class="result-artist">{{ item.artist || "歌手未知" }}</p>
                              <div class="result-meta">
                                <span>{{ musicProviderLabel(item.provider) }}</span>
                                <span>{{ item.album || "专辑未知" }}</span>
                                <span>{{ formatDurationMs(item.duration) }}</span>
                              </div>
                            </div>

                            <div class="result-actions">
                              <button
                                class="mini-btn ghost"
                                type="button"
                                :disabled="requestPreview.loading && requestPreview.trackKey === resultTrackKey(item)"
                                @click="previewSearchResult(item)"
                              >
                                试听
                              </button>
                              <button class="mini-btn primary" type="button" @click="pickSearchResult(item)">
                                锁定
                              </button>
                            </div>
                          </article>
                        </div>

                        <div v-else-if="musicSearch.searched" class="empty-state compact">
                          没有搜到可用结果，可以直接手动填写后提交。
                        </div>

                        <div v-else class="empty-state compact">
                          先搜索歌曲，再锁定音源，最后提交投稿。
                        </div>
                      </div>
                    </div>

                    <div class="submission-form-shell">
                      <div class="panel-heading compact">
                        <div>
                          <span class="panel-kicker">Request Form</span>
                          <h2>投稿信息</h2>
                          <p>把基础信息补齐后提交，后台就能直接接手这条投稿。</p>
                        </div>
                      </div>

                      <div class="form-grid">
                        <label class="form-field">
                          <span>昵称</span>
                          <input
                            v-model.trim="requestForm.nickname"
                            type="text"
                            maxlength="40"
                            placeholder="不填则使用账号昵称或匿名"
                          />
                        </label>

                        <label class="form-field">
                          <span>投稿栏目</span>
                          <select v-model="requestForm.scheduleItemId">
                            <option :value="null">暂不指定栏目</option>
                            <option v-for="item in requestablePrograms" :key="item.id" :value="item.id">
                              {{ item.title }}
                            </option>
                          </select>
                        </label>

                        <label class="form-field">
                          <span>歌曲名</span>
                          <input
                            v-model.trim="requestForm.songTitle"
                            type="text"
                            maxlength="120"
                            placeholder="例如：晴天"
                          />
                        </label>

                        <label class="form-field">
                          <span>歌手</span>
                          <input
                            v-model.trim="requestForm.artist"
                            type="text"
                            maxlength="120"
                            placeholder="例如：周杰伦"
                          />
                        </label>

                        <label class="form-field">
                          <span>联系方式</span>
                          <input
                            v-model.trim="requestForm.contact"
                            type="text"
                            maxlength="120"
                            placeholder="可选，便于联系你确认信息"
                          />
                        </label>

                        <label class="form-field">
                          <span>点歌祝福</span>
                          <input
                            v-model.trim="requestForm.dedication"
                            type="text"
                            maxlength="200"
                            placeholder="想送给谁，可以写在这里"
                          />
                        </label>
                      </div>

                      <label class="form-field full">
                        <span>留言补充</span>
                        <textarea
                          v-model.trim="requestForm.message"
                          maxlength="1000"
                          placeholder="想补充的说明、原因或者节目语境都可以写在这里"
                        />
                      </label>

                      <div class="form-actions">
                        <span class="form-note">
                          {{
                            selectedSource
                              ? `已锁定 ${musicProviderLabel(selectedSource.provider)} 音源，后台可直接试听`
                              : "也可以不锁定音源直接投稿，但后台处理会更慢。"
                          }}
                        </span>

                        <button
                          class="submit-button"
                          type="submit"
                          :disabled="submittingRequest || (loginRequired && !hasToken)"
                        >
                          {{ submittingRequest ? "提交中..." : "提交投稿" }}
                        </button>
                      </div>
                    </div>
                  </form>
                </section>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
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
  router.replace({
    query: {
      ...route.query,
      tab,
    },
  }).catch(() => undefined);
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

function stopPreviewAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
  } catch {
    // ignore
  }
}

function closePreview(target: PreviewTarget) {
  stopPreviewAudio(target === "songs" ? songPreviewAudioRef.value : requestPreviewAudioRef.value);
  resetPreviewState(target);
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
.voicehub-home {
  position: relative;
  min-height: calc(100vh - 120px);
  padding: 24px 0 40px;
  background: #f6f8f2;
  overflow: hidden;
}

.ellipse-effect {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% 16%, rgba(47, 125, 79, 0.14) 0%, transparent 30%),
    radial-gradient(circle at 88% 10%, rgba(194, 138, 38, 0.12) 0%, transparent 26%),
    radial-gradient(circle at 54% 84%, rgba(46, 111, 174, 0.08) 0%, transparent 28%);
}

.main-content {
  position: relative;
  z-index: 1;
  width: min(1240px, calc(100vw - 32px));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.top-bar,
.content-area,
.surface-card,
.rules-section,
.form-container,
.audio-player,
.selected-source-banner,
.status-banner {
  border: 1px solid #d5dfcd;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 34px rgba(43, 61, 43, 0.1);
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 22px;
  border-radius: 26px;
  backdrop-filter: blur(18px);
}

.logo-section,
.logo-divider-container,
.user-section,
.audio-top,
.selected-source-main,
.selected-source-actions,
.result-actions,
.request-actions,
.status-banner-actions,
.form-actions,
.program-top,
.request-title-row,
.weekday-head {
  display: flex;
  align-items: center;
}

.logo-section {
  gap: 16px;
  min-width: 0;
}

.logo-link {
  width: 72px;
  height: 72px;
  padding: 10px;
  display: grid;
  place-items: center;
  border-radius: 22px;
  border: 1px solid #d5dfcd;
  background: #fff;
  box-shadow: 0 12px 24px rgba(43, 61, 43, 0.08);
}

.logo-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.logo-divider-container {
  gap: 16px;
  min-width: 0;
}

.logo-divider {
  width: 1px;
  height: 56px;
  background: linear-gradient(180deg, transparent 0%, #c8d5c0 20%, #c8d5c0 80%, transparent 100%);
}

.school-mark {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.school-kicker,
.eyebrow,
.tab-kicker,
.panel-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #788878;
}

.school-mark strong {
  font-size: 26px;
  line-height: 1.1;
  color: #1f2a1f;
}

.user-section {
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.action-chip,
.mini-btn,
.search-button,
.submit-button,
.platform-btn,
.section-tab,
.text-link {
  border: 0;
  font: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-chip,
.mini-btn,
.search-button,
.submit-button {
  min-height: 42px;
  padding: 0 18px;
  border-radius: 14px;
  font-weight: 700;
}

.action-chip,
.mini-btn.ghost {
  color: #2b3d2b;
  background: #eef4e8;
  border: 1px solid #d3decb;
}

.action-chip.primary,
.mini-btn.primary,
.search-button,
.submit-button,
.platform-btn.active {
  color: #fff;
  background: linear-gradient(180deg, #2f7d4f 0%, #246a41 100%);
  box-shadow: 0 10px 24px rgba(47, 125, 79, 0.2);
}

.action-chip:hover,
.mini-btn:hover,
.search-button:hover,
.submit-button:hover,
.platform-btn:hover,
.section-tab:hover {
  transform: translateY(-1px);
}

.action-chip:disabled,
.mini-btn:disabled,
.search-button:disabled,
.submit-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.site-title {
  padding: 6px 2px 2px;
}

.title-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.eyebrow {
  color: #5f715f;
}

.main-title {
  margin: 0;
  font-size: clamp(36px, 6vw, 64px);
  line-height: 0.96;
  letter-spacing: -0.04em;
  color: #1f2a1f;
  font-weight: 800;
}

.title-divider {
  width: min(420px, 100%);
  height: 1px;
  background: linear-gradient(90deg, #9cad9c 0%, #d9e4d1 58%, transparent 100%);
}

.sub-title-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  color: #5f715f;
  font-size: 14px;
}

.sub-title-row span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sub-title-row span::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #2f7d4f;
  box-shadow: 0 0 10px rgba(47, 125, 79, 0.32);
}

.status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 22px;
}

.status-banner.warning {
  background: linear-gradient(135deg, rgba(194, 138, 38, 0.1) 0%, rgba(255, 255, 255, 0.96) 100%);
}

.status-banner-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-banner-copy strong,
.panel-heading h2,
.weekday-copy strong,
.request-copy h3,
.result-title,
.selected-source-copy strong,
.program-card h3 {
  color: #1f2a1f;
}

.status-banner-copy p,
.panel-heading p,
.weekday-copy p,
.request-copy p,
.request-meta,
.result-artist,
.result-meta,
.selected-source-copy span,
.selected-source-copy small,
.audio-meta span,
.audio-notice,
.form-note,
.status-copy,
.rules-content-desktop p,
.program-summary,
.program-meta,
.program-subtitle {
  margin: 0;
  color: #5f715f;
}

.content-area {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px;
  border-radius: 30px;
  background: rgba(251, 253, 248, 0.84);
}

.tabs-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.section-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 18px;
  background: transparent;
  border: 1px solid transparent;
  color: #556555;
  text-align: left;
}

.section-tab.active {
  color: #2f7d4f;
  background: rgba(47, 125, 79, 0.1);
  border-color: rgba(47, 125, 79, 0.24);
}

.tab-text {
  font-size: 17px;
  font-weight: 800;
}

.tab-content-container {
  min-height: 520px;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.schedule-columns,
.request-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
}

.surface-card,
.rules-section,
.form-container {
  border-radius: 24px;
  padding: 22px;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.panel-heading.compact {
  margin-bottom: 14px;
}

.panel-heading h2 {
  margin: 4px 0 8px;
  font-size: 28px;
  line-height: 1.1;
}

.meta-chip,
.slot-label,
.time-pill,
.tag-chip,
.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.meta-chip,
.slot-label,
.time-pill,
.tag-chip {
  background: rgba(47, 125, 79, 0.1);
  color: #2f7d4f;
}

.status-pill.success {
  background: rgba(47, 125, 79, 0.14);
  color: #2f7d4f;
}

.status-pill.warning {
  background: rgba(194, 138, 38, 0.14);
  color: #a5741f;
}

.status-pill.danger {
  background: rgba(209, 73, 91, 0.14);
  color: #b93c4e;
}

.weekday-grid,
.program-list,
.request-list,
.results-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.weekday-panel,
.program-card,
.request-row,
.result-item,
.selected-source-banner,
.audio-player,
.submission-form-shell {
  border-radius: 20px;
  border: 1px solid #d7e1cf;
  background: #f8fbf5;
}

.weekday-panel,
.program-card,
.submission-form-shell {
  padding: 18px;
}

.weekday-head,
.request-title-row,
.program-top {
  justify-content: space-between;
  gap: 12px;
}

.weekday-head strong {
  font-size: 18px;
}

.weekday-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.weekday-item {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 14px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e0e8da;
}

.weekday-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.program-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.program-card h3,
.request-copy h3,
.result-title {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
}

.program-subtitle {
  font-weight: 700;
}

.program-meta,
.request-meta,
.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  font-size: 13px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.list-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) repeat(2, minmax(0, 0.45fr));
  gap: 12px;
  margin-bottom: 14px;
}

.filter-field,
.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-field span,
.form-field span,
.search-label,
.section-title {
  color: #334233;
  font-size: 14px;
  font-weight: 700;
}

.filter-field input,
.filter-field select,
.form-field input,
.form-field select,
.form-field textarea,
.search-input {
  width: 100%;
  min-height: 46px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid #c8d5c0;
  background: #fff;
  color: #1f2a1f;
  font: inherit;
  outline: none;
  transition: all 0.2s ease;
}

.form-field textarea {
  min-height: 126px;
  padding: 12px 14px;
  resize: vertical;
}

.filter-field input:focus,
.filter-field select:focus,
.form-field input:focus,
.form-field select:focus,
.form-field textarea:focus,
.search-input:focus {
  border-color: #2f7d4f;
  box-shadow: 0 0 0 3px rgba(47, 125, 79, 0.12);
}

.request-row,
.result-item,
.selected-source-banner {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 16px;
}

.request-cover,
.result-cover,
.selected-source-cover {
  width: 88px;
  height: 88px;
  border-radius: 18px;
  overflow: hidden;
  background: #e8efe1;
  color: #2f7d4f;
  display: grid;
  place-items: center;
  font-size: 28px;
  font-weight: 800;
}

.request-cover img,
.result-cover img,
.selected-source-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.request-copy,
.result-info,
.selected-source-copy,
.audio-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.request-actions,
.result-actions,
.selected-source-actions,
.status-banner-actions,
.form-actions {
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.text-link {
  padding: 0;
  background: transparent;
  color: #2f7d4f;
  font-weight: 700;
}

.audio-player {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.audio-top {
  justify-content: space-between;
  gap: 16px;
}

.audio-player audio {
  width: 100%;
}

.empty-state {
  display: grid;
  place-items: center;
  min-height: 180px;
  padding: 24px;
  border-radius: 20px;
  border: 1px dashed #c8d5c0;
  background: #f4f8ef;
  color: #627262;
  text-align: center;
}

.empty-state.compact {
  min-height: 120px;
}

.request-pane {
  gap: 0;
}

.request-form {
  align-items: start;
}

.rules-section {
  position: sticky;
  top: 24px;
}

.rules-content-desktop {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.form-container {
  background: rgba(255, 255, 255, 0.94);
}

.song-request-form,
.search-results-container,
.submission-form-shell {
  display: flex;
  flex-direction: column;
}

.song-request-form {
  gap: 18px;
}

.search-results-container {
  gap: 14px;
  padding: 18px;
  border-radius: 20px;
  background: #f4f8ef;
  border: 1px solid #d8e2d1;
}

.form-header-row {
  display: flex;
}

.search-section {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.search-input-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.login-entry,
.source-status-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #d8e2d1;
}

.login-desc {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.login-title {
  margin: 0;
  color: #1f2a1f;
  font-weight: 800;
}

.login-hint {
  margin: 0;
  color: #5f715f;
}

.platform-selection-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.platform-selection {
  display: flex;
  gap: 8px;
  padding: 4px;
  border-radius: 16px;
  background: #e9f0e2;
  border: 1px solid #d3decb;
}

.platform-btn {
  flex: 1 1 0;
  min-height: 42px;
  padding: 0 12px;
  border-radius: 12px;
  color: #4b5d4b;
  background: transparent;
  font-weight: 700;
}

.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.status-title {
  color: #1f2a1f;
  font-weight: 700;
}

.status-summary {
  color: #708070;
  font-size: 12px;
  font-weight: 700;
}

.results-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-inline {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid #d8e2d1;
  background: #fff;
  color: #5f715f;
}

.status-inline.error {
  color: #b93c4e;
  border-color: rgba(209, 73, 91, 0.24);
  background: rgba(209, 73, 91, 0.08);
}

.result-cover {
  width: 72px;
  height: 72px;
}

.result-meta {
  font-size: 12px;
}

.submission-form-shell {
  gap: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 4px;
}

.form-field.full {
  margin-top: 14px;
}

.form-actions {
  margin-top: 16px;
  align-items: center;
  justify-content: space-between;
}

.form-note {
  font-size: 13px;
  line-height: 1.6;
}

.submit-button {
  min-width: 148px;
}

.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.tab-fade-enter-from,
.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 1180px) {
  .schedule-columns,
  .request-form {
    grid-template-columns: 1fr;
  }

  .rules-section {
    position: static;
  }
}

@media (max-width: 920px) {
  .main-content {
    width: min(100vw - 24px, 100%);
  }

  .top-bar,
  .list-toolbar,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .top-bar,
  .logo-section,
  .logo-divider-container,
  .status-banner,
  .status-banner-actions,
  .audio-top,
  .request-actions,
  .result-actions,
  .selected-source-actions,
  .form-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .user-section {
    width: 100%;
    justify-content: stretch;
  }

  .user-section > * {
    width: 100%;
  }

  .tabs-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .voicehub-home {
    padding-top: 16px;
  }

  .top-bar,
  .content-area,
  .surface-card,
  .rules-section,
  .form-container {
    border-radius: 22px;
  }

  .content-area {
    padding: 14px;
  }

  .panel-heading h2,
  .program-card h3,
  .request-copy h3,
  .result-title {
    font-size: 22px;
  }

  .main-title {
    font-size: clamp(32px, 12vw, 52px);
  }

  .request-row,
  .result-item,
  .selected-source-banner,
  .weekday-item {
    grid-template-columns: 1fr;
  }

  .request-cover,
  .result-cover,
  .selected-source-cover {
    width: 72px;
    height: 72px;
  }

  .platform-selection {
    flex-direction: column;
  }

  .search-input-group {
    grid-template-columns: 1fr;
  }
}
</style>
