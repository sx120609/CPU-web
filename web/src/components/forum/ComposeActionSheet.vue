<template>
  <el-drawer
    :model-value="modelValue"
    direction="btt"
    :size="campaignAds.length ? '88%' : '390px'"
    title="发布到校园"
    custom-class="compose-action-drawer"
    :append-to-body="true"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="compose-intro">先选你想做的事，发布页会自动准备对应板块和表单。</p>
    <section v-if="campaignAds.length" class="campaign-section">
      <ForumAdCarousel :ads="campaignAds" compact />
      <div class="campaign-grid">
        <button
          v-for="theme in CAMPUS_LIFE_ACTIVITY_THEMES"
          :key="theme.key"
          type="button"
          class="compose-action campaign-action"
          @click="go(campusLifeActivityPostUrl(theme))"
        >
          <span class="compose-icon"><AppIcon :name="theme.icon" /></span>
          <span><b>{{ theme.label }}</b><small>{{ theme.description }}</small></span>
        </button>
      </div>
      <p class="campaign-welcome">欢迎其他平台的优秀创作者，带着原创内容来认识我们。</p>
    </section>
    <div v-if="campaignAds.length" class="compose-divider"><span>其他发布</span></div>
    <div class="compose-grid">
      <button v-for="action in actions" :key="action.label" type="button" class="compose-action" @click="go(action.to)">
        <span class="compose-icon"><AppIcon :name="action.icon" /></span>
        <span><b>{{ action.label }}</b><small>{{ action.description }}</small></span>
      </button>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import AppIcon from "@/components/common/AppIcon.vue";
import ForumAdCarousel from "@/components/forum/ForumAdCarousel.vue";
import { forumAdsApi, type ForumAd } from "@/api/forumAds";
import { CAMPUS_LIFE_ACTIVITY_THEMES, campusLifeActivityPostUrl } from "@/utils/forumActivity";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const router = useRouter();
const auth = useAuthStore();
const campaignAds = ref<ForumAd[]>([]);
let campaignLoading = false;
const actions = [
  { icon: "forum", label: "发动态", description: "分享校园见闻和日常", to: "/post?board=general&mode=say" },
  { icon: "question", label: "提问题", description: "求助、咨询或悬赏", to: "/post?board=question" },
  { icon: "box", label: "发布闲置", description: "转让校内闲置物品", to: "/post?board=market&kind=sell" },
  { icon: "search", label: "发布求购", description: "说明需求、预算和校区", to: "/post?board=market&kind=wanted" },
  { icon: "board", label: "选择其他板块", description: "使用完整发帖表单", to: "/post" },
];

watch(() => props.modelValue, (open) => {
  if (open) void loadCampaign();
}, { immediate: true });

async function loadCampaign() {
  if (campaignLoading) return;
  campaignLoading = true;
  try {
    const ads = await forumAdsApi.list("compose-mobile-campaign");
    campaignAds.value = ads;
  } catch {
    campaignAds.value = [];
  } finally {
    campaignLoading = false;
  }
}

function go(to: string) {
  emit("update:modelValue", false);
  if (!auth.isLoggedIn) {
    void router.push({ name: "login", query: { redirect: to } });
    return;
  }
  void router.push(to);
}
</script>

<style scoped>
.compose-intro { margin: -8px 0 14px; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.6; }
.campaign-section { margin-bottom: 14px; }
.campaign-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 9px; }
.campaign-action { background: color-mix(in srgb, var(--cpu-primary) 5%, var(--cpu-surface-soft)); }
.campaign-welcome { margin: 8px 2px 0; color: var(--cpu-text-secondary); font-size: 11px; line-height: 1.55; }
.compose-divider { display: flex; align-items: center; gap: 10px; margin: 4px 0 10px; color: var(--cpu-text-muted); font-size: 10px; }
.compose-divider::before, .compose-divider::after { height: 1px; flex: 1; background: var(--cpu-border-soft); content: ""; }
.compose-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.compose-action { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 13px 12px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-surface-soft); color: var(--cpu-text); text-align: left; cursor: pointer; }
.compose-grid > .compose-action:last-child { grid-column: 1 / -1; }
.compose-action:hover { border-color: var(--cpu-primary); background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-card)); }
.compose-action:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.compose-icon { flex: 0 0 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; background: var(--cpu-card); font-size: 19px; }
.compose-action span:last-child { min-width: 0; }
.compose-action b, .compose-action small { display: block; }
.compose-action b { font-size: 13px; }
.compose-action small { margin-top: 3px; overflow: hidden; color: var(--cpu-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
:global(.compose-action-drawer) { max-width: 620px; margin: 0 auto; border-radius: 18px 18px 0 0; }
:global(.compose-action-drawer .el-drawer__header) { margin-bottom: 8px; }
@media (max-width: 480px) {
  .compose-grid { grid-template-columns: 1fr 1fr; }
  .compose-action { padding: 11px 9px; }
}
</style>
