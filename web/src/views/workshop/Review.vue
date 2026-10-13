<template>
  <div class="pk-page workshop-page">
    <header class="pk-head">
      <router-link class="pk-back" to="/workshop">‹ 创意工坊</router-link>
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true">✓</span>
        <div class="pk-title-copy">
          <h1>工坊审核管理</h1>
          <p>
            先预览并检查作品，再决定是否公开。下架与停用可在作品管理中操作。
          </p>
        </div>
      </div>
    </header>
    <div v-if="!isAdmin" class="pk-empty" role="alert">
      仅管理员可访问审核管理
    </div>
    <template v-else>
      <ExtensionSettings
        ref="extensionSettings"
        :refresh-key="extensionRefresh"
      />
      <section class="pk-card">
        <el-tabs v-model="tab" @tab-change="filterChanged"
          ><el-tab-pane label="待审核" name="queue" /><el-tab-pane
            label="全部作品"
            name="works" /><el-tab-pane label="用户举报" name="reports"
        /></el-tabs>
        <div class="ws-toolbar">
          <template v-if="tab !== 'reports'"
            ><el-input
              v-model="search"
              class="ws-search"
              clearable
              placeholder="搜索作品名称或介绍"
              aria-label="搜索审核作品"
              @keyup.enter="filterChanged"
              @clear="filterChanged"
              ><template #append
                ><el-button @click="filterChanged">搜索</el-button></template
              ></el-input
            ><el-radio-group
              v-model="type"
              aria-label="作品类型"
              @change="filterChanged"
              ><el-radio-button value="">全部</el-radio-button
              ><el-radio-button value="game">游戏</el-radio-button
              ><el-radio-button value="tool">工具</el-radio-button
              ><el-radio-button value="extension"
                >站点扩展</el-radio-button
              ></el-radio-group
            ></template
          ><el-select
            v-if="tab === 'works'"
            v-model="stateFilter"
            placeholder="作品状态"
            clearable
            aria-label="作品状态"
            @change="filterChanged"
            style="width: 160px"
            ><el-option label="已公开" value="published" /><el-option
              label="未公开"
              value="unpublished" /><el-option label="已停用" value="disabled"
          /></el-select>
          <el-radio-group
            v-if="tab === 'reports'"
            v-model="reportStatus"
            aria-label="举报状态"
            @change="filterChanged"
            ><el-radio-button value="open">待处理</el-radio-button
            ><el-radio-button value="resolved"
              >已处理</el-radio-button
            ></el-radio-group
          >
          <el-button :loading="loading" @click="load">刷新</el-button>
        </div>
      </section>
      <div v-if="loading" class="pk-card" role="status">
        <el-skeleton :rows="6" animated />
      </div>
      <div v-else-if="error" class="pk-empty ws-error" role="alert">
        <p>{{ error }}</p>
        <el-button @click="load">重试</el-button>
      </div>
      <template v-else>
        <div v-if="tab === 'reports'" class="ws-section-stack">
          <div v-if="!reports.length" class="pk-empty">暂无用户举报</div>
          <article v-for="report in reports" :key="report.id" class="pk-card">
            <div class="pk-card-head">
              <div>
                <h2 class="ws-name">
                  <router-link :to="`/workshop/${report.work.id}`">{{
                    report.work.name || report.work.slug
                  }}</router-link>
                </h2>
                <p class="pk-muted">
                  <router-link
                    class="pk-link"
                    :to="`/u/${report.reporter.id}`"
                    >{{ report.reporter.nickname }}</router-link
                  >
                  · {{ workshopDate(report.createdAt) }} 举报
                </p>
              </div>
            </div>
            <p class="ws-description">{{ report.reason }}</p>
            <p class="pk-muted">
              {{ report.resolvedAt ? "已处理" : "待处理" }}
            </p>
            <p v-if="report.resolvedAt" class="pk-muted">
              {{ report.resolvedBy?.nickname || "管理员" }} ·
              {{ workshopDate(report.resolvedAt) }} · {{ report.resolution }}
            </p>
            <div class="ws-actions" style="margin-top: 14px">
              <el-button @click="router.push(`/workshop/${report.work.id}`)"
                >查看作品</el-button
              ><el-button
                v-if="!report.resolvedAt"
                :loading="actionBusy.has(report.id)"
                @click="resolveReport(report)"
                >处理举报</el-button
              ><el-button
                type="danger"
                plain
                :loading="actionBusy.has(report.work.id)"
                @click="changeState(report.work.id, 'disable')"
                >停用作品</el-button
              >
            </div>
          </article>
        </div>
        <div v-else class="ws-section-stack">
          <div v-if="!works.length" class="pk-empty">
            {{ tab === "queue" ? "暂无待审核作品" : "没有找到作品" }}
          </div>
          <article
            v-for="work in works"
            :key="`${work.id}-${work.version?.id}`"
            class="pk-card"
          >
            <div class="pk-card-head">
              <div>
                <h2 class="ws-name">
                  <router-link :to="`/workshop/${work.id}`">{{
                    work.version?.name || work.slug
                  }}</router-link>
                </h2>
                <div class="ws-meta" style="margin-top: 6px">
                  <router-link class="pk-link" :to="`/u/${work.author.id}`">{{
                    work.author.nickname
                  }}</router-link
                  ><span>{{
                    work.version?.type === "game"
                      ? "游戏"
                      : work.version?.type === "extension"
                        ? "站点扩展"
                        : "工具"
                  }}</span
                  ><span>v{{ work.version?.version || "—" }}</span
                  ><span>{{
                    workshopDate(work.version?.submittedAt || work.updatedAt)
                  }}</span
                  ><em v-if="work.version" class="pk-badge is-info">{{
                    statusLabels[work.version.status]
                  }}</em>
                </div>
              </div>
              <em v-if="work.disabled" class="pk-badge is-danger">已停用</em
              ><em v-else-if="work.publishedVersionId" class="pk-badge is-open"
                >已公开</em
              ><em v-else class="pk-badge">未公开</em>
            </div>
            <p class="ws-description">
              {{ work.version?.description || "暂无介绍" }}
            </p>
            <p class="pk-muted">
              申请权限：{{ permissionText(work.version?.manifest.permissions) }}
            </p>
            <p v-if="work.version?.manifest.extension" class="pk-muted">
              申请位置：{{
                work.version.manifest.extension.slots
                  .map((s) => (s === "splash" ? "开屏" : "小工具"))
                  .join("、")
              }}
            </p>
            <p v-if="work.version?.reviewReason" class="ws-reason">
              上次审核意见：{{ work.version.reviewReason }}
            </p>
            <div class="ws-actions" style="margin-top: 16px">
              <el-button v-if="work.version" @click="preview(work)"
                >快速预览 / 版本历史</el-button
              >
              <template
                v-if="tab === 'queue' && work.version?.status === 'PENDING'"
                ><el-button
                  type="success"
                  :disabled="work.disabled"
                  :loading="actionBusy.has(work.version.id)"
                  @click="openReview(work, 'approve')"
                  >通过并发布</el-button
                ><el-button
                  type="danger"
                  plain
                  :loading="actionBusy.has(work.version.id)"
                  @click="openReview(work, 'reject')"
                  >退回修改</el-button
                ></template
              >
              <template v-if="tab === 'works'"
                ><el-button
                  v-if="work.publishedVersionId"
                  type="warning"
                  plain
                  :loading="actionBusy.has(work.id)"
                  @click="changeState(work.id, 'unpublish')"
                  >下架</el-button
                ><el-button
                  :type="work.disabled ? 'success' : 'danger'"
                  plain
                  :loading="actionBusy.has(work.id)"
                  @click="
                    changeState(work.id, work.disabled ? 'enable' : 'disable')
                  "
                  >{{ work.disabled ? "解除停用" : "停用" }}</el-button
                ></template
              >
            </div>
          </article>
        </div>
        <div v-if="total > pageSize" class="ws-pagination">
          <el-pagination
            v-model:current-page="page"
            :page-size="pageSize"
            :total="total"
            layout="prev, pager, next"
            @current-change="load"
          />
        </div>
      </template>
    </template>
    <el-dialog
      v-model="reviewOpen"
      :title="decision === 'approve' ? '通过并公开作品' : '退回修改'"
      width="min(520px, 92vw)"
      :close-on-click-modal="!reviewBusy"
      :show-close="!reviewBusy"
      ><p class="pk-muted" style="margin-bottom: 12px">
        {{ reviewTarget?.version?.name }} · v{{ reviewTarget?.version?.version
        }}{{
          decision === "approve"
            ? "，通过后将替换当前公开版本。请确认已完成预览和内容检查。"
            : "，请说明需要修改的问题，作者可查看审核意见。"
        }}
      </p>
      <p class="pk-muted">
        申请权限：{{
          permissionText(reviewTarget?.version?.manifest.permissions)
        }}
      </p>
      <el-input
        v-model="reviewReason"
        type="textarea"
        :rows="4"
        maxlength="1000"
        show-word-limit
        :placeholder="
          decision === 'reject' ? '填写退回原因（必填）' : '审核备注（选填）'
        "
        aria-label="审核意见"
      /><template #footer
        ><el-button :disabled="reviewBusy" @click="reviewOpen = false"
          >取消</el-button
        ><el-button
          :type="decision === 'approve' ? 'success' : 'danger'"
          :loading="reviewBusy"
          :disabled="decision === 'reject' && !reviewReason.trim()"
          @click="sendReview"
          >{{ decision === "approve" ? "通过并发布" : "确认退回" }}</el-button
        ></template
      ></el-dialog
    >
    <ReviewPreview
      v-if="previewTarget && isAdmin"
      :key="previewTarget.id"
      :work="previewTarget"
      @close="previewTarget = null"
      @changed="reviewChanged"
      @enable="enablePlacement"
    />
    <el-dialog
      v-model="reportOpen"
      title="处理举报"
      width="min(520px, 92vw)"
      :close-on-click-modal="!reportBusy"
      :show-close="!reportBusy"
    >
      <p>{{ reportTarget?.work.name || reportTarget?.work.slug }}</p>
      <p class="pk-muted">{{ reportTarget?.reason }}</p>
      <el-input
        v-model="resolution"
        type="textarea"
        :rows="4"
        maxlength="1000"
        show-word-limit
        aria-label="举报处理备注"
        placeholder="填写处理结果与备注（必填）"
        :disabled="reportBusy"
      />
      <template #footer
        ><el-button :disabled="reportBusy" @click="reportOpen = false"
          >取消</el-button
        ><el-button
          type="primary"
          :loading="reportBusy"
          :disabled="!resolution.trim()"
          @click="sendResolution"
          >标记已处理</el-button
        ></template
      >
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import {
  workshopApi,
  type WorkshopWork,
  type WorkshopType,
  type WorkshopReport,
  type WorkshopSlot,
} from "@/api/workshop";
import ExtensionSettings from "./ExtensionSettings.vue";
import ReviewPreview from "./ReviewPreview.vue";
import {
  permissionText,
  statusLabels,
  workshopDate,
  workshopError,
} from "./shared";
import "./workshop.css";
const auth = useAuthStore();
const isAdmin = computed(() => auth.user?.role === "admin");
const router = useRouter();
const tab = ref("queue");
const previewTarget = ref<WorkshopWork | null>(null);
const extensionSettings = ref<InstanceType<typeof ExtensionSettings>>();
const extensionRefresh = ref(0);
const stateFilter = ref<"" | "published" | "unpublished" | "disabled">("");
const reportStatus = ref<"open" | "resolved">("open");
const reportOpen = ref(false),
  reportTarget = ref<WorkshopReport | null>(null),
  resolution = ref(""),
  reportBusy = ref(false);
