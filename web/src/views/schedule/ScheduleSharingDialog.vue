<template>
  <!-- 「共享课表」：上面是自己的分享码，下面是别人分享给我的课表。 -->
  <el-dialog
    :model-value="modelValue"
    :title="view === 'import' ? '用分享码导入' : '共享课表'"
    :width="480"
    align-center
    append-to-body
    class="schedule-themed-dialog schedule-sharing-dialog"
    :style="pageStyle"
    @update:model-value="emit('update:modelValue', $event)"
    @open="onOpen"
    @closed="view = 'list'"
  >
    <div v-if="view === 'list'" class="sharing">
      <section class="sharing-section">
        <h3>分享我的课表</h3>
        <div class="sharing-card" :class="{ 'sharing-card-action': signedIn && !ownShare }">
          <template v-if="!signedIn">
            <p class="sharing-hint">登录站点账号后才能分享自己的课表；用分享码看别人的课表不需要登录。</p>
          </template>
          <template v-else-if="ownShare">
            <div class="sharing-code" :aria-label="`分享码 ${ownShare.code.split('').join(' ')}`">{{ ownShare.code }}</div>
            <p class="sharing-meta">{{ ownShareSummary }}</p>
            <div class="sharing-actions">
              <button type="button" @click="sendToFriend(ownShare.code)">
                <el-icon><Share /></el-icon>发送给朋友
              </button>
              <button type="button" :disabled="busy" @click="publish">
                <el-icon><Refresh /></el-icon>更新分享内容
              </button>
              <button type="button" class="danger" :disabled="busy" @click="revoke(ownShare)">
                <el-icon><CircleClose /></el-icon>撤销分享
              </button>
            </div>
          </template>
          <button v-else type="button" class="sharing-primary" :disabled="busy || !canPublish" @click="publish">
            <el-icon><Share /></el-icon>生成分享码
          </button>
          <p v-if="busy" class="sharing-status">正在处理…</p>
          <p v-if="notice" class="sharing-status ok"><el-icon><CircleCheck /></el-icon>{{ notice }}</p>
          <p v-if="errorMessage" class="sharing-status error"><el-icon><WarningFilled /></el-icon>{{ errorMessage }}</p>
        </div>
        <p v-if="signedIn" class="sharing-foot">
          分享会上传「{{ semesterLabel }}」的课程、上课时间、教室、老师和调休安排，自己添加和修改的课程也在内。拿到分享码的人不用登录就能查看。课表有变化时点「更新分享内容」，分享码不变。
        </p>
      </section>

      <section v-if="otherShares.length" class="sharing-section">
        <h3>其他学期的分享码</h3>
        <div class="sharing-card">
          <div v-for="share in otherShares" :key="share.code" class="sharing-row">
            <div class="sharing-row-text">
              <b class="mono">{{ share.code }}</b>
              <small>{{ share.semester }} · {{ share.courseCount }} 门课</small>
            </div>
            <button type="button" class="sharing-link danger" :disabled="busy" @click="revoke(share)">撤销</button>
          </div>
        </div>
      </section>

      <section class="sharing-section">
        <h3>共享给我的课表</h3>
        <div class="sharing-card" :class="{ 'sharing-card-action': !sharing.library.value.schedules.length }">
          <div v-for="item in sharing.library.value.schedules" :key="item.meta.code" class="sharing-row">
            <button type="button" class="sharing-row-main" :aria-label="`打开 ${sharedScheduleName(item)} 的课表`" @click="open(item)">
              <span class="sharing-avatar"><el-icon><User /></el-icon></span>
              <span class="sharing-row-text">
                <b>{{ sharedScheduleName(item) }}</b>
                <small v-if="item.revoked" class="warn">分享已撤销，不会再更新</small>
                <small v-else>{{ summaryOf(item) }}</small>
              </span>
            </button>
            <button type="button" class="sharing-link" @click="rename(item)">备注</button>
            <button type="button" class="sharing-link danger" @click="remove(item)">移除</button>
          </div>
          <button type="button" class="sharing-primary plain" @click="startImport">
            <el-icon><Plus /></el-icon>用分享码导入
          </button>
        </div>
        <p class="sharing-foot">轻点打开对方的课表，只能查看。导入的课表只保存在这台设备上，对方更新后会自动跟着更新。</p>
      </section>
    </div>

    <!-- 输入一个码，看看它是什么，起个名字，留下来。 -->
    <div v-else class="sharing">
      <section class="sharing-section">
        <div class="sharing-card">
          <el-input
            v-model="importCode"
            placeholder="8 位分享码，或粘贴分享链接"
            class="mono-input"
            maxlength="200"
            clearable
            @input="onImportCodeInput"
            @keyup.enter="loadPreview"
          />
          <button
            type="button"
            class="sharing-primary"
            :disabled="previewLoading || !importCode.trim()"
            @click="loadPreview"
          >
            {{ previewLoading ? "正在读取…" : "预览课表" }}
          </button>
          <p v-if="importError" class="sharing-status error"><el-icon><WarningFilled /></el-icon>{{ importError }}</p>
        </div>
        <p class="sharing-foot">分享码由对方在「课表 → 更多 → 共享课表」里生成。</p>
      </section>

      <template v-if="previewed">
        <section class="sharing-section">
          <h3>这份课表</h3>
          <div class="sharing-card">
            <div class="sharing-line"><span>来自</span><b>{{ shareOwnerName(previewed.meta) || "没有留昵称" }}</b></div>
            <div class="sharing-line"><span>学期</span><b>{{ previewed.meta.semester }}</b></div>
            <div class="sharing-line"><span>课程</span><b>{{ sharedCourseCount(previewed.schedule) }} 门</b></div>
            <div class="sharing-line"><span>教学周</span><b>{{ previewed.calendar.weeks.length }} 周</b></div>
          </div>
        </section>
        <section class="sharing-section">
          <h3>备注</h3>
          <div class="sharing-card">
            <el-input v-model="importRemark" :placeholder="shareOwnerName(previewed.meta) || '例如 室友小王'" maxlength="20" />
            <button type="button" class="sharing-primary" :disabled="!canConfirmImport" @click="confirmImport">确认导入</button>
          </div>
          <p class="sharing-foot">备注只保存在这台设备上，用来在列表里认出这份课表，对方看不到。</p>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="sharing-footer">
        <el-button v-if="view === 'import'" data-cpu-button-theme="schedule" @click="view = 'list'">返回</el-button>
        <el-button data-cpu-button-theme="schedule" @click="emit('update:modelValue', false)">完成</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CircleCheck, CircleClose, Plus, Refresh, Share, User, WarningFilled } from "@element-plus/icons-vue";
