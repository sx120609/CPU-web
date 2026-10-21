<template>
  <el-dialog
    v-model="open"
    title="宿舍课表"
    width="min(560px, calc(100vw - 24px))"
    align-center
    append-to-body
    class="schedule-themed-dialog dorm-dialog"
    :style="pageStyle"
    @open="onOpen"
  >
    <div v-if="loading" class="dorm-loading"><el-skeleton :rows="5" animated /></div>

    <!-- 还没有宿舍：创建，或者用舍友的宿舍码加入 -->
    <template v-else-if="!isActive">
      <p class="note lead">
        建一个宿舍，把宿舍码发到群里，室友输进来就能互相看课表。人数越多，找出「全宿舍都有空」的时间越准。
      </p>

      <section class="block">
        <h3>我建宿舍</h3>
        <p class="note">生成宿舍码后，把码发给室友就行。你成为创建者，可以管理成员。</p>
        <el-button
          data-cpu-button-theme="schedule"
          type="primary"
          class="wide-button"
          :loading="busy"
          @click="act(() => dormApi.invite(), '宿舍已创建，把宿舍码发给室友吧')"
        >创建宿舍并生成宿舍码</el-button>
      </section>

      <section class="block">
        <h3>用宿舍码加入</h3>
        <form class="join" @submit.prevent="join">
          <input
            v-model="joinCode"
            class="code-input"
            maxlength="8"
            placeholder="6 位宿舍码"
            autocomplete="off"
            aria-label="宿舍码"
          />
          <el-button data-cpu-button-theme="schedule" type="primary" native-type="submit" :loading="busy" :disabled="!joinCode.trim()">加入</el-button>
        </form>
      </section>
    </template>

    <!-- 已经在宿舍里 -->
    <template v-else-if="current">
      <header class="dorm-head">
        <div class="dorm-title">
          <b>{{ current.name || "我的宿舍" }}</b>
          <span>{{ current.members.length }} / {{ current.memberLimit }} 人</span>
        </div>
        <div class="dorm-people">
          <div v-for="member in current.members" :key="member.id" class="person" :title="member.nickname">
            <UserAvatar :size="34" :src="member.avatar" :name="member.nickname" :seed="member.id" />
            <span class="person-name" :style="nameStyle(member.color)">{{ member.id === current.me.id ? "我" : member.nickname }}</span>
            <i v-if="member.isOwner" class="owner-tag">舍长</i>
            <i v-if="!member.snapshot" class="stale-tag" title="还没有同步课表">?</i>
          </div>
        </div>
      </header>

      <el-tabs v-model="activeTab" class="dorm-tabs">
        <el-tab-pane label="空闲" name="free">
          <div v-if="!readers.length" class="empty-tip">还没有人上传课表，打开课表页几秒后会自动同步。</div>
          <template v-else>
            <div class="free-bar">
              <button type="button" class="date-nav" aria-label="前一天" @click="shiftFreeDate(-1)">‹</button>
              <b>{{ dormDateLabel(freeDate, todayYmd) }}</b>
              <button type="button" class="date-nav" aria-label="后一天" @click="shiftFreeDate(1)">›</button>
              <button v-if="freeDate !== todayYmd" type="button" class="date-today" @click="freeDate = todayYmd">回到今天</button>
            </div>

            <div class="free-filter">
              <span>需要几个人有空</span>
              <el-select v-model="minFree" size="small" class="min-free-select" :teleported="true">
                <el-option v-for="option in minFreeOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </div>

            <div class="track" role="img" :aria-label="trackLabel">
              <i
                v-for="(window, index) in day.windows"
                :key="index"
                class="track-free"
                :style="trackStyle(window)"
              />
              <span class="track-start">{{ formatMinute(day.window.start) }}</span>
              <span class="track-end">{{ formatMinute(day.window.end) }}</span>
            </div>

            <ul v-if="day.windows.length" class="free-list">
              <li v-for="(window, index) in day.windows" :key="index">
                <b>{{ formatWindow(window) }}</b>
                <span>{{ window.freeIds.length === day.knownIds.length ? "全宿舍都有空" : `${window.freeIds.length} 人有空` }}</span>
                <em v-if="window.freeIds.length < day.knownIds.length">{{ namesOf(window.freeIds) }}</em>
              </li>
            </ul>
            <p v-else class="note">
              {{ emptyFreeText }}
            </p>

            <p v-if="day.unknownIds.length" class="note warn">
              {{ namesOf(day.unknownIds) }} 还没有可用课表（没同步或不在学期内），上面的结果只算了其余 {{ day.knownIds.length }} 人。
            </p>

            <section class="day-courses">
              <h3>{{ dormDateLabel(freeDate, todayYmd) }} 各自在忙什么</h3>
              <div v-for="reader in readers" :key="reader.id" class="day-course-row">
                <span class="who" :style="nameStyle(reader.color)">{{ reader.id === current.me.id ? "我" : reader.nickname }}</span>
                <div class="chips">
                  <template v-if="busyChips(reader).length">
                    <span v-for="chip in busyChips(reader)" :key="chip.key" class="chip" :style="chipStyle(reader.color)">{{ chip.text }}</span>
                  </template>
                  <span v-else class="chip-free">{{ busyKnown(reader) ? "这天没课" : "没有数据" }}</span>
                </div>
              </div>
            </section>
          </template>
        </el-tab-pane>

        <el-tab-pane label="早八" name="morning">
          <div v-if="!readers.length" class="empty-tip">还没有人上传课表，打开课表页几秒后会自动同步。</div>
          <template v-else>
            <p class="next-morning">
              <template v-if="nextMorning">
                {{ nextMorning.isToday ? "今天还有早八" : `${DORM_WEEKDAY_NAMES[nextMorning.weekday - 1]}早八` }}：
                <b v-for="duty in nextMorning.duties" :key="duty.id" :style="nameStyle(duty.color)">{{ duty.nickname }}</b>
              </template>
              <template v-else>未来 {{ morningDays.length }} 天都没有早八，晚上可以放心熬。</template>
            </p>

            <ul class="morning-list">
              <li v-for="item in morningDays" :key="item.ymd" :class="{ busy: item.duties.length }">
                <div class="morning-date">
                  <b>{{ dormDayName(item.ymd, todayYmd) }}</b>
                  <span>{{ item.ymd.slice(5) }}</span>
                </div>
                <div class="morning-bodies">
                  <template v-if="item.duties.length">
                    <span v-for="duty in item.duties" :key="duty.id" class="chip" :style="chipStyle(duty.color)">
                      <i class="who-dot" :style="{ background: toneOf(duty.color).border }" />{{ duty.nickname }} · {{ duty.course }}
                    </span>
                  </template>
                  <span v-else class="morning-none">没人早八</span>
                </div>
                <i v-if="item.unknownCount" class="stale-tag" :title="`${item.unknownCount} 人课表未同步`">?</i>
              </li>
            </ul>
            <p class="note">早八按「占用第 1 节」判断；课表没同步的室友不会出现在名单里。</p>
          </template>
        </el-tab-pane>

        <el-tab-pane label="管理" name="manage">
          <div class="line">
            <span>宿舍名</span>
            <template v-if="current.isOwner">
              <input
                v-model="dormNameDraft"
                class="name-input"
                maxlength="24"
                placeholder="例如 江宁 3-402"
                aria-label="宿舍名"
                @blur="saveName"
                @keyup.enter="saveName"
              />
            </template>
            <strong v-else>{{ current.name || "未命名" }}</strong>
          </div>

          <div class="line">
            <span>我的颜色</span>
            <div class="colors" role="radiogroup" aria-label="我的颜色">
              <button
                v-for="color in DORM_COLORS"
                :key="color"
                type="button"
                class="swatch"
                :class="{ mine: color === current.me.color, taken: colorOwnerId(color) !== null }"
                :style="swatchStyle(color)"
                role="radio"
                :aria-checked="color === current.me.color"
                :aria-label="DORM_COLOR_NAMES[color] + (colorOwnerId(color) ? `，${nickOf(colorOwnerId(color)!)} 正在用，选它就和 TA 互换` : '')"
                :disabled="busy"
                @click="pickColor(color)"
              >{{ color === current.me.color ? "我" : "" }}</button>
            </div>
          </div>

          <div class="line">
            <span>我的课表</span>
            <strong>{{ current.me.snapshot ? `同步于 ${relative(current.me.snapshot.syncedAt)}` : "打开课表页后自动同步" }}</strong>
          </div>

          <div v-if="current.isOwner" class="line invite-line">
            <span>宿舍码</span>
            <template v-if="invite">
              <b class="invite-code">{{ invite.code }}</b>
              <div class="invite-actions">
                <el-button data-cpu-button-theme="schedule" size="small" @click="copyInvite">复制邀请</el-button>
                <el-button data-cpu-button-theme="schedule" size="small" :loading="busy" @click="act(() => dormApi.invite(), '宿舍码已更新')">换一个</el-button>
              </div>
            </template>
            <el-button v-else data-cpu-button-theme="schedule" size="small" :loading="busy" @click="act(() => dormApi.invite())">生成宿舍码</el-button>
          </div>
          <p v-if="current.isOwner && invite" class="note">宿舍码 24 小时内有效，可以被多个室友重复使用。宿舍满了之后自动作废。</p>

          <section v-if="current.isOwner" class="block">
            <h3>成员</h3>
            <ul class="member-list">
              <li v-for="member in current.members" :key="member.id">
                <UserAvatar :size="28" :src="member.avatar" :name="member.nickname" :seed="member.id" />
                <b :style="nameStyle(member.color)">{{ member.nickname }}</b>
                <i v-if="member.isOwner" class="owner-tag">舍长</i>
                <el-button
                  v-if="member.id !== current.me.id"
                  data-cpu-button-theme="schedule"
                  size="small"
                  text
                  type="danger"
                  :loading="busy"
                  @click="removeMember(member.id, member.nickname)"
                >移出</el-button>
              </li>
            </ul>
          </section>

          <p class="note">你的课表只对你的室友可见；退出宿舍后快照立即删除。舍长退出时会把身份交给最早加入的室友。</p>
        </el-tab-pane>
      </el-tabs>
    </template>

    <template #footer>
      <template v-if="isActive">
        <el-button data-cpu-button-theme="schedule" text type="danger" :loading="busy" @click="leave">退出宿舍</el-button>
        <el-button data-cpu-button-theme="schedule" @click="open = false">完成</el-button>
      </template>
      <el-button v-else data-cpu-button-theme="schedule" @click="open = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { dormApi, type DormSchedules, type DormStatus } from "@/api/dorm";
