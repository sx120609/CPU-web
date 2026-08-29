<template>
  <div class="vip-page" v-loading="loading && !status">
    <div class="vip-desktop">
      <header class="desktop-page-head">
        <div>
          <span class="page-kicker">拾间会员</span>
          <h1>VIP 中心</h1>
          <p>一次开通，永久有效。兑换、权益与记录都集中在这里。</p>
        </div>
        <button type="button" class="back-link" @click="router.push('/profile')">返回个人中心<AppIcon name="arrow-right" /></button>
      </header>

      <section class="desktop-primary-grid">
        <article class="membership-pass" :class="{ active: status?.vipActive }">
          <div class="pass-topline">
            <span class="pass-brand"><AppIcon name="star" /> 拾间 VIP</span>
            <span class="pass-state">{{ status?.vipActive ? "已生效" : "待激活" }}</span>
          </div>
          <div class="pass-main">
            <small>当前身份</small>
            <h2>{{ status?.vipActive ? "永久会员" : "普通用户" }}</h2>
            <p>{{ status?.vipActive ? "专属权益已经生效，无需续费。" : "使用礼品码即可开通全部会员权益。" }}</p>
          </div>
          <div class="pass-footer">
            <span><AppIcon :name="status?.vipActive ? 'success' : 'lock'" /> {{ status?.vipActive ? "永久有效" : "尚未开通" }}</span>
            <button v-if="status?.vipActive" type="button" @click="openDecoration">个性装扮<AppIcon name="arrow-right" /></button>
          </div>
        </article>

        <article class="desktop-redeem-card">
          <div class="panel-heading">
            <span class="heading-icon"><AppIcon name="gift" /></span>
            <div><span class="page-kicker">兑换中心</span><h2>{{ status?.vipActive ? "VIP 已永久生效" : "输入礼品码" }}</h2></div>
          </div>
          <p class="redeem-copy">{{ status?.vipActive ? "当前账号无需再次兑换，你仍可在下方查看兑换记录。" : "输入管理员发放的礼品码，或直接打开兑换链接完成激活。" }}</p>
          <div class="desktop-redeem-form">
            <el-input v-model="giftCode" size="large" clearable maxlength="80" :disabled="redeeming || status?.vipActive" :placeholder="status?.vipActive ? '当前账号已永久开通' : '输入 VIP 礼品码'" @keyup.enter="redeem()">
              <template #prefix><AppIcon name="ticket" /></template>
            </el-input>
            <el-button type="primary" size="large" :loading="redeeming" :disabled="status?.vipActive || !giftCode.trim()" @click="redeem()">立即兑换</el-button>
          </div>
          <span class="form-note"><AppIcon name="shield" /> 礼品码只会用于当前登录账号</span>
        </article>
      </section>

      <section class="desktop-content-grid">
        <article class="content-panel benefits-panel">
          <div class="section-heading">
            <div><span class="page-kicker">会员权益</span><h2>开通后即可使用</h2></div>
            <span class="section-note">持续更新</span>
          </div>
          <div class="desktop-benefits-grid">
            <div v-for="benefit in benefits" :key="benefit.key" class="benefit-card">
              <span class="benefit-icon"><AppIcon :name="benefitIconName(benefit.key)" /></span>
              <div><h3>{{ benefit.title }}</h3><p>{{ benefit.description }}</p></div>
              <AppIcon class="benefit-check" name="success" />
            </div>
          </div>
        </article>

        <article class="content-panel history-panel">
          <div class="section-heading">
            <div><span class="page-kicker">兑换记录</span><h2>我的礼品码</h2></div>
            <span v-if="history.length" class="record-count">{{ history.length }} 条</span>
          </div>
          <div v-if="history.length" class="desktop-history-list">
            <div v-for="item in history" :key="item.id" class="history-row">
              <span class="history-mark"><AppIcon name="ticket" /></span>
              <div><strong>{{ item.giftCode.codePreview }}</strong><small>永久 VIP</small></div>
              <time>{{ formatDate(item.redeemedAt) }}</time>
            </div>
          </div>
          <div v-else class="history-empty"><AppIcon name="ticket" /><span>暂无兑换记录</span></div>
        </article>
      </section>
    </div>

    <div class="vip-mobile">
      <header class="mobile-page-head">
        <span class="page-kicker">拾间会员</span>
        <h1>VIP 中心</h1>
        <p>一次开通，永久有效</p>
      </header>

      <section class="mobile-membership-pass" :class="{ active: status?.vipActive }">
        <div class="pass-topline">
          <span class="pass-brand"><AppIcon name="star" /> 拾间 VIP</span>
          <span class="pass-state">{{ status?.vipActive ? "已生效" : "待激活" }}</span>
        </div>
        <div class="pass-main"><small>当前身份</small><h2>{{ status?.vipActive ? "永久会员" : "普通用户" }}</h2></div>
        <div class="pass-footer">
          <span><AppIcon :name="status?.vipActive ? 'success' : 'lock'" /> {{ status?.vipActive ? "永久有效" : "输入礼品码即可开通" }}</span>
          <button v-if="status?.vipActive" type="button" aria-label="打开个性装扮" @click="openDecoration"><AppIcon name="arrow-right" /></button>
        </div>
      </section>

      <section class="mobile-card mobile-redeem-card">
        <div class="mobile-card-head">
          <span class="heading-icon"><AppIcon name="gift" /></span>
          <div><h2>{{ status?.vipActive ? "已经开通" : "兑换礼品码" }}</h2><p>{{ status?.vipActive ? "当前账号无需再次兑换" : "激活后永久有效，无需续费" }}</p></div>
        </div>
        <el-input v-model="giftCode" size="large" clearable maxlength="80" :disabled="redeeming || status?.vipActive" :placeholder="status?.vipActive ? 'VIP 已永久生效' : '输入 VIP 礼品码'" @keyup.enter="redeem()">
          <template #prefix><AppIcon name="ticket" /></template>
        </el-input>
        <el-button class="mobile-redeem-button" type="primary" size="large" :loading="redeeming" :disabled="status?.vipActive || !giftCode.trim()" @click="redeem()">{{ status?.vipActive ? "已永久开通" : "立即兑换" }}</el-button>
      </section>

      <section class="mobile-section">
        <header><div><h2>会员权益</h2><p>开通后自动生效</p></div><span>持续更新</span></header>
        <div class="mobile-benefit-list">
          <article v-for="benefit in benefits" :key="benefit.key">
            <span class="benefit-icon"><AppIcon :name="benefitIconName(benefit.key)" /></span>
            <div><h3>{{ benefit.title }}</h3><p>{{ benefit.description }}</p></div>
            <AppIcon class="benefit-check" name="success" />
          </article>
        </div>
      </section>

      <section v-if="history.length" class="mobile-section mobile-history-section">
        <header><div><h2>兑换记录</h2><p>已永久生效</p></div><span>{{ history.length }} 条</span></header>
        <div class="mobile-history-list">
          <div v-for="item in history" :key="item.id">
            <span class="history-mark"><AppIcon name="ticket" /></span>
            <p><strong>{{ item.giftCode.codePreview }}</strong><small>{{ formatDate(item.redeemedAt) }}</small></p>
          </div>
        </div>
      </section>

      <button type="button" class="mobile-back-link" @click="router.push('/profile')">返回个人中心<AppIcon name="arrow-right" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import AppIcon from "@/components/common/AppIcon.vue";
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

