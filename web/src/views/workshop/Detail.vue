<template>
  <div class="wk-page wk-page--narrow wk-detail">
    <router-link class="wk-back" to="/workshop">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>创意工坊
    </router-link>

    <div v-if="loading" class="wk-group" role="status" aria-label="正在加载作品">
      <el-skeleton :rows="5" animated />
    </div>
    <div v-else-if="error" class="wk-group wk-empty" role="alert">
      <p>{{ error }}</p>
      <el-button @click="load">重试</el-button>
    </div>
    <template v-else-if="work && version">
      <section class="wk-group wk-detail-hero">
        <div class="wk-detail-top">
          <WorkIcon :slug="work.slug" :name="version.name" :type="version.type" :size="80" />
          <div class="wk-detail-copy">
            <h1>{{ version.name }}</h1>
            <p class="wk-meta">
              <router-link :to="`/u/${work.author.id}`">{{ work.author.nickname }}</router-link>
              <span>{{ typeLabels[version.type] }}</span>
              <span>v{{ version.version }}</span>
              <span>{{ workshopAgo(work.updatedAt) }}更新</span>
            </p>
            <em v-if="!canUse" class="wk-chip" :class="`is-${state.tone}`">{{ state.label }}</em>
          </div>
        </div>
        <div class="wk-detail-actions">
          <el-button
            v-if="canUse"
            class="wk-detail-open"
            type="primary"
            size="large"
            @click="router.push(playerPath(work.id))"
            >{{ openLabels[version.type] }}</el-button
          >
          <el-button
            v-else-if="canManage"
            class="wk-detail-open"
            size="large"
            :disabled="work.disabled"
            @click="router.push(playerPath(work.id, version.id))"
            >预览这个版本</el-button
          >
          <el-button
            size="large"
            :loading="favoriteBusy"
            :aria-pressed="work.isFavorited"
            @click="toggleFavorite"
          >
            <el-icon class="wk-detail-star" :class="{ 'is-on': work.isFavorited }">
              <component :is="work.isFavorited ? StarFilled : Star" />
            </el-icon>
            {{ work.isFavorited ? "已收藏" : "收藏" }} {{ work.favoriteCount || "" }}
          </el-button>
          <el-button v-if="canUse" size="large" @click="share">分享</el-button>
        </div>
        <p v-if="!canUse" class="wk-note">
          {{
            work.disabled
              ? "这个作品已被管理员停用，暂时不能使用。"
              : canManage
                ? "这个作品还没有公开。审核通过后，其他同学才能看到并使用。"
                : "这个作品还没有公开。"
          }}
        </p>
      </section>

      <section class="wk-group">
        <h2 class="wk-h2">介绍</h2>
        <p class="wk-text wk-detail-text">{{ version.description }}</p>
      </section>

      <section v-if="hasBoard" class="wk-group wk-group--flush">
        <div class="wk-group-head">
          <div>
            <h2 class="wk-h2">排行榜</h2>
            <p class="wk-sub">{{ boardHint }}</p>
          </div>
        </div>
        <ol v-if="board?.entries.length" class="wk-detail-board">
          <li v-for="entry in board.entries" :key="entry.rank" :class="{ 'is-me': entry.me }">
            <b :class="{ 'is-first': entry.rank === 1 }">{{ entry.rank }}</b>
            <span>{{ entry.nickname }}</span>
            <strong>{{ entry.score }}</strong>
          </li>
        </ol>
        <p v-if="board?.me && !board.entries.some((entry) => entry.me)" class="wk-detail-board-me">
          你排第 {{ board.me.rank }} 名，最好成绩 {{ board.me.score }} 分
        </p>
      </section>

      <section class="wk-group">
        <h2 class="wk-h2">信息</h2>
        <dl class="wk-facts wk-detail-facts">
          <template v-if="version.manifest.game">
            <dt>操作方式</dt>
            <dd>{{ controlsText(version) }}</dd>
            <dt>屏幕方向</dt>
            <dd>{{ orientationText(version) }}</dd>
          </template>
          <dt>进度保存</dt>
          <dd>
            {{
              version.manifest.permissions?.includes("storage")
                ? auth.isLoggedIn
                  ? "保存在你的账号里，换设备也在"
                  : "访客进度只保存在这台设备，登录后跟随账号"
                : "不保存进度"
            }}
          </dd>
          <dt>可以做的事</dt>
          <dd>
            <template v-if="permissions.length">
              <span v-for="item in permissions" :key="item" class="wk-detail-permission">{{ item }}</span>
            </template>
            <template v-else>只在自己的窗口里运行</template>
          </dd>
          <dt>运行方式</dt>
          <dd>在隔离的窗口里运行，读不到你的账号、课表和成绩。</dd>
        </dl>
      </section>

      <section v-if="canManage && work.versions?.length" class="wk-group wk-group--flush">
        <div class="wk-group-head">
          <div>
            <h2 class="wk-h2">版本</h2>
            <p class="wk-sub">只有作者和管理员能看到这一栏。</p>
          </div>
          <el-button v-if="isAuthor" @click="router.push('/workshop/mine')">去我的作品管理</el-button>
        </div>
        <div class="wk-rows">
          <div v-for="item in work.versions" :key="item.id" class="wk-row">
            <div class="wk-row-copy">
              <div class="wk-row-title">
                <span>v{{ item.version }}</span>
                <em class="wk-chip" :class="`is-${statusTone[item.status]}`">{{ statusLabels[item.status] }}</em>
                <em v-if="item.id === work.publishedVersionId" class="wk-chip is-ok">公开中</em>
              </div>
              <p class="wk-meta"><span>{{ workshopDate(item.createdAt) }} 上传</span></p>
              <p v-if="item.reviewReason" class="wk-note is-danger wk-detail-reason">审核意见：{{ item.reviewReason }}</p>
            </div>
            <el-button :disabled="work.disabled" @click="router.push(playerPath(work.id, item.id))">预览</el-button>
          </div>
        </div>
      </section>

      <button type="button" class="wk-detail-report" @click="openReport">
        <el-icon aria-hidden="true"><Warning /></el-icon>举报这个作品
      </button>
    </template>
    <div v-else class="wk-group wk-empty"><p>作品没有可显示的版本</p></div>

    <el-dialog v-model="reportOpen" class="wk-dialog" title="举报作品" width="min(480px, 92vw)">
      <p class="wk-sub wk-detail-report-hint">说明作品里有什么问题，管理员会来核查。</p>
      <el-input
        v-model="reportReason"
        type="textarea"
        :rows="4"
        maxlength="1000"
        show-word-limit
        placeholder="至少 5 个字"
        aria-label="举报原因"
      />
      <template #footer>
        <el-button @click="reportOpen = false">取消</el-button>
        <el-button
          type="primary"
          :loading="reportBusy"
          :disabled="reportReason.trim().length < 5"
          @click="sendReport"
          >提交举报</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft, Star, StarFilled, Warning } from "@element-plus/icons-vue";
