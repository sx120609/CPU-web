<template>
  <div class="features-pane">
    <el-alert type="warning" :closable="false" show-icon class="warn">
      <template #title>
        紧急下架开关 —— 默认全开
      </template>
      <div style="font-size:13px;line-height:1.7;margin-top:4px">
        关闭某项后：导航栏入口会立刻消失，普通用户访问对应路由会被引导回首页，发帖接口拒绝写入。
        <b>已发布的内容不会被删除</b>（关闭只是不可见、不可发新）。<br>
        admin / mod 角色仍能进入这些路由查看历史内容，便于在敏感期间复审 / 清理。
      </div>
    </el-alert>

    <div class="site-config" v-loading="configLoading">
      <div class="config-copy">
        <div class="title">网站域名</div>
        <div class="desc">用于生成 iOS / Android 小组件 API 地址。留空时会回退到当前请求的 Host，开发环境可能显示 127.0.0.1。</div>
      </div>
      <div class="config-form">
        <el-input
          v-model="siteOrigin"
          clearable
          maxlength="240"
          placeholder="https://cpu.example.com"
          @keyup.enter="saveSiteConfig"
        />
        <el-button type="primary" :loading="savingConfig" @click="saveSiteConfig">保存</el-button>
      </div>
    </div>

    <div class="site-config ai-config" v-loading="configLoading">
      <div class="config-copy">
        <div class="title">AI 稿件审核</div>
        <div class="desc">使用 DeepSeek 对新投稿做风险判断。低于自动通过阈值直接发布，高于自动拦截阈值则拦下并允许申请人工审核。</div>
      </div>
      <div class="ai-form">
        <div class="ai-row">
          <span class="ai-label">启用审核</span>
          <el-switch v-model="aiReviewEnabled" inline-prompt active-text="开" inactive-text="关" />
        </div>
        <div class="ai-row">
          <span class="ai-label">Provider</span>
          <el-input v-model="aiReviewProvider" maxlength="40" placeholder="deepseek" />
        </div>
        <div class="ai-row">
          <span class="ai-label">模型</span>
          <el-input v-model="aiReviewModel" maxlength="80" placeholder="deepseek-v4-flash" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">API Key</span>
          <el-input v-model="aiReviewApiKey" maxlength="240" show-password placeholder="sk-..." />
        </div>
        <div class="ai-row">
          <span class="ai-label">自动通过</span>
          <el-input-number v-model="aiReviewAutoPassScore" :min="0" :max="100" />
        </div>
        <div class="ai-row">
          <span class="ai-label">自动拦截</span>
          <el-input-number v-model="aiReviewBlockScore" :min="0" :max="100" />
        </div>
        <el-button type="primary" :loading="savingConfig" @click="saveAiReviewConfig">保存 AI 审核配置</el-button>
      </div>
    </div>

    <div class="feature-grid" v-loading="loading">
      <div v-for="f in featureMeta" :key="f.key" class="feature-row">
        <div class="left">
          <div class="title">
            <span class="icon">{{ f.icon }}</span> {{ f.title }}
          </div>
          <div class="desc">{{ f.desc }}</div>
          <div class="paths">影响入口：<code>{{ f.paths.join(" · ") }}</code></div>
        </div>
        <el-switch
          :model-value="features[f.key]"
          :loading="pendingKey === f.key"
          size="large"
          inline-prompt
          active-text="开"
          inactive-text="关"
          @change="(v: boolean | string | number) => toggle(f.key, Boolean(v))"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi } from "@/api/admin";
import { useSiteStore } from "@/stores/site";

type FKey = "forum" | "market" | "coursereview" | "electric";

const site = useSiteStore();
const loading = ref(false);
const configLoading = ref(false);
const savingConfig = ref(false);
const pendingKey = ref<FKey | null>(null);
const siteOrigin = ref("");
const aiReviewEnabled = ref(false);
const aiReviewProvider = ref("deepseek");
const aiReviewModel = ref("deepseek-v4-flash");
const aiReviewApiKey = ref("");
const aiReviewAutoPassScore = ref(24);
const aiReviewBlockScore = ref(70);
const features = reactive<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean }>({
  forum: true, market: true, coursereview: true, electric: true,
});

const featureMeta: { key: FKey; icon: string; title: string; desc: string; paths: string[] }[] = [
  {
    key: "forum", icon: "💬", title: "论坛（通用板块 + 发帖）",
    desc: "灌水广场 / 校园生活 / 新生入学 / 提问广场等通用板块的可见与发帖。",
    paths: ["/forum", "/post", "/forum/topic/:id"],
  },
  {
    key: "market", icon: "🛒", title: "二手市场",
    desc: "二手交易板块。涉及个人交易，是常见举报对象。",
    paths: ["/market", "boards type=market"],
  },
  {
    key: "coursereview", icon: "📊", title: "课程点评",
    desc: "评老师 / 课程的板块。",
    paths: ["/coursereview", "/coursereview/:id"],
  },
  {
    key: "electric", icon: "💡", title: "宿舍电费查询",
    desc: "首页与校园服务页的电费快捷卡片；如果隧道不通、不想暴露这个功能时关掉。",
    paths: ["/api/services/dorm-electric", "首页电费卡片"],
  },
];

