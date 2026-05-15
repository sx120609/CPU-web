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

type FKey = "forum" | "market" | "coursereview";

const site = useSiteStore();
const loading = ref(false);
const pendingKey = ref<FKey | null>(null);
const features = reactive<{ forum: boolean; market: boolean; coursereview: boolean }>({
  forum: true, market: true, coursereview: true,
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
];

onMounted(reload);

async function reload() {
  loading.value = true;
  try {
    const r = await adminApi.features();
    Object.assign(features, r);
    site.apply(r);
  } finally { loading.value = false; }
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
</style>
