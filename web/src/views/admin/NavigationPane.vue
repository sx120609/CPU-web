<template>
  <div class="navigation-pane" v-loading="loading">
    <el-alert type="info" :closable="false" show-icon>
      <template #title>顶部导航支持站内路径、外部网址、邮件链接和页内锚点</template>
      导航顺序即展示顺序；主导航空间不足时可把入口放入“更多”。功能联动和受众规则会在前台自动过滤，不影响直接访问时原有的路由权限校验。
    </el-alert>

    <section class="preview-card">
      <div class="preview-head"><strong>实时预览</strong><small>以当前管理员身份预览可见项；灰色项目代表已停用</small></div>
      <div class="nav-preview">
        <span class="preview-brand">药大拾间</span>
        <span v-for="item in items.filter((entry) => entry.primary)" :key="item.id" :class="{ disabled: !item.enabled }">{{ item.label }}</span>
        <span v-if="items.some((entry) => !entry.primary)" class="more">更多⌄</span>
      </div>
      <div class="drawer-preview"><small>移动端抽屉</small><span v-for="item in items.filter((entry) => entry.showInDrawer)" :key="item.id" :class="{ disabled: !item.enabled }"><el-icon><component :is="iconComponents[item.icon]" /></el-icon>{{ item.fullLabel || item.label }}</span></div>
    </section>

    <div class="toolbar">
      <div><strong>{{ items.length }}</strong> 个导航项<small>最多 30 个，可拖拽或使用箭头排序</small></div>
      <div class="toolbar-actions"><el-button @click="addItem">新增导航</el-button><el-button @click="importOpen = true">JSON 导入</el-button><el-button @click="copyJson">复制 JSON</el-button><el-button type="warning" plain @click="resetDefaults">恢复默认</el-button><el-button type="primary" :loading="saving" @click="save">保存并发布</el-button></div>
    </div>

    <el-empty v-if="!loading && !items.length" description="当前顶部导航为空"><el-button type="primary" @click="addItem">添加第一个入口</el-button></el-empty>
    <div class="nav-list">
      <article
        v-for="(item, index) in items"
        :key="item.id"
        class="nav-item"
        :class="{ dragging: dragIndex === index, disabled: !item.enabled }"
        draggable="true"
        @dragstart="dragIndex = index"
        @dragend="dragIndex = -1"
        @dragover.prevent
        @drop="dropAt(index)"
      >
        <header>
          <span class="drag-handle" title="拖动排序">⋮⋮</span>
          <span class="item-icon"><el-icon><component :is="iconComponents[item.icon]" /></el-icon></span>
          <div class="item-title"><strong>{{ item.fullLabel || item.label || '未命名入口' }}</strong><small>{{ item.to || '尚未填写链接' }}</small></div>
          <el-tag size="small" :type="item.primary ? 'success' : 'info'">{{ item.primary ? '主导航' : '更多' }}</el-tag>
          <el-switch v-model="item.enabled" inline-prompt active-text="显" inactive-text="隐" />
          <div class="row-actions"><el-button circle size="small" :disabled="index === 0" @click="move(index, -1)">↑</el-button><el-button circle size="small" :disabled="index === items.length - 1" @click="move(index, 1)">↓</el-button><el-button size="small" @click="duplicate(index)">复制</el-button><el-button size="small" type="danger" plain @click="remove(index)">删除</el-button></div>
        </header>

        <div class="editor-grid">
          <label><span>唯一标识</span><el-input v-model="item.id" maxlength="48" placeholder="例如 lost-found" /></label>
          <label><span>导航短名称</span><el-input v-model="item.label" maxlength="12" placeholder="顶部显示" /></label>
          <label><span>完整名称</span><el-input v-model="item.fullLabel" maxlength="30" placeholder="更多菜单和移动端显示" /></label>
          <label class="wide"><span>链接目标</span><el-input v-model="item.to" maxlength="500" placeholder="/services 或 https://example.com" /></label>
          <label><span>图标</span><el-select v-model="item.icon"><el-option v-for="option in iconOptions" :key="option.value" :label="option.label" :value="option.value"><span class="option-icon"><el-icon><component :is="iconComponents[option.value]" /></el-icon>{{ option.label }}</span></el-option></el-select></label>
          <label><span>桌面位置</span><el-segmented v-model="item.primary" :options="[{ label: '主导航', value: true }, { label: '更多菜单', value: false }]" block /></label>
          <label><span>访问受众</span><el-select v-model="item.audience"><el-option label="所有人" value="all" /><el-option label="仅游客" value="guest" /><el-option label="仅登录用户" value="logged-in" /><el-option label="仅管理人员" value="staff" /></el-select></label>
          <label><span>关联功能开关</span><el-select v-model="item.feature"><el-option label="不关联" value="" /><el-option label="论坛" value="forum" /><el-option label="校园商城" value="market" /><el-option label="课程点评" value="coursereview" /><el-option label="宿舍电费" value="electric" /><el-option label="赞助" value="sponsor" /></el-select></label>
        </div>
        <div class="switch-row"><el-checkbox v-model="item.showInDrawer">显示在移动端抽屉</el-checkbox><el-checkbox v-model="item.requireForumAccess">仅已开启论坛的用户可见</el-checkbox><el-checkbox v-model="item.openInNewTab">新窗口打开</el-checkbox></div>
      </article>
    </div>

    <footer v-if="items.length" class="save-footer"><span>调整完成后需要点击“保存并发布”才会对前台生效。</span><el-button type="primary" size="large" :loading="saving" @click="save">保存并发布</el-button></footer>

    <el-dialog v-model="importOpen" title="JSON 导入导航配置" width="min(720px, 94vw)">
      <el-alert type="warning" :closable="false" title="导入会替换当前编辑区内容，但仍需点击保存才会发布。" />
      <el-input v-model="importJson" class="json-input" type="textarea" :rows="16" placeholder='粘贴 { "items": [...] } 或直接粘贴数组' />
      <template #footer><el-button @click="importOpen = false">取消</el-button><el-button type="primary" @click="applyJsonImport">导入到编辑区</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Bell, Calendar, ChatLineRound, Compass, Goods, House, Link, Reading, Search, Service } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import type { TopNavigationIcon, TopNavigationItem } from "@/api/site";
