<template>
  <el-drawer
    :model-value="modelValue"
    direction="btt"
    size="390px"
    title="发布到校园"
    custom-class="compose-action-drawer"
    :append-to-body="true"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="compose-intro">先选你想做的事，发布页会自动准备对应板块和表单。</p>
    <div class="compose-grid">
      <button v-for="action in actions" :key="action.label" type="button" class="compose-action" @click="go(action.to)">
        <span class="compose-icon"><AppIcon :name="action.icon" /></span>
        <span><b>{{ action.label }}</b><small>{{ action.description }}</small></span>
      </button>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import AppIcon from "@/components/common/AppIcon.vue";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const router = useRouter();
const auth = useAuthStore();
const actions = [
  { icon: "forum", label: "发动态", description: "分享校园见闻和日常", to: "/post?board=general&mode=say" },
  { icon: "question", label: "提问题", description: "求助、咨询或悬赏", to: "/post?board=question" },
  { icon: "box", label: "发布闲置", description: "转让校内闲置物品", to: "/post?board=market&kind=sell" },
  { icon: "search", label: "发布求购", description: "说明需求、预算和校区", to: "/post?board=market&kind=wanted" },
  { icon: "board", label: "选择其他板块", description: "使用完整发帖表单", to: "/post" },
];

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
.compose-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.compose-action { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 13px 12px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-surface-soft); color: var(--cpu-text); text-align: left; cursor: pointer; }
.compose-action:last-child { grid-column: 1 / -1; }
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
