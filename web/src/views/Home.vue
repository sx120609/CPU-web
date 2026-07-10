<template>
  <div class="home">
    <section class="welcome" aria-labelledby="home-title">
      <div class="welcome-copy">
        <div class="welcome-label">中国药科大学 · 校园生活入口</div>
        <h1 id="home-title">{{ welcomeTitle }}</h1>
        <p>{{ welcomeIntro }}</p>
      </div>
      <div class="welcome-actions">
        <el-button
          v-if="site.features.forum"
          type="primary"
          size="large"
          @click="router.push('/forum')"
        >
          <el-icon><ChatLineRound /></el-icon>
          {{ forumActionLabel }}
        </el-button>
        <el-button
          v-else
          type="primary"
          size="large"
          @click="router.push('/announcements')"
        >
          <el-icon><Bell /></el-icon>
          查看公告
        </el-button>
        <button type="button" class="welcome-link" @click="router.push('/schedule')">
          <el-icon><Calendar /></el-icon>
          <span>查看课表</span>
          <el-icon><ArrowRight /></el-icon>
        </button>
      </div>
    </section>

    <section v-if="homeError && !loading && !summary" class="home-alert" role="alert">
      <span class="home-alert-icon"><el-icon><WarningFilled /></el-icon></span>
      <div>
        <strong>首页内容暂时不可用</strong>
        <span>{{ homeError }}</span>
      </div>
      <el-button type="primary" plain @click="loadSummary">
        <el-icon><Refresh /></el-icon>
        重试
      </el-button>
    </section>

    <div v-else-if="loading && !summary" class="home-skeleton" aria-label="首页内容加载中" aria-busy="true">
      <section class="panel skeleton-main"><el-skeleton animated :rows="6" /></section>
      <section class="panel"><el-skeleton animated :rows="4" /></section>
    </div>

    <div
      v-else
      class="home-content"
      :class="{ 'home-content--single': !showForumContent }"
      v-loading="loading"
    >
      <div class="side-column">
        <section class="panel panel--services">
          <header class="section-head">
            <div>
              <h2>校园服务</h2>
              <p>常用入口，直接到达</p>
            </div>
            <router-link to="/services" class="section-link">全部<el-icon><ArrowRight /></el-icon></router-link>
          </header>

          <div v-if="hasServiceEntries" class="service-list">
            <button
              v-if="showElectricEntry"
              type="button"
              class="service-item"
              aria-label="宿舍电费，站内查询"
              @click="electricOpen = true"
            >
              <span class="service-icon">💡</span>
              <span class="service-copy">
                <strong>宿舍电费</strong>
                <small>站内查询</small>
              </span>
              <el-icon class="row-arrow"><ArrowRight /></el-icon>
            </button>
            <button
              v-for="serviceItem in visibleServices"
              :key="serviceItem.id"
              type="button"
              class="service-item"
              :aria-label="`${serviceItem.name}，${serviceItem.needSso ? '需要登录' : '直接打开'}`"
              @click="openUrl(serviceItem.url)"
            >
              <span class="service-icon">{{ serviceItem.icon || "🔗" }}</span>
              <span class="service-copy">
                <strong>{{ serviceItem.name }}</strong>
                <small>{{ serviceItem.needSso ? "需要登录" : "直接打开" }}</small>
              </span>
              <el-icon class="row-arrow"><ArrowRight /></el-icon>
            </button>
          </div>
          <div v-else class="empty-note">暂无可用服务</div>
        </section>

        <section class="panel panel--announcements">
          <header class="section-head">
            <div>
              <h2>校园公告</h2>
              <p>学校公开信息汇总</p>
            </div>
            <router-link to="/announcements" class="section-link">全部<el-icon><ArrowRight /></el-icon></router-link>
          </header>

          <ul v-if="summary?.announce?.length" class="announcement-list">
            <li v-for="topic in summary.announce" :key="'ann-' + topic.id">
              <button type="button" @click="openTopic(topic.id)">
                <span class="announcement-dot" aria-hidden="true"></span>
                <span class="announcement-copy">
                  <strong>{{ topic.title }}</strong>
                  <small>{{ topic.board?.name || "校园公告" }} · {{ fmtRelative(topic.createdAt) }}</small>
                </span>
                <el-icon class="row-arrow"><ArrowRight /></el-icon>
              </button>
            </li>
          </ul>
          <div v-else class="empty-note">暂无公告，稍后再来看看</div>
        </section>

        <button
          v-if="showForumContent"
          type="button"
          class="wall-link"
          @click="openBoard('campus-wall')"
        >
          <span class="wall-icon">📮</span>
          <span>
            <strong>逛逛校园</strong>
            <small>看看同学们正在分享的新鲜事</small>
          </span>
          <el-icon><ArrowRight /></el-icon>
        </button>
      </div>

      <div v-if="showForumContent" class="main-column">
        <section v-if="summary?.pinnedTopics?.length" class="panel panel--pinned">
          <header class="section-head">
            <div>
              <h2>置顶内容</h2>
              <p>重要信息</p>
            </div>
          </header>
          <div class="simple-list">
            <button
              v-for="topic in summary.pinnedTopics"
              :key="'pin-' + topic.id"
              type="button"
              class="simple-row"
              @click="openTopic(topic.id)"
            >
              <span class="pin-mark">置顶</span>
              <span class="simple-copy">
                <strong>{{ topic.title }}</strong>
                <small>{{ topic.board?.name || "校园讨论" }} · {{ fmtRelative(topic.lastReplyAt || topic.createdAt) }}</small>
                <small v-if="topicMetaText(topic)" class="topic-extra">{{ topicMetaText(topic) }}</small>
              </span>
              <el-icon class="row-arrow"><ArrowRight /></el-icon>
            </button>
          </div>
        </section>

        <section class="panel panel--latest">
          <header class="section-head">
            <div>
              <h2>最新动态</h2>
              <p>刚刚发生在校园里的讨论</p>
            </div>
            <router-link to="/forum/latest" class="section-link">更多<el-icon><ArrowRight /></el-icon></router-link>
          </header>

          <div v-if="summary?.latestTopics?.length" class="simple-list">
            <button
              v-for="topic in summary.latestTopics"
              :key="'new-' + topic.id"
              type="button"
              class="simple-row"
              @click="openTopic(topic.id)"
            >
              <span class="board-mark" :style="{ '--board-color': topic.board?.color || 'var(--cpu-primary)' }">
                {{ topic.board?.name?.slice(0, 1) || "新" }}
              </span>
              <span class="simple-copy">
                <strong>{{ topic.title || topic.content || "无标题内容" }}</strong>
                <small>
                  {{ topic.board?.name || "校园讨论" }} · {{ fmtRelative(topic.lastReplyAt || topic.createdAt) }} · {{ topic.replyCount ?? 0 }} 回复
                </small>
                <small v-if="topicMetaText(topic)" class="topic-extra">{{ topicMetaText(topic) }}</small>
              </span>
              <el-icon class="row-arrow"><ArrowRight /></el-icon>
            </button>
          </div>
          <div v-else class="empty-note">暂时还没有最新内容</div>
        </section>

        <section class="panel panel--hot">
          <header class="section-head">
            <div>
              <h2>校园热议</h2>
              <p>此刻大家关注的话题</p>
            </div>
            <router-link to="/forum/hot" class="section-link">热榜<el-icon><ArrowRight /></el-icon></router-link>
          </header>

          <div v-if="hotPreview.length" class="hot-list">
            <button
              v-for="topic in hotPreview"
              :key="'hot-' + topic.id"
              type="button"
              class="hot-row"
              @click="openTopic(topic.id)"
            >
              <span class="hot-rank" :class="{ 'hot-rank--first': topic.rank === 1 }">{{ topic.rank }}</span>
              <span class="hot-copy">
                <strong>{{ topic.title }}</strong>
                <small>{{ topic.board?.name || "校园讨论" }} · {{ topic.replyCount ?? 0 }} 回复 · {{ topic.likeCount ?? 0 }} 赞</small>
                <small v-if="topicMetaText(topic)" class="topic-extra">{{ topicMetaText(topic) }}</small>
              </span>
              <span class="hot-score">{{ Math.round(topic.hotScore || 0) }}</span>
            </button>
          </div>
          <div v-else class="empty-note">暂时还没有热议内容</div>
        </section>
      </div>
    </div>

    <DormElectricDialog v-model="electricOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowRight,
  Bell,
  Calendar,
  ChatLineRound,
  Refresh,
  WarningFilled,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import DormElectricDialog from "@/components/services/DormElectricDialog.vue";
