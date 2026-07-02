<template>
  <div class="forum-index">
    <template v-if="auth.canAccessForum">
      <h2 class="page-title">讨论板块</h2>

      <div v-if="error && !loading" class="cpu-card forum-error">
        <el-empty :description="error">
          <el-button type="primary" @click="loadBoards">重试</el-button>
        </el-empty>
      </div>

      <template v-else>
        <button type="button" class="latest-entry cpu-card" @click="$router.push('/forum/latest')">
          <div class="latest-entry-icon">🆕</div>
          <div class="latest-entry-body">
            <div class="latest-entry-title">最新内容</div>
            <div class="latest-entry-desc">按时间看看最近有哪些新帖子和新回复</div>
          </div>
          <span class="latest-entry-arrow">查看全部 →</span>
        </button>

        <div v-loading="loading" class="boards-content">
          <div class="cluster" v-if="general.length">
            <h3 class="cluster-title">💬 综合讨论</h3>
            <div class="grid">
              <div
                v-for="b in general"
                :key="b.slug"
                class="board-card"
                role="button"
                tabindex="0"
                @click="openBoard(b.slug)"
                @keydown.enter.prevent="openBoard(b.slug)"
                @keydown.space.prevent="openBoard(b.slug)"
              >
                <div class="icon" :style="{ background: b.color || '#168776' }">{{ b.icon || "💬" }}</div>
                <div class="body">
                  <div class="name">{{ b.name }}</div>
                  <div class="desc">{{ b.description }}</div>
                  <div class="meta">{{ b.topicCount }} 帖</div>
                </div>
              </div>
            </div>
          </div>

          <div class="cluster" v-if="ugc.length">
            <h3 class="cluster-title">🎒 学生共建</h3>
            <div class="grid">
              <div
                v-for="b in ugc"
                :key="b.slug"
                class="board-card"
                role="button"
                tabindex="0"
                @click="openBoard(b.slug)"
                @keydown.enter.prevent="openBoard(b.slug)"
                @keydown.space.prevent="openBoard(b.slug)"
              >
                <div class="icon" :style="{ background: b.color || '#168776' }">{{ b.icon || "🎒" }}</div>
                <div class="body">
                  <div class="name">{{ b.name }}</div>
                  <div class="desc">{{ b.description }}</div>
                  <div class="meta">{{ b.topicCount }} 帖</div>
                </div>
              </div>
            </div>
          </div>

          <div class="cluster" v-if="campusWall">
            <h3 class="cluster-title">📮 外部镜像</h3>
            <div class="grid">
              <div
                class="board-card readonly"
                role="button"
                tabindex="0"
                @click="openBoard(campusWall.slug)"
                @keydown.enter.prevent="openBoard(campusWall.slug)"
                @keydown.space.prevent="openBoard(campusWall.slug)"
              >
                <div class="icon" :style="{ background: campusWall.color || '#0ea5e9' }">{{ campusWall.icon || "📮" }}</div>
                <div class="body">
                  <div class="name">{{ campusWall.name }}</div>
                  <div class="desc">单独展示的逛逛镜像内容，不参与本站热榜和最新流；仅补充近 3 天稿件的后续更新，超过三天的稿件不再更新。</div>
                  <div class="meta">{{ campusWall.topicCount }} 帖</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="footer-tip">
        <el-icon><InfoFilled /></el-icon>
        <span>查看学校官方公告？<router-link to="/announcements">→ 校园公告</router-link></span>
      </div>
    </template>

    <template v-else>
      <section class="gate-card">
        <div class="gate-head">
          <span class="gate-badge">需手动开启</span>
          <h2>开启论坛前请先阅读说明</h2>
        </div>
        <p class="gate-intro">
          论坛内容需要先确认使用须知后才能查看和参与。阅读并确认后，你就可以正常发帖、回复和浏览讨论。
        </p>
        <div class="gate-points">
          <div>发帖和回复会经过内容审核，请理性表达。</div>
          <div>论坛与账号身份关联，请对自己的发言负责。</div>
          <div>交易、课程评价和讨论内容请自行判断。</div>
          <div>你也可以先浏览校园公告和校园服务。</div>
        </div>
        <div class="gate-actions">
          <el-button v-if="!auth.isLoggedIn" type="primary" size="large" @click="goLogin">
            登录后开启论坛
          </el-button>
          <el-button v-else type="primary" size="large" @click="openEnableDialog">
            开启论坛功能
          </el-button>
          <el-button plain size="large" @click="$router.push('/announcements')">
            先看校园公告
          </el-button>
        </div>
        <PrivacyPolicyNotice v-if="!auth.isLoggedIn" align="left" />
      </section>

      <div class="footer-tip">
        <el-icon><InfoFilled /></el-icon>
        <span>论坛未开启前，你仍可浏览 <router-link to="/announcements">校园公告</router-link> 与 <router-link to="/services">校园服务</router-link></span>
      </div>
    </template>

    <el-dialog
      v-model="enableDialogOpen"
      title="开启论坛前请先阅读"
      width="640px"
      append-to-body
      :close-on-click-modal="readSeconds <= 0"
      :close-on-press-escape="readSeconds <= 0"
      :show-close="readSeconds <= 0"
    >
      <div class="forum-notice">
        <p>开启后，你可以查看和参与论坛讨论。</p>
        <p>请文明交流，不发布人身攻击、引战、刷屏、恶意造谣或泄露隐私等内容。</p>
        <p>发帖和回复会经过内容审核，请对自己发布的内容负责。</p>
        <p>如发布违规内容，站方可能视情况删帖、限制功能、禁言或封禁账号。</p>
        <p>论坛内容仅代表发布者个人观点，交易、评价和讨论请自行判断。</p>
        <div class="forum-notice-disclaimer">
          <h3>免责声明</h3>
          <p>1. 药大拾间为学生交流平台，并非学校官方平台。</p>
          <p>2. 用户发布的内容仅代表个人观点，不代表平台立场。</p>
          <p>3. 交易、纠纷及其后果由相关用户自行承担。</p>
          <p>4. 平台可根据运营、安全和秩序需要，对内容和功能进行调整。</p>
        </div>
      </div>
      <el-form label-position="top" class="confirm-form">
        <el-form-item label="确认文字">
          <el-input v-model="confirmText" placeholder="请输入“我知道了”" maxlength="10" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <span class="read-hint">{{ readSeconds > 0 ? `请先阅读 ${readSeconds}s` : "输入“我知道了”后即可开启" }}</span>
          <div class="dialog-actions">
            <el-button :disabled="readSeconds > 0" @click="closeEnableDialog()">取消</el-button>
            <el-button
              type="primary"
              :loading="enabling"
              :disabled="enabling || readSeconds > 0 || confirmText.trim() !== '我知道了'"
              @click="confirmEnable"
            >
              确认开启论坛
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { InfoFilled } from "@element-plus/icons-vue";
import { boardApi, type Board } from "@/api/board";
import { useAuthStore } from "@/stores/auth";
import { resolveSafeRedirect } from "@/utils/redirect";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const CAMPUS_WALL_SLUG = "campus-wall";

