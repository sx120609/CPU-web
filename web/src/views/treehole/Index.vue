<template>
  <div class="th-page th-home">
    <header class="th-head">
      <div class="th-head-copy">
        <h1>艾绒树洞</h1>
        <p>艾绒朋辈心理社 · 匿名的同学倾听与陪伴</p>
      </div>
      <div v-if="me && (me.roles.host || me.roles.admin || me.roles.siteAdmin)" class="th-actions">
        <el-button v-if="me.roles.host" @click="router.push('/treehole/host')">洞主工作台</el-button>
        <el-button v-if="me.roles.admin || me.roles.siteAdmin" @click="router.push('/treehole/admin')">树洞后台</el-button>
      </div>
    </header>

    <div v-if="loading && !me" class="th-group" role="status" aria-label="正在加载">
      <el-skeleton :rows="5" animated />
    </div>
    <div v-else-if="error" class="th-group th-empty" role="alert">
      <p>{{ error }}</p>
      <el-button @click="load">重试</el-button>
    </div>

    <template v-else-if="me">
      <!-- 知情同意：不勾选不能留言、预约和进宣泄室 -->
      <section v-if="!me.consent.agreed" class="th-group th-consent">
        <h2 class="th-h2">进入树洞前，请先了解这些</h2>
        <ul>
          <li><strong>这是同学之间的朋辈陪伴</strong>，由艾绒朋辈心理社的志愿者“小艾绒”倾听，不等同于专业心理咨询。</li>
          <li><strong>你全程匿名。</strong>每条留言、每次预约都会生成新的虚拟 ID，小艾绒看不到你的学号、姓名和手机号；每段对话严格隔离。</li>
          <li><strong>遇到危机情况</strong>，小艾绒会引导你联系学校心理发展中心，必要时转介给中心老师。</li>
          <li><strong>记录会留存</strong>，只有你本人、回复你的小艾绒和社团核心管理员可以查看，用于陪伴跟进和危机追溯。</li>
          <li>只有在评估存在严重安全风险、需要线下干预时，经两名核心管理员共同审批，才会查看你在{{ site.brandName }}的账号信息，全程记录在案。</li>
        </ul>
        <el-checkbox v-model="agree">我已阅读并同意以上说明</el-checkbox>
        <div class="th-actions">
          <el-button type="primary" :disabled="!agree" :loading="consenting" @click="giveConsent">进入树洞</el-button>
        </div>
      </section>

      <template v-else>
        <div v-if="!me.canStart" class="th-notice is-warn">
          树洞暂未开放。开放后，你可以在这里找小艾绒聊聊。
        </div>
        <div v-else-if="!me.eligible" class="th-notice is-warn">
          树洞仅面向在校同学，请先退出后用“学校账号登录”进入{{ site.brandName }}。
        </div>

        <section v-if="me.canStart && me.eligible" class="th-start" aria-label="树洞服务">
          <button type="button" class="th-start-card" @click="openMessage">
            <span class="th-start-icon" data-hue="brand"><el-icon><EditPen /></el-icon></span>
            <span class="th-start-copy">
              <strong>
                留言倾诉
                <em v-if="activeSession" class="th-chip" :class="claimStatusTone(activeSession.claimStatus)">{{ claimStatusLabel(activeSession.claimStatus) }}</em>
              </strong>
              <span v-if="activeSession">你有一条留言还在进行中，点开接着说。</span>
              <span v-else>写下想说的话，小艾绒值班时认领并回复你，回复后会提醒你。</span>
            </span>
            <el-icon class="th-start-arrow" aria-hidden="true"><ArrowRight /></el-icon>
          </button>
          <button type="button" class="th-start-card" @click="router.push('/treehole/bookings')">
            <span class="th-start-icon" data-hue="violet"><el-icon><Calendar /></el-icon></span>
            <span class="th-start-copy">
              <strong>
                预约线下 1 对 1 倾诉
                <em v-if="upcomingBookings.length" class="th-chip is-ok">{{ upcomingBookings.length }} 个预约</em>
              </strong>
              <span>看值班表，挑一位小艾绒和时间，到心理发展中心当面聊。</span>
            </span>
            <el-icon class="th-start-arrow" aria-hidden="true"><ArrowRight /></el-icon>
          </button>
          <button type="button" class="th-start-card" @click="router.push('/treehole/rooms')">
            <span class="th-start-icon" data-hue="amber"><el-icon><ChatLineRound /></el-icon></span>
            <span class="th-start-copy">
              <strong>主题宣泄室</strong>
              <span>按困扰找到同主题的房间，和有相似经历的同学匿名聊聊。</span>
            </span>
            <el-icon class="th-start-arrow" aria-hidden="true"><ArrowRight /></el-icon>
          </button>
        </section>

        <section v-if="upcomingBookings.length" class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">我的预约</h2>
            <router-link class="th-muted" to="/treehole/bookings">全部预约</router-link>
          </div>
          <div class="th-rows">
            <router-link v-for="booking in upcomingBookings" :key="booking.id" class="th-row" to="/treehole/bookings">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ bookingTimeText(booking.startAt, booking.endAt) }}
                  <em class="th-chip" :class="bookingStatusTone(booking.status)">{{ bookingStatusLabel(booking.status) }}</em>
                </div>
                <p class="th-meta"><span>{{ booking.host.name }}</span><span>{{ booking.place }}</span></p>
              </div>
            </router-link>
          </div>
        </section>

        <section v-if="me.rooms.length" class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">我的宣泄室</h2>
            <router-link class="th-muted" to="/treehole/rooms">找更多主题</router-link>
          </div>
          <div class="th-rows">
            <router-link v-for="room in me.rooms" :key="room.id" class="th-row" :to="`/treehole/room/${room.id}`">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ room.name }}
                  <em class="th-chip is-brand">{{ room.categoryLabel }}</em>
                </div>
                <p class="th-meta"><span>我的虚拟 ID {{ room.alias }}</span><span v-if="room.lastMessageAt">{{ timeText(room.lastMessageAt) }}</span></p>
              </div>
              <span v-if="room.unread" class="th-badge">{{ room.unread > 99 ? "99+" : room.unread }}</span>
            </router-link>
          </div>
        </section>

        <section v-if="me.sessions.length" class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">我的留言</h2>
            <span class="th-muted">只有你自己能看到这些记录</span>
          </div>
          <div class="th-rows">
            <router-link v-for="session in me.sessions" :key="session.id" class="th-row" :to="`/treehole/session/${session.id}`">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ session.host ? session.host.name : "等待小艾绒认领" }}
                  <em class="th-chip" :class="claimStatusTone(session.claimStatus, session.status !== 'active')">{{ claimStatusLabel(session.claimStatus, session.status !== "active") }}</em>
                  <em v-if="session.mode === 'live'" class="th-chip">实时聊天</em>
                </div>
                <div class="th-row-preview">{{ session.preview || "（图片）" }}</div>
                <p v-if="session.topics.length" class="th-meta"><span v-for="topic in session.topics" :key="topic">#{{ topic }}</span></p>
              </div>
              <span v-if="session.unread" class="th-badge">{{ session.unread }}</span>
              <span class="th-muted">{{ timeText(session.lastMessageAt) }}</span>
            </router-link>
          </div>
        </section>
      </template>

      <section class="th-group th-help-card">
        <h2 class="th-h2">需要更专业的帮助？</h2>
        <p class="th-sub">{{ me.help.centerName }}</p>
        <ul>
          <li v-if="me.help.centerHotline">电话：{{ me.help.centerHotline }}</li>
          <li v-if="me.help.centerLocation">地点：{{ me.help.centerLocation }}</li>
          <li v-if="me.help.centerHours">开放时间：{{ me.help.centerHours }}</li>
        </ul>
        <p v-if="me.help.emergencyNote" class="th-help-emergency">{{ me.help.emergencyNote }}</p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useSiteStore } from "@/stores/site";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, Calendar, ChatLineRound, EditPen } from "@element-plus/icons-vue";
