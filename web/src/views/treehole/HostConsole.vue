<template>
  <div class="th-page th-host-console">
    <router-link class="th-back" to="/treehole">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>艾绒树洞
    </router-link>
    <header class="th-head">
      <div class="th-head-copy">
        <h1>洞主工作台</h1>
        <p v-if="overview">{{ overview.profile.name }} · {{ presenceText }}</p>
      </div>
      <div v-if="overview" class="th-actions">
        <el-button v-if="overview.profile.isAdmin" @click="router.push('/treehole/admin')">树洞后台</el-button>
        <el-button
          :type="overview.profile.presence.online ? 'default' : 'primary'"
          :loading="switching"
          @click="togglePresence"
        >
          {{ overview.profile.presence.online ? "暂时下线" : "上线" }}
        </el-button>
      </div>
    </header>

    <div v-if="loading && !overview" class="th-group" role="status"><el-skeleton :rows="5" animated /></div>
    <div v-else-if="error" class="th-group th-empty" role="alert"><p>{{ error }}</p><el-button @click="load()">重试</el-button></div>

    <template v-else-if="overview">
      <nav class="th-tabs" aria-label="工作台分区">
        <button v-for="item in tabs" :key="item.key" type="button" class="th-tab" :class="{ 'is-active': tab === item.key }" @click="setTab(item.key)">
          {{ item.label }}<span v-if="item.badge" class="th-badge">{{ item.badge }}</span>
        </button>
      </nav>

      <!-- 待认领：只有在岗时能看留言内容和认领 -->
      <template v-if="tab === 'pool'">
        <section class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">待认领的留言</h2>
            <span class="th-muted">{{ pool?.total ?? overview.poolCount }} 条</span>
          </div>
          <div v-if="pool && !pool.online" class="th-empty">
            <p>上线后才能查看和认领留言。现在有 {{ pool.total }} 条留言在等小艾绒。</p>
            <el-button type="primary" :loading="switching" @click="togglePresence">上线</el-button>
          </div>
          <div v-else-if="pool && !pool.list.length" class="th-empty"><p>暂时没有待认领的留言。</p></div>
          <div v-else-if="pool" class="th-rows">
            <div v-for="item in pool.list" :key="item.id" class="th-row th-pool-row">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ item.alias }}
                  <em v-for="topic in item.topics" :key="topic" class="th-chip">#{{ topic }}</em>
                </div>
                <p class="th-pool-preview">{{ item.preview }}</p>
                <p class="th-meta"><span>{{ timeText(item.createdAt) }} 留言</span></p>
              </div>
              <el-button type="primary" size="small" :loading="claiming === item.id" @click="claim(item.id)">认领</el-button>
            </div>
          </div>
        </section>
        <p class="th-sub th-tab-note">认领后只有你和来访者能看到这段对话。认领了但接不住，可以在对话菜单里“放回待认领”。</p>
      </template>

      <template v-else-if="tab === 'sessions'">
        <section class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">我认领的留言</h2>
            <span class="th-muted">{{ overview.activeSessions.length }} 条进行中</span>
          </div>
          <div v-if="!overview.activeSessions.length" class="th-empty"><p>现在没有进行中的留言，可以去“待认领”看看。</p></div>
          <div v-else class="th-rows">
            <SessionRow v-for="session in overview.activeSessions" :key="session.id" :session="session" />
          </div>
        </section>
        <section class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">已结束</h2>
            <span class="th-muted">永久保存，用于陪伴跟进和社团复盘</span>
          </div>
          <div v-if="!endedSessions.length" class="th-empty"><p>还没有结束的留言。</p></div>
          <div v-else class="th-rows">
            <SessionRow v-for="session in endedSessions" :key="session.id" :session="session" />
          </div>
          <div v-if="endedTotal > endedSessions.length" class="th-load-more">
            <el-button text :loading="loadingEnded" @click="loadMoreEnded">加载更多</el-button>
          </div>
        </section>
      </template>

      <template v-else-if="tab === 'bookings'">
        <section class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">待处理和即将到来的预约</h2>
          </div>
          <div v-if="!bookings.upcoming.length" class="th-empty"><p>还没有预约。同学会按你的排班预约 30 分钟的线下倾诉。</p></div>
          <div v-else class="th-rows">
            <div v-for="booking in bookings.upcoming" :key="booking.id" class="th-row th-booking-row">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ bookingTimeText(booking.startAt, booking.endAt) }}
                  <em class="th-chip" :class="bookingStatusTone(booking.status)">{{ bookingStatusLabel(booking.status) }}</em>
                </div>
                <p class="th-meta"><span>{{ booking.alias }}</span><span>{{ booking.place }}</span></p>
                <p v-if="booking.note" class="th-booking-note">“{{ booking.note }}”</p>
              </div>
              <div class="th-actions">
                <template v-if="booking.status === 'pending'">
                  <el-button size="small" type="primary" @click="confirmBooking(booking.id)">确认</el-button>
                  <el-button size="small" @click="rejectBooking(booking.id)">拒绝</el-button>
                </template>
                <el-button v-else-if="booking.cancellable" size="small" @click="cancelBooking(booking.id)">取消</el-button>
              </div>
            </div>
          </div>
        </section>
        <section v-if="bookings.past.length" class="th-group th-group--flush">
          <div class="th-group-head"><h2 class="th-h2">最近 30 天的记录</h2></div>
          <div class="th-rows">
            <div v-for="booking in bookings.past" :key="booking.id" class="th-row">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ bookingTimeText(booking.startAt, booking.endAt) }}
                  <em class="th-chip" :class="bookingStatusTone(booking.status)">{{ bookingStatusLabel(booking.status) }}</em>
                </div>
                <p class="th-meta">
                  <span>{{ booking.alias }}</span>
                  <span v-if="booking.cancelledBy">{{ booking.cancelledBy === "host" ? "你取消" : "同学取消" }}</span>
                  <span v-if="booking.rejectReason || booking.cancelReason">{{ booking.rejectReason || booking.cancelReason }}</span>
                </p>
              </div>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="tab === 'rooms'">
        <section class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">主题宣泄室</h2>
            <el-button size="small" type="primary" @click="router.push('/treehole/rooms')">开设或浏览</el-button>
          </div>
          <div v-if="!overview.rooms.length" class="th-empty"><p>还没有宣泄室。每位小艾绒都可以开设主题宣泄室并担任管理员。</p></div>
          <div v-else class="th-rows">
            <div v-for="room in overview.rooms" :key="room.id" class="th-row">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ room.name }}
                  <em class="th-chip is-brand">{{ room.categoryLabel }}</em>
                  <em v-if="room.joined" class="th-chip is-ok">我是管理员</em>
                </div>
                <p class="th-meta"><span>{{ room.memberCount }} 位同学</span><span>{{ room.hostCount }} 位小艾绒</span><span v-if="room.lastMessageAt">{{ timeText(room.lastMessageAt) }}</span></p>
              </div>
              <el-button v-if="room.joined" size="small" @click="router.push(`/treehole/room/${room.id}`)">进入</el-button>
              <el-button v-else size="small" type="primary" plain @click="enterRoom(room.id)">加入并管理</el-button>
            </div>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="th-group">
          <h2 class="th-h2">值班状态</h2>
          <p class="th-sub">排班时间内默认在岗，可以认领留言。临时离开点“暂时下线”，本时段结束后自动恢复；排班外点“上线”会临时在岗两小时。线下预约按排班开放，和是否上线无关。</p>
          <div class="th-notice th-presence">
            <span class="th-dot" :class="{ 'is-on': overview.profile.presence.online }" aria-hidden="true" />
            <span>{{ presenceText }}</span>
          </div>
          <h3 class="th-h3">我的排班</h3>
          <p v-if="!overview.profile.shifts.length" class="th-sub">还没有排班，请联系社团负责人录入。</p>
          <ul v-else class="th-shifts">
            <li v-for="shift in overview.profile.shifts" :key="`${shift.weekday}-${shift.startMinute}`">{{ shiftText(shift) }}</li>
          </ul>
        </section>
        <section class="th-group">
          <h2 class="th-h2">对同学展示的简介</h2>
          <p class="th-sub">同学预约时会看到，例如擅长倾听的话题。不要写能认出你的信息。</p>
          <div class="th-intro-form">
            <el-input v-model="intro" maxlength="80" show-word-limit placeholder="例如：考试焦虑、宿舍关系，都可以聊" />
            <el-button type="primary" :loading="savingIntro" @click="saveIntro">保存</el-button>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { treeholeApi, type TreeholeBooking, type TreeholeHostOverview, type TreeholePoolItem, type TreeholeSession } from "@/api/treehole";
