<template>
  <div class="home">
    <!-- Hero / 介绍 -->
    <section class="hero" aria-label="首页功能入口">
      <div class="hero-text">
        <h1>药大拾间</h1>
        <p>{{ heroIntro }}</p>
        <div class="hero-actions">
          <el-button v-if="site.features.forum" type="primary" size="large" @click="$router.push('/forum')">
            <el-icon><ChatLineRound /></el-icon>
            <span class="action-label-full">{{ forumActionLabel }}</span>
            <span class="action-label-short">论坛</span>
          </el-button>
          <el-button v-if="site.features.market && auth.canAccessForum" size="large" @click="$router.push('/market')">
            <AppIcon name="market" />
            <span class="action-label-full">二手交流</span>
            <span class="action-label-short">二手</span>
          </el-button>
          <el-button v-else type="primary" size="large" @click="$router.push('/announcements')">
            <el-icon><Bell /></el-icon>
            <span class="action-label-full">看校园公告</span>
            <span class="action-label-short">公告</span>
          </el-button>
          <el-button v-if="!auth.isLoggedIn" size="large" @click="$router.push('/login')">
            <span class="action-label-full">{{ loginActionText }}</span>
            <span class="action-label-short">登录</span>
          </el-button>
          <el-button v-else-if="site.features.forum && auth.canAccessForum" size="large" @click="$router.push('/post')">
            <el-icon><Edit /></el-icon>
            <span class="action-label-full">发布内容</span>
            <span class="action-label-short">发布</span>
          </el-button>
          <el-button size="large" @click="$router.push('/search')">
            <el-icon><ChatDotRound /></el-icon> 拾间AI
          </el-button>
        </div>
      </div>
    </section>

    <section v-if="showForumContent" class="home-search-top" aria-label="站内搜索">
      <SiteSearchBar placeholder="搜索帖子或校园服务" />
    </section>

    <section v-if="homeError && !loading" class="block home-error">
      <el-empty :description="homeError">
        <el-button type="primary" @click="loadSummary()">重试</el-button>
      </el-empty>
    </section>

    <div v-else class="grid" :class="{ 'single-col': !showForumContent }" v-loading="loading && !summary">
      <!-- 左：热帖 + 最新 -->
      <div class="col-left" v-if="showForumContent">
        <section class="block" v-if="summary?.pinnedTopics?.length">
          <div class="block-head">
            <h3><AppIcon name="pin" /> 全局置顶</h3>
            <span class="cpu-muted">重要内容</span>
          </div>
          <ForumAdCard v-if="pinnedAd" :ad="pinnedAd" compact />
          <TopicListItem v-for="t in summary.pinnedTopics" :key="'pin-' + t.id" :topic="t" />
        </section>

        <section class="block">
          <div class="block-head latest-head">
            <div>
              <h3><AppIcon name="hot" /> 热议</h3>
              <span class="block-summary">全站互动热度 Top 3</span>
            </div>
            <router-link to="/forum/hot" class="more">查看前十 →</router-link>
          </div>
          <ForumAdCard v-if="hotAd" :ad="hotAd" compact />
          <TopicListItem
            v-for="t in hotPreview"
            :key="'hot-' + t.id"
            :topic="t"
            :rank="t.rank"
            :score="t.hotScore"
            variant="simple"
          />
          <div v-if="hotPreview.length" class="hot-foot">
            <span class="cpu-muted">按回复、点赞与浏览综合排序</span>
            <router-link to="/forum/hot" class="more more-strong">进入热榜 Top 10 →</router-link>
          </div>
          <el-empty v-if="!hotPreview.length" description="暂无内容" />
        </section>

        <section class="block">
          <div class="block-head latest-head">
            <div>
              <h3><AppIcon name="new" /> 最新</h3>
              <span class="block-summary">全站最近发布</span>
            </div>
            <router-link to="/forum/latest" class="more">查看全部 →</router-link>
          </div>
          <TopicListItem v-for="t in summary?.latestTopics ?? []" :key="'new-' + t.id" :topic="t" variant="simple" time-mode="published" />
          <el-empty v-if="!summary?.latestTopics?.length" description="暂无内容" />
        </section>
      </div>

      <!-- 右：公告 + 服务 -->
      <div class="col-right">
        <section class="block">
          <div class="block-head">
            <h3><AppIcon name="announcement" /> 校园公告</h3>
            <span class="cpu-muted">学校公开信息</span>
          </div>
          <ul v-if="summary?.announce?.length" class="announce-list">
            <li
              v-for="t in summary.announce"
              :key="'ann-' + t.id"
              role="button"
              tabindex="0"
              @click="openTopic(t.id)"
              @keydown.enter.prevent="openTopic(t.id)"
              @keydown.space.prevent="openTopic(t.id)"
            >
              <div class="ann-title">{{ t.title }}</div>
              <div class="ann-meta">
                <span class="ann-source">{{ t.board?.name }}</span>
                <span>{{ fmtRelative(t.createdAt) }}</span>
              </div>
            </li>
          </ul>
          <el-empty v-else description="暂无公告，稍后再来看看" />
        </section>

        <section class="block" v-if="site.features.market && auth.canAccessForum">
          <div class="block-head">
            <h3><AppIcon name="market" /> 二手交流</h3>
            <router-link to="/market" class="more">进入板块 →</router-link>
          </div>
          <p class="second-hand-note">校内闲置与求购，按论坛帖子发布和交流。</p>
          <nav class="second-hand-actions" aria-label="发布二手内容">
            <router-link to="/post?board=market&kind=sell">＋ 发布闲置</router-link>
            <span aria-hidden="true"></span>
            <router-link to="/post?board=market&kind=wanted">＋ 发布求购</router-link>
          </nav>
        </section>

        <section class="block">
          <div class="block-head">
            <h3><AppIcon name="service" /> 校园服务</h3>
            <router-link to="/services" class="more">全部 →</router-link>
          </div>
          <div v-if="hasServiceEntries" class="service-grid">
            <div
              v-if="showElectricEntry"
              class="svc svc-special"
              role="button"
              tabindex="0"
              @click="electricOpen = true"
              @keydown.enter.prevent="electricOpen = true"
              @keydown.space.prevent="electricOpen = true"
            >
              <div class="svc-icon"><AppIcon name="electric" /></div>
              <div class="svc-name">宿舍电费</div>
              <div class="svc-tag svc-tag-fresh">站内查</div>
            </div>
            <div
              v-for="s in visibleServices"
              :key="s.id"
              class="svc"
              role="button"
              tabindex="0"
              @click="openUrl(s.url, s.name)"
              @keydown.enter.prevent="openUrl(s.url, s.name)"
              @keydown.space.prevent="openUrl(s.url, s.name)"
            >
              <div class="svc-icon"><AppIcon :legacy="s.icon" name="link" /></div>
              <div class="svc-name">{{ s.name }}</div>
              <div class="svc-tag" v-if="s.needSso">需登录</div>
            </div>
          </div>
          <el-empty v-else description="暂无可用服务" />
        </section>
      </div>
    </div>

    <router-link
      v-if="auth.isLoggedIn && site.features.forum && auth.canAccessForum"
      to="/post"
      class="home-publish-fab"
      aria-label="发布内容"
    >
      <el-icon><Edit /></el-icon>
      <span>发布</span>
    </router-link>

    <DormElectricDialog v-model="electricOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { ChatLineRound, ChatDotRound, Edit, Bell } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import ForumAdCard from "@/components/forum/ForumAdCard.vue";
