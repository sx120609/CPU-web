<template>
  <div class="pk-page pk-page--wide jwxt-page" :class="{ 'jwxt-page--login': !showDataShell }">
    <header class="pk-head">
      <div class="pk-title">
        <span class="pk-tile" style="--tone: #2563eb" aria-hidden="true"><AppIcon name="school" /></span>
        <div class="pk-title-copy">
          <h1>教务数据</h1>
          <p>
            {{ pageHintText }}
            学号 / 工号仅用于关联站内账号；勾选保持登录后，<b>学校密码会加密保存在当前浏览器</b>，验证码不会保存。
          </p>
        </div>
      </div>
    </header>

    <!-- 适用范围提示（未授权时显示，避免对已登录的本科生造成视觉噪音） -->
    <el-alert
      v-if="!showDataShell"
      type="info"
      :closable="false"
      show-icon
      class="scope-tip"
    >
      <template #title>
        {{ scopeTipText }}
      </template>
    </el-alert>

    <el-alert
      v-if="academicDataUnavailable"
      type="info"
      :closable="false"
      show-icon
      class="scope-tip"
      title="学校没有返回授权失效提示，但尚未返回可读取的教务数据。站内账号仍可正常使用，也可以手动重新授权核验。"
    />
    <el-alert
      v-else-if="jwxt.authorizationExpired"
      type="warning"
      :closable="false"
      show-icon
      class="scope-tip"
      title="学校返回了登录或统一认证提示，当前教务授权已失效，请重新授权。"
    />

    <!-- 未登录：显示登录卡片 -->
    <div v-if="!showDataShell" class="cpu-card login-card">
      <div class="login-head">
        <span class="pk-tile" aria-hidden="true"><el-icon><Lock /></el-icon></span>
        <div>
          <h3>授权读取教务数据</h3>
          <p>{{ loginCardHintText }}</p>
          <p>本应用独立运营，非学校官方应用；教务数据以学校原站为准。</p>
        </div>
      </div>

      <el-alert
        type="warning"
        :closable="false"
        title="安全告知"
        show-icon
      >
        <ul class="safety">
          <li>学号 / 工号会用于创建或关联站内账号</li>
          <li>勾选保持登录后，学校密码会加密保存在当前浏览器；验证码不会保存</li>
        </ul>
      </el-alert>

      <el-form
        :model="form"
        :rules="rules"
        ref="formRef"
        label-position="top"
        autocomplete="on"
        @submit.prevent="onSubmit"
        size="large"
        class="form"
      >
        <el-alert
          v-if="usingSavedCredentialRecovery"
          type="success"
          :closable="false"
          show-icon
          title="已读取本浏览器保存的登录信息，恢复时无需重新输入密码。"
        />
        <el-form-item v-if="!usingSavedCredentialRecovery" label="学号 / 工号" prop="username">
          <el-input v-model="form.username" name="username" placeholder="学号 / 工号" autocomplete="username" :disabled="jwxt.loading">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="!usingSavedCredentialRecovery" label="密码" prop="password">
          <el-input v-model="form.password" name="password" type="password" show-password placeholder="统一认证密码" autocomplete="current-password" :disabled="jwxt.loading">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="jwxt.needCaptcha" label="验证码" prop="captcha">
          <div class="vcode-row">
            <el-input v-model="form.captcha" placeholder="看图输入" maxlength="8" class="vcode-input" :disabled="jwxt.loading || captchaLoading" />
            <div class="vcode-side">
              <button data-cpu-button="media" v-if="jwxt.captchaImage" type="button" class="vcode-img-button" :disabled="jwxt.loading || captchaLoading" @click="reloadCaptcha">
                <img :src="jwxt.captchaImage" alt="captcha" class="vcode-img" loading="lazy" decoding="async" fetchpriority="low" :title="'点击换一张'" />
              </button>
              <el-button text class="vcode-refresh" :loading="captchaLoading" :disabled="jwxt.loading || captchaLoading" @click="reloadCaptcha"><el-icon><Refresh /></el-icon></el-button>
            </div>
          </div>
        </el-form-item>

        <el-form-item>
          <div class="remember-row">
            <div class="remember-main">
              <el-checkbox v-model="remember">
                保持登录状态并保存到本浏览器
              </el-checkbox>
            </div>
            <el-button v-if="jwxt.rememberSaved" text type="danger" size="small" class="forget-saved-btn" :loading="forgetBusy" :disabled="jwxt.loading || forgetBusy" @click="onForget">
              忘记已保存账号
            </el-button>
            <el-button v-if="usingSavedCredentialRecovery" text size="small" :disabled="jwxt.loading" @click="useManualCredentials">
              改用账号密码
            </el-button>
          </div>
          <!-- 直接写出来而不是放进悬停提示：触屏设备上悬停提示既不好打开也不好关闭。 -->
          <p class="remember-hint">勾选后会在当前浏览器加密保存学校账号密码，用于会话过期后自动重新登录。共享电脑请不要勾选。</p>
        </el-form-item>

        <el-form-item v-if="jwxt.error">
          <el-alert :title="jwxt.error" type="error" :closable="false" show-icon />
        </el-form-item>

        <PrivacyConsent v-model="privacyAccepted" :disabled="jwxt.loading" />
        <el-form-item>
          <el-button type="primary" native-type="submit" :loading="jwxt.loading" :disabled="jwxt.loading || captchaLoading || !privacyAccepted" class="btn-submit">
            {{ usingSavedCredentialRecovery ? (jwxt.needCaptcha ? "验证并恢复" : "使用已保存信息恢复") : "登录并查看" }}
          </el-button>
        </el-form-item>
      </el-form>

      <div class="alt-link">
        暂不授权？也可以 <a :href="schoolSystemLink" target="_blank" rel="noopener noreferrer">{{ schoolSystemLabel }}</a>
      </div>
    </div>

    <!-- 已登录：功能 Tab -->
    <div v-else class="jwxt-shell">
      <div v-if="academicDataUnavailable" class="cpu-card academic-empty-state">
        <el-empty description="暂无教务数据" :image-size="88" />
        <div class="academic-empty-desc">
          <p>学校没有返回授权失效提示，但尚未创建可读取的教务入口或课表数据。</p>
          <p>这不会被当成授权失效；如果学校原站已经有数据，可以手动重新授权核验。</p>
        </div>
        <el-button type="primary" :loading="reauthorizeBusy" :disabled="reauthorizeBusy" @click="onManualReauthorize">
          <el-icon><Refresh /></el-icon> 重新核验授权
        </el-button>
      </div>

      <div v-if="!academicDataUnavailable" class="cpu-card session-info" :class="{ 'is-cache-only': !jwxt.isLoggedIn }">
        <div class="session-main">
          <el-icon class="session-ok"><CircleCheckFilled /></el-icon>
          <div class="session-copy">
            <div class="session-title-row">
              <div class="session-title">{{ sessionTitleText }}</div>
              <el-tag v-if="jwxt.isLoggedIn" class="session-mode" size="small" effect="plain" type="success">{{ identityBadgeText }}</el-tag>
            </div>
            <div class="session-sub">{{ sessionSubText }}</div>
          </div>
        </div>
        <div class="session-actions">
          <el-tag v-if="jwxt.isLoggedIn && jwxt.rememberSaved" size="small" type="warning" class="remember-tag">
            已保存登录信息
          </el-tag>
          <el-button v-if="jwxt.isLoggedIn && jwxt.rememberSaved" plain type="warning" size="small" :loading="forgetBusy" :disabled="logoutBusy || forgetBusy" @click="onForget">
            清除已保存信息
          </el-button>
          <el-button v-if="jwxt.isLoggedIn" plain type="danger" size="small" :loading="logoutBusy" :disabled="logoutBusy || forgetBusy" @click="onLogout">
            <el-icon><CircleClose /></el-icon> 断开连接
          </el-button>
          <el-button v-else type="primary" size="small" :loading="reauthorizeBusy" :disabled="reauthorizeBusy" @click="onManualReauthorize">
            {{ jwxt.needCaptcha ? "补充验证码" : "恢复连接" }}
          </el-button>
        </div>
      </div>

      <el-tabs v-if="!academicDataUnavailable && hasJwxtTabs" v-model="tab" class="cpu-card jwxt-tabs" @tab-change="onTabChange">
        <el-tab-pane name="schedule" lazy>
          <template #label><AppIcon name="calendar" /> 课表</template>
          <SchedulePane :data="schedule" :loading="tabLoading" :source="isGraduateIdentity ? 'graduate' : 'jwxt'" />
          <ScheduleUsageNotice v-if="tab === 'schedule'" />
        </el-tab-pane>
        <el-tab-pane v-if="!isGraduateIdentity" name="grades" lazy>
          <template #label><AppIcon name="chart" /> 成绩</template>
          <GradesPane :data="grades" :loading="tabLoading" />
        </el-tab-pane>
        <!-- 期中功能暂时停用，保留组件和接入代码，恢复时同步启用 jwxtPrewarm.ts 中的预加载。
        <el-tab-pane v-if="!isGraduateIdentity" name="midterm" lazy>
          <template #label><AppIcon name="document" /> 期中成绩</template>
          <MidtermGradesPane :data="midtermGrades" :loading="tabLoading" />
        </el-tab-pane>
        -->
        <el-tab-pane v-if="!isGraduateIdentity" name="progress" lazy>
          <template #label><AppIcon name="school" /> 学业完成情况</template>
          <ProgressPane :data="progress" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane v-if="!isGraduateIdentity" name="pyfa" lazy>
          <template #label><AppIcon name="course" /> 培养方案</template>
          <PyfaPane :data="pyfa" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane name="debug" v-if="isDev">
          <template #label><AppIcon name="tools" /> 调试</template>
          <div class="debug-pane">
            <p class="cpu-muted">开发模式：点击「拉取调试快照」后端会把教务页面 HTML 落到 <code>server/.debug/</code>，供解析器开发用。</p>
            <el-button type="primary" :loading="snapping" :disabled="snapping" @click="onSnapshot"><AppIcon name="camera" /> 拉取调试快照</el-button>
            <ul v-if="snapResult?.saved?.length" class="snap-list">
              <li v-for="s in snapResult.saved" :key="s"><AppIcon name="success" /> {{ s }}</li>
              <li v-for="e in snapResult.errors" :key="e" style="color:#dc2626"><AppIcon name="close" /> {{ e }}</li>
            </ul>
            <el-divider />
            <p class="cpu-muted">自定义路径探针（仅 dev）：</p>
            <div class="probe-row">
              <el-input v-model="probePath" placeholder="例如 /jsxsd/xskb/xskb_list.do?xnxqid=2024-2025-2-1" :disabled="probing" />
              <el-button @click="onProbe" :loading="probing" :disabled="probing">GET</el-button>
            </div>
            <el-input v-if="probeHtml" v-model="probeHtml" type="textarea" :rows="14" readonly style="margin-top:8px;font-family:var(--cpu-font-mono)" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import "@/styles/page-kit.css";
