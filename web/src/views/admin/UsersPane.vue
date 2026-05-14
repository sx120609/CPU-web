<template>
  <div class="users-pane">
    <div class="ctrl-bar">
      <el-input v-model="q" placeholder="搜用户名 / 昵称 / 邮箱" clearable style="width:240px" @keyup.enter="reload">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="role" clearable placeholder="所有角色" style="width:140px" @change="reload">
        <el-option label="user" value="user" />
        <el-option label="mod" value="mod" />
        <el-option label="admin" value="admin" />
        <el-option label="bot" value="bot" />
      </el-select>
      <el-select v-model="status" clearable placeholder="所有状态" style="width:140px" @change="reload">
        <el-option label="active" value="active" />
        <el-option label="banned" value="banned" />
        <el-option label="muted" value="muted" />
      </el-select>
      <el-button @click="reload">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe size="default">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="username" label="账号" width="140" />
      <el-table-column prop="nickname" label="昵称" min-width="140" />
      <el-table-column label="角色" width="100">
        <template #default="{ row }">
          <el-tag :type="roleTag(row.role)" size="small">{{ row.role }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : row.status === 'banned' ? 'danger' : 'warning'" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="SSO" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.studentSso" type="primary" size="small" effect="plain">✓</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="postCount" label="帖" width="60" align="right" />
      <el-table-column prop="replyCount" label="回" width="60" align="right" />
      <el-table-column label="注册时间" width="160">
        <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="260">
        <template #default="{ row }">
          <el-button v-if="row.status === 'active'" text type="danger" size="small" @click="ban(row)">封禁</el-button>
          <el-button v-else text type="success" size="small" @click="unban(row)">解禁</el-button>
          <el-button text size="small" @click="rename(row)">改名</el-button>
          <el-button v-if="auth.isAdmin" text type="warning" size="small" @click="changeRole(row)">改角色</el-button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Search } from "@element-plus/icons-vue";
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

onMounted(reload);

async function reload() {
  loading.value = true;
  try {
    const r = await adminApi.users({ q: q.value, role: role.value, status: status.value, page: page.value, size: size.value });
    list.value = r.list;
    total.value = r.total;
  } finally { loading.value = false; }
}

function onPage(p: number) { page.value = p; reload(); }

function roleTag(r: string): "danger" | "warning" | "primary" | "info" {
  if (r === "admin") return "danger";
  if (r === "mod") return "warning";
  if (r === "bot") return "info";
  return "primary";
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
</script>

<style scoped>
.users-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pager { display: flex; justify-content: center; padding-top: 12px; }
</style>
