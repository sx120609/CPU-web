<template>
  <el-dialog
    :model-value="true"
    title="审核私密预览"
    width="min(1200px, 96vw)"
    style="--cpu-dialog-max-width: 1200px"
    destroy-on-close
    @close="emit('close')"
  >
    <div v-if="loading" role="status"><el-skeleton :rows="4" animated /></div>
    <el-alert v-else-if="error" :title="error" type="error" :closable="false" />
    <template v-else-if="selected">
      <div class="ws-actions preview-toolbar">
        <el-select v-model="versionId" aria-label="预览版本" :disabled="busy">
          <el-option
            v-for="version in versions"
            :key="version.id"
            :value="version.id"
            :label="`v${version.version} · ${statusLabels[version.status]}`"
          />
        </el-select>
        <el-radio-group v-model="device" aria-label="预览设备"
          ><el-radio-button value="desktop">电脑</el-radio-button
          ><el-radio-button value="mobile"
            >手机</el-radio-button
          ></el-radio-group
        >
        <el-select v-model="slot" aria-label="模拟位置" :disabled="busy">
          <el-option label="独立页面" value="page" />
          <el-option
            v-for="position in selected.manifest.extension?.slots || []"
            :key="position"
            :value="position"
            :label="position === 'splash' ? '开屏' : '弹窗小工具'"
          />
        </el-select>
        <el-button :disabled="disabled" @click="restart">重启预览</el-button
        ><el-button @click="stop">关闭运行</el-button>
      </div>
      <div class="preview-layout">
        <div class="preview-canvas" :class="device">
          <p v-if="slot !== 'page'" class="preview-site">
            主站页面模拟 · 预览不会改变主站扩展绑定
          </p>
          <div class="preview-shell" :class="slot">
            <div v-if="slot !== 'page'" class="preview-frame-head">
              <b>{{ slot === "splash" ? "开屏预览" : selected.name }}</b
              ><el-button size="small" @click="stop"
                >关闭{{ running ? `（${remaining}秒）` : "" }}</el-button
              >
            </div>
            <div class="preview-runtime">
              <WorkshopRuntime
                v-if="running"
                :key="`${selected.id}-${slot}-${runKey}`"
                :work-id="work.id"
                :version="selected"
                :preview="true"
                :slot="slot"
                @close="stop"
              />
              <p v-else class="pk-muted">预览已关闭，可点击重启。</p>
            </div>
          </div>
        </div>
        <aside class="preview-inspector">
          <h3>{{ selected.name }} · v{{ selected.version }}</h3>
          <p class="pk-muted">
            {{ statusLabels[selected.status] }} ·
            {{ workshopDate(selected.createdAt) }}
          </p>
          <p>{{ selected.description }}</p>
          <p>申请权限：{{ permissionText(selected.manifest.permissions) }}</p>
          <p v-if="selected.manifest.extension">
            申请位置：{{
              selected.manifest.extension.slots
                .map((s) => (s === "splash" ? "开屏" : "弹窗小工具"))
                .join("、")
            }}
          </p>
          <p v-if="disabled" class="pk-muted">
            作品已停用，仅可查看版本与操作记录。
          </p>
          <p class="pk-muted">
            存档与正式运行隔离。切换版本或关闭预览会立即卸载运行框。
          </p>
          <p v-if="selected.reviewReason">
            审核意见：{{ selected.reviewReason }}
          </p>
          <el-input
            v-if="selected.status === 'PENDING'"
            v-model="reason"
            type="textarea"
            :rows="3"
            maxlength="1000"
            show-word-limit
            placeholder="审核备注；退回时必填"
            aria-label="预览审核意见"
            :disabled="busy"
          />
          <div
            v-if="selected.status === 'PENDING'"
            class="ws-actions preview-toolbar"
          >
            <el-button
              type="success"
              :disabled="disabled || busy"
              :loading="busy"
              @click="review('approve')"
              >通过并发布此版本</el-button
            >
            <el-button
              type="danger"
              plain
              :disabled="busy || !reason.trim()"
              @click="review('reject')"
              >退回此版本</el-button
            >
          </div>
          <div
            v-if="
              selected.status === 'APPROVED' &&
              selected.id === publishedId &&
              selected.manifest.extension &&
              !disabled
            "
            class="preview-toolbar"
          >
            <p>已公开，可单独启用主站位置：</p>
            <el-button
              v-for="position in selected.manifest.extension.slots"
              :key="position"
              :disabled="busy"
              @click="emit('enable', position, selected.id)"
              >启用{{ position === "splash" ? "开屏" : "小工具" }}</el-button
            >
          </div>
          <h3>操作记录</h3>
          <p v-if="auditError" role="alert">
            {{ auditError }}
            <el-button size="small" @click="loadAudits">重试</el-button>
          </p>
          <p v-else-if="!audits.length" class="pk-muted">暂无操作记录</p>
          <div v-for="audit in audits" :key="audit.id" class="preview-audit">
            <b>{{ actionLabel(audit.action) }}</b> ·
            {{ audit.actor?.nickname || "系统"
            }}<span v-if="audit.version"> · v{{ audit.version.version }}</span>
            <p class="pk-muted">{{ workshopDate(audit.createdAt) }}</p>
            <p v-if="audit.reason">{{ auditReason(audit) }}</p>
          </div>
          <el-pagination
            v-if="auditTotal > 6"
            v-model:current-page="auditPage"
            :page-size="6"
            :total="auditTotal"
            layout="prev, pager, next"
            @current-change="loadAudits"
          />
        </aside>
      </div>
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  workshopApi,
  type WorkshopWork,
  type WorkshopVersion,
  type WorkshopAudit,
  type WorkshopSlot,
} from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import WorkshopRuntime from "./WorkshopRuntime.vue";
import {
  permissionText,
  statusLabels,
  workshopDate,
  workshopError,
} from "./shared";
const props = defineProps<{ work: WorkshopWork }>();
const emit = defineEmits<{
  close: [];
  changed: [];
  enable: [slot: WorkshopSlot, versionId: string];
}>();
const route = useRoute(),
  auth = useAuthStore();