const all = ref<Board[]>([]);
const loading = ref(false);
const error = ref("");
const enableDialogOpen = ref(false);
const enabling = ref(false);
const readSeconds = ref(0);
const confirmText = ref("");
let readTimer = 0;
let disposed = false;
let boardLoadSeq = 0;

watch(() => auth.canAccessForum, async (enabled) => {
  if (enabled) {
    confirmText.value = "";
    closeEnableDialog(true);
    await loadBoards();
  } else {
    boardLoadSeq += 1;
    all.value = [];
    error.value = "";
    loading.value = false;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  disposed = true;
  boardLoadSeq += 1;
  enabling.value = false;
  window.clearInterval(readTimer);
});

const general = computed(() => all.value.filter((b) => b.type === "normal" && b.slug !== CAMPUS_WALL_SLUG));
const ugc = computed(() => all.value.filter((b) => ["market", "question", "coursereview"].includes(b.type)));
const campusWall = computed(() => all.value.find((b) => b.slug === CAMPUS_WALL_SLUG) ?? null);

async function loadBoards() {
  if (disposed) return;
  const seq = ++boardLoadSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await boardApi.list({ suppressErrorMessage: true });
    if (disposed || seq !== boardLoadSeq) return;
    all.value = next;
  } catch (e) {
    if (disposed || seq !== boardLoadSeq) return;
    all.value = [];
    error.value = normalizeBoardListError(e);
  } finally {
    if (!disposed && seq === boardLoadSeq) loading.value = false;
  }
}

function normalizeBoardListError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "板块列表加载失败";
  }
  return "板块列表加载失败，请稍后再试";
}

function goLogin() {
  const redirect = resolveSafeRedirect(route.query.redirect, "/forum");
  router.push({ name: "login", query: { redirect } });
}

function openBoard(slug: string) {
  router.push(`/forum/b/${slug}`);
}

function openEnableDialog() {
  confirmText.value = "";
  enableDialogOpen.value = true;
  startReadTimer();
}

function closeEnableDialog(force = false) {
  if (!force && readSeconds.value > 0) return;
  enableDialogOpen.value = false;
  window.clearInterval(readTimer);
  readTimer = 0;
  readSeconds.value = 0;
}

