<template>
  <div class="auth-wrap">
    <div class="auth-shell">
      <aside class="auth-aside">
        <div class="auth-aside-brand">
          <img :src="'/favicon.svg?v=20260830'" alt="" aria-hidden="true" decoding="async" />
          <span>药大拾间</span>
        </div>
        <h2>课表、教务数据和校园服务，在一个地方查看。</h2>
        <ul>
          <li><el-icon aria-hidden="true"><Calendar /></el-icon>课表与桌面小组件</li>
          <li><el-icon aria-hidden="true"><DataLine /></el-icon>成绩、考试与培养方案</li>
          <li><el-icon aria-hidden="true"><Service /></el-icon>校园服务与小工具</li>
        </ul>
        <p>面向药大师生的独立校园工具 · 非学校官方应用</p>
      </aside>

      <main class="auth-main">
        <nav class="auth-nav">
          <button data-cpu-button="surface" type="button" @click="emit('home')">
            <el-icon aria-hidden="true"><ArrowLeft /></el-icon>返回首页
          </button>
          <slot name="nav" />
        </nav>
        <header class="auth-head">
          <img :src="'/favicon.svg?v=20260830'" alt="" aria-hidden="true" decoding="async" />
          <div>
            <h1>{{ title }}</h1>
            <p v-if="subtitle">{{ subtitle }}</p>
          </div>
        </header>
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft, Calendar, DataLine, Service } from "@element-plus/icons-vue";

// 登录页与注册页共用的外壳：桌面端左侧品牌区，移动端只保留表单一列。
defineProps<{ title: string; subtitle?: string }>();
const emit = defineEmits<{ home: [] }>();
</script>

<style scoped lang="scss">
.auth-wrap {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  place-items: center;
  padding: 24px;
  background: var(--cpu-bg);
}

.auth-shell {
  display: grid;
  width: min(940px, 100%);
  grid-template-columns: minmax(0, .85fr) minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-lg);
}

.auth-aside {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 18px;
  padding: 36px 32px;
  background: var(--cpu-primary-dark);
  color: #fff;
}
.auth-aside-brand { display: flex; align-items: center; gap: 10px; font-size: var(--cpu-fs-xl); font-weight: 700; }
.auth-aside-brand img { width: 36px; height: 36px; border-radius: var(--cpu-radius-m); background: var(--cpu-card); }
.auth-aside h2 { margin: 18px 0 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.45; letter-spacing: -.01em; }
.auth-aside ul { display: grid; gap: 12px; margin: 4px 0 0; padding: 0; list-style: none; }
.auth-aside li { display: flex; align-items: center; gap: 10px; color: rgba(255, 255, 255, .9); font-size: var(--cpu-fs-m); }
.auth-aside li .el-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  background: rgba(255, 255, 255, .14);
  font-size: var(--cpu-fs-l);
}
.auth-aside p { margin: auto 0 0; padding-top: 24px; color: rgba(255, 255, 255, .72); font-size: var(--cpu-fs-xs); line-height: 1.6; }

.auth-main { min-width: 0; padding: 26px 36px 28px; }
.auth-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 -6px 18px; }
.auth-nav :deep(button),
.auth-nav button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: none;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.auth-nav :deep(button:hover),
.auth-nav button:hover { color: var(--cpu-primary); }
.auth-nav :deep(button:focus-visible),
.auth-nav button:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }

.auth-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.auth-head img { display: none; width: 40px; height: 40px; flex: 0 0 auto; border-radius: var(--cpu-radius-m); }
.auth-head h1 { margin: 0; color: var(--cpu-text); font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.35; }
.auth-head p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.6; }

@mixin auth-single-column {
  .auth-wrap { align-items: start; padding: calc(16px + var(--cpu-safe-area-inset-top, 0px)) 12px 18px; }
  .auth-shell { width: min(480px, 100%); grid-template-columns: minmax(0, 1fr); border-radius: var(--cpu-radius-l); box-shadow: var(--cpu-shadow-md); }
  .auth-aside { display: none; }
  .auth-main { padding: 14px 18px 20px; }
  .auth-nav { margin-bottom: 12px; }
  .auth-head img { display: block; }
  .auth-head h1 { font-size: var(--cpu-fs-xl); }
}

@media (max-width: 820px) {
  @include auth-single-column;
}

// Touch tablets in the compact layout (iPad Pro 11 portrait is 834 px) get the same single-column login
// as the 820 px iPad Air, instead of the two-column desktop card.
:where(html[data-cpu-layout="compact"]) {
  @include auth-single-column;
}
</style>