import type { scheduleShareApi, ScheduleShareMeta } from "@/api/scheduleShares";
import { copyText } from "@/utils/userGroup";
import {
  shareInvitationText,
  shareOwnerName,
  shareUpdatedText,
  sharedCourseCount,
  sharedScheduleName,
  type SavedSharedSchedule,
} from "./sharedSchedules";
import { useSharedSchedules } from "./useSharedSchedules";

type PublishBody = Parameters<typeof scheduleShareApi.create>[0];

const props = withDefaults(defineProps<{
  modelValue: boolean;
  /** 屏幕上这个学期。 */
  semester: string;
  semesterLabel: string;
  signedIn: boolean;
  /** 课表和校历都在、可以发布。 */
  canPublish: boolean;
  /** 准备发布用的请求体：要整学期的课表，并且带上自己的修改。 */
  buildBody: () => Promise<PublishBody>;
  pageStyle?: Record<string, string>;
}>(), {
  pageStyle: () => ({}),
});

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "open", code: string): void;
}>();

const sharing = useSharedSchedules();
const view = ref<"list" | "import">("list");
const busy = ref(false);
const notice = ref("");
const errorMessage = ref("");

const ownShare = computed(() => sharing.shareFor(props.semester));
const otherShares = computed(() => sharing.mine.value.filter((item) => item.semester !== props.semester));
const ownShareSummary = computed(() => {
  const share = ownShare.value;
  if (!share) return "";
  return [props.semesterLabel, `${share.courseCount} 门课`, shareUpdatedText(share.updatedAt)].filter(Boolean).join(" · ");
});