import { homeApi, type HomeSummary } from "@/api/home";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { fmtRelative } from "@/utils/format";

const auth = useAuthStore();
const site = useSiteStore();
const router = useRouter();
const summary = ref<HomeSummary | null>(null);
const loading = ref(false);
const homeError = ref("");
const electricOpen = ref(false);
const hotPreview = computed(() => (summary.value?.hotTopics ?? []).slice(0, 3));
const visibleServices = computed(() => summary.value?.services ?? []);
const showElectricEntry = computed(() => auth.isLoggedIn && site.features.electric);
const hasServiceEntries = computed(() => showElectricEntry.value || visibleServices.value.length > 0);
const showForumContent = computed(() => site.features.forum && auth.canAccessForum);
let loadSeq = 0;

const welcomeTitle = computed(() => {
  const nickname = auth.nickname.trim();
  return auth.isLoggedIn && nickname ? `欢迎回来，${nickname}` : "你好，这里是药大拾间";
});

const welcomeIntro = computed(() => showForumContent.value
  ? "校园讨论、公告、课表和常用服务，今天也从这里开始。"
  : "校园公告、教务数据、课表和常用服务，都在这里。"
);

const forumActionLabel = computed(() => {
  if (auth.canAccessForum) return "进入论坛";
  return auth.isLoggedIn ? "开启论坛功能" : "论坛入口";
});