import { workshopApi, type WorkshopLeaderboard, type WorkshopWork } from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import WorkIcon from "./WorkIcon.vue";
import { useDocumentTitle } from "@/utils/documentTitle";
import {
  controlsText,
  openLabels,
  orientationText,
  permissionList,
  playerPath,
  statusLabels,
  statusTone,
  typeLabels,
  workState,
  workshopAgo,
  workshopDate,
  workshopError,
} from "./shared";
import "./workshop.css";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const work = ref<WorkshopWork | null>(null);
const version = computed(
  () =>
    work.value?.versions?.find((item) => item.id === work.value?.publishedVersionId) ||
    work.value?.version ||
    work.value?.versions?.[0],
);
useDocumentTitle(() => version.value?.name);
const isAuthor = computed(() => !!work.value && auth.user?.id === work.value.author.id);
const canManage = computed(() => isAuthor.value || (!!work.value && auth.user?.role === "admin"));
const canUse = computed(() => !!work.value?.publishedVersionId && !work.value.disabled);
const state = computed(() => workState(work.value!));
// 存档单独一行说明，这里列其余的权限。
const permissions = computed(() =>
  permissionList(version.value?.manifest.permissions?.filter((item) => item !== "storage")),
);
// 排行榜只在公开运行时记录，所以只给能打开的作品显示。
const hasBoard = computed(
  () => canUse.value && Boolean(version.value?.manifest.permissions?.includes("leaderboard")),
);
const board = ref<WorkshopLeaderboard | null>(null);
const boardFailed = ref(false);
const boardHint = computed(() => {
  if (boardFailed.value) return "暂时读不到，稍后再试";
  if (!board.value) return "正在读取…";
  if (!board.value.total) return "还没有人上榜，来当第一个";
  const scope = board.value.total > board.value.entries.length ? `前 ${board.value.entries.length} 名，共 ${board.value.total} 人上榜` : `共 ${board.value.total} 人上榜`;
  return auth.isLoggedIn ? scope : `${scope} · 登录后成绩才会计入`;
});
const loading = ref(true);
const error = ref("");
const favoriteBusy = ref(false);
const reportOpen = ref(false);
const reportReason = ref("");
const reportBusy = ref(false);
let requestId = 0;

