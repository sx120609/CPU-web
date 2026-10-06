<template>
  <div class="tools-m">
    <header class="tools-m-head">
      <router-link class="tools-m-back" to="/services"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>校园服务</router-link>
      <div class="tools-m-title">
        <div>
          <h1>校园小工具</h1>
          <p>共 {{ visibleTools.length }} 个工具，点开即可使用</p>
        </div>
        <button v-if="canManageAny" data-cpu-button="surface" type="button" class="tools-m-manage" @click="openManage">
          <el-icon aria-hidden="true"><Setting /></el-icon>管理
        </button>
      </div>
    </header>

    <p v-if="toolsError" class="tools-m-warning">
      <span>{{ toolsError }}</span>
      <button data-cpu-button="surface" type="button" :disabled="toolsLoading" @click="loadToolMetas">重试</button>
    </p>

    <div class="tools-m-list" :aria-busy="toolsLoading">
      <ToolRowMobile
        v-for="tool in visibleTools"
        :key="tool.slug"
        :tool="tool"
        :badge="toolBadge(tool)"
        :login-required="isLoginRequired(tool.slug)"
        @click="openTool(tool)"
      />
    </div>

    <p v-if="feedbackTool" class="tools-m-foot">
      没找到需要的工具？<button data-cpu-button="surface" type="button" @click="openTool(feedbackTool)">提交需求反馈</button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ArrowLeft, Setting } from "@element-plus/icons-vue";
import ToolRowMobile from "./components/ToolRowMobile.vue";
import { useServiceTools, useToolManageEntry } from "./servicesPage";

const { toolMetas, toolsLoading, toolsError, visibleTools, loadToolMetas, isLoginRequired, toolBadge, openTool } = useServiceTools();
const { canManageAny, openManage } = useToolManageEntry(toolMetas);
const feedbackTool = computed(() => visibleTools.value.find((tool) => tool.slug === "feedback"));
</script>

<style scoped>
.tools-m {
  display: flex;
  min-width: 0;
  max-width: 720px;
  margin: 0 auto;
  flex-direction: column;
  gap: 12px;
  color: var(--cpu-text);
}
.tools-m button,
.tools-m a { -webkit-tap-highlight-color: transparent; }
.tools-m-head :is(button, a):focus-visible,
.tools-m-foot button:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }

.tools-m-head { padding: 0 2px; }
.tools-m-back {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 3px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  text-decoration: none;
}
.tools-m-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tools-m-title > div { min-width: 0; }
.tools-m-title h1 { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
.tools-m-title p { margin: 3px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.tools-m-manage {
  display: inline-flex;
  min-height: 36px;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 0 13px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-primary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  font-weight: 500;
  cursor: pointer;
}
.tools-m-manage:active { background: var(--cpu-surface-soft); }

.tools-m-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 8px 8px 8px 12px;
  border: 1px solid var(--cpu-accent-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-accent-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.5;
}
.tools-m-warning button,
.tools-m-foot button {
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.tools-m-warning button { min-height: 30px; flex: 0 0 auto; padding: 0 10px; border-radius: var(--cpu-radius-m); }

.tools-m-list {
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.tools-m-list[aria-busy="true"] { opacity: .72; }

.tools-m-foot { margin: 2px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-align: center; }
.tools-m-foot button { min-height: 32px; padding: 0 2px; }
</style>
