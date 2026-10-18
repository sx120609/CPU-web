<template>
  <div class="zhs-shell" :data-theme="resolvedTheme">
  <main class="zhs-page">
    <div class="top-bar"><button v-if="desktopMode" class="text-button back" @click="$emit('back')">← 网课助手</button><a v-else class="back" href="/services/tools">← 校园小工具</a><div class="appearance"><span>外观</span><div class="theme-switch" role="group" aria-label="外观模式"><button v-for="option in themeOptions" :key="option.value" type="button" :aria-pressed="themeMode === option.value" @click="setTheme(option.value)">{{ option.label }}</button></div><small>{{ resolvedTheme === 'dark' ? '当前深色' : '当前浅色' }}</small></div></div>
    <p v-if="themeStorageError" class="muted" role="status">{{ themeStorageError }}</p>
    <header class="page-head">
      <div><div class="eyebrow">学习工作台 / {{ desktopMode ? '桌面版' : '在线版' }}</div><h1>智慧树助手<span>BETA</span></h1><p>连接你的课程，把操作和进度放在一个页面。</p></div>
    </header>

    <div v-if="error" class="notice error" role="alert">{{ error }}<button type="button" @click="reload">重试连接</button></div>
    <div v-if="view && !view.enabled" class="notice" role="status">{{ view.message }}</div>

    <div class="view-tabs" role="tablist" aria-label="助手页面">
      <button id="workspace-tab" role="tab" :aria-selected="activeTab === 'workspace'" aria-controls="workspace-content" @click="activeTab = 'workspace'">学习工作台</button>
      <button v-if="settings?.canAdmin" id="admin-tab" role="tab" :aria-selected="activeTab === 'admin'" aria-controls="admin-content" @click="activeTab = 'admin'">管理员</button>
      <button id="history-tab" role="tab" :aria-selected="activeTab === 'history'" aria-controls="history-content" @click="activeTab = 'history'">本地活动记录 · {{ history.length }}</button>
    </div>
    <section v-if="activeTab === 'history'" id="history-content" class="panel history-panel" role="tabpanel" aria-labelledby="history-tab">
      <div class="panel-title"><h2>本地活动记录</h2><button class="button secondary" :disabled="!history.length" @click="exportHistory">导出记录</button></div>
      <p class="muted">{{ desktopMode ? '自动保存在当前电脑的客户端用户数据中，保留最近 5,000 条。重启客户端后仍可查看，可导出备份。' : '自动保存在当前浏览器、当前站点，按 CPU-web 账号分开保留最近 5,000 条。刷新或重新扫码后仍可查看；清理浏览器数据会删除记录，可导出备份。' }}</p>
      <p class="muted">仅保存页面收到的活动，不含登录凭据。页面关闭期间无法写入本地；重开时可补收{{ desktopMode ? '本机执行组件' : '服务器' }}仍保留的最近 500 条会话记录。共享课的独立练习标为“未检查”，不代表已发现或已完成。</p>
      <p v-if="storageError" class="notice error" role="alert">{{ storageError }} 当前记录仍可查看、导出。</p>
      <div class="history-toolbar"><input v-model="historyQuery" type="search" aria-label="搜索活动记录" placeholder="搜索课程、习题或消息" @input="historyLimit = 50" /><label><input v-model="exerciseOnly" type="checkbox" @change="historyLimit = 50" /> 仅练习提醒</label></div>
      <ol v-if="historyFiltered.length" class="history-list"><li v-for="log in historyFiltered.slice(0, historyLimit)" :key="log.id"><div><span class="log-tag" :class="log.kind">{{ logLabel(log.kind) }}</span><time>{{ dateTimeLabel(log.at) }}</time></div><p>{{ log.message }}</p></li></ol>
      <p v-else class="empty">{{ history.length ? '没有匹配的活动记录' : '收到任务活动后会自动保存在这里；历史记录不会凭空补造。' }}</p>
      <button v-if="historyFiltered.length > historyLimit" class="button secondary" @click="historyLimit += 50">显示更多（共 {{ historyFiltered.length }} 条）</button>
    </section>
    <section v-if="activeTab === 'admin' && settings?.canAdmin" id="admin-content" class="panel admin-panel" role="tabpanel" aria-labelledby="admin-tab">
      <div class="panel-title"><h2>题目作答与提交</h2><span class="status">管理员设置</span></div>
      <p class="muted">控制视频中途的弹题。两个开关默认关闭；{{ desktopMode ? '设置仅对当前电脑的本次客户端运行生效，退出客户端后恢复关闭。' : '设置对本站全部在线助手用户生效，服务重启后恢复关闭。' }}</p>
      <label class="setting-row"><span><strong>弹题自动作答</strong><small>允许脚本选择弹题答案。关闭时遇到弹题停止，交由你在官方页面处理。</small></span><input v-model="autoAnswer" type="checkbox" role="switch" aria-label="弹题自动作答" :disabled="saving" @change="autoSubmit = autoAnswer && autoSubmit" /></label>
      <label class="setting-row"><span><strong>弹题自动提交</strong><small>允许把所选答案提交到智慧树。需先开启自动作答；关闭时不会提交答案。</small></span><input v-model="autoSubmit" type="checkbox" role="switch" aria-label="弹题自动提交" :disabled="saving || !autoAnswer" /></label>
      <div class="audit-note"><strong>排查结果</strong><p>上游共享课包含弹题自动作答及提交，现已增加独立开关。AI 测验、保存试卷答案和自动交卷代码也存在于上游，但未接入此工作台，保持不可用。</p><p>这里的开关不影响视频学习进度上报。更改开关并保存，会停止正在运行的任务并清除这些任务的登录会话；已提交记录无法撤回。</p></div>
      <div class="settings-actions"><button class="button primary" :disabled="saving" @click="saveSettings">{{ saving ? '保存中…' : '保存管理员设置' }}</button><span role="status">{{ settingsMessage }}</span></div>
    </section>
    <div v-show="activeTab === 'workspace'" id="workspace-content" role="tabpanel" aria-labelledby="workspace-tab">
    <ol class="steps" aria-label="使用步骤">
      <li :class="{ done: view?.loggedIn, active: !view?.loggedIn }"><b>{{ view?.loggedIn ? '✓' : '01' }}</b><div><strong>扫码连接</strong><small>使用你的知到账号</small></div></li>
      <li :class="{ active: canSelect && !selected.length, done: selected.length > 0 }"><b>02</b><div><strong>选择课程</strong><small>共享课与校内课</small></div></li>
      <li :class="{ active: view?.state === 'running', done: view?.state === 'completed' }"><b>03</b><div><strong>查看进度</strong><small>随时停止本次运行</small></div></li>
    </ol>

    <div class="workspace">
      <div class="main-column">
        <section class="panel account-panel" aria-labelledby="connection-title">
          <div class="panel-title"><div><span class="section-number">01</span><h2 id="connection-title">连接智慧树</h2></div><span class="status" :class="{ online: view?.loggedIn }"><i></i>{{ connectionLabel }}</span></div>
          <div class="connection-content">
            <div class="qr-box" :aria-busy="view?.state === 'starting'">
              <img v-if="view?.qr" :src="view.qr" alt="智慧树登录二维码，请使用知到 App 扫码" />
              <div v-else-if="view?.loggedIn" class="connected-mark" aria-label="已连接">✓</div>
              <div v-else class="qr-empty"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M5 18V5h13M30 5h13v13M43 30v13H30M18 43H5V30" stroke="currentColor" stroke-width="3"/><path d="M13 13h8v8h-8zM28 13h7v8h-7zM13 28h8v7h-8zM28 28h7v7h-7z" fill="currentColor"/></svg><small>{{ view?.state === 'starting' ? '正在生成…' : '等待连接' }}</small></div>
            </div>
            <div class="connection-copy">
              <h3>{{ view?.loggedIn ? '已连接你的智慧树账号' : '用知到 App 扫码登录' }}</h3>
              <p role="status">{{ view?.message || '正在读取服务状态…' }}</p>
              <p class="muted">登录会话仅用于本次服务，断开后清除。二维码失效后可重新连接。</p>
              <button v-if="!sessionActive" type="button" class="button primary" :disabled="busy || !view?.enabled" @click="act(zhihuishuApi.login)">{{ busy ? '请稍候…' : '生成登录二维码' }}</button>
              <button v-else type="button" class="button secondary" :disabled="busy" @click="confirmStop = true">{{ view?.state === 'running' ? '停止并断开' : '断开连接' }}</button>
            </div>
          </div>
        </section>

        <section class="panel courses-panel" aria-labelledby="courses-title">
          <div class="panel-title"><div><span class="section-number">02</span><h2 id="courses-title">我的课程</h2><span class="count">{{ view?.courses.length || 0 }}</span></div><button class="text-button" type="button" :disabled="!canSelect || busy" @click="act(zhihuishuApi.refresh)">↻ 刷新列表</button></div>
          <div v-for="warning in view?.warnings" :key="warning" class="course-warning" role="status">{{ warning }}</div>
          <div class="course-toolbar"><label class="search"><span aria-hidden="true">⌕</span><input v-model="query" type="search" placeholder="搜索课程名称" aria-label="搜索课程名称" :disabled="!view?.loggedIn" /></label><span>已选 {{ selected.length }} 门</span></div>
          <div v-if="!view?.loggedIn" class="empty"><div class="empty-icon">▤</div><strong>你的课程将在这里显示</strong><p>完成扫码登录后，自动读取当前账号的课程。</p></div>
          <div v-else-if="view.state === 'loading'" class="empty" role="status">正在刷新课程…</div>
          <div v-else-if="!filtered.length" class="empty"><strong>{{ query ? '没有匹配的课程' : '暂未读取到课程' }}</strong><p>{{ query ? '换个关键词试试。' : '可刷新重试；新版 AI 课程暂不支持。' }}</p></div>
          <ul v-else class="course-list">
            <li v-for="course in filtered" :key="course.key" :class="{ selected: selected.includes(course.key) }">
              <label><input v-model="selected" type="checkbox" :value="course.key" :disabled="!canSelect || busy || (selected.length >= 20 && !selected.includes(course.key))" /><span class="course-icon">{{ course.kind === 'shared' ? '共' : '校' }}</span><span class="course-info"><strong>{{ course.name }}</strong><small>{{ course.kind === 'shared' ? '共享课' : '校内课' }}</small></span></label>
            </li>
          </ul>
          <div class="speed-control"><label for="playback-speed">后台播放速度 <strong>{{ speed }}×</strong></label><select id="playback-speed" v-model.number="speed" :disabled="busy || view?.state === 'running'"><option v-for="value in speeds" :key="value" :value="value">{{ value }} 倍速{{ value === 1 ? '（默认）' : '' }}</option></select><p>开始任务时生效，运行中不能更改。实际耗时还会受请求和暂停影响。</p><p v-if="settings">弹题自动作答：{{ settings.autoAnswer ? '开启' : '关闭' }} · 自动提交：{{ settings.autoSubmit ? '开启' : '关闭' }}</p></div>
          <footer class="course-footer"><span>每次最多选择 20 门课程</span><button type="button" class="button primary" :disabled="!canSelect || busy || !selected.length" @click="act(() => zhihuishuApi.start([...selected], speed))">开始运行<span v-if="selected.length"> · {{ selected.length }} 门</span> →</button></footer>
        </section>
      </div>

      <aside class="side-column">
        <section class="panel progress-panel" aria-labelledby="progress-title">
          <div class="panel-title"><div><span class="section-number">03</span><h2 id="progress-title">本次运行</h2></div><span class="live-dot" :class="{ active: view?.state === 'running' }"></span></div>
          <div class="task-state">{{ taskLabel }}</div>
          <div v-if="view?.state === 'running' && view.activity" class="activity-state" role="status"><strong>{{ view.activity.message }}</strong><small>最近状态更新：{{ activityAge }} 秒前</small><small v-if="activityAge >= 20">执行端暂未返回新状态，可能正在等待接口或重试；百分比不代表平台已确认的记录。</small></div>
          <p v-if="view?.total" class="muted">本次任务速度：{{ view.speed }} 倍速</p>
          <div class="task-count"><strong>{{ view?.completed || 0 }}</strong><span>/ {{ view?.total || 0 }} 门已处理</span></div>
          <progress class="course-progress" :value="view?.completed || 0" :max="view?.total || 1" aria-label="本次已处理课程数"></progress>
          <div v-if="view?.current" class="current-task"><small>当前内容</small><strong>{{ view.current.title }}</strong><div v-if="view.current.percent !== null" class="video-progress"><progress :value="view.current.percent" max="100" aria-label="脚本报告的视频进度"></progress><span>{{ Math.round(view.current.percent) }}%</span></div><small>进度由脚本报告，最终学习记录请以智慧树为准。</small></div>
          <p v-else class="muted">选择课程并开始后，在这里查看任务状态。</p>
          <button v-if="view?.state === 'running'" type="button" class="button stop" :disabled="busy" @click="confirmStop = true">停止本次运行</button>
          <p class="runtime-note">关闭页面后任务继续运行，单次最长 2 小时。{{ desktopMode ? '退出客户端会结束会话。' : '服务器重启会结束会话。' }}</p>
        </section>
        <section class="panel logs-panel"><div class="panel-title"><div><h2>活动记录</h2></div><button class="text-button" @click="activeTab = 'history'">本地历史 →</button></div><ol v-if="view?.logs.length" class="logs"><li v-for="log in [...view.logs].reverse().slice(0, 12)" :key="log.id"><time>{{ timeLabel(log.at) }} · {{ logLabel(log.kind) }}</time><span>{{ log.message }}</span></li></ol><p v-else class="muted">连接、任务和练习跳过提示会显示在这里。</p><p class="muted" role="status">{{ storageError || (historyScope ? (desktopMode ? '已收到的活动自动保存到本机客户端' : '已收到的活动自动保存到本地浏览器') : '正在连接本地记录空间…') }}</p></section>
        <p class="scope-note">当前支持共享课与校内课。遇到验证码时请到智慧树处理，再重新连接。</p>
      </aside>
    </div>
    </div>
    <aside class="live-window" aria-label="实时运行状态">
      <button class="live-window-head" type="button" :aria-expanded="!liveCollapsed" aria-controls="live-window-body" @click="liveCollapsed = !liveCollapsed"><span><i :class="{ running: view?.state === 'running' && !error }"></i>实时状态 · {{ error ? '连接异常' : taskLabel }}</span><span aria-hidden="true">{{ liveCollapsed ? '＋' : '−' }}</span></button>
      <div v-show="!liveCollapsed" id="live-window-body" class="live-window-body">
        <strong class="live-title">{{ view?.current?.title || '等待选择课程' }}</strong>
        <div v-if="view?.current?.percent != null" class="video-progress"><progress :value="view.current.percent" max="100" aria-label="实时视频进度"></progress><span>{{ Math.round(view.current.percent) }}%</span></div>
        <p class="live-description" role="status">{{ error ? '页面暂时无法连接服务，显示的是最后收到的状态。' : view?.state === 'running' ? view.activity?.message || '正在启动任务' : view?.message || '正在连接本机服务…' }}</p>
        <small v-if="view?.state === 'running' && activityAge >= 20">执行端已有 {{ activityAge }} 秒未更新状态，可能在等待接口或重试。</small>
        <div class="live-meta"><span>{{ view?.speed || 1 }}× · {{ view?.completed || 0 }}/{{ view?.total || 0 }} 门</span><span>{{ lastSynced ? '同步于 ' + timeLabel(lastSynced) : '尚未同步' }}</span></div>
        <small>约每 2.5 秒同步 · 百分比为脚本报告</small>
      </div>
    </aside>
    <div v-if="confirmStop" class="dialog-backdrop" @click.self="confirmStop = false">
      <section class="stop-dialog" role="dialog" aria-modal="true" aria-labelledby="stop-title" @keydown.esc="confirmStop = false">
        <h2 id="stop-title">停止并断开连接？</h2><p>当前任务会停止，登录会话会清除。已提交的学习记录不会撤回，继续使用需要重新扫码。</p><div><button type="button" class="button secondary" autofocus @click="confirmStop = false">继续使用</button><button type="button" class="button stop" :disabled="busy" @click="disconnect">停止并断开</button></div>
      </section>
    </div>
  </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { zhihuishuApi, type ZhsSnapshot, type ZhsSettings, type ZhsLog } from "@/api/zhihuishu";
