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
      <!-- 知情同意：不勾选不能使用倾诉和宣泄室 -->
      <section v-if="!me.consent.agreed" class="th-group th-consent">
        <h2 class="th-h2">进入树洞前，请先了解这些</h2>
        <ul>
          <li><strong>这是同学之间的朋辈陪伴</strong>，由艾绒朋辈心理社的志愿者“小艾绒”倾听，不等同于专业心理咨询。</li>
          <li><strong>你全程匿名。</strong>每次倾诉都会生成新的虚拟 ID，洞主看不到你的学号、姓名和手机号；每段对话严格隔离。</li>
          <li><strong>遇到危机情况</strong>，小艾绒会引导你联系学校心理发展中心，必要时转介给中心老师。</li>
          <li><strong>对话记录会留存</strong>，只有你本人、接待你的洞主和社团核心管理员可以查看，用于陪伴跟进和危机追溯。</li>
          <li>只有在评估存在严重安全风险、需要线下干预时，经两名核心管理员共同审批，才会查看你在药大拾间的账号信息，全程记录在案。</li>
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
          树洞仅面向在校同学，请先退出后用“学校账号登录”进入药大拾间。
        </div>

        <section v-if="activeSession" class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">正在进行的倾诉</h2>
          </div>
          <div class="th-rows">
            <router-link class="th-row" :to="`/treehole/session/${activeSession.id}`">
              <span class="th-dot" :class="{ 'is-on': activeSession.host.online }" aria-hidden="true" />
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ activeSession.host.name }}
                  <em class="th-chip">{{ activeSession.mode === "live" ? "实时聊天" : "留言倾诉" }}</em>
                </div>
                <div class="th-row-preview">{{ activeSession.preview || "继续聊聊吧" }}</div>
              </div>
              <span v-if="activeSession.unread" class="th-badge">{{ activeSession.unread }}</span>
              <span class="th-muted">{{ timeText(activeSession.lastMessageAt) }}</span>
            </router-link>
          </div>
        </section>

        <section v-else-if="me.canStart && me.eligible" class="th-start">
          <button type="button" class="th-start-card" @click="router.push({ path: '/treehole/new', query: { mode: 'async' } })">
            <span class="th-start-icon" data-hue="brand"><el-icon><EditPen /></el-icon></span>
            <span class="th-start-copy">
              <strong>留言倾诉</strong>
              <span>写下想说的话，可以配图。小艾绒会在值班时间回复你，对话会一直保留到你主动结束。</span>
            </span>
            <el-icon class="th-start-arrow" aria-hidden="true"><ArrowRight /></el-icon>
          </button>
          <button type="button" class="th-start-card" @click="router.push({ path: '/treehole/new', query: { mode: 'live' } })">
            <span class="th-start-icon" data-hue="violet"><el-icon><ChatDotRound /></el-icon></span>
            <span class="th-start-copy">
              <strong>
                实时聊天
                <em v-if="onlineCount !== null" class="th-chip" :class="onlineCount ? 'is-ok' : ''">{{ onlineCount ? `${onlineCount} 位在岗` : "暂无在岗" }}</em>
              </strong>
              <span>从正在值班的小艾绒里选一位，马上开始一对一聊天。</span>
            </span>
            <el-icon class="th-start-arrow" aria-hidden="true"><ArrowRight /></el-icon>
          </button>
        </section>

        <section v-if="me.rooms.length || me.applications.length" class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">我的宣泄室</h2>
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
            <div v-for="application in me.applications" :key="`a${application.id}`" class="th-row">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ application.room.name }}
                  <em class="th-chip" :class="application.status === 'pending' ? 'is-warn' : ''">
                    {{ application.status === "pending" ? "等待审核" : "未通过" }}
                  </em>
                </div>
                <p v-if="application.rejectReason" class="th-meta"><span>{{ application.rejectReason }}</span></p>
              </div>
              <el-button v-if="application.status === 'pending'" text size="small" @click="cancelApplication(application.id)">撤回申请</el-button>
            </div>
          </div>
        </section>

        <section v-if="pastSessions.length" class="th-group th-group--flush">
          <div class="th-group-head">
            <h2 class="th-h2">历史倾诉</h2>
            <span class="th-muted">只有你自己能看到这些记录</span>
          </div>
          <div class="th-rows">
            <router-link v-for="session in pastSessions" :key="session.id" class="th-row" :to="`/treehole/session/${session.id}`">
              <div class="th-row-copy">
                <div class="th-row-title">
                  {{ session.host.name }}
                  <em class="th-chip">{{ session.mode === "live" ? "实时聊天" : "留言倾诉" }}</em>
                </div>
                <p class="th-meta"><span>当时的虚拟 ID {{ session.alias }}</span><span>{{ timeText(session.createdAt) }}</span></p>
              </div>
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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowRight, ChatDotRound, EditPen } from "@element-plus/icons-vue";
import { treeholeApi, type TreeholeMe } from "@/api/treehole";
import { errorText, timeText } from "./shared";
import "./treehole.css";

const router = useRouter();
const me = ref<TreeholeMe | null>(null);
const loading = ref(false);
const error = ref("");
const agree = ref(false);
const consenting = ref(false);
const onlineCount = ref<number | null>(null);

const activeSession = computed(() => me.value?.sessions.find((session) => session.status === "active") ?? null);
const pastSessions = computed(() => me.value?.sessions.filter((session) => session.status !== "active") ?? []);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    me.value = await treeholeApi.me();
    if (me.value.consent.agreed && me.value.canStart && !activeSession.value) {
      treeholeApi.hosts()
        .then((result) => { onlineCount.value = result.hosts.filter((host) => host.online).length; })
        .catch(() => undefined);
    }
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
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

async function cancelApplication(id: number) {
  await treeholeApi.cancelApplication(id);
  ElMessage.success("申请已撤回");
  await load();
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
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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
.th-start-copy strong { display: flex; align-items: center; gap: 8px; font-size: var(--cpu-fs-l); }
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
