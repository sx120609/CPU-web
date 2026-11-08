<template>
  <!-- 新建或编辑一条日程。新建时第一行读写下的话（「周五 14:00 组会 @药学楼」），
       在改动下面任何一项之前，下面的日期、时间、提醒、重复和地点都跟着它走。 -->
  <el-dialog
    :model-value="open"
    :title="isNew ? '新建日程' : '编辑日程'"
    width="min(520px, calc(100vw - 32px))"
    align-center
    append-to-body
    class="agenda-editor-dialog"
    @update:model-value="(value: boolean) => { if (!value) emit('close'); }"
  >
    <div class="agenda-editor">
      <section class="ae-card">
        <textarea
          ref="titleInput"
          v-model="text"
          class="ae-title"
          rows="2"
          maxlength="120"
          :placeholder="isNew ? '写下要做的事，例如「周五 14:00 组会 @药学楼」' : '标题'"
          @input="onTextInput"
          @paste="onTitlePaste"
          @keydown.enter.exact.prevent="submit"
        />
        <p v-if="parsedHint" class="ae-hint">{{ parsedHint }}</p>
      </section>

      <!-- 截图识别：活动通知截图或一长段通知文字，拾间AI 读出时间、地点和注意事项填进下面。 -->
      <section v-if="isNew && extractAvailable" class="ae-extract" :class="{ busy: Boolean(extracting) }">
        <template v-if="extracting">
          <span class="ae-spinner" aria-hidden="true" />
          <span class="ae-extract-tip">拾间AI 正在读{{ extracting }}，读出来的时间和地点会填在下面</span>
          <button type="button" class="ae-link" @click="cancelExtract">取消</button>
        </template>
        <template v-else-if="extracted.length > 1">
          <div class="ae-extract-head">
            <span>识别出 {{ extracted.length }} 条，逐条看过再添加</span>
            <button type="button" class="ae-link" @click="saveAll">全部添加</button>
          </div>
          <div class="ae-pills ae-extract-pills">
            <button
              v-for="(item, index) in extracted"
              :key="index"
              type="button"
              :class="{ active: index === pick }"
              @click="choose(index)"
            >{{ item.title }}</button>
          </div>
        </template>
        <template v-else>
          <button type="button" class="ae-shot" @click="fileInput?.click()">
            <el-icon><Picture /></el-icon>截图识别
          </button>
          <span class="ae-extract-tip">{{ extractNote || "选一张活动通知的截图，或把截图、整段通知直接粘贴到上面，拾间AI 帮你填好" }}</span>
        </template>
        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
      </section>

      <section class="ae-card">
        <div class="ae-row">
          <span>日期</span>
          <div class="ae-inline">
            <input type="date" :value="shown.date" @change="(event) => edit({ date: (event.target as HTMLInputElement).value })" />
            <button v-if="shown.date" type="button" class="ae-link" @click="edit({ date: '', start: '', end: '', remind: -1, repeat: 'none' })">不设日期</button>
          </div>
        </div>
        <label class="ae-row">
          <span>设定时间</span>
          <el-switch :model-value="Boolean(shown.start)" :disabled="!shown.date" @change="(on: string | number | boolean) => toggleTime(Boolean(on))" />
        </label>
        <div v-if="shown.start" class="ae-row">
          <span>时间</span>
          <div class="ae-inline">
            <input type="time" :value="shown.start" @change="(event) => edit({ start: (event.target as HTMLInputElement).value })" />
            <em>至</em>
            <input type="time" :value="shown.end" @change="(event) => edit({ end: (event.target as HTMLInputElement).value })" />
            <button v-if="shown.end" type="button" class="ae-link" @click="edit({ end: '' })">不设结束</button>
          </div>
        </div>
      </section>

      <section class="ae-card">
        <div class="ae-label">提醒</div>
        <div class="ae-pills">
          <button
            v-for="choice in remindChoices"
            :key="choice.value"
            type="button"
            :class="{ active: shown.remind === choice.value }"
            :disabled="!shown.date && choice.value !== -1"
            @click="edit({ remind: choice.value })"
          >{{ choice.label }}</button>
        </div>
        <template v-if="shown.date">
          <div class="ae-label">重复</div>
          <div class="ae-pills">
            <button
              v-for="choice in AGENDA_REPEAT_CHOICES"
              :key="choice.value"
              type="button"
              :class="{ active: shown.repeat === choice.value }"
              @click="edit({ repeat: choice.value })"
            >{{ choice.label }}</button>
          </div>
        </template>
      </section>

      <section class="ae-card">
        <label class="ae-row">
          <span>地点</span>
          <input :value="shown.location" maxlength="40" placeholder="选填" @input="(event) => edit({ location: (event.target as HTMLInputElement).value })" />
        </label>
        <label class="ae-row ae-note">
          <span>备注</span>
          <textarea :value="shown.note" rows="2" maxlength="1000" placeholder="选填" @input="(event) => edit({ note: (event.target as HTMLTextAreaElement).value })" />
        </label>
      </section>
    </div>
    <template #footer>
      <div class="ae-actions">
        <el-button v-if="!isNew" class="ae-delete" text @click="removeItem">删除</el-button>
        <el-button @click="emit('close')">取消</el-button>
        <el-button type="primary" :disabled="!text.trim()" @click="submit">{{ isNew ? "添加" : "保存" }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Picture } from "@element-plus/icons-vue";