import { treeholeApi, type TreeholeBooking, type TreeholeMe } from "@/api/treehole";
import {
  bookingStatusLabel,
  bookingStatusTone,
  bookingTimeText,
  claimStatusLabel,
  claimStatusTone,
  errorText,
  timeText,
} from "./shared";
import "./treehole.css";

const site = useSiteStore();
const router = useRouter();
const me = ref<TreeholeMe | null>(null);
const bookings = ref<TreeholeBooking[]>([]);
const loading = ref(false);
const error = ref("");
const agree = ref(false);
const consenting = ref(false);

const activeSession = computed(() => me.value?.sessions.find((session) => session.status === "active") ?? null);
const upcomingBookings = computed(() => bookings.value.filter((booking) => booking.status === "pending" || booking.status === "confirmed"));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    me.value = await treeholeApi.me();
    if (me.value.consent.agreed) bookings.value = await treeholeApi.myBookings().catch(() => []);
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function openMessage() {
  router.push(activeSession.value ? `/treehole/session/${activeSession.value.id}` : "/treehole/new");
}

async function giveConsent() {
  consenting.value = true;
  try {
    await treeholeApi.consent();
    await load();
  } finally {
    consenting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.th-consent ul,
.th-help-card ul {
  margin: 8px 0 12px;
  padding-left: 20px;
  color: var(--cpu-text-secondary);
}
.th-consent li { margin: 6px 0; }
.th-consent li strong { color: var(--cpu-text); }
.th-help-card ul { margin-bottom: 4px; }
.th-help-emergency {
  margin: 8px 0 0;
  color: var(--cpu-accent);
  font-size: var(--cpu-fs-s);
}
.th-start {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.th-start-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.th-start-card:hover { border-color: var(--cpu-primary); }
.th-start-card:active { background: var(--cpu-surface-soft); }
.th-start-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.th-start-copy strong { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: var(--cpu-fs-l); }
.th-start-copy > span { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.th-start-arrow { flex: none; color: var(--cpu-text-muted); }
.th-start-icon {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-hue-bg);
  color: var(--cpu-hue-ink);
  font-size: 18px;
}
</style>
