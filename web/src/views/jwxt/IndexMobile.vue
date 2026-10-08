<template>
  <div class="edu-m">
    <header class="edu-m-head">
      <div class="edu-m-title">
        <h1>教务数据</h1>
        <p v-if="!showDataShell">{{ pageHintText }}</p>
      </div>
      <button
        v-if="showDataShell && !academicDataUnavailable"
        data-cpu-button="surface"
        type="button"
        class="edu-m-status"
        :class="jwxt.isLoggedIn ? 'is-on' : 'is-cache'"
        aria-haspopup="dialog"
        @click="sessionSheetOpen = true"
      >
        <span class="edu-m-dot" aria-hidden="true" />{{ jwxt.isLoggedIn ? "已连接" : "仅缓存" }}
        <el-icon aria-hidden="true"><ArrowRight /></el-icon>
      </button>
    </header>

    <p v-if="academicDataUnavailable && !showDataShell" class="edu-m-notice is-info" role="status">
      <el-icon aria-hidden="true"><InfoFilled /></el-icon>
      <span>学校没有返回授权失效提示，但尚未返回可读取的教务数据。站内账号仍可正常使用，也可以手动重新授权核验。</span>
    </p>
    <p v-else-if="jwxt.authorizationExpired" class="edu-m-notice is-warn" role="status">
      <el-icon aria-hidden="true"><WarningFilled /></el-icon>
      <span>学校返回了登录或统一认证提示，当前教务授权已失效，请重新授权。</span>
    </p>

    <template v-if="showDataShell">
      <section v-if="academicDataUnavailable" class="edu-m-card edu-m-empty">
        <span class="edu-m-tile" style="--tone: #0284c7" aria-hidden="true"><el-icon><InfoFilled /></el-icon></span>
        <b>暂无教务数据</b>
        <p>学校没有返回授权失效提示，但尚未创建可读取的教务入口或课表数据。</p>
        <p>这不会被当成授权失效；如果学校原站已经有数据，可以手动重新授权核验。</p>
        <el-button type="primary" size="large" class="edu-m-block-btn" :icon="Refresh" :loading="reauthorizeBusy" :disabled="reauthorizeBusy" @click="onManualReauthorize">
          重新核验授权
        </el-button>
      </section>

      <template v-else>
        <section v-if="!jwxt.isLoggedIn" class="edu-m-card edu-m-cache">
          <span class="edu-m-tile" style="--tone: #d97706" aria-hidden="true"><el-icon><Clock /></el-icon></span>
          <div>
            <b>{{ sessionTitleText }}</b>
            <p>{{ sessionSubText }}</p>
          </div>
          <el-button type="primary" round :loading="reauthorizeBusy" :disabled="reauthorizeBusy" @click="onManualReauthorize">
            {{ jwxt.needCaptcha ? "补充验证码" : "恢复连接" }}
          </el-button>
        </section>

        <template v-if="availableDataTabs.length">
          <nav class="edu-m-tabs" role="tablist" aria-label="教务数据">
            <button
              v-for="item in visibleTabs"
              :id="`edu-m-tab-${item.name}`"
              :key="item.name"
              data-cpu-button="option"
              type="button"
              role="tab"
              :class="{ active: tab === item.name }"
              :aria-selected="tab === item.name"
              :aria-controls="`edu-m-panel-${item.name}`"
              @click="selectTab(item.name)"
            >
              <el-icon aria-hidden="true"><component :is="item.icon" /></el-icon>{{ item.label }}
            </button>
          </nav>

          <div
            v-for="item in visibleTabs"
            v-show="tab === item.name"
            :id="`edu-m-panel-${item.name}`"
            :key="item.name"
            class="edu-m-panel"
            role="tabpanel"
            :aria-labelledby="`edu-m-tab-${item.name}`"
          >
            <template v-if="visitedTabs.has(item.name)">
              <GradesPane v-if="item.name === 'grades'" :data="grades" :loading="tabLoading && tab === 'grades'" />
              <ProgressPane v-else-if="item.name === 'progress'" :data="progress" :loading="tabLoading && tab === 'progress'" />
              <PyfaPane v-else-if="item.name === 'pyfa'" :data="pyfa" :loading="tabLoading && tab === 'pyfa'" />
            </template>
          </div>
        </template>

        <section v-else class="edu-m-card edu-m-schedule">
          <span class="edu-m-tile" aria-hidden="true"><el-icon><Calendar /></el-icon></span>
          <div>
            <b>移动端课表已放到单独入口</b>
            <p>当前账号已连接教务系统。请从底部「课表」入口查看课表。</p>
          </div>
          <router-link class="edu-m-schedule-link" to="/schedule">打开课表</router-link>
        </section>
      </template>
    </template>

    <template v-else>
      <section class="edu-m-card edu-m-login" aria-labelledby="edu-m-login-title">
        <div class="edu-m-login-head">
          <span class="edu-m-tile" aria-hidden="true"><el-icon><Lock /></el-icon></span>
          <div>
            <h2 id="edu-m-login-title">授权读取教务数据</h2>
            <p>本应用独立运营，非学校官方应用；教务数据以学校原站为准。</p>
          </div>
        </div>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          autocomplete="on"
          size="large"
          class="edu-m-form"
          @submit.prevent="onSubmit"
        >
          <p v-if="usingSavedCredentialRecovery" class="edu-m-saved">
            <el-icon aria-hidden="true"><CircleCheckFilled /></el-icon>
            <span>已读取本浏览器保存的登录信息，恢复时无需重新输入密码。</span>
          </p>
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
            <div class="edu-m-captcha">
              <el-input v-model="form.captcha" placeholder="看图输入" maxlength="8" autocomplete="off" :disabled="jwxt.loading || captchaLoading" />
              <button
                v-if="jwxt.captchaImage"
                data-cpu-button="media"
                type="button"
                class="edu-m-captcha-img"
                aria-label="换一张验证码"
                :disabled="jwxt.loading || captchaLoading"
                @click="reloadCaptcha"
              >
                <img :src="jwxt.captchaImage" alt="验证码" decoding="async" />
              </button>
              <el-button class="edu-m-captcha-refresh" aria-label="刷新验证码" :loading="captchaLoading" :disabled="jwxt.loading || captchaLoading" @click="reloadCaptcha">
                <el-icon v-if="!captchaLoading"><Refresh /></el-icon>
              </el-button>
            </div>
          </el-form-item>

          <div class="edu-m-remember">
            <el-checkbox v-model="remember">保持登录状态并保存到本浏览器</el-checkbox>
            <p>勾选后会在当前浏览器加密保存学校账号密码，用于会话过期后自动重新登录。共享设备请不要勾选。</p>
            <div v-if="jwxt.rememberSaved || usingSavedCredentialRecovery" class="edu-m-remember-actions">
              <el-button v-if="usingSavedCredentialRecovery" text size="small" :disabled="jwxt.loading" @click="useManualCredentials">改用账号密码</el-button>
              <el-button v-if="jwxt.rememberSaved" text type="danger" size="small" :loading="forgetBusy" :disabled="jwxt.loading || forgetBusy" @click="onForget">忘记已保存账号</el-button>
            </div>
          </div>

          <p v-if="jwxt.error" class="edu-m-notice is-error" role="alert">
            <el-icon aria-hidden="true"><CircleCloseFilled /></el-icon>
            <span>{{ jwxt.error }}</span>
          </p>

          <PrivacyConsent v-model="privacyAccepted" :disabled="jwxt.loading" />
          <el-button
            type="primary"
            native-type="submit"
            size="large"
            class="edu-m-block-btn"
            :loading="jwxt.loading"
            :disabled="jwxt.loading || captchaLoading || !privacyAccepted"
          >
            {{ usingSavedCredentialRecovery ? (jwxt.needCaptcha ? "验证并恢复" : "使用已保存信息恢复") : "登录并查看" }}
          </el-button>
        </el-form>
      </section>

      <ul class="edu-m-safety" aria-label="安全告知">
        <li><el-icon aria-hidden="true"><User /></el-icon><span>学号 / 工号会用于创建或关联站内账号</span></li>
        <li><el-icon aria-hidden="true"><Lock /></el-icon><span>勾选保持登录后，学校密码会加密保存在当前浏览器；验证码不会保存</span></li>
        <li><el-icon aria-hidden="true"><InfoFilled /></el-icon><span>{{ loginCardHintText }}</span></li>
      </ul>

      <p class="edu-m-alt">
        暂不授权？也可以<a :href="schoolSystemLink" target="_blank" rel="noopener noreferrer">{{ schoolSystemLabel }}<el-icon aria-hidden="true"><TopRight /></el-icon></a>
      </p>
    </template>

    <el-drawer v-model="sessionSheetOpen" direction="btt" size="auto" title="教务连接" class="edu-m-sheet cpu-sheet-above-native-bar" append-to-body>
      <div class="edu-m-sheet-status" :class="{ 'is-cache': !jwxt.isLoggedIn }">
        <el-icon aria-hidden="true"><component :is="jwxt.isLoggedIn ? CircleCheckFilled : Clock" /></el-icon>
        <div>
          <b>{{ sessionTitleText }}</b>
          <p>{{ sessionSubText }}</p>
          <span v-if="jwxt.isLoggedIn" class="edu-m-chip">{{ identityBadgeText }}</span>
          <span v-if="jwxt.rememberSaved" class="edu-m-chip is-saved">已保存登录信息</span>
        </div>
      </div>
      <div class="edu-m-sheet-actions">
        <template v-if="jwxt.isLoggedIn">
          <el-button v-if="jwxt.rememberSaved" size="large" type="warning" plain :loading="forgetBusy" :disabled="logoutBusy || forgetBusy" @click="onForget">清除已保存信息</el-button>
          <el-button size="large" type="danger" plain :icon="CircleClose" :loading="logoutBusy" :disabled="logoutBusy || forgetBusy" @click="disconnect">
            断开连接
          </el-button>
        </template>
        <el-button v-else size="large" type="primary" :loading="reauthorizeBusy" :disabled="reauthorizeBusy" @click="recover">
          {{ jwxt.needCaptcha ? "补充验证码" : "恢复连接" }}
        </el-button>
        <a class="edu-m-sheet-link" :href="schoolSystemLink" target="_blank" rel="noopener noreferrer">
          {{ schoolSystemLabel }}<el-icon aria-hidden="true"><TopRight /></el-icon>
        </a>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, ref, watch } from "vue";
