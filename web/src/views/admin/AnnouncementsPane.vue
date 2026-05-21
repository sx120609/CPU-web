<template>
  <div class="ann-pane">
    <el-card shadow="never" class="composer">
      <template #header><h3 style="margin:0;font-size:15px">📣 发布全站公告</h3></template>
      <el-form :model="form" label-position="top">
        <el-form-item label="标题">
          <el-input v-model="form.title" maxlength="120" placeholder="公告标题" show-word-limit />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="4" maxlength="2000" placeholder="公告内容，所有用户都会在消息中心看到" show-word-limit />
        </el-form-item>
        <el-form-item label="级别">
          <el-radio-group v-model="form.level">
            <el-radio-button value="weak">弱（资讯）</el-radio-button>
            <el-radio-button value="normal">普通</el-radio-button>
            <el-radio-button value="strong">强（强提醒，跳静默时段）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="附带链接（选填）">
          <el-input v-model="form.link" placeholder="例如 /forum/topic/123 或 https://..." />
        </el-form-item>
        <el-form-item label="投放平台">
          <el-radio-group v-model="form.targetClient">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="ios">仅 iOS</el-radio-button>
            <el-radio-button value="android">仅安卓</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="publishing" :disabled="!form.title || !form.content" @click="publish">
            发布公告
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="hdr">
          <h3 style="margin:0;font-size:15px">📜 历史公告</h3>
          <el-button text @click="reload">刷新</el-button>
        </div>
      </template>
      <el-empty v-if="!list.length" description="还没发布过公告" />
      <div v-for="a in list" :key="a.id" class="ann-row">
        <div class="ann-main">
          <div class="ann-title">
            <el-tag size="small" :type="a.level === 'strong' ? 'danger' : a.level === 'normal' ? 'primary' : 'info'" effect="plain">
              {{ a.level }}
            </el-tag>
            <el-tag v-if="targetLabel(a.targetClient) !== '全部'" size="small" effect="plain">
              {{ targetLabel(a.targetClient) }}
            </el-tag>
            {{ a.title }}
          </div>
          <div class="ann-content">{{ a.content }}</div>
          <div class="ann-meta">{{ fmtDate(a.createdAt) }} · {{ a.source }}</div>
        </div>
        <el-dropdown trigger="click" @command="handleAnnouncementCommand($event, a)">
          <el-button text size="small" class="action-trigger">
            操作<el-icon class="more-icon"><MoreFilled /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { MoreFilled } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import { fmtDate } from "@/utils/format";

const list = ref<any[]>([]);
const form = reactive({ title: "", content: "", level: "normal", link: "", targetClient: "all" });
const publishing = ref(false);

onMounted(reload);
async function reload() { list.value = await adminApi.announcements(); }

function targetLabel(value?: string | null) {
  if (value === "ios") return "仅 iOS";
  if (value === "android") return "仅安卓";
  return "全部";
}

async function publish() {
  publishing.value = true;
  try {
    await adminApi.createAnnouncement({
      title: form.title.trim(),
      content: form.content.trim(),
      level: form.level,
      link: form.link.trim() || undefined,
      targetClient: form.targetClient as "all" | "ios" | "android",
    });
    ElMessage.success("公告已发布");
    form.title = ""; form.content = ""; form.link = ""; form.targetClient = "all";
    reload();
  } finally { publishing.value = false; }
}

function handleAnnouncementCommand(command: string, row: any) {
  if (command === "delete") return removeAnn(row);
}

async function removeAnn(a: any) {
  await ElMessageBox.confirm(`删除公告《${a.title}》？`, "确认", { type: "warning" });
  await adminApi.deleteAnnouncement(a.id);
  ElMessage.success("已删除");
  reload();
}
</script>

<style scoped>
.ann-pane { display: flex; flex-direction: column; gap: 14px; }
.composer .el-card__header { padding-bottom: 0; }
.hdr { display: flex; justify-content: space-between; align-items: center; }
.ann-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 10px 0;
  border-bottom: 1px dashed #f1f5f9;
}
.ann-row:last-child { border-bottom: none; }
.ann-main { flex: 1; min-width: 0; }
.ann-title { font-size: 14px; font-weight: 600; color: #1f2937; display: flex; gap: 6px; align-items: center; }
.ann-content { font-size: 13px; color: #4b5563; margin: 4px 0 4px; }
.ann-meta { font-size: 11px; color: #9ca3af; }
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }

@media (max-width: 768px) {
  .ann-pane :deep(.el-card__body) {
    padding: 12px;
  }
  .ann-pane :deep(.el-radio-group) {
    display: grid;
    width: 100%;
    gap: 8px;
  }
  .ann-pane :deep(.el-radio-button__inner) {
    width: 100%;
    border-left: var(--el-border);
    border-radius: var(--el-border-radius-base);
  }
  .ann-pane :deep(.el-form-item:last-child .el-button) {
    width: 100%;
  }
  .ann-row {
    gap: 10px;
    flex-direction: column;
  }
  .ann-title {
    align-items: flex-start;
    line-height: 1.5;
  }
  .ann-row :deep(.el-dropdown) {
    width: 100%;
  }
  .action-trigger {
    width: 100%;
  }
}
</style>
