<template>
  <div class="topics-pane">
    <div class="ctrl-bar">
      <el-input v-model="q" placeholder="搜标题 / 正文" clearable style="width:280px" @keyup.enter="reload">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="boardSlug" clearable placeholder="所有板块" style="width:160px" @change="reload">
        <el-option v-for="b in boards" :key="b.slug" :value="b.slug" :label="b.name" />
      </el-select>
      <el-radio-group v-model="hidden" size="default" @change="reload">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="0">正常</el-radio-button>
        <el-radio-button value="1">已隐</el-radio-button>
      </el-radio-group>
      <el-button @click="reload">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe size="default">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column label="板块" width="120">
        <template #default="{ row }">{{ row.board.name }}</template>
      </el-table-column>
      <el-table-column label="标题" min-width="280">
        <template #default="{ row }">
          <span v-if="row.pinned" style="color:#dc2626;margin-right:4px">📌</span>
          <span v-if="row.locked" style="margin-right:4px">🔒</span>
          <span v-if="row.hidden" style="color:#9ca3af;text-decoration:line-through">{{ row.title }}</span>
          <a v-else :href="`/forum/topic/${row.id}`" target="_blank">{{ row.title }}</a>
        </template>
      </el-table-column>
      <el-table-column label="作者" width="120">
        <template #default="{ row }">{{ row.author.nickname }}</template>
      </el-table-column>
      <el-table-column prop="replyCount" label="回" width="60" align="right" />
      <el-table-column prop="likeCount" label="赞" width="60" align="right" />
      <el-table-column label="时间" width="160">
        <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="290" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" @click="togglePin(row)">{{ row.pinned ? '取消置顶' : '置顶' }}</el-button>
          <el-button text size="small" @click="toggleLock(row)">{{ row.locked ? '解锁' : '锁定' }}</el-button>
          <el-button v-if="!row.hidden" text type="danger" size="small" @click="hideRow(row)">隐藏</el-button>
          <el-button v-else text type="success" size="small" @click="unhide(row)">恢复</el-button>
          <el-button text type="warning" size="small" @click="moveBoard(row)">转版</el-button>
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
import { boardApi, type Board } from "@/api/board";
import { fmtDate } from "@/utils/format";

const list = ref<any[]>([]);
const boards = ref<Board[]>([]);
const total = ref(0);
const page = ref(1);
const size = ref(20);
const loading = ref(false);
const q = ref("");
const boardSlug = ref("");
const hidden = ref<"" | "0" | "1">("");

onMounted(async () => {
  boards.value = await boardApi.list();
  await reload();
});

async function reload() {
  loading.value = true;
  try {
    const r = await adminApi.topics({
      q: q.value, board: boardSlug.value || undefined,
      hidden: hidden.value || undefined,
      page: page.value, size: size.value,
    });
    list.value = r.list;
    total.value = r.total;
  } finally { loading.value = false; }
}
function onPage(p: number) { page.value = p; reload(); }

async function togglePin(row: any) {
  await adminApi.updateTopic(row.id, { pinned: !row.pinned });
  ElMessage.success(row.pinned ? "已取消置顶" : "已置顶");
  reload();
}
async function toggleLock(row: any) {
  await adminApi.updateTopic(row.id, { locked: !row.locked });
  ElMessage.success(row.locked ? "已解锁" : "已锁定");
  reload();
}
async function hideRow(row: any) {
  await ElMessageBox.confirm(`隐藏帖子《${row.title.slice(0, 30)}》？`, "确认", { type: "warning" });
  await adminApi.updateTopic(row.id, { hidden: true });
  ElMessage.success("已隐藏");
  reload();
}
async function unhide(row: any) {
  await adminApi.updateTopic(row.id, { hidden: false });
  ElMessage.success("已恢复");
  reload();
}
async function moveBoard(row: any) {
  const writable = boards.value.filter((b) => !b.readOnly);
  const slugs = writable.map((b) => `${b.slug} (${b.name})`).join(", ");
  const { value } = await ElMessageBox.prompt(
    `将《${row.title.slice(0, 30)}》转到哪个板块？\n可选 slug：\n${slugs}`,
    "转板块",
    { inputValidator: (v) => writable.some((b) => b.slug === v) }
  );
  await adminApi.updateTopic(row.id, { boardSlug: value });
  ElMessage.success("已转移");
  reload();
}
</script>

<style scoped>
.topics-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pager { display: flex; justify-content: center; padding-top: 12px; }
a { color: var(--cpu-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
