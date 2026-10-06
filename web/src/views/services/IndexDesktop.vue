<template>
  <div class="pk-page pk-page--wide svc-d">
    <header class="pk-head">
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true"><AppIcon name="service" /></span>
        <div class="pk-title-copy">
          <h1>校园服务</h1>
          <p v-if="academicDataUnavailable">
            当前账号已完成站内登录，但学校暂未开放可读取的教务数据；公共服务仍可正常使用，教务相关入口会在数据可用后自动显示。
          </p>
          <p v-else>整理常用校园入口。登录教务后，还可以查看更完整的应用列表。</p>
        </div>
        <router-link v-if="jwxt.isLoggedIn" class="pk-pill svc-d-status" to="/jwxt"><span aria-hidden="true" />教务已连接</router-link>
        <router-link v-else-if="!academicDataUnavailable" class="pk-pill" to="/jwxt">登录教务<el-icon aria-hidden="true"><ArrowRight /></el-icon></router-link>
      </div>
    </header>

    <!-- 客户端下载对访客也可见；电费查询只需要站内登录 -->
    <div class="svc-d-shortcuts">
      <button v-if="electricAvailable" data-cpu-button="surface" type="button" class="svc-d-shortcut" style="--tone: #d97706" @click="electricOpen = true">
        <span class="pk-tile" aria-hidden="true"><AppIcon name="electric" /></span>
        <span><b>宿舍电费查询</b><small>站内查询本宿舍剩余电量、剩余金额与抄表时间</small></span>
        <el-icon aria-hidden="true"><ArrowRight /></el-icon>
      </button>
      <button data-cpu-button="surface" type="button" class="svc-d-shortcut" style="--tone: #2563eb" @click="$router.push('/download')">
        <span class="pk-tile" aria-hidden="true"><AppIcon name="desktop" /></span>
        <span><b>药大拾间客户端</b><small>校园网自动连接、学习通辅助与桌面常驻能力都在客户端中</small></span>
        <el-icon aria-hidden="true"><ArrowRight /></el-icon>
      </button>
    </div>

    <section class="svc-d-section" aria-labelledby="svc-d-tools-title">
      <header class="svc-d-section-head">
        <div>
          <h2 id="svc-d-tools-title" class="pk-h2">校园小工具</h2>
          <p class="pk-muted">反馈、问卷和临时查询这类轻量入口会集中放在这里。</p>
        </div>
        <router-link class="pk-pill" to="/services/tools"><el-icon aria-hidden="true"><Tools /></el-icon>全部工具</router-link>
      </header>
      <p v-if="toolsError" class="pk-notice svc-d-warning">
        <span>{{ toolsError }}</span>
        <el-button text size="small" :loading="toolsLoading" @click="loadToolMetas">重试</el-button>
      </p>
      <div class="svc-d-tools" :aria-busy="toolsLoading">
        <ToolCardDesktop
          v-for="tool in visibleTools"
          :key="tool.slug"
          :tool="tool"
          :badge="toolBadge(tool)"
          :login-required="isLoginRequired(tool.slug)"
          @click="openTool(tool)"
        />
      </div>
    </section>

    <section class="svc-d-section" aria-labelledby="svc-d-apps-title">
      <header class="svc-d-section-head">
        <div>
          <h2 id="svc-d-apps-title" class="pk-h2">校园应用</h2>
          <p v-if="jwxt.isLoggedIn" class="pk-muted">来自学校融合门户，可以搜索、按分类筛选或收藏。</p>
        </div>
      </header>

      <!-- 已登录：完整 i 服务面板 -->
      <div v-if="jwxt.isLoggedIn" class="pk-card"><IServicePane /></div>

      <div v-else-if="academicDataUnavailable" class="pk-card svc-d-gate">
        <span class="pk-tile" aria-hidden="true"><el-icon><InfoFilled /></el-icon></span>
        <div>
          <h3>暂无教务数据</h3>
          <p>当前账号已经登录站内服务，但学校暂未开放可读取的教务入口。等教务数据开通后，这里会自动补全，不需要重新登录。</p>
        </div>
        <el-button type="primary" plain @click="$router.push('/jwxt')">查看教务说明</el-button>
      </div>

      <!-- 未登录 → 引导去 /jwxt 完整登录 -->
      <div v-else class="pk-card svc-d-gate">
        <span class="pk-tile" aria-hidden="true"><el-icon><Lock /></el-icon></span>
        <div>
          <h3>登录后可查看更完整的服务列表</h3>
          <p>登录后可查看更多校园应用和常用入口。学号 / 工号仅用于关联站内账号；勾选保持登录后会在当前浏览器加密保存账号密码，验证码不会保存。</p>
          <PrivacyPolicyNotice align="left" compact />
        </div>
        <el-button type="primary" size="large" @click="$router.push('/jwxt')">前往登录</el-button>
      </div>
    </section>

    <!-- 未登录的兜底：少量基础外链 -->
    <section v-if="!jwxt.isLoggedIn" class="svc-d-section" aria-labelledby="svc-d-links-title">
      <header class="svc-d-section-head">
        <h2 id="svc-d-links-title" class="pk-h2">公开入口</h2>
        <span class="pk-muted">在新页面打开</span>
      </header>
      <div class="svc-d-links">
        <a v-for="link in publicServiceLinks" :key="link.url" :href="link.url" target="_blank" rel="noopener noreferrer">
          <AppIcon :name="link.icon" /><span>{{ link.name }}</span>
        </a>
      </div>
    </section>

    <DormElectricDialog v-model="electricOpen" />
  </div>
