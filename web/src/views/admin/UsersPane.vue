<template>
  <div class="users-pane">
    <div class="filter-panel">
      <div class="filter-row main-row">
        <el-input v-model="q" placeholder="搜用户名 / 昵称 / 邮箱" clearable class="search-input" @keyup.enter="search">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="role" clearable placeholder="角色" class="filter-select" @change="applyFilters">
          <el-option v-for="item in roleOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="status" clearable placeholder="状态" class="filter-select" @change="applyFilters">
          <el-option label="active" value="active" />
          <el-option label="banned" value="banned" />
          <el-option label="muted" value="muted" />
        </el-select>
        <el-select v-model="forumEnabled" clearable placeholder="论坛开启" class="filter-select" @change="applyFilters">
          <el-option label="已开启" value="1" />
          <el-option label="未开启" value="0" />
        </el-select>
        <el-select v-model="usedClient" clearable placeholder="客户端" class="filter-select" @change="applyFilters">
          <el-option label="iOS 客户端" value="ios" />
          <el-option label="安卓客户端" value="android" />
          <el-option label="鸿蒙客户端" value="harmony" />
        </el-select>
        <el-select v-model="sort" placeholder="排序" class="sort-select" @change="applyFilters">
          <el-option label="最近登录优先" value="login-desc" />
          <el-option label="ID 从大到小" value="id-desc" />
          <el-option label="ID 从小到大" value="id-asc" />
        </el-select>
      </div>

      <div class="filter-row sub-row">
        <el-date-picker
          v-model="loginRange"
          type="daterange"
          range-separator="至"
          start-placeholder="登录起"
          end-placeholder="登录止"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          class="date-range"
          @change="applyFilters"
        />
        <div class="actions">
          <el-button :loading="loading" :disabled="loading" @click="reload">刷新</el-button>
          <el-button :disabled="loading" @click="resetFilters">重置</el-button>
          <el-button v-if="auth.isAdmin" type="primary" :disabled="loading || creating" @click="openCreate">
            <el-icon><Plus /></el-icon> 新增用户
          </el-button>
        </div>
      </div>
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
        <el-button size="small" :loading="loading" @click="reload">重试</el-button>
      </template>
    </el-alert>

    <el-table :data="list" v-loading="loading" stripe size="default" class="admin-table">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="用户" min-width="190">
        <template #default="{ row }">
          <div class="user-cell">
            <b>{{ row.nickname || "未设置昵称" }}</b>
            <span>{{ row.username }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="身份" width="170">
        <template #default="{ row }">
          <div class="tag-stack">
            <el-tag :type="roleTag(row.role)" size="small">{{ roleLabel(row.role) }}</el-tag>
            <el-tag :type="row.status === 'active' ? 'success' : row.status === 'banned' ? 'danger' : 'warning'" size="small" effect="plain">
              {{ row.status }}
            </el-tag>
            <el-tag v-if="row.status === 'muted' && row.mutedUntil" type="warning" size="small" effect="plain">
              至 {{ fmtDate(row.mutedUntil, "MM-DD HH:mm") }}
            </el-tag>
            <el-tag v-if="row.studentSso" type="primary" size="small" effect="plain">统一认证</el-tag>
            <el-tag v-if="row.aiReviewWhitelisted" type="success" size="small" effect="plain">AI 白名单</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="客户端 / 登录" min-width="220">
        <template #default="{ row }">
          <div class="login-info">
            <div class="login-main">
              <el-tag :type="clientTagType(row.lastLoginClient)" size="small" effect="plain">
                {{ clientLabel(row.lastLoginClient) }}
              </el-tag>
              <span class="login-time">{{ row.lastLoginAt ? fmtDate(row.lastLoginAt) : "未登录" }}</span>
            </div>
            <div class="login-flags">
              <el-tag v-if="row.usedIosClient" type="info" size="small" effect="plain">iOS</el-tag>
              <el-tag v-if="row.usedAndroidClient" type="success" size="small" effect="plain">安卓</el-tag>
              <el-tag v-if="row.usedHarmonyClient" type="warning" size="small" effect="plain">鸿蒙</el-tag>
              <span v-if="!row.usedIosClient && !row.usedAndroidClient && !row.usedHarmonyClient" class="login-empty">暂无足迹</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="内容" width="90">
        <template #default="{ row }">
          <span class="content-count">{{ row.postCount }} 帖 / {{ row.replyCount }} 回</span>
        </template>
      </el-table-column>
      <el-table-column label="匿名" width="170">
        <template #default="{ row }">
          <div class="anon-info">
            <span class="anon-main">{{ row.anonymousState?.availableCredits ?? 0 }} / {{ row.anonymousState?.weeklyQuota ?? 0 }}</span>
            <span class="anon-sub">{{ row.anonymousState?.frozen ? "已冻结" : `信誉 ${row.reputation} · Lv.${row.reputationLevel?.level ?? 1}` }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="论坛开启" width="160">
        <template #default="{ row }">
          <div class="forum-info">
            <el-tag :type="row.forumEnabled ? 'success' : 'info'" size="small" effect="plain">
              {{ row.forumEnabled ? "已开启" : "未开启" }}
            </el-tag>
            <span class="forum-time">{{ row.forumEnabledAt ? fmtDate(row.forumEnabledAt) : "未确认须知" }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="注册时间" width="150">
        <template #default="{ row }"><span class="muted-date">{{ fmtDate(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="108" fixed="right" align="center">
        <template #default="{ row }">
          <el-dropdown trigger="click" @command="handleUserCommand($event, row)">
            <el-button text size="small" class="action-trigger" :loading="isUserBusy(row)" :disabled="isUserBusy(row)">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename" :disabled="isUserBusy(row)">改名</el-dropdown-item>
                <el-dropdown-item v-if="row.status !== 'banned'" command="ban" :disabled="isUserBusy(row)">封禁</el-dropdown-item>
                <el-dropdown-item v-else command="unban" :disabled="isUserBusy(row)">解禁</el-dropdown-item>
                <el-dropdown-item v-if="row.status !== 'banned'" command="mute" :disabled="isUserBusy(row)">
                  {{ row.status === "muted" ? "调整禁言" : "禁言" }}
                </el-dropdown-item>
                <el-dropdown-item v-if="row.status === 'muted'" command="unmute" :disabled="isUserBusy(row)">取消禁言</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin" command="role" divided :disabled="isUserBusy(row)">改身份</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin" command="whitelist" :disabled="isUserBusy(row)">
                  {{ row.aiReviewWhitelisted ? "取消 AI 白名单" : "设为 AI 白名单" }}
                </el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin" command="anonymity" :disabled="isUserBusy(row)">匿名额度</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin && !row.studentSso" command="password" :disabled="isUserBusy(row)">重置密码</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin && row.id !== auth.user?.id" command="delete" divided :disabled="isUserBusy(row)">删除用户</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <div class="mobile-list" v-loading="loading">
      <article v-for="row in list" :key="row.id" class="mobile-card">
        <div class="mobile-card-head">
          <div class="user-cell">
            <b>{{ row.nickname || "未设置昵称" }}</b>
            <span>{{ row.username }} · ID {{ row.id }}</span>
          </div>
          <el-tag :type="row.status === 'active' ? 'success' : row.status === 'banned' ? 'danger' : 'warning'" size="small" effect="plain">
            {{ row.status }}
          </el-tag>
        </div>
        <div class="tag-stack">
          <el-tag :type="roleTag(row.role)" size="small">{{ roleLabel(row.role) }}</el-tag>
          <el-tag v-if="row.studentSso" type="primary" size="small" effect="plain">统一认证</el-tag>
          <el-tag v-if="row.aiReviewWhitelisted" type="success" size="small" effect="plain">AI 白名单</el-tag>
          <el-tag v-if="row.status === 'muted' && row.mutedUntil" type="warning" size="small" effect="plain">
            至 {{ fmtDate(row.mutedUntil, "MM-DD HH:mm") }}
          </el-tag>
          <el-tag :type="row.forumEnabled ? 'success' : 'info'" size="small" effect="plain">
            {{ row.forumEnabled ? "论坛已开启" : "论坛未开启" }}
          </el-tag>
          <el-tag :type="clientTagType(row.lastLoginClient)" size="small" effect="plain">
            {{ clientLabel(row.lastLoginClient) }}
          </el-tag>
          <el-tag v-if="row.usedIosClient" type="info" size="small" effect="plain">iOS</el-tag>
          <el-tag v-if="row.usedAndroidClient" type="success" size="small" effect="plain">安卓</el-tag>
          <el-tag v-if="row.usedHarmonyClient" type="warning" size="small" effect="plain">鸿蒙</el-tag>
        </div>
        <div class="mobile-meta">
          <span>登录：{{ row.lastLoginAt ? fmtDate(row.lastLoginAt) : "未登录" }}</span>
          <span>论坛：{{ row.forumEnabledAt ? fmtDate(row.forumEnabledAt) : row.forumEnabled ? "已开启" : "未确认须知" }}</span>
          <span>注册：{{ fmtDate(row.createdAt) }}</span>
          <span>信誉：{{ row.reputation }} · {{ row.reputationLevel?.name || "Lv.1" }}</span>
          <span>{{ row.postCount }} 帖 / {{ row.replyCount }} 回</span>
          <span>匿名 {{ row.anonymousState?.availableCredits ?? 0 }} / {{ row.anonymousState?.weeklyQuota ?? 0 }}{{ row.anonymousState?.frozen ? "（冻结）" : "" }}</span>
        </div>
        <div class="mobile-actions">
          <el-dropdown trigger="click" @command="handleUserCommand($event, row)">
            <el-button plain size="small" class="mobile-action-trigger" :loading="isUserBusy(row)" :disabled="isUserBusy(row)">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename" :disabled="isUserBusy(row)">改名</el-dropdown-item>
                <el-dropdown-item v-if="row.status !== 'banned'" command="ban" :disabled="isUserBusy(row)">封禁</el-dropdown-item>
                <el-dropdown-item v-else command="unban" :disabled="isUserBusy(row)">解禁</el-dropdown-item>
                <el-dropdown-item v-if="row.status !== 'banned'" command="mute" :disabled="isUserBusy(row)">
                  {{ row.status === "muted" ? "调整禁言" : "禁言" }}
                </el-dropdown-item>
                <el-dropdown-item v-if="row.status === 'muted'" command="unmute" :disabled="isUserBusy(row)">取消禁言</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin" command="role" divided :disabled="isUserBusy(row)">改身份</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin" command="whitelist" :disabled="isUserBusy(row)">
                  {{ row.aiReviewWhitelisted ? "取消 AI 白名单" : "设为 AI 白名单" }}
                </el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin" command="anonymity" :disabled="isUserBusy(row)">匿名额度</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin && !row.studentSso" command="password" :disabled="isUserBusy(row)">重置密码</el-dropdown-item>
                <el-dropdown-item v-if="auth.isAdmin && row.id !== auth.user?.id" command="delete" divided :disabled="isUserBusy(row)">删除用户</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </article>
      <el-empty v-if="!loading && !list.length" description="没有符合条件的用户" />
    </div>

    <el-pagination
      v-if="total > size"
      :current-page="page"
      :page-size="size"
      :total="total"
      layout="prev, pager, next, total"
      class="pager"
      @current-change="onPage"
    />

    <!-- 新增用户弹窗（仅 admin） -->
    <el-dialog v-model="createOpen" title="新增站内账号" width="460" :close-on-click-modal="false">
      <p class="dlg-tip">用于给新生、毕业生、站务等无法使用统一认证的用户开通账号。</p>
      <el-form :model="createForm" label-position="top" size="default">
        <el-form-item label="用户名（登录用，唯一）" required>
          <el-input v-model="createForm.username" placeholder="3-20 位英文/数字/下划线" maxlength="20" />
        </el-form-item>
        <el-form-item label="初始密码" required>
          <el-input v-model="createForm.password" type="password" show-password placeholder="至少 6 位，用户登录后建议改" maxlength="64" />
        </el-form-item>
        <el-form-item label="昵称" required>
          <el-input v-model="createForm.nickname" placeholder="显示名，支持中文" maxlength="20" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="createForm.role" style="width:100%">
            <el-option v-for="item in createRoleOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="院系（选填）">
          <el-input v-model="createForm.college" maxlength="40" />
        </el-form-item>
        <el-form-item label="入学年份（选填）">
          <el-input-number v-model="createForm.enrollYear" :min="2000" :max="2100" :step="1" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="creating" @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialogOpen" title="修改身份" width="420" append-to-body>
      <el-form label-position="top">
        <el-form-item label="用户">
          <div class="dlg-tip">{{ roleDialogTarget?.nickname }}（{{ roleDialogTarget?.username }}）</div>
        </el-form-item>
        <el-form-item label="身份">
          <el-select v-model="selectedRole" style="width:100%">
            <el-option v-for="item in roleOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="roleSaving" @click="roleDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="roleSaving" :disabled="roleSaving" @click="submitRoleChange">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="muteDialogOpen" title="设置禁言时间" width="420" append-to-body>
      <el-form label-position="top">
        <el-form-item label="用户">
          <div class="dlg-tip">{{ muteTarget?.nickname }}（{{ muteTarget?.username }}）</div>
        </el-form-item>
        <el-form-item label="快捷时长">
          <el-select v-model="muteDurationPreset" style="width:100%" @change="applyMutePreset">
            <el-option v-for="item in muteDurationOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="禁言截止时间">
          <el-date-picker
            v-model="muteUntil"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            style="width:100%"
            @change="muteDurationPreset = 'custom'"
          />
        </el-form-item>
        <div class="dlg-tip">
          {{ muteUntil ? `到期后自动解禁：${fmtDate(muteUntil)}` : "请选择晚于当前时间的截止时间" }}
        </div>
      </el-form>
      <template #footer>
        <el-button :disabled="muteSaving" @click="muteDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="muteSaving" :disabled="muteSaving" @click="submitMute">确认禁言</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="anonymityDialogOpen" title="匿名额度管理" width="440" append-to-body>
      <el-form label-position="top">
        <el-form-item label="用户">
          <div class="dlg-tip">{{ anonymityTarget?.nickname }}（{{ anonymityTarget?.username }}）</div>
        </el-form-item>
        <el-form-item label="当前信誉值">
          <div class="dlg-tip">
            {{ anonymityTarget?.reputation ?? 0 }}
            <span v-if="anonymityTarget?.reputationLevel"> · Lv.{{ anonymityTarget.reputationLevel.level }} {{ anonymityTarget.reputationLevel.name }}</span>
          </div>
        </el-form-item>
        <el-form-item label="本周剩余匿名积分">
          <el-input-number v-model="anonymityCredits" :min="0" :max="999" style="width:100%" />
        </el-form-item>
        <el-form-item label="冻结匿名积分">
          <el-switch v-model="anonymityFrozen" />
        </el-form-item>
        <div class="dlg-tip">周额度会按信誉值自动刷新；这里调整的是当前周可用积分与冻结状态。</div>
      </el-form>
      <template #footer>
        <el-button :disabled="anonymitySaving" @click="anonymityDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="anonymitySaving" :disabled="anonymitySaving" @click="submitAnonymityChange">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Search, Plus, MoreFilled } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import { useAuthStore } from "@/stores/auth";
import { fmtDate } from "@/utils/format";

const auth = useAuthStore();
const list = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const size = ref(30);
const loading = ref(false);
const loadError = ref("");
const userBusyId = ref<number | null>(null);
let userLoadSeq = 0;

const q = ref("");
const role = ref("");
const status = ref("");
const forumEnabled = ref("");
const usedClient = ref("");
const sort = ref("login-desc");
const loginRange = ref<[string, string] | [] | null>([]);

const createOpen = ref(false);
const creating = ref(false);
const roleDialogOpen = ref(false);
const roleSaving = ref(false);
const roleDialogTarget = ref<any | null>(null);
const selectedRole = ref<"user" | "mod" | "admin" | "bot">("user");
const muteDialogOpen = ref(false);
const muteSaving = ref(false);
const muteTarget = ref<any | null>(null);
const muteDurationPreset = ref("1d");
const muteUntil = ref<Date | null>(null);
const anonymityDialogOpen = ref(false);
const anonymitySaving = ref(false);
const anonymityTarget = ref<any | null>(null);
const anonymityCredits = ref(0);
const anonymityFrozen = ref(false);
const createForm = reactive({
  username: "",
  password: "",
  nickname: "",
  role: "user",
  college: "",
  enrollYear: undefined as number | undefined,
});

const roleOptions = [
  { value: "user", label: "普通用户" },
  { value: "mod", label: "论坛管理员" },
  { value: "admin", label: "超级管理员" },
  { value: "bot", label: "系统账号" },
] as const;

const createRoleOptions = roleOptions;
const muteDurationOptions = [
  { value: "1h", label: "1 小时" },
  { value: "6h", label: "6 小时" },
  { value: "1d", label: "1 天" },
  { value: "3d", label: "3 天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "custom", label: "自定义时间" },
] as const;

onMounted(reload);

async function reload() {
  const seq = ++userLoadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const r = await adminApi.users({
      q: q.value,
      role: role.value,
      status: status.value,
      forumEnabled: forumEnabled.value || undefined,
      usedClient: usedClient.value || undefined,
      loginFrom: Array.isArray(loginRange.value) && loginRange.value.length === 2 ? loginRange.value[0] : undefined,
      loginTo: Array.isArray(loginRange.value) && loginRange.value.length === 2 ? loginRange.value[1] : undefined,
      sort: sort.value,
      page: page.value,
      size: size.value,
    }, { suppressErrorMessage: true });
    if (seq !== userLoadSeq) return;
    list.value = r.list;
    total.value = r.total;
  } catch (error) {
    if (seq !== userLoadSeq) return;
    list.value = [];
    total.value = 0;
    loadError.value = requestMessage(error) || "用户列表加载失败，请稍后重试";
  } finally {
    if (seq === userLoadSeq) loading.value = false;
  }
}

function onPage(p: number) { page.value = p; reload(); }

function search() {
  page.value = 1;
  reload();
}

function applyFilters() {
  page.value = 1;
  reload();
}

function resetFilters() {
  if (loading.value) return;
  q.value = "";
  role.value = "";
  status.value = "";
  forumEnabled.value = "";
  usedClient.value = "";
  sort.value = "login-desc";
  loginRange.value = [];
  page.value = 1;
  reload();
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function openCreate() {
  if (creating.value) return;
  Object.assign(createForm, {
    username: "", password: "", nickname: "",
    role: "user", college: "", enrollYear: undefined,
  });
  createOpen.value = true;
}

async function submitCreate() {
  if (creating.value) return;
  const u = createForm.username.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) { ElMessage.warning("用户名 3-20 位英文/数字/下划线"); return; }
  if (createForm.password.length < 6) { ElMessage.warning("初始密码至少 6 位"); return; }
  if (!createForm.nickname.trim()) { ElMessage.warning("请填写昵称"); return; }
  creating.value = true;
  try {
    await adminApi.createUser({
      username: u,
      password: createForm.password,
      nickname: createForm.nickname.trim(),
      role: createForm.role,
      college: createForm.college.trim() || undefined,
      enrollYear: createForm.enrollYear,
    });
    ElMessage.success(`已创建账号 ${u}，密码请妥善转交给用户`);
    createOpen.value = false;
    await reload();
  } finally { creating.value = false; }
}

function roleTag(r: string): "danger" | "warning" | "primary" | "info" {
  if (r === "admin") return "danger";
  if (r === "mod") return "warning";
  if (r === "bot") return "info";
  return "primary";
}

function roleLabel(r: string) {
  return roleOptions.find((item) => item.value === r)?.label ?? r;
}

function clientLabel(client?: string | null) {
  if (client === "ios") return "iOS 客户端";
  if (client === "android") return "安卓客户端";
  if (client === "harmony") return "鸿蒙客户端";
  if (client === "web") return "网页";
  if (client === "unknown") return "未知";
  return "未登录";
}

function clientTagType(client?: string | null): "success" | "warning" | "info" | "danger" | "primary" {
  if (client === "ios") return "success";
  if (client === "android") return "warning";
  if (client === "harmony") return "success";
  if (client === "web") return "primary";
  if (client === "unknown") return "info";
  return "info";
}

function handleUserCommand(command: string, row: any) {
  if (userBusyId.value !== null) return;
  if (command === "rename") return rename(row);
  if (command === "ban") return ban(row);
  if (command === "unban") return unban(row);
  if (command === "mute") return openMuteDialog(row);
  if (command === "unmute") return unmute(row);
  if (command === "role") return changeRole(row);
  if (command === "whitelist") return toggleAiWhitelist(row);
  if (command === "anonymity") return changeAnonymity(row);
  if (command === "password") return resetPw(row);
  if (command === "delete") return deleteUser(row);
}

function applyUserUpdate(row: any, patch: Record<string, unknown>) {
  Object.assign(row, patch);
}

function isUserBusy(row: any) {
  return userBusyId.value === row.id;
}

async function runUserAction(row: any, action: () => Promise<void>) {
  if (userBusyId.value !== null) return;
  userBusyId.value = row.id;
  try {
    await action();
  } finally {
    userBusyId.value = null;
  }
}

async function rename(row: any) {
  await runUserAction(row, async () => {
    const { value } = await ElMessageBox.prompt(`修改 ${row.username} 的昵称`, "改昵称", {
      inputValue: row.nickname,
      inputValidator: (v) => v.trim().length >= 1 && v.trim().length <= 20,
      inputErrorMessage: "昵称长度 1-20",
    }).catch(() => ({ value: "" }));
    if (!value) return;
    await adminApi.updateUser(row.id, { nickname: value.trim() });
    ElMessage.success("已修改");
    await reload();
  });
}

async function ban(row: any) {
  await runUserAction(row, async () => {
    const confirmed = await ElMessageBox.confirm(
      `封禁 ${row.nickname || row.username}？封禁后该用户将无法登录和发言。`,
      "确认",
      { type: "warning" }
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
    const patch = await adminApi.updateUser(row.id, { status: "banned" });
    applyUserUpdate(row, patch);
    ElMessage.success("已封禁");
    await reload();
  });
}

async function unban(row: any) {
  await runUserAction(row, async () => {
    const patch = await adminApi.updateUser(row.id, { status: "active" });
    applyUserUpdate(row, patch);
    ElMessage.success("已解禁");
    await reload();
  });
}

function minutesFromPreset(value: string) {
  if (value === "1h") return 60;
  if (value === "6h") return 360;
  if (value === "1d") return 1440;
  if (value === "3d") return 4320;
  if (value === "7d") return 10080;
  if (value === "30d") return 43200;
  return 0;
}

function buildMuteUntil(minutes: number) {
  const target = new Date();
  target.setMinutes(target.getMinutes() + minutes);
  return target;
}

function applyMutePreset(value: string) {
  const minutes = minutesFromPreset(value);
  if (!minutes) return;
  muteUntil.value = buildMuteUntil(minutes);
}

function openMuteDialog(row: any) {
  if (userBusyId.value !== null) return;
  muteTarget.value = row;
  const existing = row.mutedUntil ? new Date(row.mutedUntil) : null;
  if (existing && !Number.isNaN(existing.getTime()) && existing.getTime() > Date.now()) {
    muteUntil.value = existing;
    muteDurationPreset.value = "custom";
  } else {
    muteDurationPreset.value = "1d";
    muteUntil.value = buildMuteUntil(minutesFromPreset("1d"));
  }
  muteDialogOpen.value = true;
}

async function submitMute() {
  if (muteSaving.value || !muteTarget.value) return;
  if (!muteUntil.value || Number.isNaN(muteUntil.value.getTime())) {
    ElMessage.warning("请选择禁言截止时间");
    return;
  }
  if (muteUntil.value.getTime() <= Date.now()) {
    ElMessage.warning("禁言截止时间必须晚于当前时间");
    return;
  }
  muteSaving.value = true;
  userBusyId.value = muteTarget.value.id;
  try {
    const mutedUntilIso = muteUntil.value.toISOString();
    const patch = await adminApi.updateUser(muteTarget.value.id, {
      status: "muted",
      mutedUntil: mutedUntilIso,
    });
    applyUserUpdate(muteTarget.value, patch);
    muteDialogOpen.value = false;
    ElMessage.success("已设置禁言");
    await reload();
  } finally {
    muteSaving.value = false;
    userBusyId.value = null;
  }
}

async function unmute(row: any) {
  await runUserAction(row, async () => {
    const patch = await adminApi.updateUser(row.id, { status: "active" });
    applyUserUpdate(row, patch);
    ElMessage.success("已取消禁言");
    await reload();
  });
}

async function changeRole(row: any) {
  if (userBusyId.value !== null) return;
  roleDialogTarget.value = row;
  selectedRole.value = row.role;
  roleDialogOpen.value = true;
}

function changeAnonymity(row: any) {
  if (userBusyId.value !== null) return;
  anonymityTarget.value = row;
  anonymityCredits.value = row.anonymousState?.availableCredits ?? row.anonymousCredits ?? 0;
  anonymityFrozen.value = Boolean(row.anonymousState?.frozen ?? row.anonymousCreditsFrozen);
  anonymityDialogOpen.value = true;
}

async function submitRoleChange() {
  if (roleSaving.value || !roleDialogTarget.value) return;
  roleSaving.value = true;
  userBusyId.value = roleDialogTarget.value.id;
  try {
    await adminApi.updateUser(roleDialogTarget.value.id, { role: selectedRole.value });
    ElMessage.success("已修改身份");
    roleDialogOpen.value = false;
    await reload();
  } finally {
    roleSaving.value = false;
    userBusyId.value = null;
  }
}

async function submitAnonymityChange() {
  if (anonymitySaving.value || !anonymityTarget.value) return;
  anonymitySaving.value = true;
  userBusyId.value = anonymityTarget.value.id;
  try {
    const patch = await adminApi.updateUser(anonymityTarget.value.id, {
      anonymousCredits: Number(anonymityCredits.value || 0),
      anonymousCreditsFrozen: anonymityFrozen.value,
    });
    applyUserUpdate(anonymityTarget.value, patch);
    anonymityDialogOpen.value = false;
    ElMessage.success("已更新匿名额度");
  } finally {
    anonymitySaving.value = false;
    userBusyId.value = null;
  }
}

async function toggleAiWhitelist(row: any) {
  await runUserAction(row, async () => {
    await adminApi.updateUser(row.id, { aiReviewWhitelisted: !row.aiReviewWhitelisted });
    ElMessage.success(row.aiReviewWhitelisted ? "已取消 AI 白名单" : "已加入 AI 白名单");
    await reload();
  });
}

async function resetPw(row: any) {
  await runUserAction(row, async () => {
    const { value } = await ElMessageBox.prompt(
      `为 ${row.nickname}（${row.username}）设置新密码（至少 6 位）`,
      "重置密码",
      {
        inputType: "password",
        inputValidator: (v) => !!v && v.length >= 6 && v.length <= 64,
        inputErrorMessage: "密码 6-64 位",
        confirmButtonText: "重置",
      }
    ).catch(() => ({ value: null as any }));
    if (!value) return;
    await adminApi.resetUserPassword(row.id, value);
    ElMessage.success(`已重置 ${row.username} 的密码，请妥善告知本人`);
  });
}

async function deleteUser(row: any) {
  await runUserAction(row, async () => {
    const { value } = await ElMessageBox.prompt(
      `此操作会永久删除用户 ${row.nickname || row.username}（${row.username}）及其帖子、回复、点赞、课程评分和消息记录。\n请输入账号 ${row.username} 确认删除。`,
      "删除用户",
      {
        inputPlaceholder: row.username,
        inputValidator: (v) => v.trim() === row.username,
        inputErrorMessage: "请输入完整账号以确认删除",
        confirmButtonText: "永久删除",
        cancelButtonText: "取消",
        type: "warning",
      }
    ).catch(() => ({ value: null as any }));
    if (!value) return;
    const result = await adminApi.deleteUser(row.id);
    ElMessage.success(`已删除 ${row.username}，同时删除 ${result.deletedTopics} 个帖子、${result.deletedReplies} 条回复`);
    if (list.value.length === 1 && page.value > 1) page.value -= 1;
    await reload();
  });
}
</script>

<style scoped>
.users-pane { display: flex; flex-direction: column; gap: 12px; }
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.filter-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
}
.filter-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.main-row { align-items: stretch; }
.sub-row { justify-content: space-between; }
.search-input { width: 240px; }
.filter-select { width: 132px; }
.sort-select { width: 150px; }
.date-range { width: 250px; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-left: auto; }
.pager { display: flex; justify-content: center; padding-top: 12px; }
.dlg-tip { font-size: 12px; color: var(--cpu-text-secondary); margin: 0 0 12px; }
.user-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.user-cell b { font-size: 14px; color: var(--cpu-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-cell span { font-size: 12px; color: var(--cpu-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag-stack { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.login-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.login-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.login-flags { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; min-width: 0; }
.login-time { font-size: 12px; color: var(--cpu-text-secondary); }
.login-empty { font-size: 12px; color: #9ca3af; }
.anon-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.anon-main { font-size: 13px; font-weight: 600; color: var(--cpu-text); }
.anon-sub { font-size: 12px; color: var(--cpu-text-secondary); }
.content-count,
.muted-date { font-size: 12px; color: var(--cpu-text-secondary); }
.forum-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.forum-time { font-size: 12px; color: var(--cpu-text-secondary); }
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }
.admin-table { display: block; }
.mobile-list {
  display: none;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 12px;
  min-height: 120px;
}
.mobile-card {
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.mobile-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.mobile-meta {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
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

@media (max-width: 768px) {
  .admin-table { display: none; }
  .filter-panel { padding: 10px; }
  .filter-row,
  .actions { width: 100%; }
  .search-input,
  .filter-select,
  .sort-select,
  .date-range { width: 100%; }
  .actions { justify-content: flex-start; margin-left: 0; }
  .actions :deep(.el-button) { flex: 1; min-width: 96px; margin-left: 0; }
  .mobile-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .pager { overflow-x: auto; justify-content: flex-start; padding-bottom: 2px; }
  .users-pane :deep(.el-dialog) {
    width: 100% !important;
    margin-top: 5dvh;
  }
}
</style>
