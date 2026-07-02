<template>
  <div class="wall-page">
    <section class="wall-hero">
      <div class="hero-copy">
        <el-button text class="back-btn" @click="router.back()">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <p class="eyebrow">Sponsor Wall</p>
        <h1>鸣谢墙</h1>
        <p class="hero-desc">每一笔赞助都会转化为本站继续维护的动力。这里记录愿意公开展示的支持与留言。</p>
        <div class="hero-actions">
          <el-button type="primary" @click="router.push('/profile')">
            <el-icon><Money /></el-icon>
            我要赞助
          </el-button>
          <el-button plain :loading="loading" :disabled="loading" @click="loadWall">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </div>
      <div class="hero-stats">
        <div>
          <span>累计赞助</span>
          <b>¥{{ wall.totalAmount || "0.00" }}</b>
        </div>
        <div>
          <span>上墙记录</span>
          <b>{{ wall.total }}</b>
        </div>
      </div>
    </section>

    <el-skeleton v-if="loading" animated :rows="8" class="wall-loading" />

    <el-empty v-else-if="error" :description="error">
      <el-button type="primary" :loading="loading" @click="loadWall">重试</el-button>
    </el-empty>

    <el-empty v-else-if="!wall.enabled" description="鸣谢墙当前未开启" />

    <el-empty v-else-if="!wall.list.length" description="还没有公开展示的赞助" />

    <section v-else class="wall-content">
      <div class="section-head">
        <div>
          <h2>感谢这些同学</h2>
          <p>公开和匿名鸣谢都会显示在这里，选择不展示的赞助不会出现在名单中。</p>
        </div>
        <el-tag effect="plain" type="warning">{{ wall.total }} 条</el-tag>
      </div>

      <div class="wall-grid">
        <article v-for="item in wall.list" :key="item.id" class="wall-item">
          <div class="item-top">
            <UserAvatar
              :size="42"
              :src="item.anonymous ? null : item.user?.avatar"
              :name="item.anonymous ? '匿名同学' : item.user?.nickname"
              alt="赞助者头像"
            />
            <div class="item-user">
              <strong>{{ item.anonymous ? "匿名同学" : item.user?.nickname || "同学" }}</strong>
              <span>{{ item.paidAt ? fmtDate(item.paidAt, "YYYY-MM-DD HH:mm") : "刚刚" }}</span>
            </div>
            <div class="item-amount">¥{{ item.amount }}</div>
          </div>
          <p v-if="item.message" class="item-message">{{ item.message }}</p>
          <p v-else class="item-message muted">这位同学把支持留给了行动。</p>
          <div class="item-mark">
            <el-icon><Medal /></el-icon>
            <span>感谢支持</span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeft, Medal, Money, Refresh } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { paymentsApi, type SponsorWallItem } from "@/api/payments";
import { fmtDate } from "@/utils/format";

const router = useRouter();
const loading = ref(false);
const error = ref("");
const wall = reactive<{ enabled: boolean; total: number; totalAmount?: string; list: SponsorWallItem[] }>({
  enabled: true,
  total: 0,
  totalAmount: "0.00",
  list: [],
});
let loadSeq = 0;

onMounted(loadWall);

async function loadWall() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await paymentsApi.sponsorWall({ suppressErrorMessage: true });
    if (seq !== loadSeq) return;
    Object.assign(wall, next);
  } catch (error_) {
    if (seq !== loadSeq) return;
    error.value = normalizeSponsorWallError(error_);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function normalizeSponsorWallError(error_: unknown) {
  const status = (error_ as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error_ as { response?: { data?: { message?: string } } })?.response?.data?.message || "鸣谢墙加载失败";
  }
  return "鸣谢墙加载失败，请稍后再试";
}
</script>

<style scoped>
.wall-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.wall-hero {
  position: relative;
  overflow: hidden;
  min-height: 260px;
  border-radius: 12px;
  padding: 28px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 24px;
  align-items: end;
  background:
    radial-gradient(circle at 88% 18%, rgba(22, 135, 118, 0.18), transparent 30%),
    linear-gradient(135deg, var(--cpu-surface-soft) 0%, rgba(16, 185, 129, 0.12) 48%, rgba(245, 158, 11, 0.12) 100%);
  border: 1px solid var(--cpu-border-soft);
}

.hero-copy {
  max-width: 680px;
}

.back-btn {
  margin: 0 0 16px -10px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #0f766e;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.wall-hero h1 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 38px;
  line-height: 1.15;
}

.hero-desc {
  margin: 12px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 15px;
  line-height: 1.8;
}

.hero-actions {
  margin-top: 18px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.hero-stats {
  display: grid;
  gap: 10px;
}

.hero-stats div {
  border-radius: 8px;
  padding: 16px;
  background: color-mix(in srgb, var(--cpu-card) 78%, transparent);
  border: 1px solid var(--cpu-border-soft);
  backdrop-filter: blur(10px);
}

.hero-stats span {
  display: block;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  margin-bottom: 8px;
}

.hero-stats b {
  color: #b45309;
  font-size: 28px;
}

.wall-loading {
  padding: 20px;
  border-radius: 12px;
  background: var(--cpu-card);
}

.wall-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-head h2 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 20px;
}

.section-head p {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}

.wall-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.wall-item {
  min-height: 170px;
  border-radius: 8px;
  padding: 16px;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.item-top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.item-user {
  flex: 1;
  min-width: 0;
}

.item-user strong {
  display: block;
  color: var(--cpu-text);
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-user span {
  display: block;
  margin-top: 2px;
  color: var(--cpu-text-muted);
  font-size: 12px;
}

.item-amount {
  flex-shrink: 0;
  color: #b45309;
  font-size: 18px;
  font-weight: 800;
}

.item-message {
  flex: 1;
  margin: 0;
  color: var(--cpu-text-secondary);
  line-height: 1.7;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.item-message.muted {
  color: var(--cpu-text-muted);
}

.item-mark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0f766e;
  font-size: 12px;
  font-weight: 700;
}

@media (max-width: 960px) {
  .wall-hero {
    grid-template-columns: 1fr;
  }

  .hero-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .wall-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .wall-hero {
    min-height: 0;
    padding: 18px;
  }

  .wall-hero h1 {
    font-size: 30px;
  }

  .hero-stats,
  .wall-grid {
    grid-template-columns: 1fr;
  }

  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
