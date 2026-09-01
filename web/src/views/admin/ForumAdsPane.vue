<template>
  <div class="forum-ads-pane" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="一条广告可以同时投放到多个位置；广告不会插入帖子正文或回复。勾选 VIP 免广告后，VIP 用户不会看到该条广告。"
    />

    <section v-if="list.length" class="metric-overview" aria-label="广告效果概览">
      <div>
        <span>投放中</span>
        <strong>{{ activeAds }}</strong>
        <small>共 {{ list.length }} 条广告</small>
      </div>
      <div>
        <span>累计有效曝光</span>
        <strong>{{ formatNumber(totalMetrics.impressions) }}</strong>
        <small>进入屏幕超过 0.7 秒</small>
      </div>
      <div>
        <span>累计点击</span>
        <strong>{{ formatNumber(totalMetrics.clicks) }}</strong>
        <small>移动端与桌面端合计</small>
      </div>
      <div>
        <span>整体点击率</span>
        <strong>{{ formatCtr(totalMetrics.ctr) }}</strong>
        <small>点击 ÷ 有效曝光</small>
      </div>
    </section>

    <el-card shadow="never" class="editor-card">
      <template #header>
        <div class="card-header">
          <div>
            <h3>{{ editingId ? "编辑站内广告" : "新增站内广告" }}</h3>
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
            <el-select v-model="form.placements" multiple collapse-tags :max-collapse-tags="2" placeholder="可多选" style="width:100%">
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
        <el-form-item label="广告图片">
          <div class="image-editor">
            <el-input v-model="form.imageUrl" maxlength="500" placeholder="上传图片，或填写站内 / https 地址" />
            <el-button :loading="uploadingImage" @click="imageInput?.click()">上传素材</el-button>
            <input ref="imageInput" class="image-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="uploadImage" />
          </div>
          <img v-if="form.imageUrl" class="image-preview" :src="form.imageUrl" alt="广告图片预览" />
          <small class="image-tip">上传后自动压缩并存入媒体 CDN，前台按移动端和桌面端尺寸加载。</small>
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
          <el-switch
            v-model="form.vipExempt"
            :disabled="campaignPlacementSelected"
            :active-text="campaignPlacementSelected ? '活动面向全部用户' : 'VIP 免广告'"
          />
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
          <div><h3>广告列表与效果</h3><p>曝光按真正进入屏幕统计，可对比近 7 天、近 30 天和设备分布。</p></div>
          <el-button text :loading="loading" @click="load">刷新</el-button>
        </div>
      </template>
      <el-empty v-if="!list.length && !loading" description="暂未配置广告" />
      <div v-else class="ad-list">
        <div v-for="item in list" :key="item.id" class="ad-row">
          <div class="ad-row-main">
            <div class="row-title">
              <el-tag v-for="placement in placementValues(item)" :key="placement" size="small" effect="plain">{{ placementLabel(placement) }}</el-tag>
              <el-tag size="small" :type="item.enabled ? 'success' : 'info'">{{ item.enabled ? "投放中" : "已停用" }}</el-tag>
              <strong>{{ item.title }}</strong>
            </div>
            <p>{{ item.description || "无说明" }}</p>
            <small>{{ item.linkUrl }} · {{ item.vipExempt ? "VIP 免广告" : "所有用户展示" }} · 排序 {{ item.sortOrder }}</small>
            <small v-if="item.startsAt || item.endsAt">{{ formatDate(item.startsAt) }} — {{ formatDate(item.endsAt) }}</small>
            <div class="row-metrics">
              <div><span>累计曝光</span><strong>{{ formatNumber(item.metrics.all.impressions) }}</strong></div>
              <div><span>累计点击</span><strong>{{ formatNumber(item.metrics.all.clicks) }}</strong></div>
              <div><span>累计 CTR</span><strong>{{ formatCtr(item.metrics.all.ctr) }}</strong></div>
              <div><span>近 7 天</span><strong>{{ formatCtr(item.metrics.last7Days.ctr) }}</strong></div>
              <div><span>近 30 天</span><strong>{{ formatCtr(item.metrics.last30Days.ctr) }}</strong></div>
              <div><span>移动端曝光</span><strong>{{ deviceShare(item) }}</strong></div>
            </div>
            <div v-if="item.metrics.daily.length" class="daily-trend">
              <span>近 30 天</span>
              <div class="trend-bars" aria-label="近 30 天曝光趋势">
                <i
                  v-for="day in item.metrics.daily"
                  :key="day.day"
                  :style="{ height: `${trendHeight(item, day.impressions)}%` }"
                  :title="`${day.day}：${day.impressions} 次曝光，${day.clicks} 次点击`"
                ></i>
              </div>
            </div>
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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type ForumAdAdmin } from "@/api/admin";

const placementOptions = [
  { value: "home-mobile-top" as const, label: "移动端首页 · 帖子流置顶" },
  { value: "compose-mobile-campaign" as const, label: "移动端发布 · 限时活动入口" },
  { value: "forum-index-top" as const, label: "论坛首页 · 顶部（桌面 / 移动）" },
  { value: "forum-home-pinned" as const, label: "首页 · 全局置顶下方" },
  { value: "forum-home-hot" as const, label: "首页 · 热议下方" },
  { value: "forum-feed-inline" as const, label: "热榜 / 最新 · 内容区（桌面 / 移动）" },
  { value: "forum-board-top" as const, label: "板块页 · 标题下方" },
];

