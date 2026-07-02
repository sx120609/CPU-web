<template>
  <div class="filestore-page">
    <section class="filestore-shell" v-loading="loading">
      <div class="filestore-head">
        <span class="filestore-mark">药</span>
        <div>
          <div class="filestore-kicker">校园小工具</div>
          <h2>文件收集工作台</h2>
          <p>创建提交链接、查看记录和下载文件都在这里完成。</p>
        </div>
      </div>

      <div v-if="loading" class="filestore-state">
        <b>正在进入工作台</b>
        <span>会自动检查你的文件收集管理权限。</span>
      </div>

      <div v-else class="filestore-state is-denied">
        <b>暂时不能进入工作台</b>
        <span>你还没有文件收集管理权限，可以回到小工具列表查看公开入口。</span>
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { toolsApi } from "@/api/tools";

const loading = ref(true);

onMounted(loadPermission);

async function loadPermission() {
  loading.value = true;
  try {
    const perms = await toolsApi.myPermissions();
    const canAccess = perms.adminToolCodes.includes("file_collect") || perms.toolCodes.includes("file_collect");
    if (canAccess) {
      window.location.replace("/filestore/");
      return;
    }
    ElMessage.warning("没有文件收集管理权限");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.filestore-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.filestore-shell {
  width: min(860px, 100%);
  margin: 0 auto;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.filestore-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 24px;
  border-bottom: 1px solid #eef0f4;
}

.filestore-mark {
  width: 50px;
  height: 50px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: linear-gradient(135deg, var(--cpu-primary), var(--cpu-primary-dark));
  color: var(--cpu-gold);
  font-family: serif;
  font-size: 26px;
  font-weight: 700;
}

.filestore-kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 650;
  margin-bottom: 4px;
}

.filestore-head h2 {
  margin: 0;
  color: #111827;
  font-size: 22px;
}

.filestore-head p {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}

.filestore-state {
  min-height: 260px;
  padding: 28px;
  display: grid;
  align-content: center;
  place-items: center;
  gap: 8px;
  text-align: center;
}

.filestore-state b {
  color: #111827;
  font-size: 16px;
}

.filestore-state span {
  color: #6b7280;
  font-size: 13px;
}

.filestore-state .el-button {
  margin-top: 10px;
}

@media (max-width: 700px) {
  .filestore-head {
    align-items: flex-start;
    padding: 16px;
  }

  .filestore-mark {
    width: 44px;
    height: 44px;
    font-size: 23px;
  }

  .filestore-head h2 {
    font-size: 20px;
  }

  .filestore-state {
    min-height: 220px;
    padding: 22px 16px;
  }
}
</style>