import { useAgendaStore } from "@/stores/agenda";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { shouldHideHarmonyAssistant } from "@/utils/clientInfo";
import type { AgendaExtractResult } from "@/api/agenda";
import {
  AGENDA_NOTICE_PASTE_CHARS,
  agendaExtractError,
  extractAgendaFromImage,
  extractAgendaFromText,
  pastedImage,
  pendingAgendaSource,
} from "./agendaExtract";
import {
  AGENDA_REMIND_CHOICES,
  AGENDA_REPEAT_CHOICES,
  agendaRemindLabel,
  agendaRepeatLabel,
  parseAgendaText,
  type AgendaItem,
} from "@/utils/agenda";

export type AgendaEditorDraft = Partial<AgendaItem> & { title?: string };

const props = defineProps<{
  open: boolean;
  /** 编辑已有的一条时带 id；新建时可以只带日期、时间。 */
  draft: AgendaEditorDraft | null;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "saved", item: AgendaItem): void;
}>();

const agenda = useAgendaStore();
const titleInput = ref<HTMLTextAreaElement | null>(null);
const text = ref("");
const manual = ref<AgendaItem>(blank());
// 改过下面任何一项以后，第一行就只是标题，不再左右下面的选择。
const touched = ref(false);

// 截图识别（见下面「截图识别」）。
const auth = useAuthStore();
const site = useSiteStore();
const fileInput = ref<HTMLInputElement | null>(null);
/** 正在读的是什么（"截图" / "这段通知"）；空表示没在读。 */
const extracting = ref("");
/** 截图里读出的几条；只有一条时编辑器直接填好，不显示列表。 */
const extracted = ref<AgendaItem[]>([]);
const pick = ref(0);
const extractNote = ref("");
let extractToken = 0;
const extractAvailable = computed(() => auth.isLoggedIn
  && site.moduleEnabled("assistant")
  && !shouldHideHarmonyAssistant(auth.isLoggedIn, auth.user?.username));

const isNew = computed(() => !props.draft?.id);
const remindChoices = AGENDA_REMIND_CHOICES;

function blank(): AgendaItem {
  return {
    id: "", kind: "event", title: "", date: "", start: "", end: "", location: "", note: "",
    remind: -1, repeat: "none", until: "", done: false, doneDates: [], createdAt: 0, updatedAt: 0, origin: "user",
  };
}

watch(() => [props.open, props.draft] as const, ([open, draft]) => {
  cancelExtract();
  extracted.value = [];
  pick.value = 0;
  extractNote.value = "";
  if (!open) return;
  const base = { ...blank(), ...(draft ?? {}) } as AgendaItem;
  manual.value = base;
  text.value = base.title;
  touched.value = !isNew.value;
  const source = pendingAgendaSource.value;
  pendingAgendaSource.value = null;
  if (isNew.value && source && extractAvailable.value) {
    if (source.image) startImageExtract(source.image);
    else if (source.text) startTextExtract(source.text);
  }
  void nextTick(() => { if (isNew.value) titleInput.value?.focus(); });
}, { immediate: true });