import {
  ArrowRight,
  Calendar,
  CircleCheckFilled,
  CircleClose,
  CircleCloseFilled,
  Clock,
  DataAnalysis,
  InfoFilled,
  Lock,
  Reading,
  Refresh,
  School,
  TopRight,
  User,
  WarningFilled,
} from "@element-plus/icons-vue";
import PrivacyConsent from "@/components/common/PrivacyConsent.vue";
import { useInjectedJwxtPage, type DataTab, type JwxtTab } from "./jwxtPage";
const GradesPane = defineAsyncComponent(() => import("@/components/jwxt/GradesPane.vue"));
const ProgressPane = defineAsyncComponent(() => import("@/components/jwxt/ProgressPane.vue"));
const PyfaPane = defineAsyncComponent(() => import("@/components/jwxt/PyfaPane.vue"));

const {
  jwxt,
  formRef,
  form,
  rules,
  privacyAccepted,
  remember,
  tab,
  grades,
  progress,
  pyfa,
  tabLoading,
  captchaLoading,
  logoutBusy,
  forgetBusy,
  reauthorizeBusy,
  availableDataTabs,
  academicDataUnavailable,
  showDataShell,
  usingSavedCredentialRecovery,
  pageHintText,
  loginCardHintText,
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
  onManualReauthorize,
  useManualCredentials,
} = useInjectedJwxtPage();

