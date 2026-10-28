<template>
  <!-- 课表里的「日程与待办」：一句话记下、没日期或过了日期还没做完的待办、接下来一周的安排，
       以及「微信和 QQ 也提醒」。具体某一天的日程直接画在课表上，编辑用课表页的同一个编辑器。 -->
  <el-drawer
    :model-value="open"
    :direction="narrow ? 'btt' : 'rtl'"
    :size="narrow ? '86%' : '420px'"
    title="日程与待办"
    append-to-body
    class="agenda-panel-drawer"
    @update:model-value="(value: boolean) => { if (!value) emit('close'); }"
  >
    <div class="ap">
      <section v-if="!auth.isLoggedIn" class="ap-card ap-signed-out">
        <p>登录后就能记日程，并在课表里看到它们。</p>
        <el-button type="primary" @click="emit('login')">登录</el-button>
      </section>

      <template v-else>
        <form class="ap-quick" @submit.prevent="quickAdd">
          <input
            v-model="quickText"
            maxlength="120"
            placeholder="一句话记下，例如「明天下午3点 实验报告」"
            aria-label="一句话记下日程"
          />
          <button type="submit" :disabled="!quickText.trim()">添加</button>
        </form>
        <p v-if="quickPreview" class="ap-hint">{{ quickPreview }}</p>

        <section class="ap-card">
          <div class="ap-title">待办</div>
          <ul v-if="openTodos.length" class="ap-list">
            <li v-for="item in openTodos" :key="item.id">
              <span class="ap-time" :class="{ late: Boolean(item.date) }">{{ item.date ? shortDay(item.date) : "" }}</span>
              <button type="button" class="ap-check" aria-label="标为完成" @click="agenda.setDone(item.id, item.date || today, true)" />
              <button type="button" class="ap-entry" @click="emit('edit', item)">
                <b>{{ item.title }}</b>
                <span v-if="item.date">已过日期，还没完成</span>
              </button>
            </li>
          </ul>
          <p v-else class="ap-empty">没有待办</p>
          <button type="button" class="ap-add" @click="emit('create', '')"><el-icon><Plus /></el-icon>添加不设日期的待办</button>
        </section>

        <section class="ap-card">
          <div class="ap-title">接下来一周</div>
          <template v-if="upcoming.length">
            <div v-for="day in upcoming" :key="day.date" class="ap-day">
              <div class="ap-day-title">{{ day.title }}</div>
              <ul class="ap-list">
                <li v-for="entry in day.entries" :key="entry.item.id" :class="{ done: entry.done }">
                  <span class="ap-time">{{ timeText(entry.item) }}</span>
                  <button
                    type="button"
                    class="ap-check"
                    :class="{ on: entry.done }"
                    :aria-label="entry.done ? '标为未完成' : '标为完成'"
                    @click="agenda.setDone(entry.item.id, entry.date, !entry.done)"
                  ><el-icon v-if="entry.done"><Check /></el-icon></button>
                  <button type="button" class="ap-entry" @click="emit('edit', entry.item)">
                    <b>{{ entry.item.title }}</b>
                    <span v-if="entryMeta(entry.item)">{{ entryMeta(entry.item) }}</span>
                  </button>
                </li>
              </ul>
            </div>
          </template>
          <p v-else class="ap-empty">接下来一周没有安排</p>
          <button type="button" class="ap-add" @click="emit('create', today)"><el-icon><Plus /></el-icon>添加到今天</button>
        </section>

        <section class="ap-card">
          <label class="ap-switch">
            <span>
              <b>微信和 QQ 也提醒</b>
              <small>设了提醒的日程到点时，服务器发一条站内通知，并转到你绑定的微信和 QQ。iOS 和鸿蒙 App 也会在通知栏提醒。</small>
            </span>
            <el-switch :model-value="agenda.relay" @change="(on: string | number | boolean) => agenda.setRelay(Boolean(on))" />
          </label>
          <router-link class="ap-link" to="/messages?tab=settings">绑定微信、QQ</router-link>
        </section>

        <p class="ap-foot">
          <span v-if="agenda.error" class="warn">{{ agenda.error }}</span>
          <span v-else-if="agenda.syncing">正在同步…</span>
          <span v-else-if="agenda.dirtyCount">有 {{ agenda.dirtyCount }} 处改动还没同步</span>
          <span v-else-if="agenda.syncedAt">已同步。网页、手机 App 和药大拾间 NEXT 用的是同一份。</span>
        </p>
      </template>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { Check, Plus } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useAgendaStore } from "@/stores/agenda";
import {
  agendaAddDays,
  agendaChinaClock,
  agendaOn,
  agendaOpen,
  agendaRepeatLabel,
  agendaWeekday,
  parseAgendaText,
  type AgendaItem,
} from "@/utils/agenda";

defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (event: "close"): void;
  (event: "login"): void;
  (event: "edit", item: AgendaItem): void;
  /** 新建一条，带上日期（空为不设日期）。 */
  (event: "create", date: string): void;
}>();

const auth = useAuthStore();
const agenda = useAgendaStore();
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const now = ref(Date.now());
const narrow = ref(false);
const quickText = ref("");
let clock = 0;
let media: MediaQueryList | null = null;