const list = ref<ForumAdAdmin[]>([]);
const loading = ref(false);
const saving = ref(false);
const uploadingImage = ref(false);
const imageInput = ref<HTMLInputElement | null>(null);
const editingId = ref<number | null>(null);
const activeAds = computed(() => list.value.filter((item) => item.enabled).length);
const totalMetrics = computed(() => {
  const totals = list.value.reduce((result, item) => {
    result.impressions += item.metrics.all.impressions;
    result.clicks += item.metrics.all.clicks;
    return result;
  }, { impressions: 0, clicks: 0 });
  return {
    ...totals,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
  };
});
const form = reactive({
  title: "",
  description: "",
  imageUrl: "",
  linkUrl: "",
  buttonText: "了解详情",
  placements: ["home-mobile-top"] as ForumAdAdmin["placements"],
  sortOrder: 0,
  enabled: false,
  vipExempt: true,
  startsAt: "",
  endsAt: "",
});
const campaignPlacementSelected = computed(() => form.placements.includes("compose-mobile-campaign"));

onMounted(load);

watch(campaignPlacementSelected, (selected) => {
  if (selected) form.vipExempt = false;
});

async function uploadImage(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  uploadingImage.value = true;
  try {
    const result = await adminApi.uploadForumAdImage(file);
    form.imageUrl = result.url;
    ElMessage.success(result.transcoded ? "图片已压缩并上传" : "图片已上传");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "广告图片上传失败");
  } finally {
    uploadingImage.value = false;
  }
}

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
  form.placements = ["home-mobile-top"];
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
  form.placements = placementValues(item);
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
    placements: [...form.placements],
    sortOrder: form.sortOrder,
    enabled: form.enabled,
    vipExempt: form.vipExempt,
    startsAt: form.startsAt || null,
    endsAt: form.endsAt || null,
  };
}

async function save() {
  if (!form.title.trim() || !form.linkUrl.trim() || !form.placements.length) {
    ElMessage.warning("请填写广告标题、跳转链接，并至少选择一个投放位置");
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

function placementValues(item: ForumAdAdmin) {
  return item.placements?.length ? item.placements : [item.placement];
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "不限";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function formatCtr(value: number) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function deviceShare(item: ForumAdAdmin) {
  const total = item.metrics.all.impressions;
  return total > 0 ? `${Math.round((item.metrics.mobile.impressions / total) * 100)}%` : "—";
}

function trendHeight(item: ForumAdAdmin, impressions: number) {
  const max = Math.max(1, ...item.metrics.daily.map((day) => day.impressions));
  return Math.max(10, Math.round((impressions / max) * 100));
}
</script>

<style scoped>
.forum-ads-pane { display: flex; flex-direction: column; gap: 14px; }
.metric-overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.metric-overview > div { padding: 15px; border: 1px solid var(--cpu-border-soft); border-radius: 13px; background: var(--cpu-card); }
.metric-overview span, .metric-overview small { display: block; color: var(--cpu-text-muted); font-size: 11px; }
.metric-overview strong { display: block; margin: 7px 0 5px; color: var(--cpu-text); font-size: 23px; line-height: 1; }
.card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.card-header h3 { margin: 0; font-size: 15px; }
.card-header p { margin: 5px 0 0; color: var(--cpu-text-muted); font-size: 12px; }
.ad-form { max-width: 900px; }
.image-editor { display: flex; width: 100%; gap: 8px; }
.image-input { display: none; }
.image-preview { display: block; width: 180px; max-height: 120px; margin-top: 10px; border-radius: 10px; object-fit: cover; background: var(--cpu-surface-soft); }
.image-tip { display: block; width: 100%; margin-top: 7px; color: var(--cpu-text-muted); font-size: 11px; }
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
.row-metrics { display: grid; grid-template-columns: repeat(6, minmax(76px, 1fr)); gap: 7px; margin-top: 12px; }
.row-metrics > div { padding: 8px 9px; border-radius: 9px; background: var(--cpu-surface-soft); }
.row-metrics span { display: block; color: var(--cpu-text-muted); font-size: 10px; }
.row-metrics strong { display: block; margin-top: 4px; color: var(--cpu-text); font-size: 14px; }
.daily-trend { display: flex; align-items: flex-end; gap: 10px; margin-top: 10px; color: var(--cpu-text-muted); font-size: 10px; }
.trend-bars { display: flex; align-items: flex-end; gap: 2px; width: min(320px, 100%); height: 34px; }
.trend-bars i { flex: 1; min-width: 3px; border-radius: 3px 3px 0 0; background: color-mix(in srgb, var(--cpu-primary) 68%, transparent); }
@media (max-width: 900px) { .metric-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } .row-metrics { grid-template-columns: repeat(3, minmax(76px, 1fr)); } }
@media (max-width: 650px) { .form-grid { grid-template-columns: 1fr; } .ad-row { flex-direction: column; } .metric-overview { grid-template-columns: 1fr 1fr; } .row-metrics { grid-template-columns: repeat(2, minmax(76px, 1fr)); } }
</style>