import AppIcon from "@/components/common/AppIcon.vue";
import ScheduleUsageNotice from "@/components/jwxt/ScheduleUsageNotice.vue";
import { defineAsyncComponent } from "vue";
import { Lock, User, Refresh, CircleCheckFilled, CircleClose } from "@element-plus/icons-vue";
import PrivacyConsent from "@/components/common/PrivacyConsent.vue";
import { useInjectedJwxtPage } from "./jwxtPage";
const SchedulePane = defineAsyncComponent(() => import("@/components/jwxt/SchedulePane.vue"));
const GradesPane = defineAsyncComponent(() => import("@/components/jwxt/GradesPane.vue"));
// const MidtermGradesPane = defineAsyncComponent(() => import("@/components/jwxt/MidtermGradesPane.vue"));
const ProgressPane = defineAsyncComponent(() => import("@/components/jwxt/ProgressPane.vue"));
const PyfaPane = defineAsyncComponent(() => import("@/components/jwxt/PyfaPane.vue"));

const {
  jwxt,
  formRef,
  form,
  rules,
  privacyAccepted,
  remember,
  isGraduateIdentity,
  tab,
  schedule,
  grades,
  progress,
  pyfa,
  tabLoading,
  captchaLoading,
  logoutBusy,
  forgetBusy,
  reauthorizeBusy,
  probePath,
  probeHtml,
  probing,
  snapping,
  snapResult,
  isDev,
  hasJwxtTabs,
  academicDataUnavailable,
  showDataShell,
  usingSavedCredentialRecovery,
  pageHintText,
  loginCardHintText,
  scopeTipText,
  schoolSystemLink,
  schoolSystemLabel,
  sessionSubText,
  sessionTitleText,
  identityBadgeText,
  reloadCaptcha,
  onSubmit,
  onLogout,
  onForget,
  onTabChange,
  onSnapshot,
  onProbe,
  onManualReauthorize,
  useManualCredentials,
} = useInjectedJwxtPage();
</script>