import {
  bookingStatusLabel,
  bookingStatusTone,
  bookingTimeText,
  claimStatusLabel,
  claimStatusTone,
  errorText,
  nextShiftText,
  shiftText,
  tagLabel,
  tagTone,
  timeText,
  usePolling,
} from "./shared";
import "./treehole.css";

const SessionRow = defineComponent({
  props: { session: { type: Object as () => TreeholeSession, required: true } },
  setup(props) {
    return () => {
      const session = props.session;
      const ended = session.status !== "active";
      return h(RouterLink, { class: "th-row", to: `/treehole/session/${session.id}` }, () => [
        h("div", { class: "th-row-copy" }, [
          h("div", { class: "th-row-title" }, [
            session.alias,
            h("em", { class: ["th-chip", claimStatusTone(session.claimStatus, ended)] }, claimStatusLabel(session.claimStatus, ended)),
            session.tag && session.tag !== "normal" ? h("em", { class: ["th-chip", tagTone(session.tag)] }, tagLabel(session.tag)) : null,
            ...session.topics.map((topic) => h("em", { class: "th-chip" }, `#${topic}`)),
          ]),
          h("div", { class: "th-row-preview" }, session.preview || ""),
        ]),
        session.unread ? h("span", { class: "th-badge" }, String(session.unread)) : null,
        h("span", { class: "th-muted" }, timeText(session.lastMessageAt)),
      ]);
    };
  },
});

