<template>
  <div class="vip-page" v-loading="loading && !status">
    <section class="vip-hero">
      <div class="vip-hero-mark">VIP</div>
      <div class="vip-hero-copy">
        <div class="eyebrow">拾间会员中心</div>
        <h1>{{ status?.vipActive ? "你的 VIP 正在生效" : "开启你的 VIP 特权" }}</h1>
        <p>{{ status?.vipActive ? "感谢你对校园社区的支持，永久专属权益已经为你打开。" : "输入礼品码或打开兑换链接，即可永久开通 VIP。" }}</p>
      </div>
      <el-tag class="vip-hero-status" :type="status?.vipActive ? 'warning' : 'info'" effect="dark">
        {{ status?.vipActive ? "永久 VIP" : "暂未开通" }}
      </el-tag>
    </section>

    <div class="vip-main-grid">
      <section class="cpu-card vip-status-card">
        <div class="section-heading">
          <div>
            <div class="section-kicker">当前状态</div>
            <h2>{{ status?.vipActive ? "VIP" : "普通用户" }}</h2>
          </div>
          <div class="status-orb" :class="{ active: status?.vipActive }">✦</div>
        </div>
        <p v-if="status?.vipActive" class="expiry-copy">VIP 一次开通，永久有效。</p>
        <p v-else class="expiry-copy">还没有 VIP？使用右侧礼品码即可兑换。</p>
        <div class="status-actions">
          <el-button plain @click="router.push('/profile')">返回个人中心</el-button>
          <el-button v-if="status?.vipActive" type="warning" plain @click="router.push('/profile#vip-style')">装扮主页</el-button>
        </div>
      </section>

      <section class="cpu-card redeem-card">
        <div class="section-heading">
          <div>
            <div class="section-kicker">兑换中心</div>
            <h2>输入礼品码</h2>
          </div>
          <span class="ticket-icon"><AppIcon name="gift" /></span>
        </div>
        <el-input
          v-model="giftCode"
          size="large"
          clearable
          maxlength="80"
          placeholder="例如 CPUV-IPAB-CD23-EF45"
          :disabled="redeeming"
          @keyup.enter="redeem()"
        >
          <template #prefix><AppIcon name="ticket" /></template>
        </el-input>
        <el-button class="redeem-button" type="primary" size="large" :loading="redeeming" :disabled="!giftCode.trim()" @click="redeem()">
          立即兑换
        </el-button>
        <p class="redeem-hint">礼品码由管理员发放，也可以直接打开管理员提供的兑换链接自动激活。</p>
      </section>
    </div>

    <section class="cpu-card benefits-card">
      <div class="section-heading benefits-heading">
        <div>
          <div class="section-kicker">会员权益</div>
          <h2>VIP 可以得到什么</h2>
        </div>
        <span class="benefits-note">持续更新中</span>
      </div>
      <div class="benefits-grid">
        <article v-for="benefit in benefits" :key="benefit.key" class="benefit-item">
          <div class="benefit-icon">✓</div>
          <div>
            <h3>{{ benefit.title }}</h3>
            <p>{{ benefit.description }}</p>
          </div>
        </article>
      </div>
    </section>

    <section v-if="history.length" class="cpu-card history-card">
      <div class="section-heading benefits-heading">
        <div>
          <div class="section-kicker">兑换记录</div>
          <h2>我的礼品码</h2>
        </div>
      </div>
      <div class="history-list">
        <div v-for="item in history" :key="item.id" class="history-row">
          <div>
            <strong>{{ item.giftCode.codePreview }}</strong>
            <span>永久 VIP</span>
          </div>
          <div class="history-date">
            <span>{{ formatDate(item.redeemedAt) }}</span>
            <small>已永久生效</small>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { vipApi, type VipRedemption, type VipStatus } from "@/api/vip";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const loading = ref(false);
const redeeming = ref(false);
const status = ref<VipStatus | null>(null);
const history = ref<VipRedemption[]>([]);
const giftCode = ref("");

const benefits = computed(() => status.value?.benefits ?? [
  { key: "forum-ad-free", title: "论坛免广告", description: "隐藏标记为 VIP 免广告的推广内容。" },
  { key: "profile-decoration", title: "个性化资料装扮", description: "使用主页主题和头像框，展示专属身份。" },
]);

onMounted(async () => {
  await load();
  await redeemFromLink();
});

async function load() {
  loading.value = true;
  try {
    const [nextStatus, nextHistory] = await Promise.all([
      vipApi.status({ suppressErrorMessage: true }),
      vipApi.history({ suppressErrorMessage: true }),
    ]);
    status.value = nextStatus;
    history.value = nextHistory;
  } catch (error) {
    status.value = {
      vipActive: auth.user?.vipActive ?? false,
      sponsorTotalCents: auth.user?.sponsorTotalCents ?? 0,
      benefits: [],
    };
    if (error) ElMessage.error(error instanceof Error ? error.message : "VIP 信息加载失败");
  } finally {
    loading.value = false;
  }
}

