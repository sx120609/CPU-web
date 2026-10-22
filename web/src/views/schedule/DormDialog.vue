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
    <p v-if="statusError && status && !loading" class="note warn refresh-failed" role="alert">
      刷新宿舍状态失败，下面是之前的数据。
      <button type="button" class="inline-retry" :disabled="refreshing || locked" @click="refresh()">重试</button>
    </p>

    <div v-if="loading" class="dorm-loading"><el-skeleton :rows="5" animated /></div>

    <div v-else-if="statusError && !status" class="state-box" role="alert">
      <p>宿舍状态没加载出来，可能是网络不稳定。</p>
      <el-button data-cpu-button-theme="schedule" size="small" :loading="refreshing" @click="refresh()">重试</el-button>
    </div>

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
          :loading="busy" :disabled="locked"
          @click="act(() => dormApi.invite(), '宿舍已创建，把宿舍码发给室友吧', { sync: true })"
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
          <el-button data-cpu-button-theme="schedule" type="primary" native-type="submit" :loading="busy" :disabled="locked || !joinCode.trim()">加入</el-button>
        </form>
      </section>
    </template>

    <!-- 已经在宿舍里 -->
    <template v-else-if="current">
      <header class="dorm-head">
        <div class="dorm-title">
          <b>{{ current.name || "我的宿舍" }}</b>
          <span>{{ current.members.length }} / {{ current.memberLimit }} 人</span>
          <button
            type="button"
            class="refresh-button"
            :disabled="refreshing || locked"
            :aria-busy="refreshing"
            @click="refresh({ sync: true })"
          >{{ refreshing ? "刷新中…" : "刷新" }}</button>
        </div>
        <ul class="dorm-people">
          <li v-for="member in current.members" :key="member.id" class="person">
            <UserAvatar :size="34" :src="member.avatar" :name="member.nickname" :seed="member.id" />
            <span class="person-name" :style="nameStyle(member.color)" :title="member.nickname">{{ member.id === current.me.id ? "我" : member.nickname }}</span>
            <span v-if="member.isOwner || !hasSchedule(member.id)" class="person-tags">
              <i v-if="member.isOwner" class="owner-tag">舍长</i>
              <i v-if="!hasSchedule(member.id)" class="stale-tag">未同步</i>
            </span>
          </li>
        </ul>
        <p v-if="refreshedAt" class="note refreshed" aria-live="polite">
          数据更新于 {{ clockText(refreshedAt) }}<template v-if="schedulesError">；刚才刷新失败，显示的是之前的数据</template>
        </p>
      </header>

      <el-tabs v-model="activeTab" class="dorm-tabs">
        <el-tab-pane label="空闲" name="free">
          <div v-if="dataState === 'error'" class="state-box" role="alert">
            <p>室友的课表没加载出来，可能是网络不稳定。</p>
            <el-button data-cpu-button-theme="schedule" size="small" :loading="refreshing" @click="refresh()">重试</el-button>
          </div>
          <div v-else-if="dataState === 'loading'" class="dorm-loading"><el-skeleton :rows="3" animated /></div>
          <div v-else-if="dataState === 'empty'" class="empty-tip">{{ emptyDataText }}</div>
          <template v-else>
            <div class="free-bar">
              <button type="button" class="date-nav" aria-label="前一天" @click="shiftFreeDate(-1)">‹</button>
              <b aria-live="polite">{{ dormDateLabel(freeDate, todayYmd) }}</b>
              <button type="button" class="date-nav" aria-label="后一天" @click="shiftFreeDate(1)">›</button>
              <button v-if="freeDate !== todayYmd" type="button" class="date-today" @click="freeDate = todayYmd">回到今天</button>
            </div>

            <div class="free-filter">
              <span>需要几个人有空</span>
              <el-select v-model="minFree" size="small" class="min-free-select" :teleported="true" aria-label="需要几个人有空">
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
              <span class="track-start" aria-hidden="true">{{ formatMinute(day.window.start) }}</span>
              <span class="track-end" aria-hidden="true">{{ formatMinute(day.window.end) }}</span>
            </div>

            <ul v-if="day.windows.length" class="free-list">
              <li v-for="(window, index) in day.windows" :key="index">
                <b>{{ formatWindow(window) }}</b>
                <span>{{ dormFreeWindowLabel(window, day) }}</span>
                <em v-if="window.freeIds.length < day.knownIds.length">{{ namesOf(window.freeIds) }}</em>
              </li>
            </ul>
            <p v-else class="note empty-free">
              {{ dormFreeEmptyText(day, minFree > 0) }}
            </p>

            <p v-if="day.unknownIds.length" class="note warn">
              {{ namesOf(day.unknownIds) }} 这天没有可用课表（没同步或不在学期内），{{ day.knownIds.length
                ? `上面只算了已同步的 ${day.knownIds.length} 人，不能代表全宿舍。`
                : "这天的空闲时间没法判断。" }}
            </p>

            <section class="day-courses">
              <h3>{{ dormDateLabel(freeDate, todayYmd) }} 每个人的课</h3>
              <div v-for="reader in readers" :key="reader.id" class="day-course-row">
                <span class="who" :style="nameStyle(reader.color)" :title="reader.nickname">{{ reader.id === current.me.id ? "我" : reader.nickname }}</span>
                <div class="chips">
                  <template v-if="busyChips(reader).length">
                    <span v-for="chip in busyChips(reader)" :key="chip.key" class="chip" :style="chipStyle(reader.color)">{{ chip.text }}</span>
                  </template>
                  <span v-else class="chip-free" :class="{ unknown: !busyKnown(reader) }">{{ busyKnown(reader) ? "这天没课" : "没有数据" }}</span>
                </div>
              </div>
            </section>
          </template>
        </el-tab-pane>

        <el-tab-pane label="早八" name="morning">
          <div v-if="dataState === 'error'" class="state-box" role="alert">
            <p>室友的课表没加载出来，可能是网络不稳定。</p>
            <el-button data-cpu-button-theme="schedule" size="small" :loading="refreshing" @click="refresh()">重试</el-button>
          </div>
          <div v-else-if="dataState === 'loading'" class="dorm-loading"><el-skeleton :rows="3" animated /></div>
          <div v-else-if="dataState === 'empty'" class="empty-tip">{{ emptyDataText }}</div>
          <template v-else>
            <p class="next-morning">
              <template v-if="nextMorning">
                {{ nextMorning.isToday ? "今天还有早八" : `${DORM_WEEKDAY_NAMES[nextMorning.weekday - 1]}早八` }}：
                <b v-for="duty in nextMorning.duties" :key="duty.id" :style="nameStyle(duty.color)">{{ nickOf(duty.id) || duty.nickname }}</b>
              </template>
              <template v-else>{{ dormMorningSummaryText(morningDays) }}</template>
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
                      <i class="who-dot" :style="{ background: toneOf(duty.color).border }" aria-hidden="true" />{{ nickOf(duty.id) || duty.nickname }} · {{ duty.course }}
                    </span>
                  </template>
                  <span v-else class="morning-none">{{ dormMorningNoneText(item) }}</span>
                </div>
                <span v-if="item.unknownCount" class="stale-tag stale-count">{{ item.unknownCount }} 人未同步</span>
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
                @focus="nameEditing = true"
                @blur="saveName"
                @keyup.enter="saveName"
              />
            </template>
            <strong v-else>{{ current.name || "未命名" }}</strong>
          </div>

          <div class="line color-line">
            <span id="dorm-color-label">我的颜色</span>
            <div class="colors" role="group" aria-labelledby="dorm-color-label">
              <button
                v-for="color in DORM_COLORS"
                :key="color"
                type="button"
                class="swatch"
                :class="{ mine: color === current.me.color, taken: isTakenByOther(color) }"
                :style="swatchStyle(color)"
                :aria-pressed="color === current.me.color"
                :aria-label="swatchLabel(color)"
                :title="swatchLabel(color)"
                :disabled="locked"
                @click="pickColor(color)"
              >{{ color === current.me.color ? "我" : "" }}</button>
            </div>
          </div>

          <div class="line sync-line">
            <span>我的课表</span>
            <strong aria-live="polite">{{ mySyncText }}</strong>
            <el-button
              data-cpu-button-theme="schedule"
              size="small"
              :loading="syncing"
              :disabled="(locked && !syncing) || !syncNow"
              @click="syncMineNow"
            >立即同步</el-button>
          </div>

          <div v-if="current.isOwner" class="line invite-line">
            <span>宿舍码</span>
            <template v-if="invite">
              <b class="invite-code">{{ invite.code }}</b>
              <div class="invite-actions">
                <el-button data-cpu-button-theme="schedule" size="small" @click="copyInvite">复制邀请</el-button>
                <el-button data-cpu-button-theme="schedule" size="small" :loading="busy" :disabled="locked" @click="act(() => dormApi.invite(), '宿舍码已更新')">换一个</el-button>
              </div>
            </template>
            <el-button v-else data-cpu-button-theme="schedule" size="small" :loading="busy" :disabled="locked" @click="act(() => dormApi.invite())">生成宿舍码</el-button>
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
                  :loading="busy" :disabled="locked"
                  :aria-label="`把 ${member.nickname} 移出宿舍`"
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
        <el-button data-cpu-button-theme="schedule" text type="danger" :loading="busy" :disabled="locked" @click="leave">退出宿舍</el-button>
        <el-button data-cpu-button-theme="schedule" @click="open = false">完成</el-button>
      </template>
      <el-button v-else data-cpu-button-theme="schedule" @click="open = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { dormApi, type DormSchedules, type DormStatus } from "@/api/dorm";