</template>

<script setup lang="ts">
import { ArrowRight, InfoFilled, Lock, Tools } from "@element-plus/icons-vue";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import IServicePane from "@/components/jwxt/IServicePane.vue";
import DormElectricDialog from "@/components/services/DormElectricDialog.vue";
import AppIcon from "@/components/common/AppIcon.vue";
import ToolCardDesktop from "./components/ToolCardDesktop.vue";
import { publicServiceLinks, useServicesPage } from "./servicesPage";
import "@/styles/page-kit.css";

const {
  jwxt,
  electricOpen,
  electricAvailable,
  toolsLoading,
  toolsError,
  visibleTools,
  academicDataUnavailable,
  loadToolMetas,
  isLoginRequired,
  toolBadge,
  openTool,
} = useServicesPage();
</script>

<style scoped>
.svc-d { gap: 22px; }
.svc-d-status span { width: 7px; height: 7px; border-radius: 50%; background: var(--cpu-success); }
.svc-d-status { color: var(--cpu-text-secondary); }

.svc-d-shortcuts { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.svc-d-shortcut {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s ease;
}
.svc-d-shortcut > span:nth-child(2) { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.svc-d-shortcut b { font-size: var(--cpu-fs-m); font-weight: 500; }
.svc-d-shortcut small { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.5; }
.svc-d-shortcut > .el-icon { flex: 0 0 auto; color: var(--cpu-text-muted); }
@media (hover: hover) {
  .svc-d-shortcut:hover { border-color: color-mix(in srgb, var(--tone) 46%, var(--cpu-border-soft)); }
}

.svc-d-section { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.svc-d-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 0 2px; }
.svc-d-section-head .pk-h2 { font-size: var(--cpu-fs-l); }
.svc-d-warning { align-items: center; justify-content: space-between; }
.svc-d-tools { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr)); gap: 12px; }
.svc-d-tools[aria-busy="true"] { opacity: .72; }

.svc-d-gate { display: flex; align-items: center; gap: 16px; }
.svc-d-gate > div { min-width: 0; flex: 1; }
.svc-d-gate h3 { margin: 0; font-size: var(--cpu-fs-l); font-weight: 500; }
.svc-d-gate p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; }
.svc-d-gate > .el-button { flex: 0 0 auto; }

.svc-d-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.svc-d-links a {
  display: flex;
  min-width: 0;
  min-height: 48px;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  text-decoration: none;
  transition: border-color .15s ease;
}
.svc-d-links a:hover { border-color: var(--cpu-primary); }
.svc-d-links .cpu-app-icon { color: var(--cpu-primary); font-size: var(--cpu-fs-l); }
.svc-d-links span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
