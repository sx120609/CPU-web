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
          <p>常用工具会陆续补齐，也欢迎先把需求告诉我们。</p>
        </div>
        <div class="panel-actions">
          <el-button v-if="canManageAny" plain type="primary" @click="openManage">
            <el-icon><Setting /></el-icon>
            管理
          </el-button>
          <el-tag round type="success">{{ visibleTools.length }} 个入口</el-tag>
        </div>
      </div>

      <div class="tools-grid">
        <button
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
                size="small"
                :type="isLoginRequired(tool.slug) ? 'warning' : 'success'"
                effect="plain"
                round
              >
                {{ isLoginRequired(tool.slug) ? "需登录" : "免登录" }}
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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getToken } from "@/api/request";
import { toolsApi, type ServiceToolCode, type ToolMeta } from "@/api/tools";
import { serviceTools, toolHubIntro, type ServiceTool } from "@/data/serviceTools";

const router = useRouter();
const manageable = ref<ServiceToolCode[]>([]);
const toolMetas = ref<ToolMeta[]>([]);
const canManageAny = computed(() => manageable.value.length > 0 || toolMetas.value.some((item) => item.canManage));
const toolAccessMap = computed(() => Object.fromEntries(toolMetas.value.map((item) => [item.code, item])));
const visibleTools = computed(() => serviceTools.filter((tool) => toolAccessMap.value[tool.slug]?.isVisible !== false));

onMounted(async () => {
  try {
    toolMetas.value = await toolsApi.tools();
    manageable.value = toolMetas.value.filter((item) => item.canManage).map((item) => item.code);
  } catch {
    toolMetas.value = [];
  }
  if (!getToken()) return;
  try {
    manageable.value = (await toolsApi.myPermissions()).toolCodes;
  } catch {
    manageable.value = [];
  }
});

function isLoginRequired(slug: string) {
  return Boolean(toolAccessMap.value[slug]?.requireLogin);
}

function openTool(tool: ServiceTool) {
  router.push({ name: tool.routeName, params: { slug: tool.slug } });
}

function openManage() {
  router.push({ path: "/services/tools/manage", query: { tool: manageable.value[0] ?? "questionnaire" } });
}
</script>

<style scoped>
.tools-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.tools-hero,
.tools-panel {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
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
  background: #ecfdf5;
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
  color: #111827;
  font-size: 22px;
}

.hero-copy p {
  margin: 6px 0 0;
  color: #6b7280;
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
  color: #111827;
  font-size: 17px;
}

.panel-head p {
  margin: 5px 0 0;
  color: #6b7280;
  font-size: 13px;
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
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
  color: inherit;
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
  background: #fafafa;
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
  background: #f9fafb;
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
  color: #111827;
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
  color: #4b5563;
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.tool-meta {
  color: #9ca3af;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.tool-arrow {
  color: #9ca3af;
  flex: 0 0 auto;
}

@media (max-width: 700px) {
  .tools-page {
    gap: 14px;
  }

  .tools-hero {
    align-items: flex-start;
    padding: 16px;
  }

  .hero-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
  }

  .hero-copy h2 {
    font-size: 20px;
  }

  .tools-panel {
    padding: 16px;
  }

  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }

  .panel-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .panel-actions :deep(.el-button) {
    flex: 1;
    min-width: 128px;
  }

  .tools-grid {
    grid-template-columns: 1fr;
  }

  .tool-card {
    min-height: 112px;
    padding: 14px 12px;
  }

  .tool-title-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .tool-title {
    white-space: normal;
  }

  .tool-summary {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
}

@media (max-width: 430px) {
  .tools-hero {
    gap: 12px;
  }

  .hero-copy h2 {
    font-size: 18px;
  }

  .tool-icon {
    width: 42px;
    height: 42px;
  }

  .tool-arrow {
    display: none;
  }
}
</style>