import SiteSearchBar from "@/components/search/SiteSearchBar.vue";
import AppIcon from "@/components/common/AppIcon.vue";
import DormElectricDialog from "@/components/services/DormElectricDialog.vue";
import { homeApi, type HomeSummary } from "@/api/home";
import { forumAdsApi, type ForumAd } from "@/api/forumAds";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { fmtRelative } from "@/utils/format";
import {
  readHomeSummaryCache,
  writeHomeSummaryCache,
} from "@/utils/homeCache";

const auth = useAuthStore();
const site = useSiteStore();
const router = useRouter();
const summary = ref<HomeSummary | null>(null);
const loading = ref(false);
const homeError = ref("");
const electricOpen = ref(false);
const pinnedAd = ref<ForumAd | null>(null);
const hotAd = ref<ForumAd | null>(null);
const hotPreview = computed(() => (summary.value?.hotTopics ?? []).slice(0, 3));
const visibleServices = computed(() => summary.value?.services ?? []);
const showElectricEntry = computed(() => auth.isLoggedIn && site.features.electric);
const hasServiceEntries = computed(() => showElectricEntry.value || visibleServices.value.length > 0);
const homeCacheScope = computed(() => {
  const identity = auth.user?.id ? `user-${auth.user.id}` : "guest";
  return `${identity}:forum-${auth.canAccessForum ? "on" : "off"}`;
});
let loadSeq = 0;
let adsLoadSeq = 0;
let mounted = false;

