<template>
  <div class="users-pane">
    <div class="filter-panel">
      <div class="filter-row main-row">
        <el-input v-model="q" placeholder="搜用户名 / 昵称 / 邮箱" clearable class="search-input" @keyup.enter="search">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="role" clearable placeholder="角色" class="filter-select" @change="applyFilters">
          <el-option label="user" value="user" />
          <el-option label="mod" value="mod" />
          <el-option label="admin" value="admin" />
          <el-option label="bot" value="bot" />
        </el-select>
        <el-select v-model="status" clearable placeholder="状态" class="filter-select" @change="applyFilters">
          <el-option label="active" value="active" />
          <el-option label="banned" value="banned" />
          <el-option label="muted" value="muted" />
        </el-select>
        <el-select v-model="usedClient" clearable placeholder="客户端" class="filter-select" @change="applyFilters">
          <el-option label="iOS 客户端" value="ios" />
          <el-option label="安卓客户端" value="android" />
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
          <el-button @click="reload">刷新</el-button>
          <el-button @click="resetFilters">重置</el-button>
          <el-button v-if="auth.isAdmin" type="primary" @click="openCreate">
            <el-icon><Plus /></el-icon> 新增用户
          </el-button>
        </div>
      </div>
    </div>

    <el-table :data="list" v-loading="loading" stripe size="default">
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
            <el-tag :type="roleTag(row.role)" size="small">{{ row.role }}</el-tag>
            <el-tag :type="row.status === 'active' ? 'success' : row.status === 'banned' ? 'danger' : 'warning'" size="small" effect="plain">
              {{ row.status }}
            </el-tag>
            <el-tag v-if="row.studentSso" type="primary" size="small" effect="plain">统一认证</el-tag>
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
              <span v-if="!row.usedIosClient && !row.usedAndroidClient" class="login-empty">暂无足迹</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="内容" width="90">
        <template #default="{ row }">
          <span class="content-count">{{ row.postCount }} 帖 / {{ row.replyCount }} 回</span>
        </template>
      </el-table-column>
      <el-table-column label="注册时间" width="150">
        <template #default="{ row }"><span class="muted-date">{{ fmtDate(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'active'" text type="danger" size="small" @click="ban(row)">封禁</el-button>
          <el-button v-else text type="success" size="small" @click="unban(row)">解禁</el-button>
          <el-button text size="small" @click="rename(row)">改名</el-button>
          <el-dropdown v-if="auth.isAdmin" trigger="click" @command="handleCommand($event, row)">
            <el-button text size="small">
              更多<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="role">改角色</el-dropdown-item>
                <el-dropdown-item v-if="!row.studentSso" command="password">重置密码</el-dropdown-item>
                <el-dropdown-item v-if="row.id !== auth.user?.id" command="delete" divided>删除用户</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

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
            <el-option label="user（普通用户）" value="user" />
            <el-option label="mod（版主）" value="mod" />
            <el-option label="admin（管理员）" value="admin" />
            <el-option label="bot（系统账号）" value="bot" />
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
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
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

const q = ref("");
const role = ref("");
const status = ref("");
const usedClient = ref("");
const sort = ref("login-desc");
const loginRange = ref<[string, string] | [] | null>([]);

const createOpen = ref(false);
const creating = ref(false);
const createForm = reactive({
  username: "",
  password: "",
  nickname: "",
  role: "user",
  college: "",
  enrollYear: undefined as number | undefined,
});

onMounted(reload);

async function reload() {
  loading.value = true;
  try {
    const r = await adminApi.users({
      q: q.value,
      role: role.value,
      status: status.value,
      usedClient: usedClient.value || undefined,
      loginFrom: Array.isArray(loginRange.value) && loginRange.value.length === 2 ? loginRange.value[0] : undefined,
      loginTo: Array.isArray(loginRange.value) && loginRange.value.length === 2 ? loginRange.value[1] : undefined,
      sort: sort.value,
      page: page.value,
      size: size.value,
    });
    list.value = r.list;
    total.value = r.total;
  } finally { loading.value = false; }
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
  q.value = "";
  role.value = "";
  status.value = "";
  usedClient.value = "";
  sort.value = "login-desc";
  loginRange.value = [];
  page.value = 1;
  reload();
}

function openCreate() {
  Object.assign(createForm, {
    username: "", password: "", nickname: "",
    role: "user", college: "", enrollYear: undefined,
  });
  createOpen.value = true;
}

async function submitCreate() {
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

function clientLabel(client?: string | null) {
  if (client === "ios") return "iOS 客户端";
  if (client === "android") return "安卓客户端";
  if (client === "web") return "网页";
  if (client === "unknown") return "未知";
  return "未登录";
}

function clientTagType(client?: string | null): "success" | "warning" | "info" | "danger" | "primary" {
  if (client === "ios") return "success";
  if (client === "android") return "warning";
  if (client === "web") return "primary";
  if (client === "unknown") return "info";
  return "info";
}

function handleCommand(command: string, row: any) {
  if (command === "role") return changeRole(row);
  if (command === "password") return resetPw(row);
  if (command === "delete") return deleteUser(row);
}

async function ban(row: any) {
  await ElMessageBox.confirm(`封禁 ${row.nickname} (${row.username})？`, "确认", { type: "warning" });
  await adminApi.updateUser(row.id, { status: "banned" });
  ElMessage.success("已封禁");
  reload();
}
async function unban(row: any) {
  await adminApi.updateUser(row.id, { status: "active" });
  ElMessage.success("已解禁");
  reload();
}
async function rename(row: any) {
  const { value } = await ElMessageBox.prompt(`修改 ${row.username} 的昵称`, "改昵称", {
    inputValue: row.nickname,
    inputValidator: (v) => v.trim().length >= 1 && v.trim().length <= 20,
    inputErrorMessage: "昵称长度 1-20",
  });
  await adminApi.updateUser(row.id, { nickname: value.trim() });
  ElMessage.success("已修改");
  reload();
}
async function changeRole(row: any) {
  const { value } = await ElMessageBox.prompt(
    `修改 ${row.nickname} 的角色（当前 ${row.role}）。仅可填 user / mod / admin / bot`,
    "改角色",
    { inputValue: row.role, inputValidator: (v) => ["user", "mod", "admin", "bot"].includes(v) }
  );
  await adminApi.updateUser(row.id, { role: value });
  ElMessage.success("已修改");
  reload();
}

async function resetPw(row: any) {
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
}

async function deleteUser(row: any) {
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
}
</script>

<style scoped>
.users-pane { display: flex; flex-direction: column; gap: 12px; }
.filter-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafbfc;
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
.dlg-tip { font-size: 12px; color: #6b7280; margin: 0 0 12px; }
.user-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.user-cell b { font-size: 14px; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-cell span { font-size: 12px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag-stack { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.login-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.login-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.login-flags { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; min-width: 0; }
.login-time { font-size: 12px; color: #4b5563; }
.login-empty { font-size: 12px; color: #9ca3af; }
.content-count,
.muted-date { font-size: 12px; color: #4b5563; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }

@media (max-width: 768px) {
  .filter-panel { padding: 10px; }
  .filter-row,
  .actions { width: 100%; }
  .search-input,
  .filter-select,
  .sort-select,
  .date-range { width: 100%; }
  .actions { justify-content: flex-start; margin-left: 0; }
}
</style>
