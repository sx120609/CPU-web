<template>
  <div class="home">
    <!-- Hero / 介绍 -->
    <section class="hero">
      <div class="hero-text">
        <h1>药大拾间</h1>
        <p>{{ heroIntro }}</p>
        <div class="hero-actions">
          <el-button v-if="site.features.forum" type="primary" size="large" @click="$router.push('/forum')">
            <el-icon><ChatLineRound /></el-icon> {{ forumActionLabel }}
          </el-button>
          <el-button v-if="showForumContent" size="large" @click="$router.push('/forum/b/campus-wall')">
            <span>📮</span> 逛逛
          </el-button>
          <el-button v-else type="primary" size="large" @click="$router.push('/announcements')">
            <el-icon><Bell /></el-icon> 看校园公告
          </el-button>
          <el-button v-if="!auth.isLoggedIn" size="large" @click="$router.push('/login')">{{ loginActionText }}</el-button>
          <el-button v-else-if="site.features.forum && auth.canAccessForum" size="large" @click="$router.push('/post')">
            <el-icon><Edit /></el-icon> 发布内容
          </el-button>
          <el-button v-else size="large" @click="$router.push('/services')">
            <el-icon><Service /></el-icon> 校园服务
          </el-button>
        </div>
      </div>
    </section>

    <section v-if="homeError && !loading" class="block home-error">
      <el-empty :description="homeError">
        <el-button type="primary" @click="loadSummary">重试</el-button>
      </el-empty>
    </section>

    <div v-else class="grid" :class="{ 'single-col': !showForumContent }" v-loading="loading">
      <!-- 左：热帖 + 最新 -->
      <div class="col-left" v-if="showForumContent">
        <section class="block" v-if="summary?.pinnedTopics?.length">
          <div class="block-head">
            <h3>📌 全局置顶</h3>
            <span class="cpu-muted">重要内容</span>
          </div>
          <TopicListItem v-for="t in summary.pinnedTopics" :key="'pin-' + t.id" :topic="t" />
        </section>

        <section class="block">
          <div class="block-head">
            <h3>🔥 热议</h3>
            <router-link to="/forum/hot" class="more">查看前十 →</router-link>
          </div>
          <div
            v-for="t in hotPreview"
            :key="'hot-' + t.id"
            class="hot-row"
            role="button"
            tabindex="0"
            @click="openTopic(t.id)"
            @keydown.enter.prevent="openTopic(t.id)"
            @keydown.space.prevent="openTopic(t.id)"
          >
            <div class="hot-rank" :class="{ top3: t.rank <= 3 }">#{{ t.rank }}</div>
            <div class="hot-main">
              <div class="hot-title">{{ t.title }}</div>
              <div v-if="t.tags?.length" class="hot-tags">
                <span v-for="tag in t.tags.slice(0, 2)" :key="tag.name" class="hot-tag">{{ tag.name }}</span>
              </div>
              <div class="hot-meta">
                <span>{{ t.board?.name }}</span>
                <span>{{ t.replyCount }} 回 / {{ t.likeCount }} 赞</span>
              </div>
            </div>
            <div class="hot-score">{{ Math.round(t.hotScore || 0) }}</div>
          </div>
          <div v-if="hotPreview.length" class="hot-foot">
            <span class="cpu-muted">首页仅展示前三</span>
            <router-link to="/forum/hot" class="more more-strong">进入热榜 Top 10 →</router-link>
          </div>
          <el-empty v-if="!hotPreview.length" description="暂无内容" />
        </section>

        <section class="block">
          <div class="block-head">
            <h3>🆕 最新</h3>
            <router-link to="/forum/latest" class="more">更多 →</router-link>
          </div>
          <TopicListItem v-for="t in summary?.latestTopics ?? []" :key="'new-' + t.id" :topic="t" />
          <el-empty v-if="!summary?.latestTopics?.length" description="暂无内容" />
        </section>
      </div>

      <!-- 右：公告 + 服务 -->
      <div class="col-right">
        <section class="block">
          <div class="block-head">
            <h3>📢 校园公告</h3>
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

        <section class="block" v-if="showForumContent">
          <div class="block-head">
            <h3>📮 逛逛</h3>
            <span class="cpu-muted">外部镜像内容</span>
          </div>
          <div
            class="wall-card"
            role="button"
            tabindex="0"
            @click="openBoard('campus-wall')"
            @keydown.enter.prevent="openBoard('campus-wall')"
            @keydown.space.prevent="openBoard('campus-wall')"
          >
            <div class="wall-icon">📮</div>
            <div class="wall-body">
              <div class="wall-title">单独查看逛逛镜像</div>
              <div class="wall-desc">外部帖子和评论会持续同步，但仅补充近 3 天稿件的后续更新，超过三天的稿件不再更新。</div>
            </div>
          </div>
        </section>

        <section class="block">
          <div class="block-head">
            <h3>🧭 校园服务</h3>
            <router-link to="/services" class="more">全部 →</router-link>
          </div>
          <div class="service-grid">
            <div
              v-if="auth.isLoggedIn && site.features.electric"
              class="svc svc-special"
              role="button"
              tabindex="0"
              @click="electricOpen = true"
              @keydown.enter.prevent="electricOpen = true"
              @keydown.space.prevent="electricOpen = true"
            >
              <div class="svc-icon">💡</div>
              <div class="svc-name">宿舍电费</div>
              <div class="svc-tag svc-tag-fresh">站内查</div>
            </div>
            <div
              v-for="s in summary?.services ?? []"
              :key="s.id"
              class="svc"
              role="button"
              tabindex="0"
              @click="openUrl(s.url)"
              @keydown.enter.prevent="openUrl(s.url)"
              @keydown.space.prevent="openUrl(s.url)"
            >
              <div class="svc-icon">{{ s.icon || "🔗" }}</div>
              <div class="svc-name">{{ s.name }}</div>
              <div class="svc-tag" v-if="s.needSso">需登录</div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <DormElectricDialog v-model="electricOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ChatLineRound, Edit, Bell, Service } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import TopicListItem from "@/components/forum/TopicListItem.vue";
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