type TabKey = "pool" | "sessions" | "bookings" | "rooms" | "me";
const TAB_KEYS: TabKey[] = ["pool", "sessions", "bookings", "rooms", "me"];

const route = useRoute();
const router = useRouter();
const overview = ref<TreeholeHostOverview | null>(null);
const pool = ref<{ online: boolean; total: number; list: TreeholePoolItem[] } | null>(null);
const bookings = ref<{ upcoming: TreeholeBooking[]; past: TreeholeBooking[] }>({ upcoming: [], past: [] });
const loading = ref(true);
const error = ref("");
const switching = ref(false);
const claiming = ref<number | null>(null);
const intro = ref("");
const savingIntro = ref(false);
const endedSessions = ref<TreeholeSession[]>([]);
const endedTotal = ref(0);
const endedPage = ref(1);
const loadingEnded = ref(false);

const tab = ref<TabKey>(TAB_KEYS.includes(route.query.tab as TabKey) ? route.query.tab as TabKey : "pool");

const tabs = computed(() => {
  const value = overview.value;
  const unread = value?.activeSessions.reduce((sum, session) => sum + (session.unread ? 1 : 0), 0) ?? 0;
  return [
    { key: "pool" as const, label: "待认领", badge: value?.poolCount ?? 0 },
    { key: "sessions" as const, label: "我的留言", badge: unread },
    { key: "bookings" as const, label: "预约", badge: value?.pendingBookings ?? 0 },
    { key: "rooms" as const, label: "宣泄室", badge: 0 },
    { key: "me" as const, label: "排班与资料", badge: 0 },
  ];
});

const presenceText = computed(() => {
  const presence = overview.value?.profile.presence;
  if (!presence) return "";
  if (presence.online) {
    if (presence.source === "manual" && presence.until) return `临时在岗，到 ${timeText(presence.until)}`;
    return presence.until ? `在岗，本时段到 ${timeText(presence.until)}` : "在岗";
  }
  if (presence.source === "manual" && presence.inShift) return `已暂时下线，本时段结束后恢复（${timeText(presence.until)}）`;
  return `离岗 · ${nextShiftText(presence.nextShiftAt)}`;
});