/** 写下的话读出来的日期、时间等；只说了标题时为 null。 */
const parsed = computed(() => {
  if (touched.value || !text.value.trim()) return null;
  const result = parseAgendaText(text.value);
  const says = Boolean(result.date || result.start || result.remind >= 0 || result.repeat !== "none" || result.location);
  if (!says) return null;
  return { ...result, date: result.date || manual.value.date };
});

const shown = computed<AgendaItem>(() => (parsed.value
  ? { ...manual.value, ...parsed.value, title: parsed.value.title }
  : { ...manual.value, title: text.value }));

const parsedHint = computed(() => {
  const result = parsed.value;
  if (!result) return "";
  const parts = [
    result.date ? `${Number(result.date.slice(5, 7))}月${Number(result.date.slice(8))}日` : "",
    result.start ? (result.end ? `${result.start}–${result.end}` : result.start) : "",
    result.repeat !== "none" ? agendaRepeatLabel(result.repeat) : "",
    result.remind >= 0 ? `提醒：${agendaRemindLabel(result.remind)}` : "",
    result.location ? `@${result.location}` : "",
  ].filter(Boolean);
  return `会记作「${result.title}」${parts.length ? `，${parts.join(" · ")}` : ""}，可在下面修改`;
});

function onTextInput() {
  if (touched.value) manual.value = { ...manual.value, title: text.value };
}

/** 改动下面某一项：先把读出来的内容定下来，再改这一项。 */
function edit(change: Partial<AgendaItem>) {
  if (!touched.value) {
    const base = parsed.value ? { ...manual.value, ...parsed.value } : { ...manual.value, title: text.value };
    text.value = base.title;
    manual.value = base as AgendaItem;
    touched.value = true;
  }
  const next = { ...manual.value, ...change };
  if (!next.date) { next.start = ""; next.end = ""; next.repeat = "none"; next.remind = -1; }
  if (!next.start) next.end = "";
  manual.value = next;
}

function toggleTime(on: boolean) {
  edit(on ? { start: shown.value.start || "09:00" } : { start: "", end: "" });
}

/** 编辑器里现在的样子，和保存时用的一样。 */
function current(): AgendaItem {
  return touched.value ? { ...manual.value, title: manual.value.title.trim() || text.value } : shown.value;
}

function submit() {
  if (!text.value.trim()) return;
  const source = current();
  const saved = agenda.save({ ...source, id: props.draft?.id || undefined, title: source.title.trim() });
  if (!saved) {
    ElMessage.warning(agenda.error || "先写个标题");
    return;
  }
  emit("saved", saved);
  // 截图里读出几条时，添加一条后接着看下一条。
  if (extracted.value.length > 1) {
    const rest = extracted.value.filter((_, index) => index !== pick.value);
    extracted.value = rest;
    pick.value = Math.min(pick.value, rest.length - 1);
    show(rest[pick.value]);
    extractNote.value = rest.length === 1 ? `已添加，还有「${rest[0].title}」` : "";
    ElMessage.success(`已添加，还剩 ${rest.length} 条`);
    return;
  }
  emit("close");
}

// MARK: 截图识别

function show(item: AgendaItem) {
  manual.value = { ...item };
  text.value = item.title;
  touched.value = true;
}

function choose(index: number) {
  if (index === pick.value || !extracted.value[index]) return;
  extracted.value[pick.value] = current();
  pick.value = index;
  show(extracted.value[index]);
}

function cancelExtract() {
  extractToken += 1;
  extracting.value = "";
}

async function runExtract(what: string, task: () => Promise<AgendaExtractResult>) {
  const token = ++extractToken;
  extracting.value = what;
  extractNote.value = "";
  try {
    const result = await task();
    if (token !== extractToken || !props.open) return;
    if (!result.items.length) {
      ElMessage.warning(result.message || "没有在里面找到时间和要做的事");
      return;
    }
    const items = result.items.map((item) => ({ ...blank(), ...item, origin: "assistant" as const }));
    extracted.value = items;
    pick.value = 0;
    show(items[0]);
    if (items.length === 1) extractNote.value = `已按${what}填好，看一下再添加`;
  } catch (error) {
    if (token === extractToken) ElMessage.warning(agendaExtractError(error));
  } finally {
    if (token === extractToken) extracting.value = "";
  }
}