import { copyText } from "@/utils/userGroup";
import { useAppearanceStore } from "@/stores/appearance";
import { useAuthStore } from "@/stores/auth";
import { rememberDormStatus, type DormSyncNowOptions, type DormSyncNowResult } from "./dormSync";
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
  dormFreeEmptyText,
  dormFreeWindowLabel,
  dormMorningDays,
  dormMorningNoneText,
  dormMorningSummaryText,
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
  /** 立即上传自己的课表并等它完成；课表页没有可同步的数据时返回 "unavailable"。 */
  syncNow?: (options?: DormSyncNowOptions) => Promise<DormSyncNowResult>;
  /** 课表页后台上传成功一次就加一，弹窗开着时跟着刷新。 */
  syncVersion?: number;
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const appearance = useAppearanceStore();
const auth = useAuthStore();

const status = ref<DormStatus | null>(null);
const schedules = ref<DormSchedules | null>(null);
const statusError = ref(false);
const schedulesError = ref(false);
const schedulesLoading = ref(false);
const loading = ref(false);
const refreshing = ref(false);
const busy = ref(false);
const syncing = ref(false);
/** 有改动或上传在进行时，其他改动、刷新和手动同步都要等它结束。 */
const locked = computed(() => busy.value || syncing.value);
const nameEditing = ref(false);
const lastSync = ref<DormSyncNowResult | null>(null);
const refreshedAt = ref<number | null>(null);
const joinCode = ref("");
const dormNameDraft = ref("");
const activeTab = ref<"free" | "morning" | "manage">("free");
const minFree = ref(0);
const todayYmd = ref(dormTodayYmd());
const freeDate = ref(dormTodayYmd());

