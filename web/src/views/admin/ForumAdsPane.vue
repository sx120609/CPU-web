<template>
  <div class="forum-ads-pane" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="广告默认只显示在论坛页面的指定广告位，不插入帖子正文或回复；勾选 VIP 免广告后，VIP 用户不会看到该条广告。"
    />

    <el-card shadow="never" class="editor-card">
      <template #header>
        <div class="card-header">
          <div>
            <h3>{{ editingId ? "编辑论坛广告" : "新增论坛广告" }}</h3>
            <p>建议使用简短标题和一张比例接近 3:2 的图片。</p>
          </div>
          <el-button v-if="editingId" text @click="resetForm">取消编辑</el-button>
        </div>
      </template>

      <el-form label-position="top" class="ad-form">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="80" show-word-limit placeholder="例如：校园服务体验官招募" />
        </el-form-item>
        <el-form-item label="广告说明">
          <el-input v-model="form.description" maxlength="240" show-word-limit placeholder="一行补充说明，可留空" />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="投放位置" required>
            <el-select v-model="form.placement" style="width:100%">
              <el-option v-for="item in placementOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="form.sortOrder" :min="-1000" :max="1000" style="width:100%" />
          </el-form-item>
          <el-form-item label="按钮文案">
            <el-input v-model="form.buttonText" maxlength="24" placeholder="了解详情" />
          </el-form-item>
          <el-form-item label="跳转链接" required>
            <el-input v-model="form.linkUrl" maxlength="500" placeholder="/services 或 https://example.com" />
          </el-form-item>
        </div>
        <el-form-item label="图片地址">
          <el-input v-model="form.imageUrl" maxlength="500" placeholder="/uploads/... 或 https://...，可留空" />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="开始时间">
            <el-date-picker v-model="form.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="立即开始" style="width:100%" />
          </el-form-item>
          <el-form-item label="结束时间">
            <el-date-picker v-model="form.endsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="长期投放" style="width:100%" />
          </el-form-item>
        </div>
        <div class="switches">
          <el-switch v-model="form.enabled" active-text="启用广告" />
          <el-switch v-model="form.vipExempt" active-text="VIP 免广告" />
        </div>
        <div class="form-actions">
          <el-button type="primary" :loading="saving" @click="save">{{ editingId ? "保存修改" : "创建广告" }}</el-button>
          <el-button @click="resetForm">清空</el-button>
        </div>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <div><h3>广告列表</h3><p>按广告位和排序展示，最多同时返回 3 条。</p></div>
          <el-button text :loading="loading" @click="load">刷新</el-button>
        </div>
      </template>
      <el-empty v-if="!list.length && !loading" description="暂未配置广告" />
      <div v-else class="ad-list">
        <div v-for="item in list" :key="item.id" class="ad-row">
          <div class="ad-row-main">
            <div class="row-title">
              <el-tag size="small" effect="plain">{{ placementLabel(item.placement) }}</el-tag>
              <el-tag size="small" :type="item.enabled ? 'success' : 'info'">{{ item.enabled ? "投放中" : "已停用" }}</el-tag>
              <strong>{{ item.title }}</strong>
            </div>
            <p>{{ item.description || "无说明" }}</p>
            <small>{{ item.linkUrl }} · {{ item.vipExempt ? "VIP 免广告" : "所有用户展示" }} · 排序 {{ item.sortOrder }}</small>
            <small v-if="item.startsAt || item.endsAt">{{ formatDate(item.startsAt) }} — {{ formatDate(item.endsAt) }}</small>
          </div>
          <div class="row-actions">
            <el-button size="small" @click="edit(item)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="remove(item)">删除</el-button>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type ForumAdAdmin } from "@/api/admin";

const placementOptions = [
  { value: "forum-index-top" as const, label: "论坛首页 · 顶部" },
  { value: "forum-feed-inline" as const, label: "热榜 / 最新 · 内容区" },
  { value: "forum-board-top" as const, label: "板块页 · 标题下方" },
];