async function redeem(source: "manual" | "link" = "manual") {
  const code = giftCode.value.trim();
  if (!code || redeeming.value) return;
  redeeming.value = true;
  try {
    await vipApi.redeem(code);
    giftCode.value = "";
    await auth.fetchMe({ probe: true });
    ElMessage.success(source === "link" ? "链接激活成功，VIP 已永久开通" : "兑换成功，VIP 已永久开通");
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "礼品码兑换失败");
  } finally {
    redeeming.value = false;
  }
}

async function redeemFromLink() {
  const code = new URLSearchParams(route.hash.replace(/^#/, "")).get("redeem")?.trim();
  if (!code) return;
  await router.replace({ path: route.path, query: route.query, hash: "" });
  giftCode.value = code;
  await redeem("link");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
</script>

<style scoped>
.vip-page { display: flex; flex-direction: column; gap: 16px; }
.vip-hero { display: flex; align-items: center; gap: 18px; padding: 24px; border-radius: 20px; background: radial-gradient(circle at 85% 10%, rgba(251, 191, 36, .28), transparent 34%), linear-gradient(120deg, #0f766e, #0e7490); color: white; box-shadow: 0 16px 34px rgba(15, 118, 110, .2); }
.vip-hero-mark { display: grid; place-items: center; width: 68px; height: 68px; flex: 0 0 auto; border: 1px solid rgba(255,255,255,.45); border-radius: 20px; background: rgba(255,255,255,.16); color: #fde68a; font-size: 21px; font-weight: 900; letter-spacing: .08em; }
.vip-hero-copy { min-width: 0; flex: 1; }
.eyebrow, .section-kicker { color: rgba(255,255,255,.72); font-size: 12px; letter-spacing: .08em; }
.vip-hero h1 { margin: 5px 0 6px; font-size: clamp(23px, 4vw, 32px); }
.vip-hero p { margin: 0; color: rgba(255,255,255,.84); font-size: 13px; line-height: 1.6; }
.vip-hero-status { flex: 0 0 auto; }
.vip-main-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 16px; }
.vip-status-card, .redeem-card, .benefits-card, .history-card { padding: 20px; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.section-heading h2 { margin: 5px 0 0; color: var(--cpu-text); font-size: 20px; }
.section-kicker { color: var(--cpu-text-muted); }
.status-orb { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--cpu-surface-soft); color: var(--cpu-text-muted); font-size: 21px; }
.status-orb.active { background: linear-gradient(135deg, #f59e0b, #facc15); color: white; box-shadow: 0 8px 18px rgba(245, 158, 11, .24); }
.expiry-copy { min-height: 44px; margin: 18px 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.65; }
.status-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.ticket-icon { font-size: 26px; }
.redeem-card :deep(.el-input) { margin-top: 18px; }
.redeem-button { width: 100%; margin-top: 12px; }
.redeem-hint { margin: 11px 0 0; color: var(--cpu-text-muted); font-size: 12px; line-height: 1.5; }
.benefits-heading { margin-bottom: 16px; }
.benefits-note { color: var(--cpu-text-muted); font-size: 12px; }
.benefits-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.benefit-item { display: flex; gap: 10px; padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-surface-soft); }
.benefit-icon { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 auto; border-radius: 9px; background: rgba(20, 143, 123, .12); color: var(--cpu-primary); font-weight: 800; }
.benefit-item h3 { margin: 0; color: var(--cpu-text); font-size: 14px; }
.benefit-item p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.5; }
.history-list { display: flex; flex-direction: column; gap: 8px; }
.history-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--cpu-border-soft); }
.history-row strong, .history-row span, .history-row small { display: block; }
.history-row strong { color: var(--cpu-text); font-size: 13px; }
.history-row span, .history-row small { margin-top: 4px; color: var(--cpu-text-muted); font-size: 11px; }
.history-date { text-align: right; }
@media (max-width: 760px) {
  .vip-main-grid, .benefits-grid { grid-template-columns: 1fr; }
  .vip-hero {
    position: relative;
    display: grid;
    grid-template-columns: 68px minmax(0, 1fr);
    align-items: start;
    column-gap: 16px;
    row-gap: 12px;
    padding: 18px;
  }
  .vip-hero-copy { min-width: 0; padding-top: 38px; }
  .vip-hero h1 {
    font-size: clamp(24px, 7vw, 32px);
    line-height: 1.24;
    word-break: keep-all;
    overflow-wrap: normal;
  }
  .vip-hero p {
    word-break: keep-all;
    overflow-wrap: break-word;
  }
  .vip-hero-status {
    position: absolute;
    top: 18px;
    right: 18px;
    margin-left: 0;
  }
  .vip-status-card, .redeem-card, .benefits-card, .history-card { padding: 18px; }
  .status-actions { gap: 8px; }
  .status-actions .el-button { flex: 1 1 auto; min-width: 0; }
}
</style>
