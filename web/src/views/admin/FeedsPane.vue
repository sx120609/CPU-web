<template>
  <div class="feeds-pane">
    <div class="ctrl-bar cpu-button-row">
      <el-button type="primary" :loading="runningAll" :disabled="runningAll || loading" @click="runAll">
        <el-icon><Refresh /></el-icon> 全量同步
      </el-button>
      <el-button :loading="loading" :disabled="loading || runningAll" @click="reload()">刷新</el-button>
    </div>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="loadError"
    >
      <template #default>
        <el-button size="small" :loading="loading" :disabled="runningAll" @click="reload()">重试</el-button>
      </template>
    </el-alert>

    <section class="portal-card">
      <div class="portal-head">
        <div>
          <b>融合门户资讯聚合</b>
          <span>门户的资讯列表登录后才能看。学校的登录态隔一阵就会过期，存下账号密码后过期了会自动重新登录；只绑定当前登录的话，过期后要回来重新绑。</span>
        </div>
        <div class="portal-actions cpu-button-row">
          <el-button type="primary" :disabled="binding || unbinding" @click="openCredentials">
            {{ portal?.sessionAutoRelogin ? "更换账号密码" : "存账号密码自动登录" }}
          </el-button>
          <el-button :loading="binding" :disabled="binding || unbinding" @click="bindPortal">
            {{ portal?.sessionBound ? "换成我当前的登录" : "用我当前的教务登录绑定" }}
          </el-button>
          <el-button v-if="portal?.sessionBound" :loading="unbinding" :disabled="binding || unbinding" @click="unbindPortal">解除绑定</el-button>
        </div>
      </div>
      <p class="portal-state">
        <template v-if="portal?.sessionBound">
          已绑定：{{ portal.sessionUser?.nickname || portal.sessionUser?.username || "未知账号" }}
          <template v-if="portal.sessionBoundAt"> · {{ fmtRelative(portal.sessionBoundAt) }}绑定</template>
          · {{ portal.sessionAutoRelogin ? `已存 ${portal.sessionAccount} 的密码，过期自动重登` : "没存密码，过期后要重新绑定" }}
          <template v-if="portal.lastRunAt">
            · 上次同步{{ fmtRelative(portal.lastRunAt) }}
            <b :style="{ color: portal.lastRunOk ? '#16a34a' : '#dc2626' }">{{ portal.lastRunOk ? "成功" : "失败" }}</b>
          </template>
        </template>
        <template v-else>还没有绑定登录态，门户公告不会同步。</template>
      </p>
      <p v-if="portal?.sessionBound && portal.lastError" class="feed-error">{{ portal.lastError.slice(0, 160) }}</p>

      <div v-if="departments.length" class="dept-list">
        <div class="dept-title">部门默认显示（用户没自己选过部门时，“全部”和首页里有哪些部门）</div>
        <label v-for="d in departments" :key="d.id" class="dept-row">
          <el-switch :model-value="d.announceDefault" :disabled="departmentBusyId === d.id" size="small" @change="toggleDepartment(d)" />
          <span>{{ d.name }}</span>
          <em>{{ d.topicCount }} 帖</em>
        </label>
      </div>
    </section>

    <el-dialog v-model="credentialsOpen" title="存账号密码自动登录" width="420" :close-on-click-modal="false">
      <el-form label-position="top" @submit.prevent="saveCredentials">
        <el-form-item label="学号 / 工号">
          <el-input v-model.trim="credentials.username" autocomplete="off" />
        </el-form-item>
        <el-form-item label="统一认证密码">
          <el-input v-model="credentials.password" type="password" show-password autocomplete="new-password" @keyup.enter="saveCredentials" />
        </el-form-item>
        <p class="portal-hint">密码加密后存在服务器上，只用来在门户登录态过期时重新登录。改了密码要回来更新；学校拒绝登录时会自动停用，不会反复尝试。</p>
      </el-form>
      <template #footer>
        <el-button :disabled="savingCredentials" @click="credentialsOpen = false">取消</el-button>
        <el-button type="primary" :loading="savingCredentials" :disabled="!credentials.username || !credentials.password" @click="saveCredentials">登录并保存</el-button>
      </template>
    </el-dialog>

    <el-table :data="list" v-loading="loading" stripe size="default" class="admin-table">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="slug" label="slug" width="140" />
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column label="板块" width="140">
        <template #default="{ row }">
          <template v-if="row.board">{{ row.board.name }} ({{ row.board.topicCount }} 帖)</template>
          <span v-else class="muted">按部门分板块</span>
        </template>
      </el-table-column>
      <el-table-column prop="cronMinutes" label="周期(分)" width="90" align="right" />
      <el-table-column prop="maxPages" label="最多页数" width="90" align="right" />
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="isFeedBusy(row) || runningAll" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="上次" width="170">
        <template #default="{ row }">
          <span v-if="!row.lastRunAt" class="muted">—</span>
          <span v-else :style="{ color: row.lastRunOk ? '#16a34a' : '#dc2626' }">
            {{ fmtRelative(row.lastRunAt) }} · <AppIcon :name="row.lastRunOk ? 'success' : 'close'" />
          </span>
        </template>
      </el-table-column>
      <el-table-column label="错误" min-width="200">
        <template #default="{ row }">
          <span v-if="row.lastError" style="font-size:11px;color:#dc2626">{{ row.lastError.slice(0, 80) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="108" fixed="right" align="center">
        <template #default="{ row }">
          <el-dropdown trigger="click" @command="handleFeedCommand($event, row)">
            <el-button
              text
              size="small"
              class="action-trigger"
              :loading="isFeedBusy(row)"
              :disabled="runningAll"
            >
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="run" :disabled="isFeedBusy(row) || runningAll">立即同步</el-dropdown-item>
                <el-dropdown-item command="reset" :disabled="isFeedBusy(row) || runningAll" divided>
                  删除重爬
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <div class="mobile-list" v-loading="loading">
      <article v-for="row in list" :key="row.id" class="feed-card">
        <div class="feed-head">
          <div>
            <b>{{ row.name }}</b>
            <span>{{ row.slug }} · ID {{ row.id }}</span>
          </div>
          <el-switch :model-value="row.enabled" :disabled="isFeedBusy(row) || runningAll" @change="toggleEnabled(row)" />
        </div>
        <div class="feed-meta">
          <span v-if="row.board">板块：{{ row.board.name }}（{{ row.board.topicCount }} 帖）</span>
          <span v-else>板块：按部门分板块</span>
          <span>周期：{{ row.cronMinutes }} 分 · 最多 {{ row.maxPages }} 页</span>
          <span>
            上次：
            <b v-if="!row.lastRunAt" class="muted">—</b>
            <b v-else :style="{ color: row.lastRunOk ? '#16a34a' : '#dc2626' }">
              {{ fmtRelative(row.lastRunAt) }} · {{ row.lastRunOk ? '成功' : '失败' }}
            </b>
          </span>
          <span v-if="row.lastError" class="feed-error">{{ row.lastError.slice(0, 120) }}</span>
        </div>
        <div class="mobile-actions">
          <el-dropdown trigger="click" @command="handleFeedCommand($event, row)">
            <el-button
              plain
              size="small"
              class="mobile-action-trigger"
              :loading="isFeedBusy(row)"
              :disabled="runningAll"
            >
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="run" :disabled="isFeedBusy(row) || runningAll">立即同步</el-dropdown-item>
                <el-dropdown-item command="reset" :disabled="isFeedBusy(row) || runningAll" divided>
                  删除重爬
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </article>
      <el-empty v-if="!loading && !list.length" description="暂无同步源" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh, MoreFilled } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import { fmtRelative } from "@/utils/format";
import AppIcon from "@/components/common/AppIcon.vue";

const list = ref<any[]>([]);
const loading = ref(false);
const loadError = ref("");
const runningAll = ref(false);
const runningId = ref<number | null>(null);
const resettingId = ref<number | null>(null);
const togglingId = ref<number | null>(null);
const departments = ref<any[]>([]);
const departmentBusyId = ref<number | null>(null);
const binding = ref(false);
const unbinding = ref(false);
const credentialsOpen = ref(false);
const savingCredentials = ref(false);
const credentials = ref({ username: "", password: "" });
const portal = computed(() => list.value.find((row) => row.parser === "portal-notice-v1") ?? null);
let feedLoadSeq = 0;

onMounted(reload);
async function reload(force = false) {
  if (loading.value || (runningAll.value && !force)) return;
  const seq = ++feedLoadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const [next, nextDepartments] = await Promise.all([
      adminApi.feeds({ suppressErrorMessage: true }),
      adminApi.feedDepartments({ suppressErrorMessage: true }),
    ]);
    if (seq === feedLoadSeq) {
      list.value = next;
      departments.value = nextDepartments;
    }
  } catch (error) {
    if (seq === feedLoadSeq) {
      list.value = [];
      loadError.value = requestMessage(error) || "同步源列表加载失败，请稍后重试";
    }
  } finally {
    if (seq === feedLoadSeq) loading.value = false;
  }
}

