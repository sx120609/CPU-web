<template>
  <div class="wall-page">
    <section class="wall-hero">
      <div class="hero-copy">
        <el-button text class="back-btn" @click="router.back()">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <p class="eyebrow">Support Yaoda Shijian</p>
        <h1>支持药大拾间</h1>
        <p class="hero-desc">选择你希望支持的计划，查看公开筹集进度；每一笔赞助都会保留类别记录并进入鸣谢墙。</p>
        <div class="hero-actions cpu-button-row">
          <el-button type="primary" @click="router.push({ path: '/profile', hash: '#sponsor' })">
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

    <template v-else>
      <section v-if="wall.categories.length" class="campaign-section">
        <div class="section-head">
          <div>
            <h2>赞助计划</h2>
            <p>目标与进度由站内已支付订单实时统计。</p>
          </div>
        </div>
        <div class="campaign-grid">
          <article v-for="category in wall.categories" :key="category.id" class="campaign-card" :class="{ featured: category.featured }">
            <div class="campaign-card-head">
              <div>
                <span v-if="category.featured" class="campaign-kicker">当前计划</span>
                <h3>{{ category.title }}</h3>
              </div>
              <el-tag v-if="category.goalReached" type="success" effect="plain">已达成</el-tag>
              <el-tag v-else-if="!category.accepting" type="info" effect="plain">已结束</el-tag>
            </div>
            <p>{{ category.description }}</p>
            <div v-if="category.goalAmount" class="campaign-progress-copy">
              <b>¥{{ category.raisedAmount }}</b>
              <span>目标 ¥{{ category.goalAmount }}</span>
            </div>
            <div v-if="category.goalAmount" class="campaign-progress"><i :style="{ width: `${category.progressPercent ?? 0}%` }"></i></div>
            <div class="campaign-meta">
              <span>{{ category.supporterCount }} 人支持 · {{ category.paidOrderCount }} 笔赞助</span>
              <span v-if="category.deadline">截止 {{ category.deadline }}</span>
            </div>
            <el-button type="primary" :disabled="!category.accepting" @click="supportCategory(category.id)">
              {{ category.accepting ? "支持这个计划" : "计划已结束" }}
            </el-button>
          </article>
        </div>
      </section>

      <el-empty v-if="!wall.enabled" description="鸣谢墙当前未开启" />

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
                :seed="item.anonymous ? `sponsor-${item.id}` : item.user?.id ?? item.id"
                alt="赞助者头像"
              />
              <div class="item-user">
                <strong>{{ item.anonymous ? "匿名同学" : item.user?.nickname || "同学" }}</strong>
                <span>{{ item.paidAt ? fmtDate(item.paidAt, "YYYY-MM-DD HH:mm") : "刚刚" }}</span>
              </div>
              <div class="item-amount">¥{{ item.amount }}</div>
            </div>
            <el-tag class="item-category" size="small" effect="plain">{{ item.categoryTitle }}</el-tag>
            <p v-if="item.message" class="item-message">{{ item.message }}</p>
            <p v-else class="item-message muted">这位同学把支持留给了行动。</p>
            <div class="item-mark">
              <el-icon><Medal /></el-icon>
              <span>感谢支持</span>
            </div>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeft, Medal, Money, Refresh } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { paymentsApi, type SponsorCategory, type SponsorWallItem } from "@/api/payments";
import { fmtDate } from "@/utils/format";

const router = useRouter();
const loading = ref(false);
const error = ref("");
const wall = reactive<{ enabled: boolean; total: number; totalAmount?: string; categories: SponsorCategory[]; list: SponsorWallItem[] }>({
  enabled: true,
  total: 0,
  totalAmount: "0.00",
  categories: [],
  list: [],
});

function supportCategory(categoryId: string) {
  router.push({ path: "/profile", query: { sponsorCategory: categoryId }, hash: "#sponsor" });
}
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
  border-radius: var(--cpu-radius-l);
  padding: 28px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 24px;
  align-items: end;
  background: var(--cpu-card);
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
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 700;
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
  font-size: var(--cpu-fs-m);
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
  border-radius: var(--cpu-radius-m);
  padding: 16px;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
}

.hero-stats span {
  display: block;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  margin-bottom: 8px;
}

.hero-stats b {
  color: var(--cpu-accent);
  font-size: 28px;
}

.wall-loading {
  padding: 20px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}

.campaign-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.campaign-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.campaign-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 260px;
  padding: 18px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}

.campaign-card.featured {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-primary-soft);
}

.campaign-card-head,
.campaign-progress-copy,
.campaign-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.campaign-card-head {
  align-items: flex-start;
}

.campaign-card h3 {
  margin: 2px 0 0;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-l);
}

.campaign-card > p {
  flex: 1;
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.7;
}

.campaign-kicker {
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 700;
}

.campaign-progress-copy {
  align-items: baseline;
}

.campaign-progress-copy b {
  color: var(--cpu-accent);
  font-size: var(--cpu-fs-xl);
}

.campaign-progress-copy span,
.campaign-meta {
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}

.campaign-progress {
  height: 7px;
  overflow: hidden;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-border-soft);
}

.campaign-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--cpu-primary);
}

.campaign-meta {
  flex-wrap: wrap;
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
  font-size: var(--cpu-fs-xl);
}

.section-head p {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.wall-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.wall-item {
  min-height: 170px;
  border-radius: var(--cpu-radius-m);
  padding: 16px;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
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
  font-size: var(--cpu-fs-m);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-user span {
  display: block;
  margin-top: 2px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}

.item-amount {
  flex-shrink: 0;
  color: var(--cpu-accent);
  font-size: var(--cpu-fs-l);
  font-weight: 700;
}

.item-message {
  flex: 1;
  margin: 0;
  color: var(--cpu-text-secondary);
  line-height: 1.7;
  font-size: var(--cpu-fs-m);
  overflow-wrap: anywhere;
}

.item-category {
  align-self: flex-start;
  max-width: 100%;
}

.item-message.muted {
  color: var(--cpu-text-muted);
}

.item-mark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
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

  .campaign-grid {
    grid-template-columns: 1fr;
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
  .wall-grid,
  .campaign-grid {
    grid-template-columns: 1fr;
  }

  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
