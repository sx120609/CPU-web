<template>
  <section class="th-group th-group--flush">
    <div class="th-group-head">
      <h2 class="th-h2">全部宣泄室</h2>
      <span class="th-muted">进入可查看聊天记录、入群审核记录，处理违规内容</span>
    </div>
    <div v-if="!rooms.length" class="th-empty"><p>还没有宣泄室。洞主在工作台发起，满 3 名洞主联名后建成。</p></div>
    <div v-else class="th-rows">
      <div v-for="room in rooms" :key="room.id" class="th-row">
        <div class="th-row-copy">
          <div class="th-row-title">
            {{ room.name }}
            <em class="th-chip is-brand">{{ room.categoryLabel }}</em>
            <em v-if="room.status === 'closed'" class="th-chip">已关闭</em>
            <em v-if="room.pendingApplications" class="th-chip is-warn">{{ room.pendingApplications }} 条待审核</em>
          </div>
          <p class="th-meta">
            <span>{{ room.visitorCount }} 位同学 · {{ room.hostCount }} 位洞主</span>
            <span>{{ room.messageCount }} 条消息</span>
            <span>{{ room.applicationCount }} 条入群申请</span>
            <span v-if="room.founders.length">{{ room.founders.join("、") }} 联名创建</span>
            <span v-if="room.status === 'closed' && room.closeReason">关闭原因：{{ room.closeReason }}</span>
          </p>
        </div>
        <el-button size="small" @click="router.push(`/treehole/room/${room.id}`)">查看</el-button>
        <el-button v-if="room.status === 'active'" size="small" type="danger" plain @click="close(room.id, room.name)">关闭</el-button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { treeholeApi, type TreeholeAdminRoom } from "@/api/treehole";

const router = useRouter();
const rooms = ref<TreeholeAdminRoom[]>([]);

async function load() {
  rooms.value = await treeholeApi.adminRooms();
}

async function close(id: number, name: string) {
  const result = await ElMessageBox.prompt(`关闭「${name}」后成员都无法再进入，记录留存在后台。`, "关闭宣泄室", {
    confirmButtonText: "关闭",
    cancelButtonText: "取消",
    inputPlaceholder: "关闭原因",
    inputValidator: (value: string) => (value && value.trim().length >= 2) || "请写明原因",
  }).catch(() => null);
  if (!result) return;
  await treeholeApi.closeRoom(id, String(result.value).trim());
  ElMessage.success("已关闭");
  await load();
}

onMounted(load);
</script>
