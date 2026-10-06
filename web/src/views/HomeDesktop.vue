<template>
  <div class="home">
    <section class="intro" aria-label="首页功能入口">
      <div class="intro-copy">
        <h1>药大拾间</h1>
        <p>{{ heroIntro }}</p>
      </div>
      <div class="intro-actions cpu-button-row">
        <el-button v-if="showForumContent" type="primary" @click="$router.push('/forum')">
          <el-icon><ChatLineRound /></el-icon>{{ forumActionLabel }}
        </el-button>
        <el-button v-if="site.features.market && showForumContent" @click="$router.push('/market')">
          <AppIcon name="market" />二手交流
        </el-button>
        <el-button v-else-if="!auth.forumHidden" type="primary" @click="$router.push('/announcements')">
          <el-icon><Bell /></el-icon>看校园公告
        </el-button>
        <el-button v-if="!auth.isLoggedIn" @click="$router.push('/login')">{{ loginActionText }}</el-button>
        <el-button v-else-if="showForumContent" @click="$router.push('/post')">
          <el-icon><Edit /></el-icon>发布内容
        </el-button>
        <el-button v-if="assistantEntryVisible" text type="primary" @click="$router.push('/search')">
          <el-icon><ChatDotRound /></el-icon>拾间AI
        </el-button>
      </div>
    </section>

    <p class="independent-service-note"><el-icon aria-hidden="true"><InfoFilled /></el-icon>独立校园工具，非中国药科大学官方应用；学校名称仅用于说明适用用户和数据来源。</p>

    <section v-if="showForumContent" class="home-search-top" aria-label="站内搜索">
      <SiteSearchBar placeholder="搜索帖子或校园服务" />
    </section>

    <section v-if="homeError && !loading" class="group home-error">
      <el-empty :description="homeError">
        <el-button type="primary" @click="loadSummary()">重试</el-button>
      </el-empty>
    </section>

    <div v-else class="grid" :class="{ 'single-col': !showForumContent }" v-loading="loading && !summary">
      <!-- 左：置顶、热议、最新、二手 -->
      <div class="col-left" v-if="showForumContent">
        <section class="block" v-if="summary?.pinnedTopics?.length">
          <div class="block-head">
            <h3>全局置顶</h3>
            <span class="block-note">重要内容</span>
          </div>
          <div class="group">
            <ForumAdCarousel v-if="pinnedAds.length" class="block-ad" :ads="pinnedAds" compact />
            <TopicListItem v-for="t in summary.pinnedTopics" :key="'pin-' + t.id" :topic="t" />
          </div>
        </section>

        <section class="block">
          <div class="block-head">
            <h3>热议 Top 3</h3>
            <router-link to="/forum/hot" class="more">查看前十<el-icon><ArrowRight /></el-icon></router-link>
          </div>
          <div class="group">
            <ForumAdCarousel v-if="hotAds.length" class="block-ad" :ads="hotAds" compact />
            <TopicListItem
              v-for="t in hotPreview"
              :key="'hot-' + t.id"
              :topic="t"
              :rank="t.rank"
              :score="t.hotScore"
              variant="simple"
              time-mode="published"
            />
            <el-empty v-if="!hotPreview.length" description="暂无内容" />
          </div>
        </section>

        <section class="block">
          <div class="block-head">
            <h3>最新</h3>
            <router-link to="/forum/latest" class="more">查看全部<el-icon><ArrowRight /></el-icon></router-link>
          </div>
          <div class="group">
            <TopicListItem v-for="t in summary?.latestTopics ?? []" :key="'new-' + t.id" :topic="t" variant="simple" time-mode="published" />
            <el-empty v-if="!summary?.latestTopics?.length" description="暂无内容" />
          </div>
        </section>

        <section class="block" v-if="site.features.market">
          <div class="block-head">
            <h3>二手交流</h3>
            <router-link to="/market" class="more">进入板块<el-icon><ArrowRight /></el-icon></router-link>
          </div>
          <div class="group second-hand">
            <p>校内闲置与求购，按论坛帖子发布和交流。</p>
            <nav class="second-hand-actions" aria-label="发布二手内容">
              <router-link to="/post?board=market&kind=sell">发布闲置</router-link>
              <router-link to="/post?board=market&kind=wanted">发布求购</router-link>
            </nav>
          </div>
        </section>
      </div>

      <!-- 右：公告、服务 -->
      <div class="col-right">
        <section v-if="!nativeForumRestricted" class="block">
          <div class="block-head">
            <h3>校园公告</h3>
            <span class="block-note">学校公开信息</span>
          </div>
          <ul v-if="summary?.announce?.length" class="group announce-list">
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
                <span aria-hidden="true">·</span>
                <span>{{ fmtRelative(t.createdAt) }}</span>
              </div>
            </li>
          </ul>
          <div v-else class="group"><el-empty description="暂无公告，稍后再来看看" /></div>
        </section>

        <section class="block">
          <div class="block-head">
            <h3>校园服务</h3>
            <router-link to="/services" class="more">全部<el-icon><ArrowRight /></el-icon></router-link>
          </div>
          <div v-if="hasServiceEntries" class="group service-list">
            <div
              v-if="showElectricEntry"
              class="svc"
              data-hue="amber"
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
              v-for="(s, index) in visibleServices"
              :key="s.id"
              class="svc"
              :data-hue="serviceHues[index % serviceHues.length]"
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
          <div v-else class="group"><el-empty description="暂无可用服务" /></div>
        </section>
      </div>
    </div>

    <DormElectricDialog v-model="electricOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, ChatLineRound, ChatDotRound, Edit, Bell, InfoFilled } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import ForumAdCarousel from "@/components/forum/ForumAdCarousel.vue";