function onOpen() {
  notice.value = "";
  errorMessage.value = "";
  // 两个都可能因为断网失败；屏幕上保持已保存的状态。
  if (props.signedIn) void sharing.loadMine().catch(() => undefined);
  void sharing.refresh();
}

async function run(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  notice.value = "";
  errorMessage.value = "";
  try {
    await work();
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : "操作失败，请稍后重试";
  } finally {
    busy.value = false;
  }
}

function publish() {
  void run(async () => {
    const published = await sharing.publish(await props.buildBody());
    notice.value = published.created !== false
      ? "分享码已生成，发给朋友就能看到你的课表。"
      : published.changed
        ? "分享内容已更新，对方下次打开就能看到。"
        : "分享内容已经是最新的。";
  });
}

async function revoke(share: ScheduleShareMeta) {
  const confirmed = await ElMessageBox.confirm(
    "撤销后这个码立刻失效，服务器上的课表副本也会删除。已经保存到对方设备上的课表不会消失，只是不再更新。",
    "撤销这个分享码？",
    { confirmButtonText: "撤销并删除", cancelButtonText: "取消", type: "warning" },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  void run(async () => {
    await sharing.revoke(share.code);
    notice.value = `分享码 ${share.code} 已撤销。`;
  });
}

async function sendToFriend(code: string) {
  const text = shareInvitationText(code, window.location.origin);
  // 手机上走系统分享面板；其余情况复制文字。
  if (typeof navigator.share === "function" && window.matchMedia?.("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
    }
  }
  await copyText(text);
  ElMessage.success("分享码和链接已复制，粘贴发给朋友即可");
}

function summaryOf(item: SavedSharedSchedule) {
  const owner = shareOwnerName(item.meta);
  return [
    // 备注是标题；昵称只有和它不一样时才值得再写一行。
    owner && owner !== sharedScheduleName(item) ? `来自 ${owner}` : "",
    `${sharedCourseCount(item.schedule)} 门课`,
    shareUpdatedText(item.meta.updatedAt),
  ].filter(Boolean).join(" · ");
}

function open(item: SavedSharedSchedule) {
  emit("update:modelValue", false);
  emit("open", item.meta.code);
}

async function rename(item: SavedSharedSchedule) {
  const result = await ElMessageBox.prompt("备注只保存在这台设备上，对方看不到。", "修改备注", {
    inputValue: item.remark,
    inputPlaceholder: shareOwnerName(item.meta) || "备注",
    inputValidator: (value) => (String(value ?? "").trim().length <= 20 ? true : "备注最多 20 个字"),
    confirmButtonText: "保存",
    cancelButtonText: "取消",
  }).catch(() => null);
  if (!result) return;
  if (!sharing.rename(item.meta.code, String(result.value ?? ""))) ElMessage.warning("本地空间不足，备注没有保存");
}

async function remove(item: SavedSharedSchedule) {
  const confirmed = await ElMessageBox.confirm(
    "只从这台设备上移除，对方的分享不受影响。",
    `移除「${sharedScheduleName(item)}」？`,
    { confirmButtonText: "移除", cancelButtonText: "取消", type: "warning" },
  ).then(() => true).catch(() => false);
  if (confirmed) sharing.remove(item.meta.code);
}

// MARK: 导入

const importCode = ref("");
const importRemark = ref("");
const importError = ref("");
const previewLoading = ref(false);
const previewed = ref<SavedSharedSchedule | null>(null);

const canConfirmImport = computed(() => Boolean(
  previewed.value && (importRemark.value.trim() || shareOwnerName(previewed.value.meta)),
));

function startImport() {
  importCode.value = "";
  importRemark.value = "";
  importError.value = "";
  previewed.value = null;
  view.value = "import";
}

function onImportCodeInput() {
  previewed.value = null;
  importError.value = "";
}

async function loadPreview() {
  if (previewLoading.value || !importCode.value.trim()) return;
  previewLoading.value = true;
  importError.value = "";
  const input = importCode.value;
  try {
    const schedule = await sharing.preview(input, props.signedIn);
    if (input !== importCode.value) return;
    importRemark.value = sharing.saved(schedule.meta.code)?.remark ?? "";
    previewed.value = schedule;
  } catch (error) {
    importError.value = error instanceof Error && error.message ? error.message : "读取失败，请检查网络后重试";
  } finally {
    previewLoading.value = false;
  }
}

function confirmImport() {
  if (!previewed.value) return;
  if (!sharing.save(previewed.value, importRemark.value)) {
    importError.value = "本地空间不足，这份课表没有保存下来";
    return;
  }
  ElMessage.success("已导入，在「共享给我的课表」里可以打开");
  view.value = "list";
}

/** 从别处（共享课表页面）带着一个码进来时，直接进到导入。 */
function importFrom(code: string) {
  startImport();
  importCode.value = code;
  void loadPreview();
}

defineExpose({ importFrom });
</script>

<style scoped lang="scss">
:global(.el-overlay-dialog .schedule-sharing-dialog.el-dialog) {
  background: var(--schedule-surface-bg, var(--cpu-card));
  color: var(--schedule-text, var(--cpu-text));
}
:global(.schedule-sharing-dialog.el-dialog .el-dialog__title) {
  color: var(--schedule-text, var(--cpu-text));
}
:global(.schedule-sharing-dialog .el-dialog__headerbtn) {
  top: 6px;
  right: 6px;
  width: 44px;
  height: 44px;
}
:global(.el-overlay-dialog .schedule-sharing-dialog .el-dialog__body) {
  // The dialog body is the only scroll container, so the footer stays visible.
  overflow-x: hidden;
  overflow-y: auto;
  padding: 2px 4px 4px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--schedule-border, var(--cpu-border)) transparent;
}
:global(.schedule-sharing-dialog .el-dialog__body::-webkit-scrollbar) {
  width: 6px;
}
:global(.schedule-sharing-dialog .el-dialog__body::-webkit-scrollbar-thumb) {
  background: var(--schedule-border, var(--cpu-border));
  border-radius: 3px;
}
:global(.schedule-sharing-dialog .el-dialog__body::-webkit-scrollbar-track) {
  background: transparent;
}
.sharing {
  display: grid;
  gap: 24px;
  min-width: 0;
  color: var(--schedule-text);
}
.sharing-section {
  min-width: 0;
}
.sharing-section h3 {
  margin: 0 0 10px;
  color: var(--schedule-text);
  font-size: var(--cpu-fs-s, 14px);
  font-weight: 600;
}
.sharing-card {
  padding: 12px 14px;
  border: 1px solid var(--schedule-border);
  border-radius: var(--cpu-radius-l, 14px);
  background: var(--schedule-surface-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sharing-card-action {
  padding: 0;
  border: 0;
  background: transparent;
}
.sharing-foot,
.sharing-hint {
  margin: 10px 0 0;
  color: var(--schedule-text-secondary);
  font-size: var(--cpu-fs-s, 13px);
  font-weight: 400;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.sharing-hint {
  margin: 0;
}
.sharing-code {
  color: var(--schedule-text);
  font: 600 30px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 3px;
  user-select: all;
}
.sharing-meta {
  margin: -4px 0 0;
  color: var(--schedule-text-secondary);
  font-size: var(--cpu-fs-xs, 12px);
}
.sharing-actions {
  display: flex;
  flex-direction: column;
}
.sharing-actions button {
  min-height: 44px;
  padding: 0;
  border: 0;
  border-top: 1px solid var(--schedule-border);
  background: transparent;
  color: var(--schedule-accent-strong);
  font: inherit;
  font-size: var(--cpu-fs-m, 15px);
  text-align: left;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.sharing-actions button.danger,
.sharing-link.danger {
  color: #dc2626;
}
.sharing-actions button:disabled,
.sharing-primary:disabled,
.sharing-link:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.sharing-primary {
  min-height: 44px;
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: var(--cpu-radius-m, 10px);
  background: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
  font: inherit;
  font-size: var(--cpu-fs-m, 15px);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}
.sharing-primary.plain {
  border-color: var(--schedule-accent-border);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}
.sharing-primary,
.sharing-actions button,
.sharing-link,
.sharing-row-main {
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.sharing-primary:not(:disabled):active {
  background: color-mix(in srgb, var(--schedule-accent) 82%, black);
}
.sharing-primary.plain:not(:disabled):active {
  background: var(--schedule-accent-pale-hover);
}
.sharing-primary:focus-visible,
.sharing-actions button:focus-visible,
.sharing-link:focus-visible,
.sharing-row-main:focus-visible {
  outline: 2px solid var(--schedule-accent-strong);
  outline-offset: 2px;
}
.sharing-status {
  margin: 0;
  color: var(--schedule-text-secondary);
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: var(--cpu-fs-xs, 12px);
  line-height: 1.5;
}
.sharing-status .el-icon {
  flex: 0 0 auto;
  transform: translateY(3px);
}
.sharing-status.error {
  color: #dc2626;
}
.sharing-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}
.sharing-row + .sharing-row {
  padding-top: 10px;
  border-top: 1px solid var(--schedule-border);
}
.sharing-row-main {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.sharing-avatar {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
  display: grid;
  place-items: center;
}
.sharing-row-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sharing-row-text b {
  overflow: hidden;
  font-size: var(--cpu-fs-m, 15px);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sharing-row-text small {
  overflow: hidden;
  color: var(--schedule-text-secondary);
  font-size: var(--cpu-fs-xs, 12px);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sharing-row-text small.warn {
  color: #c2410c;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.mono-input :deep(input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.sharing-link {
  flex: 0 0 auto;
  padding: 6px 4px;
  border: 0;
  background: transparent;
  color: var(--schedule-accent-strong);
  font: inherit;
  font-size: var(--cpu-fs-s, 13px);
  cursor: pointer;
}
.sharing-line {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: var(--cpu-fs-s, 13px);
}
.sharing-line span {
  color: var(--schedule-text-muted);
}
.sharing-line b {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 500;
  text-align: right;
}
.sharing-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
.sharing-footer .el-button {
  --el-button-bg-color: var(--schedule-surface-bg-soft);
  --el-button-border-color: var(--schedule-border);
  --el-button-text-color: var(--schedule-text);
  --el-button-hover-bg-color: var(--schedule-accent-pale);
  --el-button-hover-border-color: var(--schedule-accent-border);
  --el-button-hover-text-color: var(--schedule-accent-strong);
  --el-button-active-bg-color: var(--schedule-accent-pale-hover);
  --el-button-active-border-color: var(--schedule-accent-border);
  --el-button-active-text-color: var(--schedule-accent-strong);
  min-height: 44px;
  padding: 10px 20px;
  border-radius: var(--cpu-radius-m, 10px);
}
@media (hover: hover) {
  .sharing-primary:not(:disabled):hover {
    background: color-mix(in srgb, var(--schedule-accent) 90%, black);
  }
  .sharing-primary.plain:not(:disabled):hover {
    background: var(--schedule-accent-pale-hover);
  }
  .sharing-actions button:not(:disabled):hover,
  .sharing-link:not(:disabled):hover,
  .sharing-row-main:hover {
    background: var(--schedule-accent-pale);
  }
}
@media (max-width: 480px) {
  .sharing-footer .el-button {
    flex: 1 1 0;
    min-width: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sharing-primary,
  .sharing-actions button,
  .sharing-link,
  .sharing-row-main {
    transition: none;
  }
}
</style>
