<template>
  <div class="home">
    <!-- Hero / 介绍 -->
    <section class="hero">
      <div class="hero-text">
        <h1>药大垎坊</h1>
        <p>{{ heroIntro }}</p>
        <div class="hero-actions">
          <el-button v-if="site.features.forum" type="primary" size="large" @click="$router.push('/forum')">
            <el-icon><ChatLineRound /></el-icon> 进入论坛
          </el-button>
          <el-button v-else type="primary" size="large" @click="$router.push('/announcements')">
            <el-icon><Bell /></el-icon> 看校园公告
          </el-button>
          <el-button v-if="!auth.isLoggedIn" size="large" @click="$router.push('/login')">{{ loginActionText }}</el-button>
          <el-button v-else-if="site.features.forum" size="large" @click="$router.push('/post')">
            <el-icon><Edit /></el-icon> 发布内容
          </el-button>
          <el-button v-else size="large" @click="$router.push('/services')">
            <el-icon><Service /></el-icon> 校园服务
          </el-button>
        </div>
      </div>
    </section>

    <div class="grid" :class="{ 'single-col': !site.features.forum }">
      <!-- 左：热帖 + 最新 -->
      <div class="col-left" v-if="site.features.forum">
        <section class="block">
          <div class="block-head">
            <h3>🔥 热议</h3>
            <router-link to="/forum/hot" class="more">更多 →</router-link>
          </div>
          <div v-for="t in summary?.hotTopics ?? []" :key="'hot-' + t.id" class="hot-row" @click="$router.push(`/forum/topic/${t.id}`)">
            <div class="hot-rank" :class="{ top3: t.rank <= 3 }">#{{ t.rank }}</div>
            <div class="hot-main">
              <div class="hot-title">{{ t.title }}</div>
              <div class="hot-meta">
                <span>{{ t.board?.name }}</span>
                <span>{{ t.replyCount }} 回 / {{ t.likeCount }} 赞</span>
              </div>
            </div>
          </div>
          <el-empty v-if="!summary?.hotTopics?.length" description="暂无内容" />
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
            <span class="cpu-muted">自动同步公开来源</span>
          </div>
          <ul v-if="summary?.announce?.length" class="announce-list">
            <li v-for="t in summary.announce" :key="'ann-' + t.id" @click="$router.push(`/forum/topic/${t.id}`)">
              <div class="ann-title">{{ t.title }}</div>
              <div class="ann-meta">
                <span class="ann-source">{{ t.board?.name }}</span>
                <span>{{ fmtRelative(t.createdAt) }}</span>
              </div>
            </li>
          </ul>
          <el-empty v-else description="暂无公告，稍后再来看看" />
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
              @click="electricOpen = true"
            >
              <div class="svc-icon">💡</div>
              <div class="svc-name">宿舍电费</div>
              <div class="svc-tag svc-tag-fresh">站内查</div>
            </div>
            <div v-for="s in summary?.services ?? []" :key="s.id" class="svc" @click="openUrl(s.url)">
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
const electricOpen = ref(false);

const enabledFeatureLabels = computed(() => {
  const labels = ["公告聚合", "教务数据", "常用校园服务"];
  if (site.features.coursereview) labels.splice(2, 0, "课程点评");
  if (site.features.market) labels.splice(labels.length - 1, 0, "二手交易");
  if (site.features.electric) labels.push("宿舍电费查询");
  if (site.features.forum) labels.unshift("校园讨论");
  return labels;
});

const heroIntro = computed(() => {
  const labels = enabledFeatureLabels.value;
  const text = labels.length > 1 ? `${labels.slice(0, -1).join("、")}与${labels.at(-1)}` : labels[0];
  return `${text}，给药大学生一个更顺手的信息入口。`;
});

const loginActionText = computed(() => site.features.forum ? "登录参与" : "登录使用");

onMounted(async () => {
  // 不区分游客 / 登录态，统一调 home/summary —— 后端按 token 自动决定 identity 是否返回
  try {
    summary.value = await homeApi.summary();
  } catch {
    summary.value = { identity: null, hotTopics: [], latestTopics: [], announce: [], services: [] };
  }
});

function openUrl(url: string) {
  if (url.startsWith("/")) {
    router.push(url);
  } else if (url.startsWith("tel:")) {
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
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
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
}
.hot-row:last-of-type { border-bottom: none; }
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

.service-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
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
}

@media (max-width: 420px) {
  .service-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