// 每次打开弹窗算一轮；关闭或卸载后，还在路上的请求回来也不再改界面。
let session = 0;
function alive(token: number) {
  return token === session && props.modelValue;
}

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

const dataState = computed<"loading" | "error" | "empty" | "ready">(() => {
  if (!schedules.value) return schedulesError.value ? "error" : "loading";
  return readers.value.some((reader) => reader.snapshot) ? "ready" : "empty";
});

const emptyDataText = computed(() => (
  syncing.value
    ? "正在同步你的课表…"
    : "还没有人同步课表。打开课表页会自动同步，也可以在「管理」里立即同步；室友同步后点上面的「刷新」就能看到。"
));

function memberCount() {
  return current.value?.members.length ?? 0;
}

const day = computed(() => dormDayAvailability(readers.value, freeDate.value, {
  minFree: minFree.value || undefined,
}));

/** 默认要求所有有数据的人都空；也可以放宽成“至少 N 人有空”，方便凑不齐人的时候用。 */
const minFreeOptions = computed(() => {
  const total = Math.max(1, memberCount());
  const relaxed = [...new Set([total - 1, Math.max(2, Math.ceil(total / 2))])]
    .filter((value) => value >= 2 && value < total)
    .sort((a, b) => b - a);
  // 0 表示“所有有课表数据的人都空闲”；有人没数据时如实写出算了几个人。
  const known = day.value.knownIds.length;
  const allLabel = day.value.unknownIds.length ? `已同步的人（${known} 人）` : `全员（${total} 人）`;
  return [{ value: 0, label: allLabel }, ...relaxed.map((value) => ({ value, label: `至少 ${value} 人` }))];
});