import { historyKey, parseHistory, mergeHistory, saveHistory } from "@/utils/zhihuishuHistory";

defineProps<{ desktopMode?: boolean }>();
defineEmits<{ back: [] }>();

const view = ref<ZhsSnapshot | null>(null);
const error = ref("");
const busy = ref(false);
const query = ref("");
const selected = ref<string[]>([]);
const confirmStop = ref(false);
const speed = ref(1);
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const activeTab = ref('workspace');
const settings = ref<ZhsSettings | null>(null);
const autoAnswer = ref(false);
const autoSubmit = ref(false);
const saving = ref(false);
const settingsMessage = ref('');
const liveCollapsed = ref(false);
const lastSynced = ref('');
type ThemeMode = 'light' | 'dark' | 'system';
const themeOptions: { value: ThemeMode; label: string }[] = [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }];
const themeKey = 'cpu-zhs-theme-v1';
const themeMode = ref<ThemeMode>('system');
const themeStorageError = ref('');
const colorQuery = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(colorQuery?.matches ?? false);
const resolvedTheme = computed(() => themeMode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themeMode.value);
function validTheme(value: string | null): ThemeMode { return value === 'light' || value === 'dark' ? value : 'system'; }
try { themeMode.value = validTheme(localStorage.getItem(themeKey)); } catch { /* Default to system if storage is unavailable. */ }
function systemThemeChanged(event: MediaQueryListEvent) { systemDark.value = event.matches; }
function storedThemeChanged(event: StorageEvent) { if (event.key === themeKey || event.key === null) themeMode.value = validTheme(event.newValue); }
function setTheme(mode: ThemeMode) {
  themeMode.value = mode;
  try { localStorage.setItem(themeKey, mode); themeStorageError.value = ''; }
  catch { themeStorageError.value = '外观已切换，但浏览器未允许保存；刷新后将跟随系统。'; }
}
const history = ref<ZhsLog[]>([]);
const historyScope = ref('');
const historyQuery = ref('');
const exerciseOnly = ref(false);
const historyLimit = ref(50);
const storageError = ref('');
const historyFiltered = computed(() => [...history.value].reverse().filter(log => (!exerciseOnly.value || log.kind !== 'info') && log.message.toLocaleLowerCase().includes(historyQuery.value.trim().toLocaleLowerCase())));
function logLabel(kind: ZhsLog['kind']) { return { info: '任务活动', skipped: '已跳过', uninspected: '未检查' }[kind] || '任务活动'; }
function dateTimeLabel(at: string) { return new Date(at).toLocaleString('zh-CN', { hour12: false }); }
function loadHistory(scope: string) {
  if (!scope || scope === historyScope.value) return;
  historyScope.value = scope; history.value = []; storageError.value = '';
  try { history.value = parseHistory(localStorage.getItem(historyKey(scope))); sessionStorage.setItem('cpu-zhs-history-scope', scope); }
  catch { storageError.value = '无法读取本地存储，可能被浏览器限制或数据损坏。'; }
}
function persistHistory(logs: ZhsLog[]) {
  if (!historyScope.value) return;
  // Accept old session logs during a rolling update without saving other fields.
  const clean = logs.map(log => ({ id: log.id || `${log.at}:${log.message}`, at: log.at, message: log.message, kind: log.kind || 'info' }));
  history.value = mergeHistory(history.value, clean);
  try { history.value = saveHistory(localStorage, historyScope.value, history.value, []); storageError.value = ''; }
  catch { storageError.value = '本地保存失败（存储已满、被禁用或数据损坏），请导出备份。'; }
}
function exportHistory() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(history.value, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `智慧树活动记录-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let disposed = false;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const canSelect = computed(() => Boolean(view.value?.loggedIn && ["ready", "completed"].includes(view.value.state)));
const sessionActive = computed(() => Boolean(view.value && ["starting", "qr", "loading", "ready", "running", "completed"].includes(view.value.state)));
const connectionLabel = computed(() => view.value?.loggedIn ? "已连接" : view.value?.state === "qr" ? "等待扫码" : view.value?.state === "starting" ? "连接中" : "未连接");
const taskLabel = computed(() => ({ offline: "等待开始", starting: "正在连接", qr: "等待扫码", loading: "读取课程", ready: "准备就绪", running: "正在运行", completed: "本次任务已结束", stopped: "已停止", error: "需要处理" }[view.value?.state || "offline"]));
const filtered = computed(() => view.value?.courses.filter(c => c.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())) || []);
const activityAge = computed(() => Math.max(0, Math.floor((Date.now() - Date.parse(view.value?.activity?.updatedAt || new Date().toISOString())) / 1000)));
function timeLabel(value: string) { return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function apply(next: ZhsSnapshot) {
  view.value = next;
  lastSynced.value = new Date().toISOString();
  persistHistory(next.logs);
  if (next.state === 'running') speed.value = next.speed;
  selected.value = selected.value.filter(key => next.courses.some(c => c.key === key));
}
function message(e: unknown) { return e instanceof Error ? e.message : "连接失败，请稍后重试"; }
async function reload() {
  const current = revision;
  try {
    const [next, config] = await Promise.all([zhihuishuApi.session(), zhihuishuApi.settings()]);
    if (!disposed && current === revision) {
      loadHistory(config.historyScope);
      apply(next); error.value = "";
      const dirty = settings.value && (autoAnswer.value !== settings.value.autoAnswer || autoSubmit.value !== settings.value.autoSubmit);
      if (!dirty) { autoAnswer.value = config.autoAnswer; autoSubmit.value = config.autoSubmit; }
      settings.value = config;
      if (!config.canAdmin && activeTab.value === 'admin') activeTab.value = 'workspace';
    }
  } catch (e) { if (!disposed && current === revision) error.value = message(e); }
}
async function poll() {
  if (disposed) return;
  if (!busy.value) await reload();
  if (!disposed) timer = setTimeout(poll, error.value ? 8000 : 2500);
}
async function act(action: () => Promise<ZhsSnapshot>) {
  if (busy.value) return;
  revision += 1; busy.value = true; error.value = "";
  try { const next = await action(); if (!disposed) apply(next); }
  catch (e) { if (!disposed) error.value = message(e); }
  finally { busy.value = false; revision += 1; }
}
async function disconnect() { confirmStop.value = false; await act(zhihuishuApi.disconnect); }
async function saveSettings() {
  if (saving.value) return;
  saving.value = true; settingsMessage.value = '';
  try {
    const next = await zhihuishuApi.saveSettings({ autoAnswer: autoAnswer.value, autoSubmit: autoSubmit.value });
    if (!disposed) { settings.value = next; settingsMessage.value = '已保存'; await reload(); }
  } catch (e) { if (!disposed) settingsMessage.value = message(e); }
  finally { saving.value = false; }
}
onMounted(() => {
  colorQuery?.addEventListener('change', systemThemeChanged);
  window.addEventListener('storage', storedThemeChanged);
  try { const previous = sessionStorage.getItem('cpu-zhs-history-scope'); if (previous) loadHistory(previous); } catch { /* The storage error is shown when saving. */ }
  void poll();
});
onBeforeUnmount(() => { disposed = true; revision += 1; clearTimeout(timer); colorQuery?.removeEventListener('change', systemThemeChanged); window.removeEventListener('storage', storedThemeChanged); });
</script>

<style scoped>
.zhs-shell{--ink:#20352e;--muted:#65786c;--line:#dce6df;--paper:#fff;--green:#16775b;--canvas:#f4f7f5;--soft:#f0f5f1;--tint:#e1f0e7;--track:#e9efeb;--selected:#f1f8f4;--primary-hover:#0e6048;--on-primary:#fff;--warning-bg:#fff5df;--warning-ink:#835f23;--danger-bg:#fff0ed;--danger-ink:#984932;--neutral-bg:#eef0fa;--neutral-ink:#546184;min-height:100vh;background:var(--canvas);color:var(--ink);color-scheme:light}
.zhs-shell[data-theme=dark]{--ink:#e3ede7;--muted:#acbfb3;--line:#34483c;--paper:#1b2922;--green:#76d5aa;--canvas:#111b16;--soft:#23362b;--tint:#2b4436;--track:#34483c;--selected:#263c30;--primary-hover:#8be6bc;--on-primary:#10251b;--warning-bg:#42351e;--warning-ink:#f1c578;--danger-bg:#402725;--danger-ink:#f2b0a5;--neutral-bg:#2e344c;--neutral-ink:#c1c9f0;color-scheme:dark}
.top-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.appearance{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--muted)}.appearance small{font-size:10px}.theme-switch{display:flex;padding:3px;border:1px solid var(--line);border-radius:9px;background:var(--paper)}.theme-switch button{border:0;border-radius:6px;padding:7px 10px;background:transparent;font:inherit;color:var(--muted);cursor:pointer}.theme-switch button[aria-pressed=true]{background:var(--tint);color:var(--green)}
.view-tabs{flex-wrap:wrap}.history-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin:20px 0;font-size:12px}.history-toolbar>input{padding:10px;border:1px solid var(--line);border-radius:8px;min-width:0;flex:1;font:inherit;background:var(--paper);color:var(--ink)}.history-toolbar label{display:flex;align-items:center;gap:6px}.history-list{list-style:none;margin:0 0 20px;padding:0}.history-list li{padding:16px 0;border-bottom:1px solid var(--line)}.history-list li>div{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.history-list time{font-size:11px;color:var(--muted)}.history-list p{font-size:13px;line-height:1.8;overflow-wrap:anywhere;margin:10px 0 0}.log-tag{font-size:10px;padding:4px 8px;border-radius:5px;background:var(--soft);color:var(--green)}.log-tag.skipped{background:var(--warning-bg);color:var(--warning-ink)}.log-tag.uninspected{background:var(--neutral-bg);color:var(--neutral-ink)}
.live-window{position:fixed;right:20px;bottom:20px;width:300px;max-width:calc(100vw - 32px);z-index:40;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 30px #20352e24;overflow:hidden}.live-window-head{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:12px 14px;border:0;background:var(--soft);font:inherit;font-size:12px;color:var(--ink);cursor:pointer}.live-window-head>span:first-child{display:flex;align-items:center;gap:8px}.live-window-head i{width:7px;height:7px;border-radius:50%;background:#a6b5ab}.live-window-head i.running{background:var(--green)}.live-window-body{padding:14px;display:grid;gap:10px}.live-title{font-size:13px;overflow-wrap:anywhere}.live-description{font-size:12px;line-height:1.8;margin:0}.live-window-body small{font-size:10px;line-height:1.8;color:var(--muted)}.live-meta{display:flex;justify-content:space-between;font-size:10px;color:var(--muted)}.zhs-page{padding-bottom:300px!important}@media(max-width:600px){.live-window{right:16px;bottom:12px;width:270px}}
.activity-state{display:grid;gap:7px;padding:12px;border-radius:8px;background:var(--soft);margin-bottom:16px;line-height:1.8}.activity-state strong{font-size:12px;font-weight:500}.activity-state small{font-size:11px;color:var(--muted)}
.view-tabs{display:flex;gap:8px;margin-bottom:20px}.view-tabs button{border:1px solid var(--line);background:var(--paper);color:var(--muted);border-radius:8px;padding:10px 18px;cursor:pointer}.view-tabs button[aria-selected=true]{background:var(--tint);color:var(--green);border-color:var(--line)}.speed-control{margin-top:20px;padding:16px;background:var(--soft);border-radius:9px;font-size:12px}.speed-control label{margin-right:16px}.speed-control strong{color:var(--green);margin-left:6px}.speed-control select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)}.speed-control p{color:var(--muted);line-height:1.8;margin:10px 0 0}.admin-panel{max-width:820px}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:22px 0;border-bottom:1px solid var(--line)}.setting-row strong,.setting-row small{display:block}.setting-row strong{font-size:14px}.setting-row small{font-size:12px;line-height:1.8;color:var(--muted);margin-top:8px}.setting-row input{width:22px;height:22px;flex-shrink:0;accent-color:var(--green)}.audit-note{padding:18px;background:var(--soft);border-radius:9px;margin:22px 0;font-size:12px;line-height:1.9}.audit-note p{color:var(--muted);margin-bottom:0}.settings-actions{display:flex;align-items:center;gap:16px;font-size:12px;color:var(--green)}
.zhs-page{max-width:1180px;margin:0 auto;padding:30px 24px 64px;color:var(--ink)}
.back{color:var(--muted);text-decoration:none;font-size:13px}.page-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin:30px 0}.eyebrow{font-size:11px;letter-spacing:2px;color:var(--green);font-weight:650}h1{font-size:34px;letter-spacing:-1px;margin:8px 0 10px;display:flex;align-items:center;gap:13px}h1 span{font-size:10px;letter-spacing:1px;padding:4px 7px;border:1px solid var(--line);border-radius:5px;color:var(--green)}.page-head p{font-size:14px;color:var(--muted);margin:0}
.steps{list-style:none;padding:18px 24px;margin:0 0 24px;display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:12px;background:var(--paper)}.steps li{display:flex;align-items:center;gap:13px;padding:0 22px;border-left:1px solid var(--line)}.steps li:first-child{border:0;padding-left:0}.steps b{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--soft);color:#8a9790;font-size:12px}.steps .active b,.steps .done b{background:var(--tint);color:var(--green)}.steps strong,.steps small{display:block}.steps strong{font-size:13px}.steps small{font-size:11px;color:var(--muted);margin-top:4px}
.workspace{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:22px;align-items:start}.main-column,.side-column{display:grid;gap:20px;min-width:0}.panel{border:1px solid var(--line);border-radius:13px;background:var(--paper);padding:22px}.panel-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}.panel-title>div{display:flex;align-items:center;gap:10px}.panel h2{margin:0;font-size:16px;font-weight:650}.section-number{font:11px ui-monospace,monospace;color:#92a098}.count{font-size:11px;color:var(--muted);padding:2px 7px;background:var(--soft);border-radius:6px}.status{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:11px}.status i,.live-dot{width:6px;height:6px;border-radius:50%;background:#bcc7bf}.status.online{color:var(--green)}.status.online i,.live-dot.active{background:var(--green)}
.connection-content{display:flex;gap:24px;align-items:center}.qr-box{width:136px;height:136px;flex-shrink:0;border:1px solid var(--line);border-radius:12px;display:grid;place-items:center;background:#fff}.qr-box img{width:124px;height:124px;object-fit:contain}.qr-empty{text-align:center;color:#a5b5aa}.qr-empty svg{width:45px;height:45px;display:block;margin:0 auto 12px}.qr-empty small{font-size:11px}.connected-mark{font-size:42px;width:75px;height:75px;display:grid;place-items:center;border-radius:50%;color:var(--green);background:var(--tint)}.connection-copy h3{font-size:15px;margin:0 0 8px}.connection-copy p{font-size:12px;line-height:1.8;margin:6px 0}.muted{color:var(--muted);font-size:12px;line-height:1.8}.connection-copy .button{margin-top:10px}
.button{font:inherit;font-size:12px;border:1px solid transparent;border-radius:8px;padding:10px 16px;cursor:pointer;line-height:1.3;transition:background .15s}.primary{background:var(--green);color:var(--on-primary)}.primary:hover:not(:disabled){background:var(--primary-hover)}.secondary{border-color:var(--line);background:var(--paper);color:var(--ink)}.stop{background:var(--danger-bg);border-color:var(--line);color:var(--danger-ink)}.button:disabled,.text-button:disabled{opacity:.45;cursor:not-allowed}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8fcab3;outline-offset:3px}.text-button{background:none;border:0;font:inherit;font-size:12px;color:var(--green);cursor:pointer}.course-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}.course-toolbar>span{font-size:11px;color:var(--muted);white-space:nowrap}.search{display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;width:70%;color:var(--muted)}.search input{min-width:0;width:100%;border:0;background:transparent;color:var(--ink);font:inherit;font-size:12px}.empty{padding:35px 8px 45px;text-align:center;color:var(--muted)}.empty-icon{font-size:28px;margin-bottom:12px;color:#a6b9ad}.empty strong{font-size:13px;font-weight:500}.empty p{font-size:12px;line-height:1.8}.course-list{list-style:none;padding:0;margin:0;display:grid;gap:8px;max-height:460px;overflow-y:auto}.course-list li{border:1px solid var(--line);border-radius:9px}.course-list li.selected{background:var(--selected);border-color:var(--line)}.course-list label{display:flex;align-items:center;gap:13px;padding:15px 13px;cursor:pointer}.course-list input{accent-color:var(--green);width:16px;height:16px;flex-shrink:0}.course-icon{width:36px;height:40px;flex-shrink:0;background:var(--soft);color:var(--green);display:grid;place-items:center;font-size:13px;border-radius:6px}.course-info{display:grid;gap:6px;min-width:0}.course-info strong{font-size:13px;line-height:1.6;overflow-wrap:anywhere;font-weight:550}.course-info small{font-size:11px;color:var(--muted)}.course-footer{display:flex;align-items:center;justify-content:space-between;gap:15px;border-top:1px solid var(--line);padding-top:18px;margin-top:20px}.course-footer>span{font-size:11px;color:var(--muted)}
.task-state{font-size:12px;color:var(--green);margin-bottom:12px}.task-count{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}.task-count strong{font-size:42px;line-height:1;font-weight:550;letter-spacing:-2px}.task-count span{font-size:12px;color:var(--muted)}progress{appearance:none;-webkit-appearance:none;border:0;height:5px;border-radius:6px;overflow:hidden;background:var(--track);width:100%}progress::-webkit-progress-bar{background:var(--track)}progress::-webkit-progress-value{background:var(--green);border-radius:6px}progress::-moz-progress-bar{background:var(--green)}.current-task{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);display:grid;gap:9px}.current-task strong{font-size:13px;line-height:1.7;overflow-wrap:anywhere}.current-task small{font-size:11px;color:var(--muted);line-height:1.7}.video-progress{display:flex;align-items:center;gap:10px;font-size:11px}.runtime-note{font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:15px;margin:20px 0 0;line-height:1.9}.progress-panel .stop{width:100%;margin-top:15px}.log-caption{color:var(--muted);font-size:10px}.logs{list-style:none;margin:0;padding:0;display:grid;gap:16px}.logs li{display:grid;gap:5px;font-size:12px;line-height:1.7}.logs time{font:10px ui-monospace,monospace;color:var(--muted)}.scope-note{font-size:11px;color:var(--muted);line-height:1.9;margin:0 5px}.notice,.course-warning{font-size:12px;line-height:1.8;padding:12px 16px;background:var(--warning-bg);color:var(--warning-ink);border-radius:8px;margin-bottom:18px}.notice.error{background:var(--danger-bg);color:var(--danger-ink)}.notice button{margin-left:12px;font:inherit;color:inherit;background:none;border:0;text-decoration:underline;cursor:pointer}
.dialog-backdrop{position:fixed;inset:0;background:#193a2c66;backdrop-filter:blur(3px);display:grid;place-items:center;z-index:2500;padding:24px}.stop-dialog{background:var(--paper);padding:28px;border-radius:15px;max-width:420px;box-shadow:0 20px 80px #142d2533}.stop-dialog h2{margin:0 0 12px;font-size:20px}.stop-dialog p{font-size:13px;color:var(--muted);line-height:1.9;margin-bottom:24px}.stop-dialog>div{display:flex;justify-content:flex-end;gap:10px}
@media(max-width:850px){.workspace{grid-template-columns:1fr}.side-column{grid-template-columns:1fr 1fr}.scope-note{grid-column:1/-1}.page-head h1{font-size:28px}.steps li{padding:0 14px}}@media(max-width:540px){.zhs-page{padding:20px 14px 40px}.page-head{margin:24px 0;align-items:flex-start}.page-head p{font-size:12px}.page-head h1{font-size:26px}.steps{padding:14px 10px;gap:5px}.steps li{padding:0 5px;gap:6px}.steps b{width:25px;height:25px;font-size:10px;flex-shrink:0}.steps strong{font-size:11px}.steps small{display:none}.panel{padding:18px}.connection-content{align-items:flex-start;gap:15px}.qr-box{width:108px;height:108px}.qr-box img{width:100px;height:100px}.connection-copy h3{font-size:13px}.connection-copy p{font-size:11px}.side-column{grid-template-columns:1fr}.course-footer{align-items:flex-start}.course-footer>span{max-width:105px;line-height:1.7}.course-footer .button{white-space:nowrap}.panel-title{gap:8px}.panel h2{font-size:15px}}
</style>