import { copyText } from "@/utils/userGroup";
import { useAppearanceStore } from "@/stores/appearance";
import {
  DORM_COLORS,
  DORM_COLOR_NAMES,
  DORM_WEEKDAY_NAMES,
  createDormReaders,
  dormBusySpansForDate,
  dormDateLabel,
  dormDateRange,
  dormDayAvailability,
  dormDayName,
  dormMorningDays,
  dormNextMorning,
  dormPersonTone,
  dormTodayYmd,
  formatMinute,
  formatWindow,
  type DormColor,
  type DormDayReader,
  type DormMinuteSpan,
} from "./dorm";

const props = defineProps<{
  modelValue: boolean;
  pageStyle?: Record<string, string>;
  initialCode?: string;
  /** 打开弹窗时补一次课表上传，刚加入宿舍的人不用等下一次刷新。 */
  syncNow?: () => void | Promise<void>;
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const appearance = useAppearanceStore();

const status = ref<DormStatus | null>(null);
const schedules = ref<DormSchedules | null>(null);
const loading = ref(false);
const busy = ref(false);
const joinCode = ref("");
const dormNameDraft = ref("");
const activeTab = ref<"free" | "morning" | "manage">("free");
const minFree = ref(0);
const todayYmd = ref(dormTodayYmd());
const freeDate = ref(dormTodayYmd());

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const current = computed(() => (status.value?.status === "active" ? status.value : null));
const isActive = computed(() => Boolean(current.value));
const invite = computed(() => {
  const value = current.value?.invite;
  return value?.code && !value.expired ? value as { code: string } : null;
});

/** 弹窗里的计算全部基于这份快照；两边对不上时以快照为准。 */
const readers = computed<DormDayReader[]>(() => {
  const members = schedules.value?.members ?? [];
  return createDormReaders(members.map((member) => ({
    id: member.id,
    nickname: member.nickname,
    color: member.color,
    snapshot: member.snapshot,
  })));
});

function memberCount() {
  return current.value?.members.length ?? 0;
}

/** 默认要求所有人都空；也可以放宽成“至少 N 人有空”，方便凑不齐人的时候用。 */
const minFreeOptions = computed(() => {
  const total = Math.max(1, memberCount());
  const relaxed = [...new Set([total - 1, Math.max(2, Math.ceil(total / 2))])]
    .filter((value) => value >= 2 && value < total)
    .sort((a, b) => b - a);
  // 0 表示“所有有课表数据的人都空闲”，某天有人不在学期内时也不会永远凑不齐。
  return [{ value: 0, label: `全员（${total} 人）` }, ...relaxed.map((value) => ({ value, label: `至少 ${value} 人` }))];
});

const day = computed(() => dormDayAvailability(readers.value, freeDate.value, {
  minFree: minFree.value || undefined,
}));

const morningDays = computed(() => dormMorningDays(readers.value, dormDateRange(todayYmd.value, 7)));
const nextMorning = computed(() => dormNextMorning(morningDays.value));

const emptyFreeText = computed(() => {
  if (!day.value.knownIds.length) return "这天大家都没有可用课表。";
  const requirement = minFree.value > 1 && minFree.value < day.value.knownIds.length
    ? `${minFree.value} 人同时有空`
    : "全宿舍同时有空";
  return `这天没有 ${requirement} 的时段。可以在课表里手动加课后再看，或者把条件放宽一点。`;
});

const trackLabel = computed(() => {
  if (!day.value.windows.length) return "这天没有符合条件的空闲时段";
  return day.value.windows.map((window) => formatWindow(window)).join("、");
});

function toneOf(color: DormColor) {
  return dormPersonTone(color, appearance.isDark);
}

function nameStyle(color: DormColor) {
  return { color: toneOf(color).border };
}

function chipStyle(color: DormColor) {
  const tone = toneOf(color);
  return { background: tone.bg, borderColor: tone.border, color: tone.text };
}

function swatchStyle(color: DormColor) {
  const tone = toneOf(color);
  return { background: tone.bg, color: tone.text, borderColor: tone.border };
}

function trackStyle(window: DormMinuteSpan) {
  const span = Math.max(1, day.value.window.end - day.value.window.start);
  return {
    left: `${((window.start - day.value.window.start) / span) * 100}%`,
    width: `${((window.end - window.start) / span) * 100}%`,
  };
}

function namesOf(ids: number[]) {
  const names = ids.map((id) => {
    const member = current.value?.members.find((item) => item.id === id);
    if (!member) return "";
    return member.id === current.value?.me.id ? "我" : member.nickname;
  }).filter(Boolean);
  return names.join("、");
}

function nickOf(id: number) {
  const member = current.value?.members.find((item) => item.id === id);
  return member ? (member.id === current.value?.me.id ? "我" : member.nickname) : "";
}

function colorOwnerId(color: DormColor) {
  const member = current.value?.members.find((item) => item.color === color);
  return member?.id ?? null;
}

function busyKnown(reader: DormDayReader) {
  return dormBusySpansForDate(reader, freeDate.value) !== null;
}

function busyChips(reader: DormDayReader) {
  const spans = dormBusySpansForDate(reader, freeDate.value);
  if (!spans) return [];
  const courses = reader.coursesForDate(freeDate.value) ?? [];
  return courses.map((course, index) => ({
    key: `${reader.id}-${index}`,
    text: `${course.start}–${course.end} ${course.course.name}`,
  }));
}

function relative(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function shiftFreeDate(days: number) {
  const next = new Date(`${freeDate.value}T00:00:00Z`);
  if (!Number.isFinite(next.getTime())) return;
  next.setUTCDate(next.getUTCDate() + days);
  freeDate.value = next.toISOString().slice(0, 10);
}

async function loadSchedules() {
  try {
    const next = await dormApi.schedules();
    schedules.value = next;
    // 有人课表刚变化时，成员的同步时间也要跟着刷新。
    const firstUnknown = readerCountMismatch();
    if (firstUnknown) scheduleRefreshAgain();
  } catch {
    schedules.value = schedules.value ?? null;
  }
}

let refreshAgainTimer = 0;
function readerCountMismatch() {
  const expected = memberCount();
  const actual = schedules.value?.members.length ?? 0;
  return expected > 0 && actual !== expected;
}
/** 成员刚加入时快照还没传上来，隔几秒再拉一次，避免一直显示“没有数据”。 */
function scheduleRefreshAgain() {
  if (refreshAgainTimer) window.clearTimeout(refreshAgainTimer);
  refreshAgainTimer = window.setTimeout(() => { void loadSchedules(); }, 5000);
}

function applyStatus(next: DormStatus) {
  status.value = next;
  if (next.status === "active") {
    dormNameDraft.value = next.name ?? "";
    const total = next.members.length;
    if (minFree.value > total) minFree.value = 0;
  } else {
    schedules.value = null;
    minFree.value = 0;
  }
}

async function act(task: () => Promise<DormStatus>, success?: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    applyStatus(await task());
    await loadSchedules();
    if (success) ElMessage.success(success);
    void props.syncNow?.();
  } catch {
    // 请求层已经提示了具体错误。
  } finally {
    busy.value = false;
  }
}

async function join() {
  const code = joinCode.value.trim();
  if (!code) return;
  await act(() => dormApi.join(code), "已加入宿舍");
  if (isActive.value) joinCode.value = "";
}

function pickColor(color: DormColor) {
  if (color === current.value?.me.color) return;
  const owner = colorOwnerId(color);
  void act(() => dormApi.setMyColor(color), owner ? `已和 ${nickOf(owner)} 互换颜色` : "颜色已保存");
}

async function saveName() {
  const value = dormNameDraft.value.trim();
  const saved = current.value?.name ?? "";
  if (!current.value?.isOwner || value === saved) return;
  await act(() => dormApi.setName(value || null), "宿舍名已保存");
}

async function copyInvite() {
  if (!invite.value) return;
  const link = `${window.location.origin}/schedule?dorm=1&code=${invite.value.code}`;
  await copyText(`加一下我们的宿舍课表！宿舍码 ${invite.value.code}（24 小时内有效），打开 ${link} 输入就能加入。`);
  ElMessage.success("邀请已复制，发到宿舍群吧");
}

async function removeMember(userId: number, nickname: string) {
  try {
    await ElMessageBox.confirm(`把 ${nickname} 移出宿舍吗？TA 的课表快照会立即删除。`, "移出成员", {
      confirmButtonText: "移出",
      cancelButtonText: "取消",
      type: "warning",
      appendTo: document.body,
    });
  } catch {
    return;
  }
  await act(() => dormApi.removeMember(userId), "已移出");
}

async function leave() {
  try {
    await ElMessageBox.confirm("退出后你的课表快照会立即删除，宿舍里的其他人看不到你的课了。确定退出吗？", "退出宿舍", {
      confirmButtonText: "退出",
      cancelButtonText: "再想想",
      type: "warning",
      appendTo: document.body,
    });
  } catch {
    return;
  }
  if (busy.value) return;
  busy.value = true;
  try {
    applyStatus(await dormApi.leave());
    ElMessage.success("已退出宿舍");
  } catch {
    // 请求层已经提示了具体错误。
  } finally {
    busy.value = false;
  }
}

async function onOpen() {
  todayYmd.value = dormTodayYmd();
  freeDate.value = todayYmd.value;
  if (props.initialCode && !joinCode.value) joinCode.value = props.initialCode;
  loading.value = !status.value;
  try {
    applyStatus(await dormApi.status());
    await loadSchedules();
  } catch {
    // 请求层已经提示了具体错误。
  } finally {
    loading.value = false;
  }
}

watch(() => props.modelValue, (value) => {
  if (!value && refreshAgainTimer) {
    window.clearTimeout(refreshAgainTimer);
    refreshAgainTimer = 0;
  }
});
</script>

<style scoped>
.dorm-loading { padding: 8px 0; }
.note { margin: 10px 0 0; color: var(--schedule-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.note.lead { margin: 0 0 6px; font-size: var(--cpu-fs-s); }
.note.warn { color: var(--cpu-warning, #b26a00); }
.block { padding: 12px 0; border-bottom: 1px solid var(--schedule-border); }
.block:last-child { border-bottom: 0; padding-bottom: 0; }
.block h3 { margin: 0 0 6px; color: var(--schedule-text); font-size: var(--cpu-fs-m); }
.wide-button { width: 100%; margin-top: 10px; }
.empty-tip { padding: 20px 0; color: var(--schedule-text-muted); font-size: var(--cpu-fs-s); text-align: center; }

.join { display: flex; gap: 8px; margin-top: 10px; }
.code-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--schedule-border);
  border-radius: var(--cpu-radius-m);
  background: var(--schedule-surface-bg-soft, transparent);
  color: var(--schedule-text);
  font: 600 16px ui-monospace, SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace;
  letter-spacing: 3px;
  text-transform: uppercase;
  outline: none;
}
.code-input::placeholder { color: var(--schedule-text-muted); font: 400 13px var(--cpu-font-sans, inherit); letter-spacing: normal; text-transform: none; }
.code-input:focus { border-color: var(--schedule-accent, var(--cpu-primary)); }

.dorm-head { margin: 0 0 8px; }
.dorm-title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dorm-title b { min-width: 0; overflow: hidden; color: var(--schedule-text); font-size: var(--cpu-fs-m); text-overflow: ellipsis; white-space: nowrap; }
.dorm-title span { flex: 0 0 auto; color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); }
.dorm-people { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
.person { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.person-name { max-width: 56px; overflow: hidden; font-size: 10px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.owner-tag, .stale-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: 6px;
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
  line-height: 14px;
}
.owner-tag { background: color-mix(in srgb, var(--schedule-accent, var(--cpu-primary)) 16%, transparent); color: var(--schedule-text); }
.stale-tag { width: 14px; padding: 0; background: color-mix(in srgb, var(--schedule-text-muted) 20%, transparent); color: var(--schedule-text-secondary); }

.dorm-tabs { margin-top: 4px; }
.free-bar { display: flex; align-items: center; gap: 8px; }
.free-bar b { flex: 1; min-width: 0; color: var(--schedule-text); font-size: var(--cpu-fs-s); text-align: center; }
.date-nav {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border: 1px solid var(--schedule-border);
  border-radius: 50%;
  background: transparent;
  color: var(--schedule-text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.date-today { flex: 0 0 auto; padding: 2px 8px; border: 1px solid var(--schedule-border); border-radius: 10px; background: transparent; color: var(--schedule-text-secondary); font-size: 10px; cursor: pointer; }
.free-filter { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 12px 0 6px; color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); }
.min-free-select { width: 130px; }

.track { position: relative; height: 26px; margin: 6px 0 4px; border-radius: 8px; background: color-mix(in srgb, var(--schedule-text-muted) 12%, transparent); }
.track-free { position: absolute; top: 0; bottom: 0; border-radius: 6px; background: color-mix(in srgb, var(--cpu-success, #2aa06a) 62%, transparent); }
.track-start, .track-end { position: absolute; bottom: -16px; color: var(--schedule-text-muted); font-size: 9px; }
.track-start { left: 0; }
.track-end { right: 0; }

.free-list { margin: 22px 0 0; padding: 0; list-style: none; }
.free-list li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--schedule-border); font-size: var(--cpu-fs-s); }
.free-list b { color: var(--schedule-text); font-variant-numeric: tabular-nums; }
.free-list span { color: var(--cpu-success, #2aa06a); font-weight: 600; }
.free-list em { color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); font-style: normal; }

.day-courses { margin-top: 16px; }
.day-courses h3 { margin: 0 0 6px; color: var(--schedule-text); font-size: var(--cpu-fs-s); }
.day-course-row { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; }
.who { flex: 0 0 52px; overflow: hidden; font-size: var(--cpu-fs-xs); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border: 1px solid transparent; border-radius: 8px; font-size: 10px; font-weight: 600; line-height: 16px; }
.chip-free { color: var(--schedule-text-muted); font-size: 10px; line-height: 18px; }
.who-dot { width: 6px; height: 6px; border-radius: 50%; }

.next-morning { margin: 4px 0 10px; color: var(--schedule-text); font-size: var(--cpu-fs-s); line-height: 1.7; }
.next-morning b { margin-right: 6px; font-weight: 700; }
.morning-list { margin: 0; padding: 0; list-style: none; }
.morning-list li { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px dashed var(--schedule-border); }
.morning-list li.busy { background: color-mix(in srgb, var(--cpu-warning, #e6a23c) 8%, transparent); border-radius: 6px; }
.morning-date { flex: 0 0 82px; display: flex; flex-direction: column; gap: 1px; }
.morning-date b { color: var(--schedule-text); font-size: var(--cpu-fs-xs); }
.morning-date span { color: var(--schedule-text-muted); font-size: 9px; }
.morning-bodies { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.morning-none { color: var(--schedule-text-muted); font-size: 10px; line-height: 18px; }

.line { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; padding: 6px 0; border-bottom: 1px solid var(--schedule-border); font-size: var(--cpu-fs-s); }
.line > span { flex: 0 0 auto; color: var(--schedule-text-muted); }
.line strong { min-width: 0; color: var(--schedule-text); font-weight: 600; text-align: right; }
.name-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--schedule-border);
  border-radius: var(--cpu-radius-m);
  background: var(--schedule-surface-bg-soft, transparent);
  color: var(--schedule-text);
  font-size: var(--cpu-fs-s);
  text-align: right;
  outline: none;
}
.name-input:focus { border-color: var(--schedule-accent, var(--cpu-primary)); }
.colors { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }
.swatch { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 50%; font: inherit; font-size: 10px; font-weight: 700; cursor: pointer; }
.swatch.mine { outline: 2px solid var(--schedule-text); outline-offset: 1px; }
.swatch.taken { border-style: dashed; }
.swatch:disabled { cursor: default; opacity: 0.6; }
.invite-line { flex-wrap: wrap; }
.invite-code { color: var(--schedule-text); font: 700 20px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace; letter-spacing: 4px; }
.invite-actions { display: flex; gap: 4px; }
.member-list { margin: 0; padding: 0; list-style: none; }
.member-list li { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: var(--cpu-fs-s); }
.member-list b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-list :deep(.el-button) { margin-left: auto; }
@media (max-width: 520px) {
  .free-filter { flex-wrap: wrap; }
  .min-free-select { width: 110px; }
  .morning-date { flex-basis: 70px; }
}
</style>
