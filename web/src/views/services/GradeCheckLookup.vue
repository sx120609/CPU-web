<template>
  <div class="grade-lookup-page">
    <section class="lookup-card" v-loading="loading">
      <button type="button" class="back-btn" @click="$router.push('/services/tools/grade_check')">
        <el-icon><ArrowLeft /></el-icon>
        <span>成绩表核对</span>
      </button>

      <template v-if="lookup">
        <div class="lookup-head">
          <div class="head-copy">
            <div class="head-kicker">个人查询结果</div>
            <h2>{{ lookup.table.title }}</h2>
            <p>{{ lookup.table.description || "请核对下方信息。如有疑问，请联系发布者。" }}</p>
          </div>
          <div class="identity-card">
            <span>当前登录学号</span>
            <b>{{ lookup.studentId }}</b>
            <el-tag size="small" :type="lookup.row ? 'success' : 'warning'" effect="plain">
              {{ lookup.row ? "已匹配记录" : "未匹配记录" }}
            </el-tag>
          </div>
        </div>

        <template v-if="lookup.row">
          <div class="summary-strip">
            <div>
              <span>查询状态</span>
              <b>{{ statusText(lookup.table.status) }}</b>
            </div>
            <div>
              <span>记录字段</span>
              <b>{{ lookup.table.columns.length }}</b>
            </div>
            <div>
              <span>表内记录</span>
              <b>{{ lookup.table.rowCount }}</b>
            </div>
            <div>
              <span>更新时间</span>
              <b>{{ fmtDate(lookup.table.updatedAt) }}</b>
            </div>
          </div>

          <div class="result-layout">
            <main class="result-main">
              <section v-if="scoreColumns.length" class="result-section">
                <div class="section-title">
                  <h3>成绩明细</h3>
                  <span>按上传表格字段展示</span>
                </div>
                <div class="score-table-wrap">
                  <table class="score-table">
                    <thead>
                      <tr>
                        <th>项目</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="column in scoreColumns" :key="column">
                        <td>{{ column }}</td>
                        <td>{{ lookup.row[column] || "-" }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section class="result-section">
                <div class="section-title">
                  <h3>完整记录</h3>
                  <span>仅包含你的学号对应行</span>
                </div>
                <dl class="info-grid">
                  <div v-for="column in infoColumns" :key="column" class="info-item">
                    <dt>{{ column }}</dt>
                    <dd>{{ lookup.row[column] || "-" }}</dd>
                  </div>
                </dl>
              </section>
            </main>

            <aside class="result-side">
              <section class="side-box">
                <h3>发布信息</h3>
                <div class="side-row">
                  <span>发布者</span>
                  <b>{{ lookup.table.createdBy?.nickname || lookup.table.createdBy?.username || "未记录" }}</b>
                </div>
                <div class="side-row">
                  <span>开放状态</span>
                  <el-tag size="small" :type="statusTag(lookup.table.status)" effect="plain">{{ statusText(lookup.table.status) }}</el-tag>
                </div>
                <div class="side-row">
                  <span>发布时间</span>
                  <b>{{ lookup.table.publishedAt ? fmtDate(lookup.table.publishedAt) : "-" }}</b>
                </div>
              </section>
              <section class="side-box safe-box">
                <h3>隐私说明</h3>
                <p>系统按你的登录学号匹配查询表，只返回同一行数据，不展示其他同学的信息。</p>
              </section>
              <el-button v-if="lookup.canManage" plain type="primary" @click="$router.push('/services/tools/manage')">
                进入管理
              </el-button>
            </aside>
          </div>
        </template>

        <el-empty v-else description="未找到与你学号匹配的信息">
          <el-button plain @click="load">重新查询</el-button>
        </el-empty>
      </template>

      <el-empty v-else-if="!loading" description="查询表不存在或暂未开放">
        <el-button type="primary" @click="$router.push('/services/tools/grade_check')">返回成绩表核对</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import { toolsApi, type GradeCheckLookup, type GradeCheckStatus } from "@/api/tools";
import { fmtDate } from "@/utils/format";

const route = useRoute();
const loading = ref(false);
const lookup = ref<GradeCheckLookup | null>(null);
const scoreKeywords = ["成绩", "分数", "总评", "平时", "期末", "期中", "绩点", "等级", "得分"];

const scoreColumns = computed(() => {
  if (!lookup.value?.row) return [];
  return lookup.value.table.columns.filter((column) => scoreKeywords.some((keyword) => column.includes(keyword)));
});
const infoColumns = computed(() => {
  if (!lookup.value?.row) return [];
  const scores = new Set(scoreColumns.value);
  return lookup.value.table.columns.filter((column) => !scores.has(column));
});

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
  border: 1px solid #e5eaf3;
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
  color: #2563eb;
  border-color: #93c5fd;
}
.lookup-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 18px;
  align-items: stretch;
  margin-bottom: 16px;
}
.head-copy {
  min-width: 0;
  padding: 18px 0 16px;
}
.head-kicker {
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 6px;
}
.lookup-head h2 {
  margin: 0;
  color: #111827;
  font-size: 24px;
}
.lookup-head p {
  margin: 7px 0 0;
  max-width: 760px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}