async function bindPortal() {
  if (binding.value) return;
  binding.value = true;
  try {
    const r = await adminApi.bindPortalFeedSession();
    ElMessage.success(`绑定成功，门户里现有 ${r.total} 条资讯，稍后开始同步`);
    await reload(true);
  } finally { binding.value = false; }
}

function openCredentials() {
  credentials.value = { username: portal.value?.sessionAccount || "", password: "" };
  credentialsOpen.value = true;
}

async function saveCredentials() {
  if (savingCredentials.value || !credentials.value.username || !credentials.value.password) return;
  savingCredentials.value = true;
  try {
    const r = await adminApi.bindPortalFeedCredentials(credentials.value);
    credentialsOpen.value = false;
    credentials.value.password = "";
    ElMessage.success(`已保存，门户里现有 ${r.total} 条资讯，登录态过期后会自动重新登录`);
    await reload(true);
  } finally { savingCredentials.value = false; }
}

async function unbindPortal() {
  if (unbinding.value) return;
  try {
    await ElMessageBox.confirm("解除后门户公告停止同步，保存的账号密码一并删除，已同步的公告保留。", "解除绑定", { type: "warning", confirmButtonText: "解除", cancelButtonText: "取消" });
  } catch { return; }
  unbinding.value = true;
  try {
    await adminApi.unbindPortalFeedSession();
    ElMessage.success("已解除绑定");
    await reload(true);
  } finally { unbinding.value = false; }
}