const disabled = ref(props.work.disabled);
const loading = ref(true),
  error = ref(""),
  versions = ref<WorkshopVersion[]>([]),
  versionId = ref(props.work.version?.id || ""),
  publishedId = ref(props.work.publishedVersionId);
const selected = computed(() =>
  versions.value.find((v) => v.id === versionId.value),
);
const device = ref("desktop"),
  slot = ref<"page" | WorkshopSlot>("page"),
  running = ref(false),
  runKey = ref(0),
  remaining = ref(0),
  reason = ref(""),
  busy = ref(false);
const audits = ref<WorkshopAudit[]>([]),
  auditPage = ref(1),
  auditTotal = ref(0),
  auditError = ref("");
let alive = true,
  auditSeq = 0,
  deadline = 0,
  timer: ReturnType<typeof setInterval> | undefined;
function stop() {
  running.value = false;
  clearInterval(timer);
}
function restart() {
  stop();
  if (disabled.value || !selected.value || auth.user?.role !== "admin") return;
  runKey.value++;
  remaining.value = slot.value === "splash" ? 15 : 120;
  running.value = true;
  startCountdown();
}
function updateCountdown() {
  if (!running.value || slot.value === "page") return;
  remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  if (remaining.value === 0) stop();
}
function startCountdown() {
  clearInterval(timer);
  if (slot.value === "page") return;
  deadline = Date.now() + remaining.value * 1000;
  timer = setInterval(updateCountdown, 250);
}
async function loadAudits() {
  const seq = ++auditSeq;
  auditError.value = "";
  try {
    const result = await workshopApi.audits(props.work.id, {
      page: auditPage.value,
      pageSize: 6,
    });
    if (!alive || seq !== auditSeq) return;
    audits.value = result.items;
    auditTotal.value = result.pagination.total;
  } catch (e) {
    if (alive && seq === auditSeq)
      auditError.value = workshopError(e, "操作记录加载失败");
  }
}
function auditReason(audit: WorkshopAudit) {
  const slotLabel = (slot: string) =>
    ({ splash: "开屏", dialog: "弹窗小工具" })[slot] || slot;
  if (audit.action === "placement-remove") return slotLabel(audit.reason || "");
  if (audit.action === "placement-set" && audit.reason) {
    try {
      const detail = JSON.parse(audit.reason);
      if (detail && typeof detail.slot === "string")
        return `${slotLabel(detail.slot)}${detail.previousVersionId ? " · 替换原绑定版本" : " · 首次绑定"}`;
    } catch { /* Older records remain readable as plain text. */ }
  }
  return audit.reason;
}
function actionLabel(action: string) {
  return (
    (
      {
        approve: "审核通过",
        reject: "审核退回",
        unpublish: "下架",
        disable: "停用",
        enable: "解除停用",
        submit: "提交审核",
        resolve_report: "处理举报",
        "placement-set": "启用扩展位置",
        "placement-remove": "关闭扩展位置",
      } as Record<string, string>
    )[action] || action
  );
}
async function review(decision: "approve" | "reject") {
  const version = selected.value;
  if (
    !version ||
    busy.value ||
    (decision === "approve" && disabled.value) ||
    version.status !== "PENDING" ||
    (decision === "reject" && !reason.value.trim())
  )
    return;
  const reviewReason = reason.value.trim();
  busy.value = true;
  try {
    await ElMessageBox.confirm(
      `确认${decision === "approve" ? "通过并公开" : "退回"}「${version.name}」v${version.version}？`,
      "审核此版本",
      { type: "warning" },
    );
    if (
      !alive ||
      auth.user?.role !== "admin" ||
      selected.value?.id !== version.id
    )
      return;
    await workshopApi.review(version.id, decision, reviewReason || undefined);
    if (!alive) return;
    version.status = decision === "approve" ? "APPROVED" : "REJECTED";
    version.reviewReason = reviewReason || null;
    if (decision === "approve") publishedId.value = version.id;
    ElMessage.success(
      decision === "approve" ? "此版本已通过审核并公开" : "此版本已退回修改",
    );
    emit("changed");
    void loadAudits();
  } catch (e) {
    if (e !== "cancel" && e !== "close" && alive)
      ElMessage.error(workshopError(e));
  } finally {
    busy.value = false;
  }
}
watch([versionId, slot], () => {
  reason.value = "";
  if (
    slot.value !== "page" &&
    !selected.value?.manifest.extension?.slots.includes(slot.value)
  )
    slot.value = "page";
  restart();
});
watch(
  () => route.fullPath,
  () => {
    stop();
    emit("close");
  },
);
watch(
  () => auth.sessionVersion,
  () => {
    stop();
    emit("close");
  },
);
watch(
  () => auth.user?.role,
  (role) => {
    if (role !== "admin") {
      stop();
      emit("close");
    }
  },
);
onMounted(async () => {
  document.addEventListener("visibilitychange", updateCountdown);
  void loadAudits();
  try {
    const detail = await workshopApi.detail(props.work.id);
    if (!alive) return;
    versions.value =
      detail.versions || (detail.version ? [detail.version] : []);
    publishedId.value = detail.publishedVersionId;
    disabled.value = detail.disabled;
    if (!selected.value) versionId.value = versions.value[0]?.id || "";
    if (!detail.disabled) restart();
  } catch (e) {
    if (alive) error.value = workshopError(e, "版本历史加载失败");
  } finally {
    if (alive) loading.value = false;
  }
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", updateCountdown);
  alive = false;
  auditSeq++;
  stop();
});
</script>
<style scoped>
.preview-toolbar {
  display: flex;
  align-items: center;
  margin: 12px 0;
  gap: 8px;
  flex-wrap: wrap;
}
.preview-toolbar .el-button + .el-button {
  margin-left: 0;
}
.preview-toolbar .el-select {
  width: 200px;
}
.preview-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
}
.preview-canvas {
  min-width: 0;
  background: var(--cpu-bg);
  border: 1px solid var(--cpu-border);
  border-radius: 12px;
  padding: 12px;
}
.preview-canvas.mobile {
  width: min(390px, 100%);
  justify-self: center;
}
.preview-site {
  color: var(--cpu-text-muted);
  padding: 12px;
}
.preview-frame-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--cpu-card);
}
.preview-runtime {
  height: 560px;
}
.preview-shell.dialog {
  margin: 24px auto;
  border: 1px solid var(--cpu-border);
  border-radius: 12px;
  overflow: hidden;
}
.dialog .preview-runtime {
  height: 420px;
}
.preview-inspector {
  min-width: 0;
  overflow-wrap: anywhere;
}
.preview-inspector p {
  margin: 10px 0;
}
.preview-audit {
  padding: 10px 0;
  border-bottom: 1px solid var(--cpu-border);
}
@media (max-width: 760px) {
  .preview-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .preview-runtime {
    height: 480px;
  }
}
</style>
