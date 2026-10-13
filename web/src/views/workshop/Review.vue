<template>
  <div class="wk-page wk-review">
    <router-link class="wk-back" to="/workshop">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>创意工坊
    </router-link>
    <header class="wk-head">
      <div class="wk-head-copy">
        <h1>工坊审核</h1>
        <p>先预览，再决定公不公开。</p>
      </div>
      <el-button v-if="isAdmin && tab !== 'placements'" :loading="loading" @click="load">刷新</el-button>
    </header>

    <div v-if="!isAdmin" class="wk-group wk-empty" role="alert"><p>只有管理员能进入审核</p></div>
    <template v-else>
      <div class="wk-review-bar">
        <div class="wk-seg" role="group" aria-label="审核分区">
          <button
            v-for="item in tabs"
            :key="item.value"
            type="button"
            :aria-pressed="tab === item.value"
            @click="setTab(item.value)"
          >
            {{ item.label }}
          </button>
        </div>
        <el-input
          v-if="tab === 'queue' || tab === 'works'"
          v-model="search"
          class="wk-review-search"
          clearable
          placeholder="搜索作品"
          aria-label="搜索作品"
          :prefix-icon="Search"
          @keyup.enter="filterChanged"
          @clear="filterChanged"
        />
      </div>
      <div v-if="tab === 'queue' || tab === 'works'" class="wk-review-filters">
        <el-select v-model="type" placeholder="全部类型" clearable aria-label="作品类型" @change="filterChanged">
          <el-option label="游戏" value="game" />
          <el-option label="工具" value="tool" />
          <el-option label="扩展" value="extension" />
        </el-select>
        <el-select
          v-if="tab === 'works'"
          v-model="stateFilter"
          placeholder="全部状态"
          clearable
          aria-label="作品状态"
          @change="filterChanged"
        >
          <el-option label="已公开" value="published" />
          <el-option label="未公开" value="unpublished" />
          <el-option label="已停用" value="disabled" />
        </el-select>
      </div>
      <div v-if="tab === 'reports'" class="wk-seg" role="group" aria-label="举报状态">
        <button type="button" :aria-pressed="reportStatus === 'open'" @click="setReportStatus('open')">待处理</button>
        <button type="button" :aria-pressed="reportStatus === 'resolved'" @click="setReportStatus('resolved')">已处理</button>
      </div>

      <ExtensionSettings v-show="tab === 'placements'" ref="extensionSettings" :refresh-key="extensionRefresh" />

      <template v-if="tab !== 'placements'">
        <div v-if="loading" class="wk-group" role="status" aria-label="正在加载"><el-skeleton :rows="5" animated /></div>
        <div v-else-if="error" class="wk-group wk-empty" role="alert">
          <p>{{ error }}</p>
          <el-button @click="load">重试</el-button>
        </div>
        <template v-else-if="tab === 'reports'">
          <div v-if="!reports.length" class="wk-group wk-empty">
            <p>{{ reportStatus === "open" ? "没有待处理的举报" : "还没有处理过的举报" }}</p>
          </div>
          <section v-for="report in reports" :key="report.id" class="wk-group wk-review-item">
            <div class="wk-review-item-head">
              <div class="wk-review-item-copy">
                <h2 class="wk-h2">
                  <router-link :to="`/workshop/${report.work.id}`">{{ report.work.name || report.work.slug }}</router-link>
                  <em class="wk-chip" :class="report.resolvedAt ? 'is-ok' : 'is-warn'">{{ report.resolvedAt ? "已处理" : "待处理" }}</em>
                </h2>
                <p class="wk-meta">
                  <router-link :to="`/u/${report.reporter.id}`">{{ report.reporter.nickname }}</router-link>
                  <span>{{ workshopAgo(report.createdAt) }}举报</span>
                </p>
              </div>
            </div>
            <p class="wk-text">{{ report.reason }}</p>
            <p v-if="report.resolvedAt" class="wk-note">
              <b>{{ report.resolvedBy?.nickname || "管理员" }}</b> 于 {{ workshopDate(report.resolvedAt) }} 处理：{{ report.resolution }}
            </p>
            <div class="wk-actions">
              <el-button @click="router.push(`/workshop/${report.work.id}`)">查看作品</el-button>
              <el-button
                v-if="!report.resolvedAt"
                type="primary"
                :loading="actionBusy.has(report.id)"
                @click="resolveReport(report)"
                >处理举报</el-button
              >
              <el-button
                type="danger"
                plain
                :loading="actionBusy.has(report.work.id)"
                @click="changeState(report.work.id, 'disable')"
                >停用作品</el-button
              >
            </div>
          </section>
        </template>
        <template v-else>
          <div v-if="!works.length" class="wk-group wk-empty">
            <p>{{ tab === "queue" ? "没有等待审核的作品" : "没有找到作品" }}</p>
          </div>
          <section v-for="work in works" :key="`${work.id}-${work.version?.id}`" class="wk-group wk-review-item">
            <div class="wk-review-item-head">
              <WorkIcon :slug="work.slug" :name="workName(work)" :type="work.version?.type" :size="44" />
              <div class="wk-review-item-copy">
                <h2 class="wk-h2">
                  <router-link :to="`/workshop/${work.id}`">{{ workName(work) }}</router-link>
                  <em v-if="work.version" class="wk-chip" :class="`is-${statusTone[work.version.status]}`">{{ statusLabels[work.version.status] }}</em>
                  <em class="wk-chip" :class="`is-${workState(work).tone}`">{{ workState(work).label }}</em>
                </h2>
                <p class="wk-meta">
                  <router-link :to="`/u/${work.author.id}`">{{ work.author.nickname }}</router-link>
                  <span>{{ typeLabels[work.version?.type || "tool"] }}</span>
                  <span>v{{ work.version?.version || "—" }}</span>
                  <span>{{ workshopAgo(work.version?.submittedAt || work.updatedAt) }}{{ work.version?.submittedAt ? "提交" : "更新" }}</span>
                </p>
              </div>
            </div>
            <p class="wk-text wk-review-summary">{{ work.version?.description || "暂无介绍" }}</p>
            <dl class="wk-facts">
              <dt>申请权限</dt>
              <dd>{{ permissionText(work.version?.manifest.permissions) }}</dd>
              <template v-if="work.version?.manifest.extension">
                <dt>申请位置</dt>
                <dd>{{ work.version.manifest.extension.slots.map(slotLabel).join("、") }}</dd>
              </template>
            </dl>
            <p v-if="work.version?.reviewReason" class="wk-note is-danger">上次审核意见：{{ work.version.reviewReason }}</p>
            <div class="wk-actions">
              <el-button v-if="work.version" @click="preview(work)">预览和记录</el-button>
              <template v-if="tab === 'queue' && work.version?.status === 'PENDING'">
                <el-button
                  type="primary"
                  :disabled="work.disabled"
                  :loading="actionBusy.has(work.version.id)"
                  @click="openReview(work, 'approve')"
                  >通过并公开</el-button
                >
                <el-button
                  type="danger"
                  plain
                  :loading="actionBusy.has(work.version.id)"
                  @click="openReview(work, 'reject')"
                  >退回</el-button
                >
              </template>
              <template v-if="tab === 'works'">
                <el-button
                  v-if="work.publishedVersionId"
                  :loading="actionBusy.has(work.id)"
                  @click="changeState(work.id, 'unpublish')"
                  >下架</el-button
                >
                <el-button
                  :type="work.disabled ? 'primary' : 'danger'"
                  plain
                  :loading="actionBusy.has(work.id)"
                  @click="changeState(work.id, work.disabled ? 'enable' : 'disable')"
                  >{{ work.disabled ? "解除停用" : "停用" }}</el-button
                >
              </template>
            </div>
          </section>
        </template>
        <div v-if="!loading && !error && total > pageSize" class="wk-pagination">
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
      class="wk-dialog"
      :title="decision === 'approve' ? '通过并公开' : '退回修改'"
      width="min(520px, 92vw)"
      :close-on-click-modal="!reviewBusy"
      :show-close="!reviewBusy"
    >
      <p class="wk-review-dialog-title">{{ reviewTarget?.version?.name }} · v{{ reviewTarget?.version?.version }}</p>
      <p class="wk-sub">
        {{
          decision === "approve"
            ? "通过后这个版本立即公开，并替换当前公开的版本。"
            : "写清楚要改什么，作者能看到这段话。"
        }}
      </p>
      <p class="wk-note wk-review-dialog-note">申请权限：{{ permissionText(reviewTarget?.version?.manifest.permissions) }}</p>
      <el-input
        v-model="reviewReason"
        type="textarea"
        :rows="4"
        maxlength="1000"
        show-word-limit
        :placeholder="decision === 'reject' ? '退回原因（必填）' : '备注（选填）'"
        aria-label="审核意见"
      />
      <template #footer>
        <el-button :disabled="reviewBusy" @click="reviewOpen = false">取消</el-button>
        <el-button
          :type="decision === 'approve' ? 'primary' : 'danger'"
          :loading="reviewBusy"
          :disabled="decision === 'reject' && !reviewReason.trim()"
          @click="sendReview"
          >{{ decision === "approve" ? "通过并公开" : "确认退回" }}</el-button
        >
      </template>
    </el-dialog>
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
      class="wk-dialog"
      title="处理举报"
      width="min(520px, 92vw)"
      :close-on-click-modal="!reportBusy"
      :show-close="!reportBusy"
    >
      <p class="wk-review-dialog-title">{{ reportTarget?.work.name || reportTarget?.work.slug }}</p>
      <p class="wk-note wk-review-dialog-note">{{ reportTarget?.reason }}</p>
      <el-input
        v-model="resolution"
        type="textarea"
        :rows="4"
        maxlength="1000"
        show-word-limit
        aria-label="举报处理备注"
        placeholder="处理结果（必填）。这里只记录结论，要下架或停用请另外操作。"
        :disabled="reportBusy"
      />
      <template #footer>
        <el-button :disabled="reportBusy" @click="reportOpen = false">取消</el-button>
        <el-button type="primary" :loading="reportBusy" :disabled="!resolution.trim()" @click="sendResolution">标记已处理</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Search } from "@element-plus/icons-vue";
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
import WorkIcon from "./WorkIcon.vue";
import {
  permissionText,
  slotLabel,
  statusLabels,
  statusTone,
  typeLabels,
  workName,
  workState,
  workshopAgo,
  workshopDate,
  workshopError,
} from "./shared";
import "./workshop.css";
const auth = useAuthStore();
const isAdmin = computed(() => auth.user?.role === "admin");
const router = useRouter();
type Tab = "queue" | "works" | "reports" | "placements";
const tabs: { value: Tab; label: string }[] = [
  { value: "queue", label: "待审核" },
  { value: "works", label: "全部作品" },
  { value: "reports", label: "举报" },
  { value: "placements", label: "扩展位置" },
];
const tab = ref<Tab>("queue");
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
  if (!isAdmin.value || tab.value === "placements") return;
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
function setTab(value: Tab) {
  if (tab.value === value) return;
  tab.value = value;
  filterChanged();
}
function setReportStatus(value: "open" | "resolved") {
  if (reportStatus.value === value) return;
  reportStatus.value = value;
  filterChanged();
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
    unpublish: "下架后其他人不能再打开这个作品，要重新提交并通过审核才能再公开。",
    disable: "停用后作品不能再打开，作者也不能预览；解除停用后恢复原来的公开状态。",
    enable: "解除停用，恢复作品原来的公开状态？",
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

<style scoped>
.wk-review-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}
.wk-review-search { width: 240px; }
.wk-review-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.wk-review-filters .el-select { width: 140px; }
.wk-review-item { display: flex; flex-direction: column; gap: 10px; }
.wk-review-item-head { display: flex; min-width: 0; align-items: center; gap: 12px; }
.wk-review-item-copy { min-width: 0; flex: 1; }
.wk-review-item-copy h2 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}
.wk-review-item-copy h2 a { color: inherit; text-decoration: none; overflow-wrap: anywhere; }
.wk-review-summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}
.wk-review-dialog-title { margin: 0; font-weight: 600; }
.wk-review-dialog-note { margin: 10px 0; }
@media (max-width: 600px) {
  .wk-review-search { width: 100%; }
}
</style>