function startImageExtract(file: File) {
  if (!file.type.startsWith("image/")) {
    ElMessage.warning("请选择图片");
    return;
  }
  void runExtract("截图", () => extractAgendaFromImage(file));
}

function startTextExtract(value: string) {
  void runExtract("这段通知", () => extractAgendaFromText(value));
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) startImageExtract(file);
}

/** 粘贴截图，或粘贴一整段通知（比标题长得多），交给拾间AI；一般的短句照常粘贴。 */
function onTitlePaste(event: ClipboardEvent) {
  if (!isNew.value || !extractAvailable.value || extracting.value) return;
  const image = pastedImage(event);
  if (image) {
    event.preventDefault();
    startImageExtract(image);
    return;
  }
  const pasted = event.clipboardData?.getData("text/plain")?.trim() ?? "";
  if (pasted.length > AGENDA_NOTICE_PASTE_CHARS) {
    event.preventDefault();
    startTextExtract(pasted);
  }
}

function saveAll() {
  extracted.value[pick.value] = current();
  let count = 0;
  for (const item of extracted.value) {
    if (!item.title.trim()) continue;
    const saved = agenda.save({ ...item, id: undefined, title: item.title.trim() });
    if (saved) {
      count += 1;
      emit("saved", saved);
    }
  }
  if (!count) {
    ElMessage.warning(agenda.error || "没能添加");
    return;
  }
  ElMessage.success(`已添加 ${count} 条`);
  emit("close");
}

async function removeItem() {
  const id = props.draft?.id;
  if (!id) return;
  const item = agenda.find(id);
  if (!item) return;
  const confirmed = await ElMessageBox.confirm(
    item.repeat !== "none" ? "这是重复的日程，所有日子的都会删除。" : "删除后其他设备上也会删除。",
    `删除「${item.title}」？`,
    { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  const removed = agenda.remove(id);
  emit("close");
  if (removed) {
    ElMessage({
      type: "success",
      message: "已删除",
      duration: 4000,
      showClose: true,
    });
  }
}
</script>

<style scoped lang="scss">
.agenda-editor {
  display: grid;
  gap: 12px;
}
.ae-card {
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface-soft);
  padding: 4px 14px;
}
.ae-title {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-l);
  font-weight: 560;
  line-height: 1.5;
  padding: 10px 0;
}
.ae-hint {
  margin: 0;
  padding: 8px 0 10px;
  border-top: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.5;
}
.ae-row {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.ae-row:last-child {
  border-bottom: 0;
}
.ae-row > span,
.ae-label {
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  font-weight: 560;
  white-space: nowrap;
}
.ae-label {
  padding: 12px 0 8px;
}
.ae-inline {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
.ae-inline em {
  font-style: normal;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
}
.ae-row input,
.ae-row textarea {
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-m);
  text-align: right;
}
.ae-row > input {
  flex: 1;
}
.ae-note {
  align-items: flex-start;
  padding: 12px 0;
}
.ae-note textarea {
  flex: 1;
  resize: vertical;
  text-align: left;
  line-height: 1.5;
}
.ae-link {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--cpu-primary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.ae-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 12px;
}
.ae-pills button {
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.ae-pills button.active {
  border-color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary-dark);
  font-weight: 560;
}
.ae-pills button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.ae-extract {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
  border-radius: var(--cpu-radius-m);
  border: 1px dashed var(--cpu-border);
  padding: 10px 14px;
}
.ae-extract.busy {
  border-style: solid;
  border-color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
}
.ae-shot {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--cpu-primary);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-primary-dark);
  font: inherit;
  font-size: var(--cpu-fs-s);
  font-weight: 560;
  cursor: pointer;
  white-space: nowrap;
}
.ae-extract-tip {
  flex: 1;
  min-width: 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.5;
}
.ae-extract-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-s);
  font-weight: 560;
}
.ae-extract-pills {
  width: 100%;
  padding-bottom: 0;
}
.ae-extract-pills button {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ae-spinner {
  width: 14px;
  height: 14px;
  flex: none;
  border: 2px solid var(--cpu-primary-soft);
  border-top-color: var(--cpu-primary);
  border-radius: 50%;
  animation: ae-spin 0.8s linear infinite;
}
@keyframes ae-spin {
  to { transform: rotate(360deg); }
}
.ae-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.ae-delete {
  margin-right: auto;
  color: var(--cpu-danger);
}
</style>
