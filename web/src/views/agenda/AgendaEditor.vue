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
          @keydown.enter.exact.prevent="submit"
        />
        <p v-if="parsedHint" class="ae-hint">{{ parsedHint }}</p>
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
import { useAgendaStore } from "@/stores/agenda";
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

const isNew = computed(() => !props.draft?.id);
const remindChoices = AGENDA_REMIND_CHOICES;

function blank(): AgendaItem {
  return {
    id: "", kind: "event", title: "", date: "", start: "", end: "", location: "", note: "",
    remind: -1, repeat: "none", until: "", done: false, doneDates: [], createdAt: 0, updatedAt: 0, origin: "user",
  };
}

watch(() => [props.open, props.draft] as const, ([open, draft]) => {
  if (!open) return;
  const base = { ...blank(), ...(draft ?? {}) } as AgendaItem;
  manual.value = base;
  text.value = base.title;
  touched.value = !isNew.value;
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

function submit() {
  if (!text.value.trim()) return;
  const source = touched.value ? { ...manual.value, title: manual.value.title.trim() || text.value } : shown.value;
  const saved = agenda.save({ ...source, id: props.draft?.id || undefined, title: source.title.trim() });
  if (!saved) {
    ElMessage.warning(agenda.error || "先写个标题");
    return;
  }
  emit("saved", saved);
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