const search = ref("");
const type = ref<WorkshopType | "">("");
const page = ref(1);
const pageSize = 12;
const total = ref(0);
const works = ref<WorkshopWork[]>([]);
const reports = ref<WorkshopReport[]>([]);
const loading = ref(false);
const error = ref("");
const actionBusy = ref(new Set<string>());
const reviewOpen = ref(false);
const reviewTarget = ref<WorkshopWork | null>(null);
const decision = ref<"approve" | "reject">("approve");
const reviewReason = ref("");
const reviewBusy = ref(false);
let requestId = 0;
async function load() {
  if (!isAdmin.value) return;
  const id = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const params = {
      q: search.value.trim() || undefined,
      type: type.value || undefined,
      page: page.value,
      pageSize,
    };
    if (tab.value === "reports") {
      const data = await workshopApi.reports({
        page: page.value,
        pageSize,
        reportStatus: reportStatus.value,
      });
      if (id !== requestId) return;
      if (page.value > Math.max(1, data.pagination.totalPages)) {
        page.value = Math.max(1, data.pagination.totalPages);
        await load();
        return;
      }
      reports.value = data.items;
      total.value = data.pagination.total;
    } else {
      const data = await (tab.value === "queue"
        ? workshopApi.queue(params)
        : workshopApi.adminWorks({
            ...params,
            state: stateFilter.value || undefined,
          }));
      if (id !== requestId) return;
      if (page.value > Math.max(1, data.pagination.totalPages)) {
        page.value = Math.max(1, data.pagination.totalPages);
        await load();
        return;
      }
      works.value = data.items;
      total.value = data.pagination.total;
    }
  } catch (e) {
    if (id === requestId) error.value = workshopError(e, "管理列表加载失败");
  } finally {
    if (id === requestId) loading.value = false;
  }
}
function filterChanged() {
  page.value = 1;
  void load();
}
function preview(work: WorkshopWork) {
  previewTarget.value = work;
}
function reviewChanged() {
  extensionRefresh.value++;
  void load();
}
async function enablePlacement(slot: WorkshopSlot, versionId: string) {
  await extensionSettings.value?.enable(slot, versionId);
}
function resolveReport(report: WorkshopReport) {
  if (reportBusy.value) return;
  reportTarget.value = report;
  resolution.value = "";
  reportOpen.value = true;
}
async function sendResolution() {
  const target = reportTarget.value;
  if (!target || reportBusy.value || !resolution.value.trim() || !isAdmin.value)
    return;
  reportBusy.value = true;
  actionBusy.value.add(target.id);
  try {
    await workshopApi.resolveReport(target.id, resolution.value.trim());
    reportOpen.value = false;
    ElMessage.success("举报已处理");
    await load();
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    reportBusy.value = false;
    actionBusy.value.delete(target.id);
  }
}
function openReview(work: WorkshopWork, next: "approve" | "reject") {
  if (reviewBusy.value) return;
  reviewTarget.value = work;
  decision.value = next;
  reviewReason.value = "";
  reviewOpen.value = true;
}
async function sendReview() {
  const version = reviewTarget.value?.version;
  if (
    !version ||
    !isAdmin.value ||
    reviewBusy.value ||
    (decision.value === "reject" && !reviewReason.value.trim())
  )
    return;
  const submittedDecision = decision.value;
  const submittedReason = reviewReason.value.trim();
  reviewBusy.value = true;
  actionBusy.value.add(version.id);
  try {
    await workshopApi.review(
      version.id,
      submittedDecision,
      submittedReason || undefined,
    );
    reviewOpen.value = false;
    extensionRefresh.value++;
    if (submittedDecision === "approve" && version.manifest.extension)
      previewTarget.value = {
        ...reviewTarget.value!,
        publishedVersionId: version.id,
      };
    ElMessage.success(
      submittedDecision === "approve"
        ? "作品已通过审核并公开"
        : "已退回作者修改",
    );
    await load();
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    reviewBusy.value = false;
    actionBusy.value.delete(version.id);
  }
}
async function changeState(
  id: string,
  action: "unpublish" | "disable" | "enable",
) {
  if (actionBusy.value.has(id)) return;
  const label = { unpublish: "下架", disable: "停用", enable: "解除停用" }[
    action
  ];
  const message = {
    unpublish: "下架后公开入口将关闭，需要再次审核发布才能重新公开。",
    disable: "停用后公开使用与私密预览将关闭，解除停用后恢复原有发布状态。",
    enable: "确认解除停用并恢复作品原有发布状态？",
  }[action];
  try {
    await ElMessageBox.confirm(message, `${label}作品`, {
      confirmButtonText: `确认${label}`,
      cancelButtonText: "取消",
      type: action === "enable" ? "info" : "warning",
    });
  } catch {
    return;
  }
  actionBusy.value.add(id);
  try {
    await workshopApi.state(id, action);
    if (previewTarget.value?.id === id) previewTarget.value = null;
    extensionRefresh.value++;
    ElMessage.success(`已${label}`);
    await load();
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    actionBusy.value.delete(id);
  }
}
watch(isAdmin, (allowed) => {
  if (!allowed) {
    requestId++;
    previewTarget.value = null;
    reviewOpen.value = false;
    reportOpen.value = false;
    works.value = [];
    reports.value = [];
  } else void load();
});
onMounted(load);
</script>
