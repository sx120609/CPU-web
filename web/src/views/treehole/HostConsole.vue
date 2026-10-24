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

      <template v-if="tab === 'sessions'">
        <section class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">进行中的会话</h2>
            <span class="th-muted">{{ overview.activeSessions.length }} 个</span>
          </div>
          <div v-if="!overview.activeSessions.length" class="th-empty"><p>现在没有进行中的会话。</p></div>
          <div v-else class="th-rows">
            <SessionRow v-for="session in overview.activeSessions" :key="session.id" :session="session" />
          </div>
        </section>
        <section class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">接待过的会话</h2>
            <span class="th-muted">永久保存，用于陪伴跟进和社团复盘</span>
          </div>
          <div v-if="!endedSessions.length" class="th-empty"><p>还没有结束的会话。</p></div>
          <div v-else class="th-rows">
            <SessionRow v-for="session in endedSessions" :key="session.id" :session="session" />
          </div>
          <div v-if="endedTotal > endedSessions.length" class="th-load-more">
            <el-button text :loading="loadingEnded" @click="loadMoreEnded">加载更多</el-button>
          </div>
        </section>
      </template>

      <template v-else-if="tab === 'rooms'">
        <section class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">宣泄室</h2>
            <el-button size="small" type="primary" @click="proposalOpen = true">发起新建</el-button>
          </div>
          <div v-if="!overview.rooms.length" class="th-empty"><p>还没有宣泄室。新建需要至少 3 名洞主联名。</p></div>
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
              <span v-if="room.pendingApplications" class="th-badge" :title="`${room.pendingApplications} 条待审核申请`">{{ room.pendingApplications }}</span>
              <el-button v-if="room.joined" size="small" @click="router.push(room.pendingApplications ? `/treehole/room/${room.id}?panel=applications` : `/treehole/room/${room.id}`)">进入</el-button>
              <el-button v-else size="small" type="primary" plain @click="enterRoom(room.id)">加入并管理</el-button>
            </div>
          </div>
        </section>

        <section v-if="overview.proposals.length" class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">联名中的提议</h2>
            <span class="th-muted">满 3 名洞主联名后自动建成，联名的洞主都是群管理员</span>
          </div>
          <div class="th-rows">
            <div v-for="proposal in overview.proposals" :key="proposal.id" class="th-row">
              <div class="th-row-copy">
                <div class="th-row-title">{{ proposal.name }} <em class="th-chip is-brand">{{ proposal.categoryLabel }}</em></div>
                <p class="th-meta"><span>{{ proposal.proposer }} 发起</span><span>已联名 {{ proposal.signers.length }}/3：{{ proposal.signers.join("、") }}</span></p>
                <p v-if="proposal.intro" class="th-row-preview">{{ proposal.intro }}</p>
              </div>
              <el-button v-if="!proposal.signed" size="small" type="primary" @click="sign(proposal.id)">联名</el-button>
              <el-button v-if="proposal.mine" size="small" text @click="cancelProposal(proposal.id)">撤回</el-button>
            </div>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="th-group">
          <h2 class="th-h2">值班状态</h2>
          <p class="th-sub">排班时间内默认在岗。临时离开可以点“暂时下线”，本时段结束后自动恢复；排班外点“上线”会临时在岗两小时。</p>
          <div class="th-notice th-presence">
            <span class="th-dot" :class="{ 'is-on': overview.profile.presence.online }" aria-hidden="true" />
            <span>{{ presenceText }}</span>
          </div>
          <h3 class="th-h3">我的排班</h3>
          <p v-if="!overview.profile.shifts.length" class="th-sub">还没有排班，请联系核心管理员录入。</p>
          <ul v-else class="th-shifts">
            <li v-for="shift in overview.profile.shifts" :key="`${shift.weekday}-${shift.startMinute}`">{{ shiftText(shift) }}</li>
          </ul>
        </section>
        <section class="th-group">
          <h2 class="th-h2">对来访者展示的简介</h2>
          <p class="th-sub">来访者选洞主时会看到，例如擅长倾听的话题。不要写能认出你的信息。</p>
          <div class="th-intro-form">
            <el-input v-model="intro" maxlength="80" show-word-limit placeholder="例如：考试焦虑、宿舍关系，都可以聊" />
            <el-button type="primary" :loading="savingIntro" @click="saveIntro">保存</el-button>
          </div>
        </section>
      </template>
    </template>

    <el-dialog v-model="proposalOpen" title="发起新建宣泄室" width="min(92vw, 440px)" append-to-body>
      <form class="th-form" @submit.prevent="propose">
        <div class="th-field">
          <label for="th-proposal-name">名称</label>
          <el-input id="th-proposal-name" v-model="proposal.name" maxlength="20" placeholder="例如：期末夸夸群" />
        </div>
        <div class="th-field">
          <span class="th-field-label">类型</span>
          <el-radio-group v-model="proposal.category">
            <el-radio-button v-for="item in ROOM_CATEGORIES" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="th-field">
          <label for="th-proposal-intro">简介</label>
          <el-input id="th-proposal-intro" v-model="proposal.intro" type="textarea" :rows="2" maxlength="120" show-word-limit placeholder="进群的同学会看到" />
        </div>
      </form>
      <template #footer>
        <el-button @click="proposalOpen = false">取消</el-button>
        <el-button type="primary" :disabled="proposal.name.trim().length < 2" :loading="proposing" @click="propose">发起联名</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { treeholeApi, type TreeholeHostOverview, type TreeholeSession } from "@/api/treehole";