const morningDays = computed(() => dormMorningDays(readers.value, dormDateRange(todayYmd.value, 7)));
const nextMorning = computed(() => dormNextMorning(morningDays.value));

const trackLabel = computed(() => {
  const date = dormDateLabel(freeDate.value, todayYmd.value);
  if (!day.value.windows.length) return `${date}没有符合条件的空闲时段`;
  return `${date}空闲时段：${day.value.windows.map((window) => formatWindow(window)).join("、")}`;
});

const mySyncText = computed(() => {
  if (syncing.value) return "正在同步…";
  const snapshot = current.value?.me.snapshot;
  const failed = lastSync.value === "failed" ? "，刚才同步失败" : "";
  if (snapshot) return `同步于 ${relative(snapshot.syncedAt)}${failed}`;
  if (lastSync.value === "failed") return "同步失败，请稍后再试";
  if (lastSync.value === "unavailable") return "课表加载好后会自动同步";
  return "还没有同步";
});

function toneOf(color: DormColor) {
  return dormPersonTone(color, appearance.isDark);
}

function nameStyle(color: DormColor) {
  return { color: toneOf(color).name };
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

function nickOf(id: number) {
  if (id === current.value?.me.id) return "我";
  return current.value?.members.find((item) => item.id === id)?.nickname
    ?? schedules.value?.members.find((item) => item.id === id)?.nickname
    ?? "";
}

function namesOf(ids: number[]) {
  return ids.map(nickOf).filter(Boolean).join("、");
}

function hasSchedule(id: number) {
  const fromSchedules = schedules.value?.members.find((item) => item.id === id);
  if (fromSchedules) return Boolean(fromSchedules.snapshot);
  return Boolean(current.value?.members.find((item) => item.id === id)?.snapshot);
}

function colorOwnerId(color: DormColor) {
  return current.value?.members.find((item) => item.color === color)?.id ?? null;
}

function isTakenByOther(color: DormColor) {
  const owner = colorOwnerId(color);
  return owner !== null && owner !== current.value?.me.id;
}

function swatchLabel(color: DormColor) {
  const name = `${DORM_COLOR_NAMES[color]}色`;
  if (color === current.value?.me.color) return `${name}，当前颜色`;
  const owner = colorOwnerId(color);
  return owner ? `${name}，${nickOf(owner)} 正在用，选它就和 TA 互换` : name;
}

function busyKnown(reader: DormDayReader) {
  return dormBusySpansForDate(reader, freeDate.value) !== null;
}

function busyChips(reader: DormDayReader) {
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

function clockText(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function shiftFreeDate(days: number) {
  const next = new Date(`${freeDate.value}T00:00:00Z`);
  if (!Number.isFinite(next.getTime())) return;
  next.setUTCDate(next.getUTCDate() + days);
  freeDate.value = next.toISOString().slice(0, 10);
}

/**
 * 读请求（状态、室友课表）开始时记下代次；任何改动宿舍关系的操作都会让代次加一，
 * 于是改动之前发出、改动之后才回来的旧响应会被丢掉，不会把界面改回旧状态。
 */
let generation = 0;
function fresh(token: number, gen: number) {
  return gen === generation && alive(token);
}

/** 服务端返回的状态写进同步缓存。只认发起请求的账号，弹窗关了也照写，切换账号后不会写错人。 */
function rememberFor(userId: number | undefined, gen: number, next: DormStatus) {
  if (gen === generation) rememberDormStatus(userId, next);
}

function applyStatus(next: DormStatus) {
  const previousId = current.value?.id;
  status.value = next;
  statusError.value = false;
  if (next.status === "active") {
    // 正在编辑或等着保存的宿舍名不能被刷新回来的旧名字覆盖。
    if (!nameEditing.value && pendingName === null) dormNameDraft.value = next.name ?? "";
    if (minFree.value >= next.members.length) minFree.value = 0;
    // 换了宿舍时旧宿舍的课表不能留在界面上。
    if (previousId !== undefined && previousId !== next.id) schedules.value = null;
  } else {
    schedules.value = null;
    schedulesError.value = false;
    minFree.value = 0;
  }
}

/** 只有在宿舍里才拉室友课表；失败时保留之前的数据并标记错误，和“没人同步”区分开。 */
async function loadSchedules(token: number, gen: number) {
  if (!current.value) return;
  schedulesLoading.value = true;
  try {
    const next = await dormApi.schedules();
    if (!fresh(token, gen)) return;
    schedules.value = next;
    schedulesError.value = false;
    refreshedAt.value = Date.now();
  } catch {
    if (fresh(token, gen)) schedulesError.value = true;
  } finally {
    if (alive(token)) schedulesLoading.value = false;
  }
}

/** 上传自己的课表；真的传上去了就返回 true，调用方据此重新拉取状态和课表。 */
async function uploadMine(token: number, next: DormStatus, force = false) {
  if (!props.syncNow || next.status !== "active") return false;
  syncing.value = true;
  try {
    const result = await props.syncNow({ status: next, force });
    if (!alive(token)) return false;
    lastSync.value = result;
    return result === "synced";
  } catch {
    if (alive(token)) lastSync.value = "failed";
    return false;
  } finally {
    if (alive(token)) {
      syncing.value = false;
      flushPendingName();
    }
  }
}

/** 重新拉一次状态和室友课表；返回 null 表示失败（已标记 statusError）或响应已作废。 */
async function reloadStatus(token: number): Promise<DormStatus | null> {
  const gen = generation;
  const userId = auth.user?.id;
  try {
    const next = await dormApi.status();
    rememberFor(userId, gen, next);
    // 期间有改动完成：这份响应作废，弹窗还开着就按新代次再拉一次（代次只随用户操作变化，不会无限重试）。
    if (!fresh(token, gen)) return alive(token) && gen !== generation ? reloadStatus(token) : null;
    applyStatus(next);
    await loadSchedules(token, gen);
    return next;
  } catch {
    if (fresh(token, gen)) statusError.value = true;
    return null;
  }
}

/** 先显示服务端现有数据，再按需上传自己的课表，上传成功后再刷新一次，让“同步于”和室友视图都是新的。 */
async function refresh(options: { sync?: boolean } = {}) {
  const token = session;
  // 刷新按钮在改动进行时是禁用的；这里不再拦，打开弹窗时上一轮关掉前提交的改名可能还在路上。
  // 读到的旧响应由代次丢弃。
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const next = await reloadStatus(token);
    if (!alive(token)) return;
    loading.value = false;
    if (next?.status === "active" && options.sync && await uploadMine(token, next)) await reloadStatus(token);
  } finally {
    if (alive(token)) {
      refreshing.value = false;
      loading.value = false;
    }
  }
}

/** 创建、加入、退出、移出、改名、换色：同一时间只跑一个，跑的时候刷新和手动同步都锁住。 */
async function act(task: () => Promise<DormStatus>, success?: string, options: { sync?: boolean } = {}) {
  if (locked.value) return;
  const token = session;
  const userId = auth.user?.id;
  busy.value = true;
  generation += 1;
  try {
    const next = await task();
    // 改动成功之后再加一次，作废改动期间发出的读请求。
    generation += 1;
    const gen = generation;
    // 服务端已经改了，弹窗关掉也要更新这个账号的同步缓存。
    rememberFor(userId, gen, next);
    if (!alive(token)) return;
    applyStatus(next);
    if (success) ElMessage.success(success);
    if (next.status !== "active") return;
    await loadSchedules(token, gen);
    // 刚建好或刚加入的宿舍里服务端还没有我的快照，等上传完成再刷新，免得一直显示“未同步”。
    if (options.sync && fresh(token, gen) && await uploadMine(token, next)) await reloadStatus(token);
  } catch {
    // 请求层已经提示了具体错误。
  } finally {
    if (token === session) {
      busy.value = false;
      flushPendingName();
    }
  }
}

async function syncMineNow() {
  const next = status.value;
  if (!next || next.status !== "active" || locked.value) return;
  const token = session;
  const uploaded = await uploadMine(token, next, true);
  if (!alive(token)) return;
  if (uploaded) {
    if (await reloadStatus(token) && alive(token)) ElMessage.success("课表已同步");
    return;
  }
  if (lastSync.value === "unavailable") ElMessage.info("课表还没加载好，或者正在看往年学期；回到本学期课表后再同步。");
  else if (lastSync.value === "skipped") ElMessage.info("当前课表来源拿不到整学期课表，暂时没法同步。");
  else if (lastSync.value === "failed") ElMessage.error("同步失败，请稍后再试");
}

async function join() {
  const code = joinCode.value.trim();
  if (!code) return;
  await act(() => dormApi.join(code), "已加入宿舍", { sync: true });
  if (isActive.value) joinCode.value = "";
}

function pickColor(color: DormColor) {
  if (color === current.value?.me.color) return;
  const owner = colorOwnerId(color);
  void act(() => dormApi.setMyColor(color), owner ? `已和 ${nickOf(owner)} 互换颜色` : "颜色已保存");
}

/** 失焦或回车时保存；别的操作正在进行时先记下来，等它结束再存，不会悄悄丢掉。 */
let pendingName: string | null = null;
async function saveName() {
  nameEditing.value = false;
  const value = dormNameDraft.value.trim();
  if (!current.value?.isOwner || value === (current.value.name ?? "")) {
    pendingName = null;
    return;
  }
  if (locked.value) {
    pendingName = value;
    return;
  }
  pendingName = null;
  await act(() => dormApi.setName(value || null), "宿舍名已保存");
}

function flushPendingName() {
  if (pendingName === null || locked.value) return;
  const value = pendingName;
  pendingName = null;
  if (!current.value?.isOwner || value === (current.value.name ?? "")) return;
  void act(() => dormApi.setName(value || null), "宿舍名已保存");
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
  await act(() => dormApi.leave(), "已退出宿舍");
}

function onOpen() {
  todayYmd.value = dormTodayYmd();
  freeDate.value = todayYmd.value;
  if (props.initialCode && !joinCode.value) joinCode.value = props.initialCode;
  lastSync.value = null;
  loading.value = !status.value;
  // 打开时补一次上传：内容没变时 syncNow 只比对本地记录，不会重复上传。
  void refresh({ sync: true });
}

function endSession() {
  session += 1;
  loading.value = false;
  refreshing.value = false;
  busy.value = false;
  syncing.value = false;
  schedulesLoading.value = false;
  nameEditing.value = false;
  // 关闭前失焦触发、但被别的操作挡住的改名照样提交；界面已关，只更新服务端。
  flushPendingName();
}

watch(() => props.modelValue, (value) => {
  if (!value) endSession();
});

// 换了账号时上一个账号的宿舍不能留在弹窗里，进行中的请求也一律作废。
watch(() => auth.user?.id, (next, previous) => {
  if (next === previous) return;
  pendingName = null;
  endSession();
  generation += 1;
  status.value = null;
  schedules.value = null;
  statusError.value = false;
  schedulesError.value = false;
  lastSync.value = null;
  refreshedAt.value = null;
  if (props.modelValue && next) {
    loading.value = true;
    void refresh({ sync: true });
  }
});

watch(() => props.syncVersion, () => {
  if (!props.modelValue || !current.value || locked.value) return;
  lastSync.value = "synced";
  void reloadStatus(session);
});

onBeforeUnmount(endSession);
</script>

<style scoped>
.dorm-loading { padding: 8px 0; }
.note { margin: 10px 0 0; color: var(--schedule-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.note.lead { margin: 0 0 6px; font-size: var(--cpu-fs-s); }
.note.warn { color: var(--cpu-warning, #b26a00); }
.note.refreshed { margin-top: 6px; color: var(--schedule-text-muted); }
.block { padding: 12px 0; border-bottom: 1px solid var(--schedule-border); }
.block:last-child { border-bottom: 0; padding-bottom: 0; }
.block h3 { margin: 0 0 6px; color: var(--schedule-text); font-size: var(--cpu-fs-m); }
.wide-button { width: 100%; margin-top: 10px; }
.empty-tip { padding: 20px 0; color: var(--schedule-text-muted); font-size: var(--cpu-fs-s); line-height: 1.6; text-align: center; }
.state-box { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 20px 0; color: var(--schedule-text-secondary); font-size: var(--cpu-fs-s); text-align: center; }
.state-box p { margin: 0; }
.note.refresh-failed { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0 0 10px; }
.inline-retry {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid currentColor;
  border-radius: 16px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.inline-retry:disabled { cursor: default; opacity: 0.6; }
.inline-retry:focus-visible { outline: 2px solid var(--schedule-accent, var(--cpu-primary)); outline-offset: 2px; }
@media (pointer: coarse) { .inline-retry { min-height: 44px; } }

.join { display: flex; gap: 8px; margin-top: 10px; }
.code-input {
  flex: 1;
  min-width: 0;
  height: 40px;
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
.code-input:focus-visible,
.name-input:focus-visible {
  border-color: var(--schedule-accent, var(--cpu-primary));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--schedule-accent, var(--cpu-primary)) 30%, transparent);
}

.dorm-head { margin: 0 0 8px; }
.dorm-title { display: flex; align-items: center; gap: 10px; }
.dorm-title b { flex: 1; min-width: 0; overflow: hidden; color: var(--schedule-text); font-size: var(--cpu-fs-m); text-overflow: ellipsis; white-space: nowrap; }
.dorm-title span { flex: 0 0 auto; color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); }
.refresh-button {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--schedule-border);
  border-radius: 16px;
  background: transparent;
  color: var(--schedule-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
}
.refresh-button:disabled { cursor: default; opacity: 0.6; }
.dorm-people { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0 0; padding: 0; list-style: none; }
.person { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.person-name { max-width: 64px; overflow: hidden; font-size: var(--cpu-fs-xs); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.person-tags { display: flex; gap: 3px; }
.owner-tag, .stale-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 6px;
  font-size: var(--cpu-fs-xs);
  font-style: normal;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}
.owner-tag { background: color-mix(in srgb, var(--schedule-accent, var(--cpu-primary)) 16%, transparent); color: var(--schedule-text); }
.stale-tag { background: color-mix(in srgb, var(--schedule-text-muted) 18%, transparent); color: var(--schedule-text-secondary); }
.stale-count { flex: 0 0 auto; }

.dorm-tabs { margin-top: 4px; }
.free-bar { display: flex; align-items: center; gap: 8px; }
.free-bar b { flex: 1; min-width: 0; color: var(--schedule-text); font-size: var(--cpu-fs-s); text-align: center; }
.date-nav {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border: 1px solid var(--schedule-border);
  border-radius: 50%;
  background: transparent;
  color: var(--schedule-text-secondary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.date-today {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--schedule-border);
  border-radius: 16px;
  background: transparent;
  color: var(--schedule-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
}
.date-nav:focus-visible,
.date-today:focus-visible,
.refresh-button:focus-visible,
.swatch:focus-visible {
  outline: 2px solid var(--schedule-accent, var(--cpu-primary));
  outline-offset: 2px;
}
.free-filter { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 12px 0 6px; color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); }
.min-free-select { width: 150px; }

.track { position: relative; height: 26px; margin: 6px 0 4px; border-radius: 8px; background: color-mix(in srgb, var(--schedule-text-muted) 12%, transparent); }
.track-free { position: absolute; top: 0; bottom: 0; border-radius: 6px; background: color-mix(in srgb, var(--cpu-success, #2aa06a) 62%, transparent); }
.track-start, .track-end { position: absolute; bottom: -18px; color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); }
.track-start { left: 0; }
.track-end { right: 0; }

.free-list { margin: 24px 0 0; padding: 0; list-style: none; }
.free-list li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--schedule-border); font-size: var(--cpu-fs-s); }
.free-list b { color: var(--schedule-text); font-variant-numeric: tabular-nums; }
.free-list span { color: var(--cpu-success, #2aa06a); font-weight: 600; }
.free-list em { color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); font-style: normal; }
.note.empty-free { margin-top: 24px; }

.day-courses { margin-top: 16px; }
.day-courses h3 { margin: 0 0 6px; color: var(--schedule-text); font-size: var(--cpu-fs-s); }
.day-course-row { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; }
.who { flex: 0 0 56px; overflow: hidden; font-size: var(--cpu-fs-xs); font-weight: 700; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border: 1px solid transparent; border-radius: 8px; font-size: var(--cpu-fs-xs); font-weight: 600; line-height: 18px; }
.chip-free { color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); line-height: 20px; }
.chip-free.unknown { color: var(--cpu-warning, #b26a00); }
.who-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; }

.next-morning { margin: 4px 0 10px; color: var(--schedule-text); font-size: var(--cpu-fs-s); line-height: 1.7; }
.next-morning b { margin-right: 6px; font-weight: 700; }
.morning-list { margin: 0; padding: 0; list-style: none; }
.morning-list li { display: flex; align-items: center; gap: 10px; padding: 7px 4px; border-bottom: 1px dashed var(--schedule-border); }
.morning-list li.busy { background: color-mix(in srgb, var(--cpu-warning, #e6a23c) 8%, transparent); border-radius: 6px; }
.morning-date { flex: 0 0 72px; display: flex; flex-direction: column; gap: 1px; }
.morning-date b { color: var(--schedule-text); font-size: var(--cpu-fs-xs); }
.morning-date span { color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); }
.morning-bodies { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.morning-none { color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); line-height: 20px; }

.line { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 6px 0; border-bottom: 1px solid var(--schedule-border); font-size: var(--cpu-fs-s); }
.line > span { flex: 0 0 auto; color: var(--schedule-text-muted); }
.line strong { flex: 1; min-width: 0; color: var(--schedule-text); font-weight: 600; text-align: right; }
.name-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--schedule-border);
  border-radius: var(--cpu-radius-m);
  background: var(--schedule-surface-bg-soft, transparent);
  color: var(--schedule-text);
  font-size: var(--cpu-fs-s);
  text-align: right;
  outline: none;
}
.colors { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.swatch { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 1px solid transparent; border-radius: 50%; font: inherit; font-size: var(--cpu-fs-xs); font-weight: 700; cursor: pointer; }
.swatch.mine { box-shadow: 0 0 0 2px var(--schedule-surface-bg, transparent), 0 0 0 4px var(--schedule-text); }
.swatch.taken { border-style: dashed; border-width: 2px; }
.swatch:disabled { cursor: default; opacity: 0.6; }
.invite-line { flex-wrap: wrap; }
.invite-code { color: var(--schedule-text); font: 700 20px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace; letter-spacing: 4px; }
.invite-actions { display: flex; gap: 4px; }
.member-list { margin: 0; padding: 0; list-style: none; }
.member-list li { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 0; font-size: var(--cpu-fs-s); }
.member-list b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-list :deep(.el-button) { margin-left: auto; }

/* 触屏上把日期切换和颜色按钮放大到 44px，手指好点。 */
@media (pointer: coarse) {
  .date-nav { width: 44px; height: 44px; }
  .date-today, .refresh-button { min-height: 44px; }
  .swatch { width: 44px; height: 44px; }
}
@media (max-width: 520px) {
  .free-filter { flex-wrap: wrap; }
  .min-free-select { width: 100%; }
  .color-line, .sync-line { flex-wrap: wrap; }
  .color-line .colors { flex: 1 1 100%; justify-content: flex-start; }
  .sync-line strong { text-align: left; }
  .morning-list li { flex-wrap: wrap; }
  .morning-date { flex-basis: 60px; }
}
</style>