const enabledFeatureLabels = computed(() => {
  const labels = ["公告聚合", "教务数据", "常用校园服务"];
  if (site.features.coursereview && auth.canAccessForum) labels.splice(2, 0, "课程点评");
  if (site.features.market && auth.canAccessForum) labels.splice(labels.length - 1, 0, "二手交易");
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

onMounted(loadSummary);

async function loadSummary() {
  loading.value = true;
  homeError.value = "";
  try {
    // 不区分游客 / 登录态，统一调 home/summary —— 后端按 token 自动决定 identity 是否返回
    summary.value = await homeApi.summary({ suppressErrorMessage: true });
  } catch (e) {
    summary.value = { identity: null, pinnedTopics: [], hotTopics: [], latestTopics: [], announce: [], services: [] };
    homeError.value = normalizeHomeError(e);
  } finally {
    loading.value = false;
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
.hero-actions { display: flex; gap: 10px; }
.hero-actions .el-button { background: rgba(255,255,255,0.9); border: none; color: #168776; }
.hero-actions .el-button:hover { background: #fff; }
.hero-actions .el-button--primary { background: #fff; color: #168776; }

.grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}
/* 论坛被关掉时，左栏隐藏 → 右栏单独占满整行，避免出现 1/3 宽的"孤儿" */
.grid.single-col {
  grid-template-columns: 1fr;
}
@media (max-width: 1100px) {
  .grid { grid-template-columns: 1fr; }
}

.col-left, .col-right { display: flex; flex-direction: column; gap: 16px; }

.block {
  background: #fff;
  border-radius: 12px;
  padding: 16px 20px 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
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
.block-head h3 { margin: 0; font-size: 16px; color: #1f2937; font-weight: 600; }
.more { font-size: 12px; color: var(--cpu-primary); text-decoration: none; }

.announce-list { list-style: none; padding: 0; margin: 0; }
.announce-list li {
  padding: 10px 4px;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 6px;
}
.announce-list li:hover { background: #f4f6f8; }
.announce-list li:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.announce-list li:last-child { border-bottom: none; }
.ann-title {
  font-size: 14px;
  color: #1f2937;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.ann-meta {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 2px;
  display: flex;
  gap: 8px;
}
.ann-source { color: var(--cpu-primary); }

.hot-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
}
.hot-row:last-of-type { border-bottom: none; }
.hot-row:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.hot-rank {
  min-width: 46px;
  font-size: 13px;
  font-weight: 800;
  color: #94a3b8;
}
.hot-rank.top3 { color: #dc2626; }
.hot-title {
  font-size: 14px;
  color: #111827;
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.hot-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
  font-size: 12px;
  color: #9ca3af;
}
.hot-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.hot-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: #fff7ed;
  border: 1px solid #fdba74;
  color: #9a3412;
  font-size: 11px;
  font-weight: 600;
}
.hot-score {
  min-width: 44px;
  text-align: right;
  font-size: 16px;
  font-weight: 700;
  color: var(--cpu-primary);
}
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
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);
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
  background: #dbeafe;
  flex-shrink: 0;
}
.wall-title {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}
.wall-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7280;
}
.svc {
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  position: relative;
}
.svc:hover { border-color: var(--cpu-primary); background: #f0fdf4; }
.svc:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.svc-icon { font-size: 22px; }
.svc-name { font-size: 12px; color: #374151; margin-top: 4px; line-height: 1.3; }
.svc-tag {
  position: absolute;
  top: 6px;
  right: 6px;
  background: #fef3c7;
  color: #b45309;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
}
.svc-special {
  background: linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%);
  border-color: #fde68a;
}
.svc-special:hover {
  border-color: #f59e0b;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
}
.svc-tag-fresh { background: #fbbf24; color: #78350f; font-weight: 500; }
.cpu-muted { font-size: 12px; color: #9ca3af; }

@media (max-width: 768px) {
  .home {
    gap: 14px;
  }

  .hero {
    border-radius: 12px;
    padding: 22px 18px;
    align-items: stretch;
    flex-direction: column;
    gap: 18px;
  }

  .hero h1 {
    font-size: 28px;
  }

  .hero p {
    font-size: 14px;
    line-height: 1.6;
  }

  .hero-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .hero-actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .grid {
    gap: 14px;
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

  .hot-row {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .hot-score {
    grid-column: 2;
    text-align: left;
    min-width: 0;
    font-size: 13px;
  }
}

@media (max-width: 420px) {
  .service-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
