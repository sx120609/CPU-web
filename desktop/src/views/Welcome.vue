<script setup lang="ts">
import { useRouter } from "vue-router";
const router = useRouter();
</script>

<template>
  <div class="welcome">
    <div class="hero">
      <div class="brand-logo">药</div>
      <h1>药大刷课助手</h1>
      <p class="tagline">药大拾间出品 · 学习通自动刷课工具</p>
    </div>

    <div class="features">
      <div class="feat">
        <div class="feat-icon">▶</div>
        <div>
          <div class="feat-title">视频自动播放</div>
          <div class="feat-desc">静音播放、自动跳转下一章</div>
        </div>
      </div>
      <div class="feat">
        <div class="feat-icon">📄</div>
        <div>
          <div class="feat-title">文档自动阅读</div>
          <div class="feat-desc">PPT / PDF 自动标记已读</div>
        </div>
      </div>
      <div class="feat">
        <div class="feat-icon feat-icon-gold">🤖</div>
        <div>
          <div class="feat-title">AI 智能答题</div>
          <div class="feat-desc">即将上线，需平台额度</div>
        </div>
      </div>
    </div>

    <button class="start-btn" @click="router.push('/login')">
      开始使用
    </button>

    <p class="footer-text">
      视频刷课免费 · AI 答题按次扣额度<br/>
      <span class="site">cpu.lizmt.cn</span>
    </p>
  </div>
</template>

<style scoped>
.welcome {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(165deg, #f0faf7 0%, #e8f4f0 40%, #f4f6f8 100%);
  padding: 32px 24px;
  gap: 28px;
}

.hero {
  text-align: center;
}

.brand-logo {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: linear-gradient(135deg, #168776, #0f6557);
  color: #e8a317;
  display: inline-grid;
  place-items: center;
  font-family: serif;
  font-size: 34px;
  font-weight: 700;
  margin-bottom: 14px;
  box-shadow: 0 8px 24px rgba(20, 143, 123, 0.3);
}

.hero h1 {
  font-size: 26px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.tagline {
  font-size: 13px;
  color: #6b7280;
  margin: 6px 0 0;
}

.features {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feat {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 12px;
  backdrop-filter: blur(8px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.feat-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(20, 143, 123, 0.1);
  display: grid;
  place-items: center;
  font-size: 16px;
  flex-shrink: 0;
}

.feat-icon-gold { background: rgba(245, 158, 11, 0.1); }

.feat-title { font-size: 14px; font-weight: 600; color: #1e293b; }
.feat-desc { font-size: 12px; color: #94a3b8; margin-top: 2px; }

.start-btn {
  width: 100%;
  max-width: 320px;
  height: 48px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #148f7b, #0d6e5e);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 2px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 4px 16px rgba(20, 143, 123, 0.35);
}
.start-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(20, 143, 123, 0.45);
}
.start-btn:active { transform: translateY(0); }

.footer-text {
  font-size: 11px;
  color: #9ca3af;
  text-align: center;
  line-height: 1.8;
}
.site { color: #cbd5e1; }
</style>