<style scoped lang="scss">
.jwxt-page--login { max-width: 620px; }
.pk-title p b { color: var(--cpu-accent); font-weight: 500; }
.scope-tip { border-radius: var(--cpu-radius-l); }
.jwxt-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  padding: 20px 24px;
  box-shadow: var(--cpu-shadow-sm);
}

.login-card { padding: 24px 28px; }

.login-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.login-head h3 { margin: 0; font-size: var(--cpu-fs-l); }
.login-head p { margin: 2px 0 0; font-size: var(--cpu-fs-xs); color: var(--cpu-text-secondary); }
.login-head b { color: var(--cpu-primary); }

.safety { padding-left: 20px; margin: 4px 0 0; line-height: 1.7; font-size: var(--cpu-fs-xs); }
.safety li b { color: var(--cpu-accent); }

.form { margin-top: 16px; }
.btn-submit { width: 100%; letter-spacing: 4px; }
.remember-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.remember-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.forget-saved-btn {
  margin-left: auto;
}

.vcode-row { display: flex; gap: 8px; align-items: center; }
.vcode-input {
  flex: 1;
  min-width: 0;
}
.vcode-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.vcode-img-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--cpu-radius-s);
  background: transparent;
  cursor: pointer;
}
.vcode-img-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
.vcode-img-button:focus-visible {
  outline: 2px solid rgba(22, 135, 118, 0.35);
  outline-offset: 2px;
}
.vcode-img {
  height: 36px;
  border-radius: var(--cpu-radius-s);
  border: 1px solid var(--cpu-border-soft);
  display: block;
}
.vcode-refresh {
  flex-shrink: 0;
}