import SiteSearchBar from "@/components/search/SiteSearchBar.vue";
import AppIcon from "@/components/common/AppIcon.vue";
import DormElectricDialog from "@/components/services/DormElectricDialog.vue";
import { homeApi, type HomeSummary } from "@/api/home";
import { forumAdsApi, type ForumAd } from "@/api/forumAds";
import { isForumDestination } from "@/utils/nativeForumVisibility";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { isCampusAssistantDestination, isNativeForumIntranetOnlyAccount, shouldHideHarmonyAssistant, shouldHideNativeYaodaCanFly } from "@/utils/clientInfo";
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
const pinnedAds = ref<ForumAd[]>([]);
const hotAds = ref<ForumAd[]>([]);
// 服务入口没有固定板块，按顺序轮流取色
const serviceHues = ["brand", "blue", "green", "violet", "orange"];
const hotPreview = computed(() => (summary.value?.hotTopics ?? []).slice(0, 3));
const visibleServices = computed(() => (summary.value?.services ?? [])
  .filter((service) => !auth.forumHidden || !isForumDestination(String(service?.url || "")))
  .filter((service) => assistantEntryVisible.value || !isCampusAssistantDestination(service?.url))
  .filter((service) => !(
  shouldHideNativeYaodaCanFly(auth.isLoggedIn, auth.user?.username)
  && String(service?.url || "").includes("/services/tools/yaoda-can-fly")
)));
const showElectricEntry = computed(() => auth.isLoggedIn && site.features.electric);
const hasServiceEntries = computed(() => showElectricEntry.value || visibleServices.value.length > 0);
const showForumContent = computed(() => site.features.forum
  && auth.canAccessForum
  && !isNativeForumIntranetOnlyAccount(auth.user?.username));
const assistantEntryVisible = computed(() => site.features.assistantEntry
  && !shouldHideHarmonyAssistant(auth.isLoggedIn, auth.user?.username));
const nativeForumRestricted = computed(() => isNativeForumIntranetOnlyAccount(auth.user?.username));
const homeCacheScope = computed(() => {
  const identity = auth.user?.id ? `user-${auth.user.id}` : "guest";
  return `${identity}:forum-${showForumContent.value ? "on" : "off"}`;
});
let loadSeq = 0;
let adsLoadSeq = 0;
let mounted = false;