.identity-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  background: #eff6ff;
}
.identity-card span {
  color: #6b7280;
  font-size: 12px;
}
.identity-card b {
  color: #111827;
  font-size: 24px;
  line-height: 1.2;
}
.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid #e5eaf3;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 16px;
}
.summary-strip div {
  min-width: 0;
  padding: 13px 14px;
  border-right: 1px solid #e5eaf3;
  background: #f9fafb;
}
.summary-strip div:last-child {
  border-right: 0;
}
.summary-strip span {
  display: block;
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 4px;
}
.summary-strip b {
  color: #111827;
  font-size: 15px;
}
.result-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  align-items: start;
}
.result-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.result-section,
.side-box {
  border: 1px solid #e5eaf3;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px;
  border-bottom: 1px solid #e5eaf3;
  background: #f8fbff;
}
.section-title h3,
.side-box h3 {
  margin: 0;
  color: #111827;
  font-size: 15px;
}
.section-title span {
  color: #6b7280;
  font-size: 12px;
}
.score-table-wrap {
  width: 100%;
  overflow-x: auto;
}
.score-table {
  width: 100%;
  min-width: 420px;
  border-collapse: collapse;
}
.score-table th,
.score-table td {
  padding: 13px 16px;
  border-bottom: 1px solid #eef0f4;
  text-align: left;
}
.score-table th {
  color: #6b7280;
  background: #f9fafb;
  font-size: 12px;
  font-weight: 650;
}
.score-table td:first-child {
  color: #4b5563;
  width: 42%;
}
.score-table td:last-child {
  color: #111827;
  font-size: 18px;
  font-weight: 700;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  margin: 0;
}
.info-item {
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid #eef0f4;
  border-bottom: 1px solid #eef0f4;
}
.info-item dt {
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 6px;
}
.info-item dd {
  margin: 0;
  color: #111827;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.6;
  word-break: break-word;
}
.result-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.side-box {
  padding: 15px;
}
.side-box h3 {
  margin-bottom: 12px;
}
.side-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px solid #eef0f4;
  color: #6b7280;
  font-size: 13px;
}
.side-row:first-of-type {
  border-top: 0;
}
.side-row b {
  color: #111827;
  font-weight: 650;
  text-align: right;
}
.safe-box {
  background: #f8fbff;
}
.safe-box p {
  margin: 0;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.7;
}
@media (max-width: 960px) {
  .lookup-head,
  .result-layout {
    grid-template-columns: 1fr;
  }
  .summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .summary-strip div:nth-child(2n) {
    border-right: 0;
  }
}
@media (max-width: 700px) {
  .lookup-card {
    padding: 16px;
  }
  .lookup-head h2 {
    font-size: 20px;
  }
  .identity-card b {
    font-size: 22px;
  }
  .summary-strip {
    grid-template-columns: 1fr;
  }
  .summary-strip div {
    border-right: 0;
    border-bottom: 1px solid #e5eaf3;
  }
  .summary-strip div:last-child {
    border-bottom: 0;
  }
  .section-title {
    align-items: flex-start;
    flex-direction: column;
  }
  .info-grid {
    grid-template-columns: 1fr;
  }
}
</style>