onMounted(reload);

async function reload() {
  loading.value = true;
  configLoading.value = true;
  try {
    const [r, config] = await Promise.all([adminApi.features(), adminApi.siteConfig()]);
    Object.assign(features, r);
    site.apply(r);
    siteOrigin.value = config.siteOrigin;
    aiReviewEnabled.value = config.aiReviewEnabled;
    aiReviewProvider.value = config.aiReviewProvider;
    aiReviewModel.value = config.aiReviewModel;
    aiReviewApiKey.value = config.aiReviewApiKey;
    aiReviewAutoPassScore.value = config.aiReviewAutoPassScore;
    aiReviewBlockScore.value = config.aiReviewBlockScore;
  } finally {
    loading.value = false;
    configLoading.value = false;
  }
}

async function saveSiteConfig() {
  savingConfig.value = true;
  try {
    const config = await adminApi.updateSiteConfig({ siteOrigin: siteOrigin.value });
    siteOrigin.value = config.siteOrigin;
    ElMessage.success(config.siteOrigin ? "网站域名已保存" : "已清空网站域名");
  } finally {
    savingConfig.value = false;
  }
}

async function saveAiReviewConfig() {
  savingConfig.value = true;
  try {
    const config = await adminApi.updateSiteConfig({
      aiReviewEnabled: aiReviewEnabled.value,
      aiReviewProvider: aiReviewProvider.value,
      aiReviewModel: aiReviewModel.value,
      aiReviewApiKey: aiReviewApiKey.value,
      aiReviewAutoPassScore: aiReviewAutoPassScore.value,
      aiReviewBlockScore: aiReviewBlockScore.value,
    });
    aiReviewEnabled.value = config.aiReviewEnabled;
    aiReviewProvider.value = config.aiReviewProvider;
    aiReviewModel.value = config.aiReviewModel;
    aiReviewApiKey.value = config.aiReviewApiKey;
    aiReviewAutoPassScore.value = config.aiReviewAutoPassScore;
    aiReviewBlockScore.value = config.aiReviewBlockScore;
    ElMessage.success("AI 审核配置已保存");
  } finally {
    savingConfig.value = false;
  }
}

async function toggle(key: FKey, on: boolean) {
  if (!on) {
    try {
      await ElMessageBox.confirm(
        `确认关闭「${featureMeta.find((m) => m.key === key)?.title}」？\n` +
        `普通用户立刻看不到对应入口，无法发新内容。已发布内容会保留。`,
        "确认关闭",
        { type: "warning", confirmButtonText: "关闭", cancelButtonText: "取消" }
      );
    } catch {
      // 用户取消 —— 强制还原 switch 状态
      features[key] = !on;
      return;
    }
  }
  pendingKey.value = key;
  try {
    const r = await adminApi.updateFeatures({ [key]: on });
    Object.assign(features, r);
    site.apply(r);
    ElMessage.success(on ? "已开启" : "已关闭");
  } catch {
    features[key] = !on;
  } finally { pendingKey.value = null; }
}
</script>

<style scoped>
.features-pane { display: flex; flex-direction: column; gap: 14px; }
.warn :deep(.el-alert__title) { font-size: 14px; }
.site-config {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid #e6edf7;
  border-radius: 10px;
  background: #fff;
}
.config-copy {
  flex: 1;
  min-width: 0;
}
.config-form {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(520px, 52%);
}
.ai-config {
  align-items: flex-start;
}
.ai-form {
  width: min(640px, 58%);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}
.ai-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-row--stretch {
  grid-column: 1 / -1;
}
.ai-label {
  font-size: 12px;
  color: #6b7280;
}
.config-form :deep(.el-input) {
  flex: 1;
}
.feature-grid { display: flex; flex-direction: column; gap: 10px; }
.feature-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
}
.left { flex: 1; min-width: 0; }
.title { font-size: 15px; font-weight: 600; color: #1f2937; }
.icon { margin-right: 4px; }
.desc { font-size: 12px; color: #6b7280; margin-top: 4px; line-height: 1.6; }
.paths { font-size: 11px; color: #9ca3af; margin-top: 4px; }
.paths code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; }

@media (max-width: 768px) {
  .site-config,
  .feature-row {
    align-items: stretch;
    flex-direction: column;
    padding: 12px;
  }
  .config-form {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }
  .ai-form {
    width: 100%;
    grid-template-columns: 1fr;
  }
  .feature-row :deep(.el-switch) {
    align-self: flex-start;
  }
  .title {
    line-height: 1.45;
  }
  .paths code {
    display: inline;
    white-space: normal;
    word-break: break-all;
  }
}
</style>