onMounted(loadSummary);

async function loadSummary() {
  const seq = ++loadSeq;
  loading.value = true;
  homeError.value = "";
  try {
    const next = await homeApi.summary({ suppressErrorMessage: true });
    if (seq !== loadSeq) return;
    summary.value = next;
  } catch (error) {
    if (seq !== loadSeq) return;
    homeError.value = normalizeHomeError(error);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function openUrl(url: string) {
  const target = typeof url === "string" ? url.trim() : "";
  if (!target) {
    ElMessage.warning("该服务暂未配置链接");
    return;
  }
  if (target.startsWith("/")) {
    router.push(target);
    return;
  }
  if (target.startsWith("tel:") || target.startsWith("mailto:")) {
    window.location.href = target;
    return;
  }
  if (/^https?:\/\//i.test(target)) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  ElMessage.warning("该服务链接格式暂不支持");
}

function openTopic(id: number) {
  router.push(`/forum/topic/${id}`);
}

function openBoard(slug: string) {
  router.push(`/forum/b/${slug}`);
}

function topicMetaText(topic: any) {
  const metadata = topic?.metadata ?? {};
  const labels: string[] = [];
  if (metadata.price !== undefined && metadata.price !== null && metadata.price !== "") {
    labels.push(`¥${metadata.price}`);
  }
  const recommend = metadata.ratings?.recommend;
  if (typeof recommend === "number" && recommend > 0) {
    labels.push(`推荐度 ${recommend.toFixed(1)}`);
  }
  if (metadata.resolved === true) labels.push("已解决");
  if (metadata.bounty) labels.push(`悬赏 ${metadata.bounty}`);
  if (topic?.locked) labels.push("已锁定");
  return labels.join(" · ");
}

function normalizeHomeError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "首页服务暂时不可用";
  }
  return "服务暂时不可用，请稍后重试。";
}
</script>

<style scoped lang="scss">
.home {
  display: flex;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  flex-direction: column;
  gap: 16px;
}

.welcome {
  position: relative;
  display: flex;
  min-height: 138px;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  padding: 24px 28px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 16%, var(--cpu-border-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--cpu-primary) 4%, var(--cpu-card));
}

