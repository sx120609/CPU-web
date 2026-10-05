<template>
  <div class="tools-page">
    <section class="tools-hero">
      <div class="hero-icon">
        <el-icon><component :is="toolHubIntro.iconComponent" /></el-icon>
      </div>
      <div class="hero-copy">
        <div class="hero-kicker">校园服务</div>
        <h2>{{ toolHubIntro.title }}</h2>
        <p>{{ toolHubIntro.subtitle }}</p>
      </div>
    </section>

    <section class="tools-panel">
      <div class="panel-head">
        <div>
          <h3>工具列表</h3>
          <p>选择需要的校园工具，也可以通过需求反馈提出建议。</p>
        </div>
        <div class="panel-actions">
          <el-button v-if="canManageAny" plain type="primary" @click="openManage">
            <el-icon><Setting /></el-icon>
            管理
          </el-button>
          <el-tag round type="success">{{ visibleTools.length }} 个入口</el-tag>
        </div>
      </div>

      <div v-if="toolsError" class="tools-error">
        <span>{{ toolsError }}</span>
        <el-button text size="small" :loading="toolsLoading" @click="loadToolMetas">重试</el-button>
      </div>

      <div class="tools-grid">
        <button data-cpu-button="surface"
          v-for="tool in visibleTools"
          :key="tool.slug"
          type="button"
          class="tool-card"
          :class="{ planned: tool.status === 'planned' }"
          @click="openTool(tool)"
        >
          <span class="tool-accent" :style="{ background: tool.accent }"></span>
          <span class="tool-icon" :style="{ color: tool.accent }">
            <el-icon><component :is="tool.iconComponent" /></el-icon>
          </span>
          <span class="tool-main">
            <span class="tool-title-row">
              <span class="tool-title">{{ tool.name }}</span>
              <el-tag
                v-if="!tool.hideBadge"
                size="small"
                :type="tool.badgeType ?? (isLoginRequired(tool.slug) ? 'warning' : 'success')"
                effect="plain"
                round
              >
                {{ tool.badge ?? (isLoginRequired(tool.slug) ? "需登录" : "免登录") }}
              </el-tag>
            </span>
            <span class="tool-summary">{{ tool.summary }}</span>
            <span class="tool-meta">{{ tool.category }}</span>
          </span>
          <el-icon class="tool-arrow"><Right /></el-icon>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Right, Setting } from "@element-plus/icons-vue";
import { toolHubIntro } from "@/data/serviceTools";
import { useServiceTools, useToolManageEntry } from "./servicesPage";

const { toolMetas, toolsLoading, toolsError, visibleTools, loadToolMetas, isLoginRequired, openTool } = useServiceTools();
const { canManageAny, openManage } = useToolManageEntry(toolMetas);
</script>

<style scoped>
.tools-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.tools-hero,
.tools-panel {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  box-shadow: var(--cpu-shadow-sm);
}

.tools-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 22px 24px;
}

.hero-icon {
  width: 58px;
  height: 58px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: var(--cpu-primary);
  background: var(--cpu-surface-subtle);
  flex: 0 0 auto;
}

.hero-icon .el-icon {
  font-size: 28px;
}

.hero-copy {
  min-width: 0;
}

.hero-kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 650;
  margin-bottom: 4px;
}

.hero-copy h2 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 22px;
}

.hero-copy p {
  margin: 6px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.tools-panel {
  padding: 20px 22px 22px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 16px;
}
.panel-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.panel-actions :deep(.el-button) {
  min-height: 40px;
}

.panel-head h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 17px;
}

.panel-head p {
  margin: 5px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}

.tools-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding: 9px 12px;
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 12px;
}

.tool-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 13px;
  min-height: 126px;
  padding: 16px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-surface);
  color: var(--cpu-text);
  cursor: pointer;
  font: inherit;
  text-align: left;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.tool-card:hover {
  border-color: var(--cpu-primary);
  box-shadow: 0 8px 24px rgba(22, 135, 118, 0.11);
  transform: translateY(-1px);
}

.tool-card.planned {
  background: var(--cpu-surface-soft);
}

.tool-accent {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
}

.tool-icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--cpu-surface-subtle);
  flex: 0 0 auto;
}

.tool-icon .el-icon {
  font-size: 24px;
}

.tool-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tool-title {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--cpu-text);
  font-size: 15px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-title-row :deep(.el-tag) {
  flex: 0 0 auto;
}

.tool-summary {
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.tool-meta {
  color: var(--cpu-text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.tool-arrow {
  color: var(--cpu-text-muted);
  flex: 0 0 auto;
}
</style>