import { errorText, nextShiftText, ROOM_CATEGORIES, shiftText, tagLabel, tagTone, timeText, usePolling } from "./shared";
import "./treehole.css";

const SessionRow = defineComponent({
  props: { session: { type: Object as () => TreeholeSession, required: true } },
  setup(props) {
    return () => {
      const session = props.session;
      return h(RouterLink, { class: "th-row", to: `/treehole/session/${session.id}` }, () => [
        h("div", { class: "th-row-copy" }, [
          h("div", { class: "th-row-title" }, [
            session.alias,
            h("em", { class: "th-chip" }, session.mode === "live" ? "实时" : "留言"),
            session.tag && session.tag !== "normal" ? h("em", { class: ["th-chip", tagTone(session.tag)] }, tagLabel(session.tag)) : null,
          ]),
          h("div", { class: "th-row-preview" }, session.preview || ""),
        ]),
        session.unread ? h("span", { class: "th-badge" }, String(session.unread)) : null,
        h("span", { class: "th-muted" }, timeText(session.lastMessageAt)),
      ]);
    };
  },
});

const route = useRoute();
const router = useRouter();
const overview = ref<TreeholeHostOverview | null>(null);
const loading = ref(true);
const error = ref("");
const switching = ref(false);
const intro = ref("");
const savingIntro = ref(false);
const endedSessions = ref<TreeholeSession[]>([]);
const endedTotal = ref(0);
const endedPage = ref(1);
const loadingEnded = ref(false);
const proposalOpen = ref(false);
const proposing = ref(false);
const proposal = reactive({ name: "", category: "praise", intro: "" });

type TabKey = "sessions" | "rooms" | "me";
const tab = ref<TabKey>(["rooms", "me"].includes(String(route.query.tab)) ? route.query.tab as TabKey : "sessions");

const tabs = computed(() => {
  const value = overview.value;
  const unread = value?.activeSessions.reduce((sum, session) => sum + (session.unread ? 1 : 0), 0) ?? 0;
  const pending = value?.rooms.reduce((sum, room) => sum + room.pendingApplications, 0) ?? 0;
  return [
    { key: "sessions" as const, label: "会话", badge: unread },
    { key: "rooms" as const, label: "宣泄室", badge: pending },
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
  router.replace({ query: key === "sessions" ? {} : { tab: key } });
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
  } catch (cause) {
    if (!silent) error.value = errorText(cause, "只有在任的洞主可以使用工作台");
  } finally {
    loading.value = false;
  }
}

usePolling(() => load(true), 15_000);

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
  } finally {
    switching.value = false;
  }
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

async function propose() {
  if (proposal.name.trim().length < 2) return;
  proposing.value = true;
  try {
    await treeholeApi.proposeRoom({ name: proposal.name.trim(), category: proposal.category, intro: proposal.intro.trim() });
    proposalOpen.value = false;
    Object.assign(proposal, { name: "", category: "praise", intro: "" });
    ElMessage.success("已发起，等待其他洞主联名");
    await load(true);
  } finally {
    proposing.value = false;
  }
}

async function sign(id: number) {
  const result = await treeholeApi.signProposal(id);
  if (result.created && result.roomId) {
    ElMessage.success("联名已满，宣泄室建好了");
    router.push(`/treehole/room/${result.roomId}`);
    return;
  }
  ElMessage.success(`已联名（${result.signatures}/3）`);
  await load(true);
}

async function cancelProposal(id: number) {
  const confirmed = await ElMessageBox.confirm("撤回后这个提议就作废了。", "撤回提议？", { confirmButtonText: "撤回", cancelButtonText: "取消" }).then(() => true, () => false);
  if (!confirmed) return;
  await treeholeApi.cancelProposal(id);
  await load(true);
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
</style>