function setTab(key: TabKey) {
  tab.value = key;
  router.replace({ query: key === "pool" ? {} : { tab: key } });
}

async function loadTab() {
  if (tab.value === "pool") pool.value = await treeholeApi.pool();
  if (tab.value === "bookings") bookings.value = await treeholeApi.hostBookings();
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  error.value = "";
  try {
    const result = await treeholeApi.hostOverview();
    overview.value = result;
    if (!silent) {
      intro.value = result.profile.intro;
      endedPage.value = 1;
      const page = await treeholeApi.hostSessions({ status: "ended", page: 1 });
      endedSessions.value = page.list;
      endedTotal.value = page.total;
    }
    await loadTab();
  } catch (cause) {
    if (!silent) error.value = errorText(cause, "只有在任的小艾绒可以使用工作台");
  } finally {
    loading.value = false;
  }
}

usePolling(() => load(true), 15_000);
watch(tab, () => void loadTab());

async function loadMoreEnded() {
  loadingEnded.value = true;
  try {
    const page = await treeholeApi.hostSessions({ status: "ended", page: endedPage.value + 1 });
    endedPage.value += 1;
    endedSessions.value.push(...page.list);
    endedTotal.value = page.total;
  } finally {
    loadingEnded.value = false;
  }
}

async function togglePresence() {
  if (!overview.value) return;
  switching.value = true;
  try {
    overview.value.profile.presence = await treeholeApi.setPresence(overview.value.profile.presence.online ? "offline" : "online");
    await load(true);
  } finally {
    switching.value = false;
  }
}

async function claim(id: number) {
  claiming.value = id;
  try {
    await treeholeApi.claim(id);
    router.push(`/treehole/session/${id}`);
  } catch {
    await load(true);
  } finally {
    claiming.value = null;
  }
}

async function confirmBooking(id: number) {
  await treeholeApi.confirmBooking(id);
  ElMessage.success("已确认，同学会收到提醒");
  await load(true);
}

async function rejectBooking(id: number) {
  const result = await ElMessageBox.prompt("同学会看到这条原因，请温和地说明，也可以建议换个时间。", "拒绝预约", {
    confirmButtonText: "拒绝",
    cancelButtonText: "取消",
    inputValidator: (value: string) => (value && value.trim().length >= 2) || "请简单说明原因",
  }).catch(() => null);
  if (!result) return;
  await treeholeApi.rejectBooking(id, String(result.value).trim());
  await load(true);
}

async function cancelBooking(id: number) {
  const result = await ElMessageBox.prompt("同学会收到取消提醒，请说明原因。", "取消预约", {
    confirmButtonText: "取消预约",
    cancelButtonText: "不取消",
    inputValidator: (value: string) => (value && value.trim().length >= 2) || "请简单说明原因",
  }).catch(() => null);
  if (!result) return;
  await treeholeApi.cancelBooking(id, String(result.value).trim());
  await load(true);
}

async function saveIntro() {
  savingIntro.value = true;
  try {
    await treeholeApi.updateHostProfile(intro.value.trim());
    ElMessage.success("已保存");
  } finally {
    savingIntro.value = false;
  }
}

async function enterRoom(id: number) {
  await treeholeApi.enterRoom(id);
  router.push(`/treehole/room/${id}`);
}

onMounted(() => load());
</script>

<style scoped>
.th-h3 { margin: 16px 0 4px; font-size: var(--cpu-fs-m); font-weight: 600; }
.th-presence { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--cpu-text); }
.th-shifts { margin: 4px 0 0; padding-left: 20px; color: var(--cpu-text-secondary); }
.th-intro-form { display: flex; gap: 8px; margin-top: 12px; }
.th-load-more { display: flex; justify-content: center; padding: 6px; border-top: 1px solid var(--cpu-border-soft); }
.th-tab .th-badge { margin-left: 2px; }
.th-tab-note { margin: -4px 4px 0; }
.th-pool-row { align-items: flex-start; }
.th-pool-preview {
  display: -webkit-box;
  margin: 4px 0;
  overflow: hidden;
  color: var(--cpu-text);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.th-booking-row { flex-wrap: wrap; }
.th-booking-note { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
</style>