.alt-link {
  margin-top: 12px;
  text-align: center;
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
}
.alt-link a { color: var(--cpu-primary); margin-left: 4px; }

.session-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  --session-tone: var(--cpu-success);
  padding: 12px 16px;
  font-size: var(--cpu-fs-s);
}
.session-info.is-cache-only { --session-tone: var(--cpu-gold); }
.session-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.session-ok {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  background: color-mix(in srgb, var(--session-tone) 13%, var(--cpu-card));
  color: color-mix(in srgb, var(--session-tone) 82%, var(--cpu-text));
  font-size: var(--cpu-fs-l);
  flex-shrink: 0;
}
.session-copy {
  min-width: 0;
}
.session-title {
  font-weight: 500;
  color: var(--cpu-text);
}
.session-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.session-sub {
  margin-top: 2px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.6;
}
.session-mode {
  flex: 0 0 auto;
}
.session-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.academic-empty-state {
  padding: 28px 20px;
  text-align: center;
}
.academic-empty-desc {
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.7;
}
.academic-empty-desc p {
  margin: 0;
}
.academic-empty-state > .el-button {
  margin-top: 14px;
}
.remember-tag {
  margin-right: 0;
}
.remember-hint {
  flex-basis: 100%;
  margin: 2px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.6;
}

/* 标签页改成分段样式，内容区不再带下划线。 */
.jwxt-tabs { padding: 14px 20px 20px; }
.jwxt-tabs :deep(.el-tabs__header) { margin-bottom: 16px; }
.jwxt-tabs :deep(.el-tabs__nav-wrap::after),
.jwxt-tabs :deep(.el-tabs__active-bar) { display: none; }
.jwxt-tabs :deep(.el-tabs__nav) {
  gap: 4px;
  padding: 4px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-subtle);
}
.jwxt-tabs :deep(.el-tabs__item) {
  height: 36px;
  gap: 6px;
  padding: 0 16px !important;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-m);
  font-weight: 500;
}
.jwxt-tabs :deep(.el-tabs__item.is-active) {
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
  color: var(--cpu-primary);
}

.debug-pane { padding: 8px 0; }
.probe-row {
  display: flex;
  gap: 8px;
}
.snap-list { font-size: var(--cpu-fs-xs); color: var(--cpu-text-secondary); list-style: none; padding: 0; margin: 10px 0; }
.snap-list li { padding: 2px 0; font-family: var(--cpu-font-mono); }
.cpu-muted { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
</style>