function startReadTimer() {
  window.clearInterval(readTimer);
  readTimer = 0;
  readSeconds.value = 5;
  readTimer = window.setInterval(() => {
    readSeconds.value -= 1;
    if (readSeconds.value <= 0) {
      window.clearInterval(readTimer);
      readTimer = 0;
      readSeconds.value = 0;
    }
  }, 1000);
}

async function confirmEnable() {
  if (enabling.value) return;
  if (readSeconds.value > 0) return;
  if (confirmText.value.trim() !== "我知道了") {
    ElMessage.warning("请输入“我知道了”后继续");
    return;
  }
  enabling.value = true;
  try {
    await auth.enableForumAccess(confirmText.value.trim());
    if (disposed) return;
    const redirect = resolveSafeRedirect(route.query.redirect, "/forum");
    ElMessage.success("论坛功能已开启");
    await router.replace(redirect);
  } finally {
    if (!disposed) enabling.value = false;
  }
}
</script>

<style scoped>
.forum-index { display: flex; flex-direction: column; gap: 24px; }
.page-title { margin: 0; font-size: 22px; }
.cluster-title { margin: 0 0 12px; font-size: 16px; color: var(--cpu-text); font-weight: 600; }
.cpu-card {
  background: var(--cpu-card);
  border-radius: 14px;
  border: 1px solid var(--cpu-border-soft);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}
.boards-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 120px;
}
.forum-error {
  padding: 24px 16px;
}
.latest-entry {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.latest-entry:hover {
  border-color: var(--cpu-primary);
  transform: translateY(-1px);
  box-shadow: 0 10px 28px rgba(22, 135, 118, 0.08);
}
.latest-entry-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
  font-size: 24px;
  flex-shrink: 0;
}
.latest-entry-body {
  flex: 1;
  min-width: 0;
}
.latest-entry-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--cpu-text);
}
.latest-entry-desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--cpu-text-secondary);
  line-height: 1.55;
}
.latest-entry-arrow {
  color: var(--cpu-primary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.gate-card {
  background: linear-gradient(135deg, var(--cpu-card) 0%, var(--cpu-surface-subtle) 100%);
  border: 1px solid var(--cpu-border);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.gate-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.gate-head h2 {
  margin: 0;
  font-size: 24px;
  color: var(--cpu-text);
}

.gate-badge {
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.14);
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.gate-intro {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--cpu-text-secondary);
}

.gate-points {
  margin-top: 16px;
  display: grid;
  gap: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--cpu-text-secondary);
}

.gate-points > div {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
  border: 1px solid var(--cpu-border-soft);
}

.gate-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 12px;
}

.board-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.board-card:hover {
  border-color: var(--cpu-primary);
  box-shadow: 0 4px 14px rgba(22, 135, 118, 0.08);
}

.board-card:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

.board-card.readonly { background: linear-gradient(135deg, var(--cpu-card) 0%, rgba(16, 185, 129, 0.08) 100%); }

.footer-tip {
  margin-top: 8px;
  padding: 10px 14px;
  background: var(--cpu-surface-subtle);
  border-radius: 10px;
  font-size: 13px;
  color: var(--cpu-text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.footer-tip a {
  color: var(--cpu-primary);
  text-decoration: none;
  font-weight: 500;
}

.footer-tip a:hover { text-decoration: underline; }

.forum-notice {
  max-height: min(52dvh, 520px);
  overflow: auto;
  padding-right: 4px;
  color: var(--cpu-text-secondary);
}

.forum-notice p {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.75;
}

.forum-notice-disclaimer {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.34);
}

.forum-notice-disclaimer h3 {
  margin: 0 0 10px;
  font-size: 15px;
  color: #9a3412;
}

.forum-notice-disclaimer p:last-child,
.forum-notice p:last-child {
  margin-bottom: 0;
}

.confirm-form {
  margin-top: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.dialog-actions {
  display: flex;
  gap: 8px;
}

.read-hint {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}

.icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 20px;
  flex-shrink: 0;
  color: #fff;
}

.body { flex: 1; min-width: 0; }
.name { font-size: 15px; font-weight: 600; color: var(--cpu-text); overflow-wrap: anywhere; }

.desc {
  font-size: 12px;
  color: var(--cpu-text-secondary);
  margin-top: 2px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}

.meta {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .forum-index {
    gap: 18px;
  }

  .page-title {
    font-size: 20px;
  }

  .latest-entry {
    align-items: flex-start;
    padding: 14px;
    gap: 12px;
  }

  .latest-entry-arrow {
    display: none;
  }

  .gate-card {
    border-radius: 12px;
    padding: 18px 14px;
  }

  .gate-head h2 {
    font-size: 21px;
    line-height: 1.4;
  }

  .gate-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .dialog-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  .board-card {
    border-radius: 10px;
    padding: 12px;
  }

  .desc {
    -webkit-line-clamp: 2;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .dialog-actions {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