.welcome-copy {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.welcome-label {
  margin-bottom: 6px;
  color: var(--cpu-primary-dark);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
}

.welcome h1 {
  margin: 0;
  color: var(--cpu-text);
  font-size: clamp(24px, 2.4vw, 30px);
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.welcome p {
  margin: 8px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.welcome-actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 14px;
}

.welcome-actions :deep(.el-button) {
  min-height: 42px;
  margin-left: 0;
  border-radius: 9px;
  padding-inline: 18px;
  font-weight: 600;
}

.welcome-link {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 5px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.welcome-link:hover { color: var(--cpu-primary-dark); }

.home-alert {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 70px;
  padding: 12px 16px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.07);
}

.home-alert-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 9px;
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
}

.home-alert > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.home-alert strong { color: var(--cpu-text); font-size: 13px; }
.home-alert span { color: var(--cpu-text-secondary); font-size: 12px; }

.home-skeleton,
.home-content {
  display: grid;
  grid-template-columns: minmax(300px, 0.82fr) minmax(0, 1.75fr);
  gap: 16px;
  align-items: start;
}

.skeleton-main {
  grid-column: 2;
  grid-row: span 2;
}

.home-skeleton > .panel:not(.skeleton-main) {
  grid-column: 1;
  grid-row: 1;
}

.side-column {
  grid-column: 1;
  grid-row: 1;
}

.main-column {
  grid-column: 2;
  grid-row: 1;
}

.side-column,
.main-column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

.home-content--single {
  grid-template-columns: 1fr;
}

.home-content--single .side-column {
  grid-column: 1;
}

.panel {
  min-width: 0;
  padding: 17px 18px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
}

.panel--pinned {
  border-left: 3px solid var(--cpu-gold);
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.section-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--cpu-text);
  font-size: 16px;
  font-weight: 650;
  line-height: 1.3;
}

.section-head h2::before {
  content: "";
  width: 3px;
  height: 14px;
  border-radius: 3px;
  background: var(--cpu-primary);
}

.panel--pinned .section-head h2::before {
  background: var(--cpu-gold);
}

