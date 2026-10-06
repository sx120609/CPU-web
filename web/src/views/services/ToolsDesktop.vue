<template>
  <div class="pk-page pk-page--wide tools-d">
    <header class="pk-head">
      <router-link class="pk-back" to="/services"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>校园服务</router-link>
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true"><el-icon><component :is="toolHubIntro.iconComponent" /></el-icon></span>
        <div class="pk-title-copy">
          <h1>{{ toolHubIntro.title }}<em class="pk-badge is-open">{{ visibleTools.length }} 个入口</em></h1>
          <p>{{ toolHubIntro.subtitle }}</p>
        </div>
        <button v-if="canManageAny" data-cpu-button="surface" type="button" class="pk-pill" @click="openManage">
          <el-icon aria-hidden="true"><Setting /></el-icon>管理
        </button>
      </div>
    </header>

    <p v-if="toolsError" class="pk-notice tools-d-warning">
      <span>{{ toolsError }}</span>
      <el-button text size="small" :loading="toolsLoading" @click="loadToolMetas">重试</el-button>
    </p>

    <div class="tools-d-grid" :aria-busy="toolsLoading">
      <ToolCardDesktop
        v-for="tool in visibleTools"
        :key="tool.slug"
        :tool="tool"
        :badge="toolBadge(tool)"
        :login-required="isLoginRequired(tool.slug)"
        @click="openTool(tool)"
      />
    </div>

    <p v-if="feedbackTool" class="tools-d-foot">
      没找到需要的工具？<button data-cpu-button="surface" type="button" class="pk-link" @click="openTool(feedbackTool)">提交需求反馈</button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ArrowLeft, Setting } from "@element-plus/icons-vue";
import { toolHubIntro } from "@/data/serviceTools";
import ToolCardDesktop from "./components/ToolCardDesktop.vue";
import { useServiceTools, useToolManageEntry } from "./servicesPage";
import "@/styles/page-kit.css";

const { toolMetas, toolsLoading, toolsError, visibleTools, loadToolMetas, isLoginRequired, toolBadge, openTool } = useServiceTools();
const { canManageAny, openManage } = useToolManageEntry(toolMetas);
const feedbackTool = computed(() => visibleTools.value.find((tool) => tool.slug === "feedback"));
</script>

<style scoped>
.tools-d-warning { align-items: center; justify-content: space-between; }
.tools-d-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 12px; }
.tools-d-grid[aria-busy="true"] { opacity: .72; }
.tools-d-foot { margin: 4px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); text-align: center; }
.tools-d-foot button { padding: 0; border: 0; background: none; font: inherit; cursor: pointer; }
</style>