const today = computed(() => agendaChinaClock(now.value).date);
const openTodos = computed(() => agendaOpen(agenda.items, today.value));
const upcoming = computed(() => Array.from({ length: 7 }, (_, index) => {
  const date = agendaAddDays(today.value, index);
  return { date, title: `${shortDay(date)} · ${WEEKDAYS[agendaWeekday(date) - 1]}`, entries: agendaOn(agenda.items, date) };
}).filter((day) => day.entries.length));

const quickPreview = computed(() => {
  const text = quickText.value.trim();
  if (!text) return "";
  const draft = parseAgendaText(text, now.value);
  const when = [
    draft.date ? shortDay(draft.date) : "不设日期",
    draft.start ? (draft.end ? `${draft.start}–${draft.end}` : draft.start) : "",
    draft.repeat !== "none" ? agendaRepeatLabel(draft.repeat) : "",
    draft.remind >= 0 ? "提醒" : "",
    draft.location ? `@${draft.location}` : "",
  ].filter(Boolean).join(" · ");
  return `会记作「${draft.title}」：${when}`;
});

function shortDay(date: string) {
  if (!date) return "";
  if (date === today.value) return "今天";
  if (date === agendaAddDays(today.value, 1)) return "明天";
  if (date === agendaAddDays(today.value, -1)) return "昨天";
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}

function timeText(item: AgendaItem) {
  if (!item.start) return "全天";
  return item.end ? `${item.start}–${item.end}` : item.start;
}

function entryMeta(item: AgendaItem) {
  return [item.location, item.repeat !== "none" ? agendaRepeatLabel(item.repeat) : ""].filter(Boolean).join(" · ");
}

function quickAdd() {
  const text = quickText.value.trim();
  if (!text) return;
  const draft = parseAgendaText(text, Date.now());
  const saved = agenda.save({ ...draft, title: draft.title });
  if (!saved) {
    ElMessage.warning(agenda.error || "没能记下来，换个说法试试");
    return;
  }
  quickText.value = "";
  ElMessage.success(saved.date ? `已添加到${shortDay(saved.date)}` : "已添加到待办");
}

function onMedia() {
  narrow.value = Boolean(media?.matches);
}

onMounted(() => {
  media = window.matchMedia("(max-width: 640px)");
  onMedia();
  media.addEventListener("change", onMedia);
  clock = window.setInterval(() => { now.value = Date.now(); }, 60_000);
});

onBeforeUnmount(() => {
  media?.removeEventListener("change", onMedia);
  clearInterval(clock);
});
</script>

<style scoped lang="scss">
.ap {
  display: grid;
  gap: 12px;
  padding-bottom: 12px;
}
.ap-card {
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  padding: 4px 14px 6px;
}
.ap-signed-out {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-m);
}
.ap-signed-out p {
  margin: 0;
}
.ap-quick {
  display: flex;
  gap: 8px;
}
.ap-quick input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-m);
}
.ap-quick input:focus {
  outline: 0;
  border-color: var(--cpu-primary);
}
.ap-quick button {
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-primary);
  color: var(--cpu-on-primary);
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 560;
  cursor: pointer;
}
.ap-quick button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ap-hint {
  margin: -6px 2px 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.ap-title,
.ap-day-title {
  padding: 10px 0 4px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  font-weight: 600;
}
.ap-day-title {
  padding-top: 8px;
  font-weight: 560;
  color: var(--cpu-text-muted);
}
.ap-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ap-list li {
  display: grid;
  grid-template-columns: 92px 30px minmax(0, 1fr);
  align-items: center;
  min-height: 46px;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.ap-list li.done {
  opacity: 0.55;
}
.ap-list li.done .ap-entry b {
  text-decoration: line-through;
}
.ap-time {
  font-size: var(--cpu-fs-s);
  font-weight: 600;
  color: var(--cpu-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ap-time.late {
  color: var(--cpu-danger);
}
.ap-check {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1.5px solid var(--cpu-text-muted);
  border-radius: 50%;
  background: transparent;
  color: var(--cpu-on-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  cursor: pointer;
}
.ap-check.on {
  border-color: var(--cpu-primary);
  background: var(--cpu-primary);
}
.ap-entry {
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 8px 0;
  text-align: left;
  font: inherit;
  cursor: pointer;
  display: grid;
  gap: 2px;
}
.ap-entry b {
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  color: var(--cpu-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ap-entry span {
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ap-empty {
  margin: 0;
  padding: 10px 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
}
.ap-add {
  width: 100%;
  min-height: 42px;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 560;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 0;
}
.ap-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
}
.ap-switch > span {
  display: grid;
  gap: 4px;
}
.ap-switch b {
  font-size: var(--cpu-fs-m);
  color: var(--cpu-text);
  font-weight: 560;
}
.ap-switch small {
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
  line-height: 1.5;
}
.ap-link {
  display: inline-block;
  margin: 8px 0 6px;
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-s);
}
.ap-foot {
  margin: 0 2px;
  min-height: 18px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.ap-foot .warn {
  color: var(--cpu-danger);
}
</style>
