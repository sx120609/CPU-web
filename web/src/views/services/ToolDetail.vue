<template>
  <div v-if="tool" class="pk-page tool-detail">
    <header class="pk-head">
      <router-link class="pk-back" to="/services/tools"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>校园小工具</router-link>
      <div class="pk-title">
        <span class="pk-tile" :style="{ '--tone': tool.accent }" aria-hidden="true"><el-icon><component :is="tool.iconComponent" /></el-icon></span>
        <div class="pk-title-copy">
          <h1>{{ tool.name }}<em v-if="toolBadge(tool)" class="pk-badge" :class="`is-${toolBadgeTone(tool, requireLogin)}`">{{ toolBadge(tool) }}</em></h1>
          <p>{{ tool.description }}</p>
        </div>
        <button v-if="canManage" data-cpu-button="surface" type="button" class="pk-pill" @click="openToolManage(tool.slug as ServiceToolCode)">
          <el-icon aria-hidden="true"><Setting /></el-icon>管理
        </button>
      </div>
    </header>

    <ToolFeedbackPanel v-if="tool.componentKey === 'feedback'" />
    <PdfToolPanel v-else-if="tool.componentKey === 'pdf_tools'" :require-login="requireLogin" />
    <SchoolCalendarPanel v-else-if="tool.componentKey === 'school_calendar'" />
    <VenueReservationPanel v-else-if="tool.componentKey === 'venue_reservation'" />

    <!-- 问卷、成绩核对、文件收集都是“凭分享链接进入”的工具，这里只给说明和入口。 -->
    <section v-else class="pk-card tool-entry">
      <header class="pk-card-head">
        <div>
          <h2 class="pk-h2">{{ entry.title }}</h2>
          <p class="pk-muted">{{ entry.intro }}</p>
        </div>
        <el-button v-if="canManage" type="primary" plain @click="openToolManage(tool.slug as ServiceToolCode)">{{ entry.manageLabel }}</el-button>
      </header>

      <div v-if="relatedLoading" class="pk-empty" role="status">正在查找与你有关的查询…</div>
      <ul v-else-if="related.length" class="pk-rows tool-entry-rows">
        <li v-for="item in related" :key="item.id">
          <router-link class="pk-row" :to="`/services/tools/grade-checks/${item.slug}`">
            <span class="pk-tile pk-tile--sm" style="--tone: #2563eb" aria-hidden="true"><el-icon><Link /></el-icon></span>
            <span class="pk-row-copy">
              <b>{{ item.title }}</b>
              <small>{{ item.rowCount }} 条记录 · 更新 {{ new Date(item.updatedAt).toLocaleDateString() }}</small>
            </span>
            <span class="pk-row-end">查看<el-icon aria-hidden="true"><ArrowRight /></el-icon></span>
          </router-link>
        </li>
      </ul>
      <div v-else class="pk-empty">
        <p>{{ canManage ? entry.manageHint : entry.guestHint }}</p>
        <PrivacyPolicyNotice v-if="entry.showPolicy" compact />
      </div>
    </section>
  </div>

  <div v-else class="pk-page pk-page--narrow">
    <section class="pk-card">
      <el-empty description="没有找到这个小工具">
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, ArrowRight, Link, Setting } from "@element-plus/icons-vue";
import { getToken } from "@/api/request";
import { toolsApi, type GradeCheckTable, type ServiceToolCode } from "@/api/tools";
import { findServiceTool } from "@/data/serviceTools";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import ToolFeedbackPanel from "./components/ToolFeedbackPanel.vue";
import { toolBadgeTone, useServiceTools, useToolManageEntry } from "./servicesPage";
import "@/styles/page-kit.css";

const PdfToolPanel = defineAsyncComponent(() => import("./PdfToolPanel.vue"));
const SchoolCalendarPanel = defineAsyncComponent(() => import("./SchoolCalendarPanel.vue"));
const VenueReservationPanel = defineAsyncComponent(() => import("./VenueReservationPanel.vue"));

const route = useRoute();
const { toolMetas, isLoginRequired, toolBadge } = useServiceTools();
const { canManageTool, openToolManage } = useToolManageEntry(toolMetas);
const tool = computed(() => findServiceTool(String(route.params.slug || "")));
const requireLogin = computed(() => Boolean(tool.value && isLoginRequired(tool.value.slug)));
const canManage = computed(() => Boolean(tool.value && canManageTool(tool.value.slug)));
const loggedIn = Boolean(getToken());

const related = ref<GradeCheckTable[]>([]);
const relatedLoading = ref(false);

const entry = computed(() => {
  const key = tool.value?.componentKey;
  if (key === "questionnaire") {
    return {
      title: "在线问卷",
      intro: "问卷由发起者创建后通过链接分享。这里不展示全部问卷。",
      manageLabel: "进入管理",
      manageHint: "在管理页创建问卷，发布后复制链接发给填写人。",
      guestHint: "请通过发起者分享的问卷链接填写。",
      showPolicy: false,
    };
  }
  if (key === "grade_check") {
    return {
      title: "成绩表核对",
      intro: "查询表由发起者上传 Excel 后生成链接。学生登录打开链接，只能看到自己学号对应的信息。",
      manageLabel: "进入管理",
      manageHint: "在管理页上传带有“学号”字段的 Excel，开放后复制链接分享给需要核对的同学。",
      guestHint: loggedIn
        ? "暂未找到与你学号匹配的开放查询。也可以通过发起者分享的链接进入。"
        : "登录后会自动显示与你学号匹配的开放查询。",
      showPolicy: !loggedIn && !canManage.value,
    };
  }
  return {
    title: "文件收集",
    intro: "进入 Filestore 创建提交链接，集中收取作业、材料、照片等文件。",
    manageLabel: "打开 Filestore",
    manageHint: "在 Filestore 工作台创建任务、复制提交链接、查看提交记录和下载文件。",
    guestHint: "请通过发起者分享的文件收集链接上传文件。",
    showPolicy: false,
  };
});

onMounted(async () => {
  if (tool.value?.componentKey !== "grade_check" || !loggedIn) return;
  relatedLoading.value = true;
  try {
    related.value = await toolsApi.relatedGradeChecks();
  } catch {
    related.value = [];
  } finally {
    relatedLoading.value = false;
  }
});
</script>

<style scoped>
.tool-entry-rows { margin: 0 -4px; }
.tool-entry-rows .pk-row { padding-inline: 4px; }
.pk-row-end { display: inline-flex; align-items: center; gap: 2px; color: var(--cpu-primary); font-weight: 500; }
.pk-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; }

@media (max-width: 560px) {
  .tool-detail .pk-title { flex-wrap: wrap; }
  .tool-entry .pk-card-head { flex-direction: column; }
  .tool-entry .pk-card-head .el-button { width: 100%; }
}
</style>
