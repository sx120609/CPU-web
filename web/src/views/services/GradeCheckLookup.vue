<template>
  <div class="grade-lookup-page">
    <section class="lookup-card" v-loading="loading">
      <button type="button" class="back-btn" @click="$router.push('/services/tools')">
        <el-icon><ArrowLeft /></el-icon>
        <span>校园小工具</span>
      </button>

      <template v-if="lookup">
        <div class="lookup-head">
          <div class="head-icon"><el-icon><DataLine /></el-icon></div>
          <div class="head-copy">
            <h2>{{ lookup.table.title }}</h2>
            <p>{{ lookup.table.description || "请核对下方信息。如有疑问，请联系发布者。" }}</p>
            <div class="meta-row">
              <el-tag size="small" effect="plain">当前学号 {{ lookup.studentId }}</el-tag>
              <el-tag size="small" :type="statusTag(lookup.table.status)" effect="plain">{{ statusText(lookup.table.status) }}</el-tag>
              <el-tag size="small" type="info" effect="plain">{{ lookup.table.rowCount }} 条记录</el-tag>
            </div>
          </div>
          <el-button v-if="lookup.canManage" plain type="primary" @click="$router.push('/services/tools/manage')">
            管理
          </el-button>
        </div>

        <div v-if="lookup.row" class="result-panel">
          <div class="result-title">
            <b>核对信息</b>
            <span>仅展示与你登录学号匹配的记录</span>
          </div>
          <dl class="result-grid">
            <div v-for="column in lookup.table.columns" :key="column" class="result-item">
              <dt>{{ column }}</dt>
              <dd>{{ lookup.row[column] || "-" }}</dd>
            </div>
          </dl>
        </div>

        <el-empty v-else description="未找到与你学号匹配的信息">
          <el-button plain @click="load">重新查询</el-button>
        </el-empty>
      </template>

      <el-empty v-else-if="!loading" description="查询表不存在或暂未开放">
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, DataLine } from "@element-plus/icons-vue";
import { toolsApi, type GradeCheckLookup, type GradeCheckStatus } from "@/api/tools";

const route = useRoute();
const loading = ref(false);
const lookup = ref<GradeCheckLookup | null>(null);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    lookup.value = await toolsApi.gradeCheck(String(route.params.slug));
  } finally {
    loading.value = false;
  }
}

function statusText(status: GradeCheckStatus) {
  if (status === "open") return "开放";
  if (status === "closed") return "关闭";
  return "草稿";
}

function statusTag(status: GradeCheckStatus): "success" | "info" | "warning" {
  if (status === "open") return "success";
  if (status === "closed") return "info";
  return "warning";
}
</script>

<style scoped>
.grade-lookup-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.lookup-card {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 20px 22px 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  margin-bottom: 16px;
}
.back-btn:hover {
  color: var(--cpu-primary);
  border-color: var(--cpu-primary);
}
.lookup-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding-bottom: 18px;
  border-bottom: 1px solid #eef0f4;
  margin-bottom: 18px;
}
.head-icon {
  width: 50px;
  height: 50px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #2563eb;
  background: #eff6ff;
  flex: 0 0 auto;
}
.head-icon .el-icon {
  font-size: 26px;
}
.head-copy {
  min-width: 0;
  flex: 1;
}
.lookup-head h2 {
  margin: 0;
  color: #111827;
  font-size: 22px;
}
.lookup-head p {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.result-panel {
  max-width: 920px;
  border: 1px solid #e5eaf3;
  border-radius: 10px;
  overflow: hidden;
}
.result-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: #f8fbff;
  border-bottom: 1px solid #e5eaf3;
}
.result-title b {
  color: #111827;
}
.result-title span {
  color: #6b7280;
  font-size: 12px;
}
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin: 0;
}
.result-item {
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid #eef0f4;
  border-bottom: 1px solid #eef0f4;
}
.result-item dt {
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 6px;
}
.result-item dd {
  margin: 0;
  color: #111827;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.6;
  word-break: break-word;
}
@media (max-width: 700px) {
  .lookup-card {
    padding: 16px;
  }
  .lookup-head {
    flex-direction: column;
  }
  .lookup-head .el-button {
    width: 100%;
  }
  .lookup-head h2 {
    font-size: 20px;
  }
  .result-title {
    align-items: flex-start;
    flex-direction: column;
  }
  .result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