const enabledFeatureLabels = computed(() => {
  const labels = ["公告聚合", "教务数据", "常用校园服务"];
  if (site.features.coursereview && auth.canAccessForum) labels.splice(2, 0, "课程点评");
  if (site.features.market && auth.canAccessForum) labels.splice(labels.length - 1, 0, "二手交流");
  if (site.features.electric) labels.push("宿舍电费查询");
  if (site.features.forum && auth.canAccessForum) labels.unshift("校园讨论");
  return labels;
});
const showForumContent = computed(() => site.features.forum && auth.canAccessForum);
const forumActionLabel = computed(() => {
  if (!site.features.forum) return "看校园公告";
  if (auth.canAccessForum) return "进入论坛";
  return auth.isLoggedIn ? "开启论坛功能" : "论坛入口";
});

const heroIntro = computed(() => {
  const labels = enabledFeatureLabels.value;
  const text = labels.length > 1 ? `${labels.slice(0, -1).join("、")}与${labels.at(-1)}` : labels[0];
  return `${text}，给药大学生一个更顺手的信息入口。`;
});

const loginActionText = computed(() => site.features.forum ? "登录" : "登录使用");

onMounted(() => {
  mounted = true;
  void loadHomeScope();
});

watch(homeCacheScope, () => {
  if (mounted) void loadHomeScope();
});

async function loadHomeScope() {
  const scope = homeCacheScope.value;
  const cachedSummary = readHomeSummaryCache(scope);
  summary.value = cachedSummary;
  homeError.value = "";
  void loadSummary({ scope, fallback: cachedSummary });
  void loadAds();

}

async function loadAds() {
  const seq = ++adsLoadSeq;
  try {
    const [pinned, hot] = await Promise.all([
      forumAdsApi.list("forum-home-pinned"),
      forumAdsApi.list("forum-home-hot"),
    ]);
    if (seq !== adsLoadSeq) return;
    pinnedAd.value = pinned[0] ?? null;
    hotAd.value = hot[0] ?? null;
  } catch {
    if (seq !== adsLoadSeq) return;
    pinnedAd.value = null;
    hotAd.value = null;
  }
}

