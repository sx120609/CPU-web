<template>
  <div class="services-page">
    <div class="page-head">
      <div>
        <h2>🎯 服务导航</h2>
        <p class="hint">
          药大融合门户（<a href="https://i.cpu.edu.cn" target="_blank">i.cpu.edu.cn</a>）的 50+ 应用直通。
          点击任一卡片在新窗口打开，学校 SSO 自动透传登录。
        </p>
      </div>
    </div>

    <!-- 未登录引导 -->
    <div v-if="!jwxt.isLoggedIn" class="cpu-card login-hint">
      <el-icon class="big-icon"><Lock /></el-icon>
      <div class="hint-body">
        <h3>登录学校账号解锁完整服务列表</h3>
        <p>登录后将看到融合门户的全部应用（含你的收藏、热度排序、所属部门）。账号仅在本地浏览器内存中使用，<b>不会上传服务器</b>。</p>
        <el-button type="primary" size="large" @click="$router.push('/jwxt')">前往登录学校账号</el-button>
      </div>
    </div>

    <!-- 未登录的兜底：少量基础外链 -->
    <div v-if="!jwxt.isLoggedIn" class="fallback">
      <h4 class="fb-title">无需登录也可访问</h4>
      <div class="fb-grid">
        <a href="http://lib.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">📚</span><span>图书馆</span></a>
        <a href="http://opac.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">🔍</span><span>馆藏检索</span></a>
        <a href="https://i.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">🏛️</span><span>融合门户</span></a>
        <a href="http://jwc.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">📋</span><span>教务处</span></a>
        <a href="http://news.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">📢</span><span>校园新闻</span></a>
        <a href="https://cpu.91job.org.cn/sub-station/home/10316" target="_blank" class="fb-card"><span class="fb-icon">💼</span><span>就业平台</span></a>
      </div>
    </div>

    <!-- 已登录：完整 i 服务面板 -->
    <IServicePane v-else />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { Lock } from "@element-plus/icons-vue";
import { useJwxtStore } from "@/stores/jwxt";
import IServicePane from "@/components/jwxt/IServicePane.vue";

const jwxt = useJwxtStore();

onMounted(async () => {
  jwxt.hydrate();
  await jwxt.refreshStatus();
  // 若有保存的账号但当前未登录，悄悄尝试自动登录
  if (!jwxt.isLoggedIn && jwxt.rememberSaved) {
    await jwxt.tryAutoLogin();
  }
});
</script>

<style scoped>
.services-page { display: flex; flex-direction: column; gap: 18px; }
.page-head h2 { margin: 0; font-size: 22px; }
.page-head .hint { font-size: 13px; color: #6b7280; margin: 4px 0 0; line-height: 1.7; }
.page-head .hint a { color: var(--cpu-primary); }

.cpu-card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.login-hint {
  display: flex;
  align-items: center;
  gap: 20px;
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
}
.big-icon {
  font-size: 48px;
  color: var(--cpu-primary);
  background: rgba(255,255,255,0.6);
  padding: 16px;
  border-radius: 16px;
}
.hint-body { flex: 1; }
.hint-body h3 { margin: 0 0 6px; font-size: 17px; color: #1f2937; }
.hint-body p { margin: 0 0 12px; font-size: 13px; color: #4b5563; line-height: 1.7; }
.hint-body b { color: #b45309; }

.fallback {
  background: #fff;
  border-radius: 12px;
  padding: 18px 22px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.fb-title { margin: 0 0 12px; font-size: 14px; color: #6b7280; font-weight: 500; }
.fb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.fb-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  text-decoration: none;
  color: #1f2937;
  transition: border-color 0.15s, background 0.15s;
}
.fb-card:hover {
  border-color: var(--cpu-primary);
  background: #f0fdf4;
}
.fb-icon { font-size: 22px; }
</style>