import { useSiteStore } from "@/stores/site";

const site = useSiteStore();
const loading = ref(false);
const saving = ref(false);
const items = reactive<TopNavigationItem[]>([]);
const defaults = ref<TopNavigationItem[]>([]);
const dragIndex = ref(-1);
const importOpen = ref(false);
const importJson = ref("");
const iconComponents: Record<TopNavigationIcon, unknown> = { home: House, forum: ChatLineRound, "lost-found": Compass, announcement: Bell, academic: Reading, schedule: Calendar, service: Service, course: Reading, market: Goods, search: Search, link: Link };
const iconOptions: Array<{ value: TopNavigationIcon; label: string }> = [
  { value: "home", label: "首页" }, { value: "forum", label: "论坛" }, { value: "lost-found", label: "失物招领" }, { value: "announcement", label: "公告" }, { value: "academic", label: "教务" }, { value: "schedule", label: "日历/课表" }, { value: "service", label: "服务" }, { value: "course", label: "课程" }, { value: "market", label: "商城" }, { value: "search", label: "搜索" }, { value: "link", label: "链接" },
];

onMounted(load);
async function load() { loading.value = true; try { const result = await adminApi.topNavigation({ suppressErrorMessage: true }); replaceItems(result.items); defaults.value = result.defaults.map(cloneItem); } finally { loading.value = false; } }
function cloneItem(item: TopNavigationItem): TopNavigationItem { return { ...item }; }
function replaceItems(next: TopNavigationItem[]) { items.splice(0, items.length, ...next.map(cloneItem)); }
function nextId(prefix = "nav") { let index = items.length + 1; let id = `${prefix}-${index}`; while (items.some((item) => item.id === id)) id = `${prefix}-${++index}`; return id; }
function addItem() { if (items.length >= 30) return ElMessage.warning("最多 30 个导航项"); items.push({ id: nextId(), label: "新入口", fullLabel: "新导航入口", to: "/home", icon: "link", enabled: true, primary: false, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false }); }
function duplicate(index: number) { if (items.length >= 30) return ElMessage.warning("最多 30 个导航项"); const copy = cloneItem(items[index]); copy.id = nextId(copy.id); copy.label = `${copy.label}副本`.slice(0, 12); items.splice(index + 1, 0, copy); }
async function remove(index: number) { await ElMessageBox.confirm(`确认删除“${items[index].fullLabel || items[index].label}”？保存后前台入口会消失。`, "删除导航项", { type: "warning" }); items.splice(index, 1); }
function move(index: number, delta: number) { const target = index + delta; if (target < 0 || target >= items.length) return; const [item] = items.splice(index, 1); items.splice(target, 0, item); }
function dropAt(index: number) { if (dragIndex.value < 0 || dragIndex.value === index) return; const [item] = items.splice(dragIndex.value, 1); const target = dragIndex.value < index ? index - 1 : index; items.splice(target, 0, item); dragIndex.value = -1; }
function validateItems() { if (items.length > 30) return "最多只能配置 30 个导航项"; const ids = new Set<string>(); for (const [index, item] of items.entries()) { const row = `第 ${index + 1} 项`; item.id = item.id.trim().toLowerCase(); item.label = item.label.trim(); item.fullLabel = item.fullLabel.trim(); item.to = item.to.trim(); if (!/^[a-z0-9][a-z0-9_-]*$/.test(item.id)) return `${row}的唯一标识格式不正确`; if (ids.has(item.id)) return `${row}的唯一标识与其他项目重复`; ids.add(item.id); if (!item.label || !item.fullLabel) return `${row}缺少名称`; if (!/^\/(?!\/)|^#[A-Za-z0-9_.:-]+$|^mailto:[^\s]+$|^https?:\/\/[^\s]+$/i.test(item.to)) return `${row}的链接格式不正确`; } return ""; }
async function save() { const error = validateItems(); if (error) return ElMessage.warning(error); saving.value = true; try { const result = await adminApi.updateTopNavigation(items.map(cloneItem)); replaceItems(result.items); defaults.value = result.defaults.map(cloneItem); site.applyTopNavigation(result.items); ElMessage.success("顶部导航已发布"); } finally { saving.value = false; } }
async function resetDefaults() { await ElMessageBox.confirm("这会立即恢复系统默认导航并发布，当前自定义配置将被覆盖。", "恢复默认导航", { type: "warning" }); saving.value = true; try { const result = await adminApi.resetTopNavigation(); replaceItems(result.items); defaults.value = result.defaults.map(cloneItem); site.applyTopNavigation(result.items); ElMessage.success("已恢复默认导航"); } finally { saving.value = false; } }
async function copyJson() { const text = JSON.stringify({ items }, null, 2); try { await navigator.clipboard.writeText(text); ElMessage.success("导航 JSON 已复制"); } catch { importJson.value = text; importOpen.value = true; ElMessage.info("浏览器未允许剪贴板访问，已放入导入框供手动复制"); } }
function applyJsonImport() { const previous = items.map(cloneItem); try { const parsed = JSON.parse(importJson.value); const next = Array.isArray(parsed) ? parsed : parsed.items; if (!Array.isArray(next)) throw new Error(); replaceItems(next as TopNavigationItem[]); const error = validateItems(); if (error) throw new Error(error); importOpen.value = false; ElMessage.success("已导入编辑区，请检查后保存"); } catch (error) { replaceItems(previous); ElMessage.error(error instanceof Error && error.message ? error.message : "JSON 格式不正确"); } }
</script>

<style scoped>
.navigation-pane{display:flex;flex-direction:column;gap:16px}.preview-card{padding:16px;border:1px solid var(--cpu-border-soft);border-radius:14px;background:linear-gradient(135deg,var(--cpu-surface-subtle),var(--cpu-card))}.preview-head{display:flex;justify-content:space-between;margin-bottom:12px}.preview-head small,.toolbar small{color:var(--cpu-text-muted)}.nav-preview{min-height:54px;display:flex;align-items:center;gap:20px;padding:0 18px;border:1px solid var(--cpu-border-soft);border-radius:10px;background:var(--cpu-card);overflow-x:auto}.preview-brand{margin-right:auto;color:var(--cpu-primary);font-weight:800}.nav-preview span:not(.preview-brand){white-space:nowrap;font-size:13px}.disabled{opacity:.35;text-decoration:line-through}.more{padding-left:12px;border-left:1px solid var(--cpu-border-soft)}.drawer-preview{display:flex;align-items:center;gap:8px;margin-top:10px;overflow-x:auto}.drawer-preview small{flex:none;color:var(--cpu-text-muted)}.drawer-preview span{flex:none;display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;background:var(--cpu-card);font-size:11px}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.toolbar>div:first-child{display:flex;align-items:baseline;gap:8px}.toolbar>div:first-child strong{font-size:24px;color:var(--cpu-primary)}.toolbar-actions{display:flex;gap:8px;flex-wrap:wrap}.nav-list{display:flex;flex-direction:column;gap:12px}.nav-item{padding:14px;border:1px solid var(--cpu-border-soft);border-radius:14px;background:var(--cpu-card);transition:.18s}.nav-item.dragging{opacity:.45;border-color:var(--cpu-primary)}.nav-item.disabled{opacity:.76;text-decoration:none}.nav-item header{display:flex;align-items:center;gap:10px}.drag-handle{color:var(--cpu-text-muted);cursor:grab}.item-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;color:var(--cpu-primary);background:color-mix(in srgb,var(--cpu-primary) 10%,transparent);font-size:19px}.item-title{min-width:140px;flex:1;display:flex;flex-direction:column}.item-title small{max-width:420px;overflow:hidden;color:var(--cpu-text-muted);text-overflow:ellipsis;white-space:nowrap}.row-actions{display:flex;gap:5px}.row-actions .el-button+.el-button{margin-left:0}.editor-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-top:15px;padding-top:15px;border-top:1px solid var(--cpu-border-soft)}.editor-grid label{display:flex;flex-direction:column;gap:6px}.editor-grid label>span{color:var(--cpu-text-secondary);font-size:11px}.editor-grid .wide{grid-column:span 2}.switch-row{display:flex;gap:22px;margin-top:13px;flex-wrap:wrap}.option-icon{display:flex;align-items:center;gap:7px}.save-footer{position:sticky;z-index:3;bottom:8px;display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border:1px solid var(--cpu-border-soft);border-radius:12px;background:color-mix(in srgb,var(--cpu-card) 92%,transparent);box-shadow:0 10px 30px rgba(15,23,42,.12);backdrop-filter:blur(12px)}.save-footer span{color:var(--cpu-text-secondary);font-size:12px}.json-input{margin-top:14px}.json-input :deep(textarea){font-family:Consolas,monospace;font-size:12px}
@media(max-width:1000px){.editor-grid{grid-template-columns:1fr 1fr}.nav-item header{flex-wrap:wrap}.item-title{min-width:calc(100% - 110px)}.row-actions{width:100%;justify-content:flex-end}.toolbar{align-items:flex-start;flex-direction:column}.toolbar-actions{width:100%}}
@media(max-width:650px){.preview-head{align-items:flex-start;flex-direction:column;gap:4px}.editor-grid{grid-template-columns:1fr}.editor-grid .wide{grid-column:auto}.nav-item{padding:12px}.nav-item header .el-tag{display:none}.row-actions{justify-content:stretch}.row-actions .el-button{flex:1}.switch-row{gap:6px;flex-direction:column}.toolbar-actions{display:grid;grid-template-columns:1fr 1fr}.toolbar-actions .el-button{margin:0}.save-footer{bottom:70px}.save-footer span{display:none}.save-footer .el-button{width:100%}}
</style>