async function loadSummary(options: { scope?: string; fallback?: HomeSummary | null } = {}) {
  const scope = options.scope ?? homeCacheScope.value;
  const seq = ++loadSeq;
  loading.value = !summary.value;
  homeError.value = "";
  try {
    const next = await homeApi.summary({ suppressErrorMessage: true, cacheTtlMs: 0 });
    if (seq !== loadSeq || scope !== homeCacheScope.value) return;
    summary.value = next;
    writeHomeSummaryCache(scope, next);
  } catch (e) {
    if (seq !== loadSeq) return;
    if (scope === homeCacheScope.value && options.fallback) {
      summary.value = options.fallback;
    }
    if (!summary.value) homeError.value = normalizeHomeError(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function isMobileTelephoneDevice() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  const ipadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return ipadDesktopMode || /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(userAgent);
}

function openUrl(url: string, label = "联系电话") {
  const target = typeof url === "string" ? url.trim() : "";
  if (!target) {
    ElMessage.warning("该服务暂未配置链接");
    return;
  }
  if (target.startsWith("/")) {
    router.push(target);
    return;
  }
  if (target.startsWith("tel:")) {
    if (isMobileTelephoneDevice()) {
      window.location.href = target;
      return;
    }
    const phone = target.slice(4).split(/[?#;]/, 1)[0].trim();
    void ElMessageBox.alert(phone || target, label, {
      confirmButtonText: "知道了",
      type: "info",
    }).catch(() => undefined);
    return;
  }
  if (target.startsWith("mailto:")) {
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

function normalizeHomeError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "首页内容加载失败";
  }
  return "首页内容加载失败，请稍后再试";
}
</script>

<style scoped lang="scss">
.home {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hero {
  background: linear-gradient(135deg, #168776 0%, #2da391 60%, #0f6557 100%);
  color: #fff;
  border-radius: 16px;
  padding: 32px 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  overflow: hidden;

  &::after {
    content: "";
    position: absolute;
    right: -80px;
    top: -80px;
    width: 280px;
    height: 280px;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 40%, rgba(232, 163, 23, 0.45), transparent 60%);
    pointer-events: none;
  }
}

.hero-text { flex: 1; z-index: 1; }
.hero h1 { margin: 0 0 6px; font-size: 32px; }
.hero p { margin: 0 0 16px; opacity: 0.9; font-size: 15px; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.action-label-short { display: none; }
.hero-actions .el-button { background: rgba(255,255,255,0.9); border: none; color: #168776; }
.hero-actions .el-button:hover { background: #fff; }
.hero-actions .el-button--primary { background: #fff; color: #168776; }

:global(html[data-theme="dark"] .hero-actions .el-button) {
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(238, 248, 245, 0.22);
  color: #eef8f5;
}
:global(html[data-theme="dark"] .hero-actions .el-button:hover) {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(238, 248, 245, 0.34);
  color: #ffffff;
}
:global(html[data-theme="dark"] .hero-actions .el-button--primary) {
  background: rgba(45, 212, 191, 0.95);
  border-color: rgba(45, 212, 191, 0.95);
  color: #05201c;
}
:global(html[data-theme="dark"] .hero-actions .el-button--primary:hover) {
  background: #5eead4;
  border-color: #5eead4;
  color: #04201c;
}

.grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}
.grid.single-col {
  grid-template-columns: 1fr;
}
@media (max-width: 1100px) {
  .grid { grid-template-columns: 1fr; }
}

.col-left, .col-right { display: flex; flex-direction: column; gap: 16px; }

.block {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 16px 20px 12px;
  box-shadow: var(--cpu-shadow-sm);
}
.home-error {
  padding: 24px 16px;
}

.block-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}
.block-head h3 { margin: 0; font-size: 16px; color: var(--cpu-text); font-weight: 600; }
.latest-head > div { min-width: 0; }
.block-summary { display: block; margin-top: 3px; color: var(--cpu-text-muted); font-size: 11px; }
.more { font-size: 12px; color: var(--cpu-primary); text-decoration: none; }
.home-search-top {
  padding: 12px 14px;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  box-shadow: var(--cpu-shadow-sm);
}

.announce-list { list-style: none; padding: 0; margin: 0; }
.announce-list li {
  padding: 10px 4px;
  border-bottom: 1px dashed var(--cpu-border-soft);
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 6px;
}
.announce-list li:hover { background: var(--cpu-surface-soft); }
.announce-list li:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.announce-list li:last-child { border-bottom: none; }
.ann-title {
  font-size: 14px;
  color: var(--cpu-text);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.ann-meta {
  font-size: 12px;
  color: var(--cpu-text-muted);
  margin-top: 2px;
  display: flex;
  gap: 8px;
}
.ann-source { color: var(--cpu-primary); }

.hot-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
}
.more-strong {
  font-weight: 600;
}

.service-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.wall-card {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-soft);
  cursor: pointer;
}
.wall-card:hover {
  border-color: #93c5fd;
}
.wall-card:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.wall-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 22px;
  background: var(--cpu-surface-subtle);
  flex-shrink: 0;
}
.wall-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--cpu-text);
}
.wall-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--cpu-text-secondary);
}
.second-hand-note {
  margin: -2px 0 8px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.second-hand-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--cpu-border-soft);
  font-size: 12px;
}
.second-hand-actions a { color: var(--cpu-primary); font-weight: 600; text-decoration: none; }
.second-hand-actions a:hover { text-decoration: underline; }
.second-hand-actions span { width: 1px; height: 12px; background: var(--cpu-border); }
.svc {
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-surface);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  position: relative;
}
.svc:hover { border-color: var(--cpu-primary); background: var(--cpu-surface-soft); }
.svc:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.svc-icon { font-size: 22px; }
.svc-name { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 4px; line-height: 1.3; }
.svc-tag {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
}
.svc-special {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.14) 0%, rgba(251, 191, 36, 0.1) 100%);
  border-color: rgba(245, 158, 11, 0.32);
}
.svc-special:hover {
  border-color: #f59e0b;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.18) 0%, rgba(251, 191, 36, 0.14) 100%);
}
.svc-tag-fresh { background: rgba(251, 191, 36, 0.85); color: #78350f; font-weight: 500; }
.cpu-muted { font-size: 12px; color: var(--cpu-text-muted); }
.home-publish-fab { display: none; }

@media (max-width: 768px) {
  .home {
    gap: 14px;
  }

  .hero {
    display: block;
    padding: 7px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 16px;
    background: color-mix(in srgb, var(--cpu-card) 92%, transparent);
    box-shadow: var(--cpu-shadow-sm);
    backdrop-filter: blur(18px) saturate(140%);
  }

  .hero::before,
  .hero::after {
    content: none;
  }

  .hero h1,
  .hero p {
    display: none;
  }

  .hero-actions {
    display: flex;
    width: 100%;
    max-width: 100%;
    flex-wrap: nowrap;
    gap: 6px;
    overflow-x: hidden;
    padding: 0;
  }

  .hero-actions .el-button {
    flex: 1 1 0;
    width: 0;
    min-width: 0;
    height: 40px;
    min-height: 40px;
    margin-left: 0;
    justify-content: center;
    overflow: hidden;
    padding: 0 5px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 999px;
    background: var(--cpu-surface-soft);
    color: var(--cpu-text-secondary);
    box-shadow: none;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .hero-actions :deep(.el-button > span) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .action-label-full {
    display: none;
  }

  .action-label-short {
    display: inline;
  }

  .hero-actions .el-button--primary {
    border-color: color-mix(in srgb, var(--cpu-primary) 72%, transparent);
    background: var(--cpu-primary);
    color: #fff;
  }

  .hero-actions .el-button:hover,
  .hero-actions .el-button:focus-visible {
    border-color: color-mix(in srgb, var(--cpu-primary) 35%, var(--cpu-border-soft));
    background: var(--cpu-surface-subtle);
    color: var(--cpu-primary);
  }

  .hero-actions .el-button--primary:hover,
  .hero-actions .el-button--primary:focus-visible {
    border-color: var(--cpu-primary);
    background: var(--cpu-primary);
    color: #fff;
  }

  .grid {
    gap: 14px;
  }

  .home-search-top {
    margin: 0;
    padding: 8px;
    border-radius: 12px;
    box-shadow: var(--cpu-shadow-sm);
  }

  .home-search-top :deep(.site-search-bar) {
    grid-template-columns: minmax(0, 1fr) 56px;
    gap: 6px;
  }

  .home-search-top :deep(.el-input) {
    min-width: 0;
  }

  .home-search-top :deep(.el-input__wrapper) {
    min-height: 40px;
    border-radius: 9px;
  }

  .home-search-top :deep(.el-button) {
    width: 56px;
    min-width: 56px;
    min-height: 40px;
    padding: 0 8px;
    border-radius: 9px;
    font-weight: 600;
  }

  .col-left,
  .col-right {
    gap: 14px;
  }

  .block {
    border-radius: 10px;
    padding: 14px 12px 10px;
  }

  .block-head {
    align-items: center;
  }

  .service-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .svc {
    min-height: 82px;
    padding: 9px 7px;
  }

  .svc-icon {
    font-size: 20px;
  }

  .home-publish-fab {
    position: fixed;
    right: 16px;
    bottom: calc(78px + env(safe-area-inset-bottom));
    z-index: 20;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 42px;
    padding: 0 16px;
    border-radius: 999px;
    background: var(--cpu-primary);
    box-shadow: 0 8px 22px color-mix(in srgb, var(--cpu-primary) 28%, transparent);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
  }

  .home-publish-fab:focus-visible {
    outline: 2px solid var(--cpu-card);
    outline-offset: 2px;
  }
}

@media (max-width: 420px) {
  .service-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