.section-head p {
  margin: 3px 0 0 11px;
  color: var(--cpu-text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.section-link {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  color: var(--cpu-primary-dark);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}

.section-link:hover { color: #0a5f51; }

:global(html[data-theme="dark"]) .welcome-label,
:global(html[data-theme="dark"]) .section-link,
:global(html[data-theme="dark"]) .simple-copy .topic-extra,
:global(html[data-theme="dark"]) .hot-copy .topic-extra,
:global(html[data-theme="dark"]) .hot-score {
  color: var(--cpu-primary);
}

:global(html[data-theme="dark"]) .welcome-link:hover,
:global(html[data-theme="dark"]) .section-link:hover {
  color: var(--cpu-primary-light);
}

.service-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.service-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  min-width: 0;
  min-height: 58px;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: var(--cpu-surface-soft);
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.16s ease, background-color 0.16s ease;
}

.service-item:hover {
  border-color: rgba(20, 143, 123, 0.3);
  background: var(--cpu-surface-subtle);
}

.service-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
  font-size: 17px;
}

.service-copy,
.announcement-copy,
.simple-copy,
.hot-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.service-copy strong {
  overflow: hidden;
  color: var(--cpu-text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-copy small {
  margin-top: 2px;
  color: var(--cpu-text-secondary);
  font-size: 11px;
}

.row-arrow {
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
  font-size: 13px;
}

.announcement-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.announcement-list li + li,
.simple-row + .simple-row,
.hot-row + .hot-row {
  border-top: 1px solid var(--cpu-border-soft);
}

.announcement-list button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  width: 100%;
  padding: 10px 3px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.announcement-list button:hover { background: var(--cpu-surface-soft); }

.announcement-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cpu-primary);
}

.announcement-copy strong {
  overflow: hidden;
  color: var(--cpu-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcement-copy small {
  margin-top: 3px;
  color: var(--cpu-text-secondary);
  font-size: 11px;
}

.wall-link {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  min-height: 64px;
  padding: 11px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  background: var(--cpu-card);
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.wall-link:hover { border-color: rgba(20, 143, 123, 0.28); }
.wall-link > span:nth-child(2) { display: flex; min-width: 0; flex-direction: column; }
.wall-link strong { color: var(--cpu-text); font-size: 13px; }
.wall-link small { margin-top: 2px; color: var(--cpu-text-secondary); font-size: 10px; }
.wall-link > .el-icon { color: var(--cpu-text-muted); }
.wall-icon { font-size: 20px; }

.simple-list,
.hot-list {
  margin: 0 -4px -3px;
}

.simple-row,
.hot-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
  width: 100%;
  min-height: 60px;
  padding: 10px 7px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.simple-row:hover,
.hot-row:hover {
  background: var(--cpu-surface-soft);
}

.pin-mark {
  display: inline-flex;
  min-width: 34px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: rgba(245, 158, 11, 0.11);
  color: #92400e;
  font-size: 10px;
  font-weight: 650;
}

.board-mark,
.hot-rank {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
  font-size: 11px;
  font-weight: 700;
}

.board-mark {
  border-left: 3px solid var(--board-color);
  color: var(--cpu-text);
}

.simple-copy strong,
.hot-copy strong {
  overflow: hidden;
  color: var(--cpu-text);
  font-size: 14px;
  font-weight: 580;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.simple-copy small,
.hot-copy small {
  overflow: hidden;
  margin-top: 4px;
  color: var(--cpu-text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.simple-copy .topic-extra,
.hot-copy .topic-extra {
  color: var(--cpu-primary-dark);
  font-weight: 600;
}

.hot-rank--first {
  background: rgba(245, 158, 11, 0.11);
  color: #92400e;
}

:global(html[data-theme="dark"]) .home-alert-icon,
:global(html[data-theme="dark"]) .pin-mark,
:global(html[data-theme="dark"]) .hot-rank--first {
  color: #fbbf24;
}

.hot-score {
  min-width: 38px;
  color: var(--cpu-primary-dark);
  font-size: 13px;
  font-weight: 650;
  text-align: right;
}

.empty-note {
  display: grid;
  min-height: 68px;
  place-items: center;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

@media (max-width: 960px) {
  .home-content {
    display: flex;
    align-items: stretch;
    flex-direction: column;
  }

  .side-column,
  .main-column {
    display: contents;
  }

  .panel--services { order: 1; }
  .panel--announcements { order: 2; }
  .wall-link { order: 3; }
  .panel--pinned { order: 4; }
  .panel--latest { order: 5; }
  .panel--hot { order: 6; }

  .home-skeleton {
    grid-template-columns: 1fr;
  }

  .skeleton-main,
  .home-skeleton > .panel:not(.skeleton-main) {
    grid-column: auto;
    grid-row: auto;
  }
}

@media (min-width: 900px) {
  .home-content--single .service-list {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .home-content--single .announcement-copy {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
  }

  .home-content--single .announcement-copy small {
    margin-top: 0;
    white-space: nowrap;
  }
}

@media (max-width: 600px) {
  .home { gap: 12px; }

  .welcome {
    min-height: 0;
    align-items: flex-start;
    flex-direction: column;
    gap: 14px;
    padding: 17px 16px;
    border-radius: 11px;
  }

  .welcome-label { font-size: 10px; }
  .welcome h1 { font-size: 23px; }
  .welcome p { margin-top: 6px; font-size: 13px; line-height: 1.55; }

  .welcome-actions {
    width: 100%;
    justify-content: space-between;
  }

  .welcome-actions :deep(.el-button) {
    min-height: 40px;
    padding-inline: 15px;
  }

  .welcome-link { min-height: 40px; }

  .panel {
    width: 100%;
    padding: 14px 13px;
    border-radius: 10px;
  }

  .side-column,
  .main-column {
    gap: 12px;
  }

  .section-head { margin-bottom: 8px; }
  .section-head h2 { font-size: 15px; }
  .section-head p { display: none; }
  .section-link { min-height: 28px; font-size: 11px; }

  .service-list { gap: 7px; }
  .service-item { min-height: 54px; padding: 7px; }
  .service-icon { width: 29px; height: 29px; font-size: 16px; }
  .service-copy strong { font-size: 11px; }

  .simple-row,
  .hot-row { min-height: 56px; gap: 9px; padding: 9px 4px; }
  .simple-copy strong,
  .hot-copy strong { font-size: 13px; }

  .announcement-copy strong {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .home-alert {
    grid-template-columns: auto minmax(0, 1fr);
    padding: 11px 12px;
  }

  .home-alert .el-button {
    grid-column: 2;
    justify-self: start;
    margin-left: 0;
  }
}

@media (max-width: 360px) {
  .service-list { gap: 6px; }
  .service-item { gap: 6px; padding-inline: 6px; }
  .service-item .row-arrow { display: none; }
  .service-copy small { font-size: 10px; }
}
</style>