const enabledFeatureLabels = computed(() => {
  const labels = auth.forumHidden ? ["教务数据", "常用校园服务"] : ["公告聚合", "教务数据", "常用校园服务"];
  if (site.features.coursereview && showForumContent.value) labels.splice(2, 0, "课程点评");
  if (site.features.market && showForumContent.value) labels.splice(labels.length - 1, 0, "二手交流");
  if (site.features.electric) labels.push("宿舍电费查询");
  if (showForumContent.value) labels.unshift("校园讨论");
  return labels;
});
const forumActionLabel = computed(() => {
  if (!site.features.forum || nativeForumRestricted.value) return "看校园公告";
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
  if (!showForumContent.value) {
    pinnedAds.value = [];
    hotAds.value = [];
    return;
  }
  const seq = ++adsLoadSeq;
  try {
    const [pinned, hot] = await Promise.all([
      forumAdsApi.list("forum-home-pinned"),
      forumAdsApi.list("forum-home-hot"),
    ]);
    if (seq !== adsLoadSeq) return;
    pinnedAds.value = pinned;
    hotAds.value = hot;
  } catch {
    if (seq !== adsLoadSeq) return;
    pinnedAds.value = [];
    hotAds.value = [];
  }
}

async function loadSummary(options: { scope?: string; fallback?: HomeSummary | null } = {}) {
  const scope = options.scope ?? homeCacheScope.value;
  const seq = ++loadSeq;
  loading.value = !summary.value;
  homeError.value = "";
  try {
    const next = await homeApi.summary({ suppressErrorMessage: true, cacheTtlMs: 0 }, auth.forumHidden);
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

<style scoped>
/* 桌面首页：简短的站点介绍，下面两栏白色分组。分组标题在分组外，像设置页的小标题。 */
.home { display: flex; max-width: 1120px; margin: 0 auto; flex-direction: column; color: var(--cpu-text); font-size: var(--cpu-fs-m); line-height: 1.6; }

.intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.intro h1 { margin: 0; font-size: var(--cpu-fs-xxl); font-weight: 700; line-height: 1.3; }
.intro p { margin: 2px 0 0; color: var(--cpu-text-secondary); }
.intro-actions { display: flex; flex: none; flex-wrap: wrap; gap: 8px; }
.intro-actions .el-button { height: 40px; margin: 0; padding: 0 14px; font-size: var(--cpu-fs-m); }
.intro-actions .el-button :deep(> span) { display: inline-flex; align-items: center; gap: 6px; }
.independent-service-note { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.independent-service-note .el-icon { flex: none; font-size: 15px; }
.home-search-top { margin-top: 20px; }

.grid { display: grid; grid-template-columns: minmax(0, 1fr) 368px; align-items: start; gap: 0 32px; }
.grid.single-col { grid-template-columns: minmax(0, 1fr); }
.col-left, .col-right { display: flex; min-width: 0; flex-direction: column; }

.group { overflow: hidden; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.home-error { margin-top: 24px; padding: 28px 16px; }
.block-head { display: flex; min-height: 32px; align-items: center; justify-content: space-between; gap: 12px; margin: 24px 4px 6px; }
.block-head h3 { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); font-weight: 500; }
.block-note { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.more { display: inline-flex; flex: none; min-height: 32px; align-items: center; gap: 1px; color: var(--cpu-primary); font-size: var(--cpu-fs-s); text-decoration: none; white-space: nowrap; }
.block-ad { padding: 12px 12px 0; }
.block-ad :deep(.forum-ad-card) { border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); }

/* 列表项沿用论坛的组件，这里只把它放进分组并统一左右留白 */
.group :deep(.topic-row) { padding-right: 16px; padding-left: 16px; border-radius: 0; }

.second-hand { padding: 14px 16px 16px; color: var(--cpu-text-secondary); }
.second-hand p { margin: 0; }
.second-hand-actions { display: flex; gap: 8px; margin-top: 12px; }
.second-hand-actions a { display: inline-flex; height: 40px; flex: 1; align-items: center; justify-content: center; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); color: var(--cpu-text); font-weight: 500; text-decoration: none; }
.second-hand-actions a:hover { background: var(--cpu-surface-subtle); }

.announce-list { margin: 0; padding: 0; list-style: none; }
.announce-list li { padding: 12px 16px; cursor: pointer; }
.announce-list li + li, .svc + .svc { box-shadow: inset 0 1px 0 var(--cpu-border-soft); }
.announce-list li:hover, .svc:hover { background: var(--cpu-surface-soft); }
.announce-list li:focus-visible, .svc:focus-visible, .second-hand-actions a:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.ann-title { display: -webkit-box; overflow: hidden; font-weight: 500; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; text-wrap: pretty; }
.ann-meta { display: flex; gap: 5px; margin-top: 2px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.ann-source { color: var(--cpu-text-secondary); }

.svc { display: flex; min-height: 52px; align-items: center; gap: 12px; padding: 0 16px; cursor: pointer; }
.svc-icon { display: inline-flex; width: 32px; height: 32px; flex: none; align-items: center; justify-content: center; border-radius: var(--cpu-radius-m); background: var(--cpu-hue-bg); color: var(--cpu-hue-ink); font-size: 18px; }
.svc-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.svc-tag { flex: none; height: 18px; padding: 0 5px; border-radius: var(--cpu-radius-s); color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-weight: 500; line-height: 18px; box-shadow: inset 0 0 0 1px var(--cpu-border); }
.svc-tag-fresh { background: var(--cpu-primary-soft); color: var(--cpu-primary); box-shadow: none; }

@media (max-width: 1023px) {
  .grid { grid-template-columns: minmax(0, 1fr); }
  .intro { flex-direction: column; align-items: flex-start; gap: 16px; }
  .service-list { display: grid; grid-template-columns: 1fr 1fr; }
  .service-list .svc:nth-child(2) { box-shadow: none; }
}
</style>