const benefits = computed(() => status.value?.benefits?.length ? status.value.benefits : [
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
    ElMessage.error(error instanceof Error ? error.message : "VIP 信息加载失败");
  } finally {
    loading.value = false;
  }
}

async function redeem(source: "manual" | "link" = "manual") {
  const code = giftCode.value.trim();
  if (!code || redeeming.value || status.value?.vipActive) return;
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
  if (status.value?.vipActive) {
    ElMessage.info("当前账号的 VIP 已永久生效，无需重复兑换");
    return;
  }
  giftCode.value = code;
  await redeem("link");
}

function openDecoration() {
  router.push("/profile#vip-style");
}

function benefitIconName(key: string) {
  if (key === "forum-ad-free") return "shield";
  if (key === "profile-decoration") return "user";
  return "success";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
</script>

<style scoped>
.vip-page { color: var(--cpu-text); }
.vip-desktop { display: flex; flex-direction: column; gap: 18px; }
.vip-mobile { display: none; }
.desktop-page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding: 4px 2px 2px; }
.page-kicker { color: var(--cpu-primary); font-size: 12px; font-weight: 750; letter-spacing: .08em; }
.desktop-page-head h1, .mobile-page-head h1 { margin: 5px 0 6px; color: var(--cpu-text); font-size: 30px; line-height: 1.15; }
.desktop-page-head p, .mobile-page-head p { margin: 0; color: var(--cpu-text-muted); font-size: 13px; }
.back-link, .mobile-back-link { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 0; background: transparent; color: var(--cpu-primary); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.desktop-primary-grid { display: grid; grid-template-columns: minmax(340px, .92fr) minmax(420px, 1.25fr); gap: 18px; }
.membership-pass, .mobile-membership-pass { position: relative; display: flex; min-height: 238px; flex-direction: column; overflow: hidden; padding: 24px; border-radius: 22px; background: linear-gradient(145deg, #283838 0%, #172928 58%, #0f1e1d 100%); color: #f5fbfa; box-shadow: 0 18px 38px rgba(15, 42, 39, .16); }
.membership-pass::before, .mobile-membership-pass::before { position: absolute; width: 220px; height: 220px; top: -118px; right: -62px; border: 1px solid rgba(255,255,255,.13); border-radius: 50%; background: rgba(255,255,255,.035); content: ""; }
.membership-pass::after, .mobile-membership-pass::after { position: absolute; width: 138px; height: 138px; right: 26px; bottom: -98px; border-radius: 50%; background: rgba(245, 158, 11, .13); content: ""; }
.membership-pass.active, .mobile-membership-pass.active { background: linear-gradient(145deg, #163d38 0%, #0f2927 58%, #122220 100%); }
.pass-topline, .pass-footer { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pass-brand { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 800; letter-spacing: .06em; }
.pass-brand .cpu-app-icon { color: #fbbf24; }
.pass-state { padding: 5px 9px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(255,255,255,.08); color: rgba(255,255,255,.8); font-size: 11px; }
.pass-main { position: relative; z-index: 1; margin: auto 0; }
.pass-main small { color: rgba(255,255,255,.56); font-size: 11px; letter-spacing: .08em; }
.pass-main h2 { margin: 5px 0 7px; color: white; font-size: 30px; }
.pass-main p { margin: 0; color: rgba(255,255,255,.68); font-size: 12px; }
.pass-footer { color: rgba(255,255,255,.68); font-size: 12px; }
.pass-footer > span, .pass-footer button { display: inline-flex; align-items: center; gap: 6px; }
.pass-footer button { border: 0; background: transparent; color: #f8cf72; font: inherit; font-weight: 700; cursor: pointer; }
.desktop-redeem-card, .content-panel, .mobile-card, .mobile-section { border: 1px solid var(--cpu-border-soft); background: var(--cpu-surface); }
.desktop-redeem-card { display: flex; flex-direction: column; justify-content: center; padding: 26px; border-radius: 22px; }
.panel-heading, .mobile-card-head { display: flex; align-items: center; gap: 12px; }
.heading-icon, .benefit-icon, .history-mark { display: grid; flex: 0 0 auto; place-items: center; }
.heading-icon { width: 42px; height: 42px; border-radius: 13px; background: rgba(15, 143, 127, .1); color: var(--cpu-primary); font-size: 20px; }
.panel-heading h2, .section-heading h2 { margin: 4px 0 0; color: var(--cpu-text); font-size: 20px; }
.redeem-copy { margin: 18px 0 14px; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.65; }
.desktop-redeem-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
.desktop-redeem-form .el-button { min-width: 112px; }
.form-note { display: inline-flex; align-items: center; gap: 6px; margin-top: 11px; color: var(--cpu-text-muted); font-size: 11px; }
.desktop-content-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(310px, .8fr); gap: 18px; align-items: start; }
.content-panel { padding: 22px; border-radius: 20px; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.section-note, .record-count { color: var(--cpu-text-muted); font-size: 11px; }
.desktop-benefits-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.benefit-card { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 15px; border-radius: 15px; background: var(--cpu-surface-soft); }
.benefit-icon { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 12px; background: rgba(15, 143, 127, .1); color: var(--cpu-primary); font-size: 17px; }
.benefit-card h3, .mobile-benefit-list h3 { margin: 0; color: var(--cpu-text); font-size: 14px; }
.benefit-card p, .mobile-benefit-list p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.45; }
.benefit-check { color: var(--cpu-primary); font-size: 16px; }
.desktop-history-list { display: flex; flex-direction: column; gap: 2px; }
.history-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px 0; border-top: 1px solid var(--cpu-border-soft); }
.history-mark { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 10px; background: var(--cpu-surface-soft); color: var(--cpu-primary); }
.history-row strong, .history-row small { display: block; }
.history-row strong { color: var(--cpu-text); font-size: 12px; }
.history-row small, .history-row time { margin-top: 3px; color: var(--cpu-text-muted); font-size: 10px; }
.history-row time { text-align: right; }
.history-empty { display: grid; min-height: 94px; place-items: center; align-content: center; gap: 8px; color: var(--cpu-text-muted); font-size: 12px; }
.history-empty .cpu-app-icon { font-size: 22px; }
@media (max-width: 760px) {
  .vip-desktop { display: none; }
  .vip-mobile { display: flex; flex-direction: column; gap: 14px; }
  .mobile-page-head { padding: 2px 2px 5px; }
  .mobile-page-head h1 { font-size: 28px; }
  .mobile-membership-pass { min-height: 174px; padding: 19px; border-radius: 20px; box-shadow: 0 14px 30px rgba(15, 42, 39, .15); }
  .mobile-membership-pass::before { width: 170px; height: 170px; top: -96px; right: -48px; }
  .mobile-membership-pass .pass-main h2 { font-size: 26px; }
  .mobile-membership-pass .pass-main p { display: none; }
  .mobile-membership-pass .pass-footer button { width: 28px; height: 28px; justify-content: center; border-radius: 50%; background: rgba(255,255,255,.08); }
  .mobile-card, .mobile-section { padding: 17px; border-radius: 18px; }
  .mobile-card-head h2 { margin: 0; color: var(--cpu-text); font-size: 17px; }
  .mobile-card-head p { margin: 4px 0 0; color: var(--cpu-text-muted); font-size: 11px; }
  .mobile-redeem-card :deep(.el-input) { margin-top: 16px; }
  .mobile-redeem-button { width: 100%; margin-top: 10px; }
  .mobile-section > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .mobile-section > header h2 { margin: 0; color: var(--cpu-text); font-size: 17px; }
  .mobile-section > header p, .mobile-section > header span { margin: 4px 0 0; color: var(--cpu-text-muted); font-size: 11px; }
  .mobile-benefit-list { display: flex; flex-direction: column; }
  .mobile-benefit-list article { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 11px; padding: 13px 0; border-top: 1px solid var(--cpu-border-soft); }
  .mobile-benefit-list article:first-child { border-top: 0; }
  .mobile-history-list > div { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--cpu-border-soft); }
  .mobile-history-list > div:first-child { border-top: 0; }
  .mobile-history-list p, .mobile-history-list strong, .mobile-history-list small { display: block; margin: 0; }
  .mobile-history-list strong { color: var(--cpu-text); font-size: 12px; }
  .mobile-history-list small { margin-top: 3px; color: var(--cpu-text-muted); font-size: 10px; }
  .mobile-back-link { align-self: center; min-height: 42px; padding: 0 16px; }
}
</style>