// 移动端课表在独立课表页，这里只提供成绩、学业与培养方案。
const tabMeta: Record<Exclude<DataTab, "schedule">, { label: string; icon: unknown }> = {
  grades: { label: "成绩", icon: DataAnalysis },
  progress: { label: "学业", icon: School },
  pyfa: { label: "培养", icon: Reading },
};
const visibleTabs = computed(() => availableDataTabs.value
  .filter((name): name is Exclude<DataTab, "schedule"> => name !== "schedule")
  .map((name) => ({ name, ...tabMeta[name] })));

const sessionSheetOpen = ref(false);
// 打开过的标签保持挂载，切换回来时保留筛选和滚动位置，与原先 el-tabs lazy 的行为一致。
const visitedTabs = reactive(new Set<JwxtTab>([tab.value]));
watch(tab, (next) => visitedTabs.add(next));

function selectTab(name: JwxtTab) {
  if (tab.value === name) return;
  tab.value = name;
  onTabChange();
}

async function disconnect() {
  await onLogout();
  if (!jwxt.isLoggedIn) sessionSheetOpen.value = false;
}

async function recover() {
  sessionSheetOpen.value = false;
  await onManualReauthorize();
}
</script>

<style scoped>
.edu-m {
  --edu-m-tile-fill: 11%;
  --edu-m-tile-ink: 100%;
  display: flex;
  min-width: 0;
  max-width: 720px;
  margin: 0 auto;
  flex-direction: column;
  gap: 12px;
  color: var(--cpu-text);
}
.edu-m button,
.edu-m a { -webkit-tap-highlight-color: transparent; }
.edu-m :is(button, a):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }

.edu-m-card {
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.edu-m-tile {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-l);
  background: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--edu-m-tile-fill), var(--cpu-card));
  color: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--edu-m-tile-ink), var(--cpu-text));
  font-size: var(--cpu-fs-xl);
}
.edu-m-block-btn { width: 100%; margin: 0 !important; }

.edu-m-head { display: flex; min-height: 32px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px; }
.edu-m-title { min-width: 0; }
.edu-m-title h1 { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
.edu-m-title p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.edu-m-status {
  --status: var(--cpu-success);
  display: inline-flex;
  min-height: 32px;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  cursor: pointer;
}
.edu-m-status.is-cache { --status: var(--cpu-gold); }
.edu-m-status:active { background: var(--cpu-surface-soft); }
.edu-m-status .el-icon { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.edu-m-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--status); box-shadow: 0 0 0 3px color-mix(in srgb, var(--status) 20%, transparent); }

.edu-m-notice {
  --notice: #0284c7;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--notice) 26%, transparent);
  border-radius: var(--cpu-radius-l);
  background: color-mix(in srgb, var(--notice) 9%, var(--cpu-card));
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.6;
}
.edu-m-notice .el-icon { flex: 0 0 auto; margin-top: 2px; color: var(--notice); font-size: var(--cpu-fs-m); }
.edu-m-notice.is-warn { --notice: #d97706; }
.edu-m-notice.is-error { --notice: var(--cpu-danger); margin-bottom: 4px; }

.edu-m-cache { display: flex; align-items: center; gap: 11px; padding: 12px; border-color: var(--cpu-border-soft); }
.edu-m-cache > div { min-width: 0; flex: 1; }
.edu-m-cache b { display: block; font-size: var(--cpu-fs-m); font-weight: 500; }
.edu-m-cache p { margin: 2px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.5; }
.edu-m-cache .el-button { flex: 0 0 auto; margin: 0; }

.edu-m-tabs {
  position: relative;
  z-index: 1;
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.edu-m-tabs button {
  --cpu-button-radius: 10px;
  display: inline-flex;
  min-width: 0;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.edu-m-tabs button .el-icon { font-size: var(--cpu-fs-m); }
.edu-m-tabs button.active { font-weight: 500; }
.edu-m-panel { min-width: 0; min-height: 160px; }

.edu-m-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 22px 16px 16px; text-align: center; }
.edu-m-empty .edu-m-tile { margin-bottom: 6px; }
.edu-m-empty b { font-size: var(--cpu-fs-m); font-weight: 500; }
.edu-m-empty p { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.7; }
.edu-m-empty .el-button { margin-top: 12px !important; }

.edu-m-schedule { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px; }
.edu-m-schedule > div { min-width: 0; flex: 1; }
.edu-m-schedule b { font-size: var(--cpu-fs-m); font-weight: 500; }
.edu-m-schedule p { margin: 3px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.edu-m-schedule-link {
  display: inline-flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-primary);
  color: #fff;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  text-decoration: none;
}

.edu-m-login { padding: 16px 14px 14px; }
.edu-m-login-head { display: flex; align-items: flex-start; gap: 12px; }
.edu-m-login-head h2 { margin: 1px 0 0; font-size: var(--cpu-fs-l); font-weight: 700; line-height: 1.4; }
.edu-m-login-head p { margin: 3px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.edu-m-form { margin-top: 16px; }
.edu-m-form :deep(.el-form-item) { margin-bottom: 16px; }
.edu-m-form :deep(.el-form-item__label) { margin-bottom: 6px; font-weight: 500; }
/* 16px 以下 iOS 会在聚焦时放大页面 */
.edu-m-form :deep(.el-input__inner) { font-size: var(--cpu-fs-l); }
.edu-m-saved {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-s);
  line-height: 1.55;
}
.edu-m-saved .el-icon { flex: 0 0 auto; margin-top: 2px; font-size: var(--cpu-fs-l); }

.edu-m-captcha { display: grid; width: 100%; grid-template-columns: minmax(0, 1fr) auto 40px; align-items: center; gap: 8px; }
.edu-m-captcha-img {
  display: inline-flex;
  height: 40px;
  align-items: center;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-card);
  cursor: pointer;
}
.edu-m-captcha-img img { display: block; height: 100%; max-width: 112px; object-fit: contain; }
.edu-m-captcha-img:disabled { cursor: not-allowed; opacity: .62; }
.edu-m-captcha-refresh { width: 40px; height: 40px; margin: 0 !important; padding: 0; }

.edu-m-remember { margin-bottom: 12px; }
.edu-m-remember :deep(.el-checkbox) { height: auto; min-height: 28px; white-space: normal; }
.edu-m-remember :deep(.el-checkbox__label) { font-size: var(--cpu-fs-m); line-height: 1.5; }
.edu-m-remember > p { margin: 2px 0 0 24px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.edu-m-remember-actions { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 6px 0 0 18px; }
.edu-m-remember-actions .el-button { margin: 0; }
.edu-m-login :deep(.privacy-consent) { margin: 4px 0 14px; }

.edu-m-safety { display: flex; flex-direction: column; gap: 8px; margin: 2px 0 0; padding: 0 6px; list-style: none; }
.edu-m-safety li { display: flex; align-items: flex-start; gap: 8px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.edu-m-safety .el-icon { flex: 0 0 auto; margin-top: 2px; color: var(--cpu-primary); font-size: var(--cpu-fs-m); }

.edu-m-alt { margin: 2px 0 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-align: center; }
.edu-m-alt a,
.edu-m-sheet-link {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 2px;
  color: var(--cpu-primary);
  font-weight: 500;
  text-decoration: none;
}
.edu-m-alt a { margin-left: 4px; }

:global(.edu-m-sheet.el-drawer) { height: auto !important; max-height: min(92dvh, 640px); border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom); }
:global(.edu-m-sheet .el-drawer__header) { margin-bottom: 0; }
:global(.edu-m-sheet .el-drawer__body) { padding-top: 12px; }
.edu-m-sheet-status {
  --status: var(--cpu-success);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-radius: var(--cpu-radius-l);
  background: color-mix(in srgb, var(--status) 10%, var(--cpu-card));
}
.edu-m-sheet-status.is-cache { --status: #d97706; }
.edu-m-sheet-status > .el-icon { flex: 0 0 auto; margin-top: 1px; color: var(--status); font-size: var(--cpu-fs-xl); }
.edu-m-sheet-status b { font-size: var(--cpu-fs-m); font-weight: 500; }
.edu-m-sheet-status p { margin: 3px 0 8px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.edu-m-chip {
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  margin: 0 6px 0 0;
  padding: 0 8px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
}
.edu-m-chip.is-saved { color: var(--cpu-accent); }
.edu-m-sheet-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.edu-m-sheet-actions .el-button { width: 100%; margin: 0; }
.edu-m-sheet-link { justify-content: center; font-size: var(--cpu-fs-s); }

:global(html[data-theme="dark"] .edu-m) {
  --edu-m-tile-fill: 20%;
  --edu-m-tile-ink: 46%;
}

@media (max-width: 360px) {
  .edu-m-title h1 { font-size: var(--cpu-fs-xl); }
  .edu-m-captcha { grid-template-columns: minmax(0, 1fr) 40px; }
  .edu-m-captcha-img { grid-column: 1 / -1; grid-row: 2; justify-content: center; width: 100%; }
}
</style>