async function toggleDepartment(department: any) {
  if (departmentBusyId.value !== null) return;
  departmentBusyId.value = department.id;
  try {
    await adminApi.updateFeedDepartment(department.id, { announceDefault: !department.announceDefault });
    department.announceDefault = !department.announceDefault;
  } finally { departmentBusyId.value = null; }
}

function handleFeedCommand(command: string, row: any) {
  if (command === "run") return runOne(row);
  if (command === "reset") return resetRun(row);
}

function isFeedBusy(row: any) {
  return runningId.value === row.id || resettingId.value === row.id || togglingId.value === row.id;
}

async function toggleEnabled(row: any) {
  if (isFeedBusy(row) || runningAll.value) return;
  togglingId.value = row.id;
  try {
    await adminApi.updateFeed(row.id, { enabled: !row.enabled });
    ElMessage.success(row.enabled ? "已禁用" : "已启用");
    await reload();
  } finally {
    togglingId.value = null;
  }
}

async function runOne(row: any) {
  if (isFeedBusy(row) || runningAll.value) return;
  runningId.value = row.id;
  try {
    const r = await adminApi.runFeed(row.id);
    ElMessage.success(`同步完成，新增 ${r?.newCount ?? 0} 条`);
    await reload();
  } finally { runningId.value = null; }
}

async function resetRun(row: any) {
  if (isFeedBusy(row) || runningAll.value) return;
  resettingId.value = row.id;
  try {
    await ElMessageBox.confirm(
      row.board
        ? `删除「${row.name}」已抓取的 ${row.board.topicCount ?? 0} 篇文章并重新抓取？\n用于切换到代理后重新获取正文，删除后不可恢复。`
        : `删除「${row.name}」同步来的全部文章并重新抓取？\n各部门板块保留，删除后不可恢复。`,
      "删除并重爬",
      { type: "warning", confirmButtonText: "删除重爬", cancelButtonText: "取消" }
    );
  } catch {
    resettingId.value = null;
    return;
  }
  try {
    const r = await adminApi.resetRunFeed(row.id);
    ElMessage.success(`重爬完成，新增 ${r?.newCount ?? 0} 条`);
    await reload();
  } finally { resettingId.value = null; }
}

async function runAll() {
  if (runningAll.value || loading.value) return;
  runningAll.value = true;
  try {
    const r = await adminApi.runAllFeeds();
    const total = (r as any[]).reduce((s, x) => s + (x.newCount ?? 0), 0);
    ElMessage.success(`全量同步完成，共新增 ${total} 条`);
    runningAll.value = false;
    await reload(true);
  } finally {
    runningAll.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.feeds-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; }
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.muted { color: #9ca3af; }
.portal-card { padding: 14px; border: 1px solid #e7edf5; border-radius: 14px; background: #fff; }
.portal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.portal-head b { display: block; color: #111827; font-size: 14px; }
.portal-head span { display: block; margin-top: 2px; color: #6b7280; font-size: 12px; line-height: 1.5; }
.portal-actions { display: flex; flex: none; gap: 8px; }
.portal-state { margin: 10px 0 0; color: #374151; font-size: 12px; }
.portal-hint { margin: 0; color: #6b7280; font-size: 12px; line-height: 1.6; }
.dept-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 4px 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eef2f7; }
.dept-title { grid-column: 1 / -1; color: #6b7280; font-size: 12px; }
.dept-row { display: flex; min-height: 28px; align-items: center; gap: 8px; color: #111827; font-size: 13px; }
.dept-row span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dept-row em { flex: none; color: #9ca3af; font-size: 12px; font-style: normal; }
.admin-table { display: block; }
.mobile-list {
  display: none;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 12px;
  min-height: 120px;
}
.feed-card {
  padding: 14px;
  border: 1px solid #e7edf5;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.feed-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.feed-head b {
  display: block;
  color: #111827;
  font-size: 14px;
}
.feed-head span {
  display: block;
  margin-top: 2px;
  color: #6b7280;
  font-size: 12px;
}
.feed-meta {
  display: grid;
  gap: 5px;
  margin-top: 10px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}
.feed-error { color: #dc2626; }
.mobile-actions {
  margin-top: 12px;
}
.mobile-actions :deep(.el-dropdown) {
  width: 100%;
}
.mobile-action-trigger {
  width: 100%;
}
.mobile-list :deep(.el-empty) {
  grid-column: 1 / -1;
}
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }

@media (max-width: 768px) {
  .admin-table { display: none; }
  .mobile-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .ctrl-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .portal-head { flex-direction: column; }
  .portal-actions { width: 100%; flex-wrap: wrap; }
  .ctrl-bar :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
}
</style>