async function share() {
  if (!work.value || !version.value) return;
  const url = new URL(`/workshop/${work.value.id}`, window.location.origin).href;
  try {
    if (navigator.share) {
      await navigator.share({ title: version.value.name, url });
    } else {
      await navigator.clipboard.writeText(url);
      ElMessage.success("作品链接已复制");
    }
  } catch (cause) {
    if (!(cause instanceof DOMException && cause.name === "AbortError")) {
      ElMessage.info("请复制浏览器地址分享此作品");
    }
  }
}
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = "";
  work.value = null;
  try {
    const data = await workshopApi.detail(String(route.params.id));
    if (id !== requestId) return;
    work.value = data;
    board.value = null;
    boardFailed.value = false;
    if (hasBoard.value)
      workshopApi.leaderboard(data.id, { limit: 10 }).then(
        (result) => {
          if (id === requestId) board.value = result;
        },
        () => {
          if (id === requestId) boardFailed.value = true;
        },
      );
  } catch (e) {
    if (id === requestId) error.value = workshopError(e, "作品不存在或暂时无法访问");
  } finally {
    if (id === requestId) loading.value = false;
  }
}
async function requireLogin() {
  if (auth.isLoggedIn) return true;
  await router.push({ name: "login", query: { redirect: route.fullPath } });
  return false;
}
async function toggleFavorite() {
  if (!work.value || favoriteBusy.value || !(await requireLogin())) return;
  const current = work.value;
  favoriteBusy.value = true;
  try {
    if (current.isFavorited) await workshopApi.unfavorite(current.id);
    else await workshopApi.favorite(current.id);
    current.isFavorited = !current.isFavorited;
    current.favoriteCount = Math.max(0, current.favoriteCount + (current.isFavorited ? 1 : -1));
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    favoriteBusy.value = false;
  }
}
async function openReport() {
  if (await requireLogin()) {
    reportReason.value = "";
    reportOpen.value = true;
  }
}
async function sendReport() {
  const reason = reportReason.value.trim();
  if (!work.value || reason.length < 5 || reportBusy.value) return;
  reportBusy.value = true;
  try {
    await workshopApi.report(work.value.id, reason);
    reportOpen.value = false;
    ElMessage.success("举报已提交，感谢你的反馈");
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    reportBusy.value = false;
  }
}
watch(() => route.params.id, load, { immediate: true });
</script>

<style scoped>
.wk-detail-hero {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.wk-detail-top {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 16px;
}
.wk-detail-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.wk-detail-copy h1 {
  margin: 0;
  font-size: var(--cpu-fs-xxl);
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.wk-detail-copy .wk-meta { font-size: var(--cpu-fs-s); }
.wk-detail-copy .wk-meta a { color: var(--cpu-primary); font-weight: 500; }
.wk-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wk-detail-actions .el-button + .el-button { margin-left: 0; }
.wk-detail-open { min-width: 160px; }
.wk-detail-star { margin-right: 4px; }
.wk-detail-star.is-on { color: var(--cpu-hue-amber-ink); }
.wk-detail-text { margin-top: 8px; }
.wk-detail-facts { margin-top: 10px; }
.wk-detail-permission { display: block; }
.wk-detail-reason { margin-top: 6px; }
.wk-detail-board {
  margin: 0;
  padding: 0;
  list-style: none;
}
.wk-detail-board li {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 9px 16px;
  border-top: 1px solid var(--cpu-border-soft);
  font-size: var(--cpu-fs-m);
}
.wk-detail-board li.is-me { background: var(--cpu-primary-soft); }
.wk-detail-board b {
  width: 24px;
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-l);
  font-weight: 700;
  text-align: center;
}
.wk-detail-board b.is-first { color: var(--cpu-hue-amber-ink); }
.wk-detail-board span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wk-detail-board strong { flex: 0 0 auto; font-weight: 600; font-variant-numeric: tabular-nums; }
.wk-detail-board-me {
  margin: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}
.wk-detail-report {
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: 4px;
  padding: 4px 8px;
  border: 0;
  background: none;
  color: var(--cpu-text-muted);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
}
.wk-detail-report-hint { margin: 0 0 10px; }
@media (max-width: 600px) {
  .wk-detail-top { gap: 12px; }
  .wk-detail-open { flex: 1 1 100%; }
  .wk-detail-actions .el-button:not(.wk-detail-open) { flex: 1; }
}
</style>