const list = ref<ForumAdAdmin[]>([]);
const loading = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const form = reactive({
  title: "",
  description: "",
  imageUrl: "",
  linkUrl: "",
  buttonText: "了解详情",
  placement: "forum-index-top" as ForumAdAdmin["placement"],
  sortOrder: 0,
  enabled: false,
  vipExempt: true,
  startsAt: "",
  endsAt: "",
});

onMounted(load);

async function load() {
  loading.value = true;
  try {
    list.value = await adminApi.forumAds({ suppressErrorMessage: true });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "广告列表加载失败");
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  editingId.value = null;
  form.title = "";
  form.description = "";
  form.imageUrl = "";
  form.linkUrl = "";
  form.buttonText = "了解详情";
  form.placement = "forum-index-top";
  form.sortOrder = 0;
  form.enabled = false;
  form.vipExempt = true;
  form.startsAt = "";
  form.endsAt = "";
}

function edit(item: ForumAdAdmin) {
  editingId.value = item.id;
  form.title = item.title;
  form.description = item.description || "";
  form.imageUrl = item.imageUrl || "";
  form.linkUrl = item.linkUrl;
  form.buttonText = item.buttonText || "";
  form.placement = item.placement;
  form.sortOrder = item.sortOrder;
  form.enabled = item.enabled;
  form.vipExempt = item.vipExempt;
  form.startsAt = item.startsAt ? item.startsAt.slice(0, 19) : "";
  form.endsAt = item.endsAt ? item.endsAt.slice(0, 19) : "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function payload() {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    imageUrl: form.imageUrl.trim() || null,
    linkUrl: form.linkUrl.trim(),
    buttonText: form.buttonText.trim() || null,
    placement: form.placement,
    sortOrder: form.sortOrder,
    enabled: form.enabled,
    vipExempt: form.vipExempt,
    startsAt: form.startsAt || null,
    endsAt: form.endsAt || null,
  };
}

async function save() {
  if (!form.title.trim() || !form.linkUrl.trim()) {
    ElMessage.warning("请填写广告标题和跳转链接");
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) await adminApi.updateForumAd(editingId.value, payload());
    else await adminApi.createForumAd(payload());
    ElMessage.success(editingId.value ? "广告已更新" : "广告已创建");
    resetForm();
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "广告保存失败");
  } finally {
    saving.value = false;
  }
}

async function remove(item: ForumAdAdmin) {
  const confirmed = await ElMessageBox.confirm(`确定删除广告“${item.title}”？`, "删除广告", { type: "warning" }).then(() => true).catch(() => false);
  if (!confirmed) return;
  try {
    await adminApi.deleteForumAd(item.id);
    ElMessage.success("广告已删除");
    if (editingId.value === item.id) resetForm();
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "广告删除失败");
  }
}

function placementLabel(value: ForumAdAdmin["placement"]) {
  return placementOptions.find((item) => item.value === value)?.label || value;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "不限";
}
</script>

<style scoped>
.forum-ads-pane { display: flex; flex-direction: column; gap: 14px; }
.card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.card-header h3 { margin: 0; font-size: 15px; }
.card-header p { margin: 5px 0 0; color: var(--cpu-text-muted); font-size: 12px; }
.ad-form { max-width: 900px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
.switches, .form-actions, .row-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.form-actions { margin-top: 4px; }
.ad-list { display: flex; flex-direction: column; gap: 10px; }
.ad-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; }
.ad-row-main { min-width: 0; flex: 1; }
.row-title { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.row-title strong { color: var(--cpu-text); }
.ad-row p { margin: 7px 0; color: var(--cpu-text-secondary); font-size: 13px; }
.ad-row small { display: block; margin-top: 3px; overflow-wrap: anywhere; color: var(--cpu-text-muted); font-size: 11px; }
@media (max-width: 650px) { .form-grid { grid-template-columns: 1fr; } .ad-row { flex-direction: column; } }
</style>
