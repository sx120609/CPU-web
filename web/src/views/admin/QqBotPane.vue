<template>
  <div class="qqbot-pane">
    <el-alert
      v-if="configLoadError"
      type="error"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="configLoadError"
    >
      <template #default>
        <el-button size="small" :loading="configLoading" @click="loadConfig">重试配置</el-button>
      </template>
    </el-alert>
    <el-alert
      v-if="boardsLoadError"
      type="warning"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="boardsLoadError"
    >
      <template #default>
        <el-button size="small" :loading="boardsLoading" @click="loadBoards">重试板块</el-button>
      </template>
    </el-alert>

    <section class="section-grid">
      <div class="config-card" v-loading="configLoading || boardsLoading">
        <div class="card-head">
          <div>
            <h3>NapCat 对接</h3>
            <p>在 NapCat 创建一个 WebSocket 服务端，把地址填到这里即可。</p>
          </div>
          <el-switch v-model="form.enabled" inline-prompt active-text="开" inactive-text="关" :disabled="configDisabled" />
        </div>

        <div class="setup-guide">
          <div>
            <b>推荐配置</b>
            <span>NapCat 里新建 WebSocket 服务端；CPU-web 会作为客户端连过去。收 QQ 消息、回复消息、推送通知都走这一条连接。</span>
          </div>
          <div v-if="config" class="status-box">
            <b>当前连接状态</b>
            <span :class="['status-text', `status-${config.connectionStatus}`]">{{ connectionStatusText }}</span>
            <span v-if="config.connectionError" class="status-error">{{ config.connectionError }}</span>
          </div>
        </div>

        <el-form label-width="150px" class="config-form">
          <el-form-item label="Bot QQ 号">
            <el-input v-model="form.botQqId" placeholder="例如 123456789" :disabled="configDisabled" />
            <div class="form-tip">展示在通知设置里，告诉用户应该在 QQ 里联系哪个机器人账号。</div>
          </el-form-item>
          <el-form-item label="WebSocket 地址">
            <el-input v-model="form.napcatBaseUrl" placeholder="例如 ws://127.0.0.1:3001" :disabled="configDisabled" />
            <div class="form-tip">这是 CPU-web 后端连接 NapCat 的地址。NapCat 和后端不在同一台机器时，请填后端能访问到的内网或公网地址。</div>
          </el-form-item>
          <el-form-item label="Access Token">
            <el-input v-model="form.accessToken" show-password placeholder="留空则不修改" :disabled="configDisabled">
              <template #append>{{ config?.hasAccessToken ? config.accessTokenMasked : "未设置" }}</template>
            </el-input>
            <div class="form-tip">如果 NapCat WebSocket 服务端设置了 token，这里填同一个；没设置就留空。</div>
          </el-form-item>
          <el-form-item label="默认投稿板块">
            <el-select v-model="form.defaultBoardSlug" filterable :disabled="configDisabled || Boolean(boardsLoadError)">
              <el-option v-for="board in postBoards" :key="board.slug" :label="`${board.name} / ${board.slug}`" :value="board.slug" />
            </el-select>
          </el-form-item>
          <el-form-item label="能力开关">
            <div class="check-grid">
              <el-checkbox v-model="form.allowPrivatePost" :disabled="configDisabled">允许私聊投稿</el-checkbox>
              <el-checkbox v-model="form.allowGroupPost" :disabled="configDisabled">允许群内投稿</el-checkbox>
              <el-checkbox v-model="form.notificationEnabled" :disabled="configDisabled">推送站内通知</el-checkbox>
            </div>
          </el-form-item>
          <el-form-item label="私聊通知类型">
            <el-checkbox-group v-model="form.notifyCategories" :disabled="configDisabled">
              <el-checkbox label="reply">回复</el-checkbox>
              <el-checkbox label="mention">提及</el-checkbox>
              <el-checkbox label="like">点赞</el-checkbox>
              <el-checkbox label="system">系统</el-checkbox>
              <el-checkbox label="service-tool">小工具提醒</el-checkbox>
              <el-checkbox label="school-feed">校园公告</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="超级管理员">
            <el-select
              v-model="form.superAdminQqIds"
              multiple
              filterable
              allow-create
              default-first-option
              clearable
              collapse-tags
              collapse-tags-tooltip
              :disabled="configDisabled"
              placeholder="输入可跨群执行群管命令的 QQ 号"
            />
            <div class="form-tip">超级管理员按 QQ 号识别，不依赖站内绑定。可跨群执行加群审核、禁言、踢出和授权维护。</div>
          </el-form-item>
        </el-form>

        <div class="actions">
          <el-button type="primary" :loading="saving" :disabled="saving || configDisabled" @click="saveConfig">保存配置</el-button>
          <el-button :loading="dispatching" :disabled="dispatching || configDisabled" @click="dispatchNow">立即派发最近通知</el-button>
          <el-button v-if="config?.hasAccessToken" text type="danger" :loading="clearingToken" :disabled="clearingToken || configDisabled" @click="clearToken">清除 Token</el-button>
        </div>
      </div>

      <div class="config-card">
      <div class="card-head">
        <div>
          <h3>绑定与测试</h3>
          <p>用户在站内生成绑定码后，需要私聊 QQBot 发送“绑定 绑定码”完成关联，绑定码不应发到群里。</p>
        </div>
      </div>
        <div class="bind-box">
          <el-button type="primary" plain :loading="creatingBindToken" :disabled="creatingBindToken" @click="createBindToken">生成我的绑定码</el-button>
          <div v-if="bindToken" class="bind-token">
            <b>{{ bindToken.token }}</b>
            <span>10 分钟内私聊发送：绑定 {{ bindToken.token }}</span>
          </div>
        </div>
        <el-divider />
        <el-form label-width="90px">
          <el-form-item label="QQ 号">
            <el-input v-model="test.qqId" placeholder="私聊测试 QQ 号" />
          </el-form-item>
          <el-form-item label="群号">
            <el-input v-model="test.groupId" placeholder="群消息测试群号，和 QQ 号二选一" />
          </el-form-item>
          <el-form-item label="内容">
            <el-input v-model="test.message" type="textarea" :rows="3" />
          </el-form-item>
        </el-form>
        <div class="actions">
          <el-button :loading="testing" :disabled="testing" @click="sendTest">发送测试消息</el-button>
        </div>
      </div>
    </section>

    <section class="list-card">
      <div class="card-head">
        <div>
          <h3>QQ群配置</h3>
          <p>群配置用于控制群内投稿、公告通知，以及管理群专用的站务提醒。</p>
        </div>
        <el-button type="primary" plain :disabled="savingGroup || groupBusyId !== null || Boolean(groupsLoadError)" @click="openGroupDialog()">添加群</el-button>
      </div>
      <el-alert
        v-if="groupsLoadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="groupsLoadError"
      >
        <template #default>
          <el-button size="small" :loading="groupsLoading" @click="loadGroups">重试</el-button>
        </template>
      </el-alert>
      <el-table :data="groups" v-loading="groupsLoading" size="small" class="interactive-table">
        <el-table-column prop="groupId" label="群号" width="150" />
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="开关" min-width="420">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? "启用" : "停用" }}</el-tag>
            <el-tag :type="row.allowPosting ? 'warning' : 'info'" size="small">投稿 {{ row.allowPosting ? "开" : "关" }}</el-tag>
            <el-tag :type="row.notificationEnabled ? 'success' : 'info'" size="small">通知 {{ row.notificationEnabled ? "开" : "关" }}</el-tag>
            <el-tag :type="row.memberWelcomeEnabled ? 'success' : 'info'" size="small">欢迎 {{ row.memberWelcomeEnabled ? "开" : "关" }}</el-tag>
            <el-tag :type="row.adFilterEnabled ? 'danger' : 'info'" size="small">广告 {{ row.adFilterEnabled ? "开" : "关" }}</el-tag>
            <el-tag :type="row.joinReviewEnabled ? 'warning' : 'info'" size="small">加群审 {{ row.joinReviewEnabled ? "开" : "关" }}</el-tag>
            <el-tag :type="row.allowMute ? 'warning' : 'info'" size="small">禁言 {{ row.allowMute ? "开" : "关" }}</el-tag>
            <el-tag :type="row.allowKick ? 'warning' : 'info'" size="small">踢出 {{ row.allowKick ? "开" : "关" }}</el-tag>
            <el-tag :type="row.allowKickAndBlock ? 'danger' : 'info'" size="small">踢黑 {{ row.allowKickAndBlock ? "开" : "关" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="通知规则" min-width="240">
          <template #default="{ row }">
            <div class="group-meta-tags">
              <el-tag v-for="item in formatGroupNotifyCategories(row.notifyCategories)" :key="item" size="small" effect="plain">{{ item }}</el-tag>
              <el-tag v-for="item in formatGroupNotifyAudiences(row.notifyAudiences)" :key="item" size="small" type="warning" effect="plain">{{ item }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="defaultBoardSlug" label="默认板块" width="130" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="isGroupBusy(row)" @click="openGroupDialog(row)">编辑</el-button>
            <el-button link type="danger" :loading="isGroupBusy(row)" :disabled="isGroupBusy(row)" @click="removeGroup(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="record-list" v-loading="groupsLoading">
        <article v-for="row in groups" :key="`group-${row.id}`" class="record-card">
          <div class="record-head">
            <div>
              <b>{{ row.name || "未命名群" }}</b>
              <span>{{ row.groupId }}</span>
            </div>
            <div class="group-meta-tags">
              <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? "启用" : "停用" }}</el-tag>
              <el-tag :type="row.allowPosting ? 'warning' : 'info'" size="small">投稿 {{ row.allowPosting ? "开" : "关" }}</el-tag>
              <el-tag :type="row.notificationEnabled ? 'success' : 'info'" size="small">通知 {{ row.notificationEnabled ? "开" : "关" }}</el-tag>
              <el-tag :type="row.memberWelcomeEnabled ? 'success' : 'info'" size="small">欢迎 {{ row.memberWelcomeEnabled ? "开" : "关" }}</el-tag>
              <el-tag :type="row.adFilterEnabled ? 'danger' : 'info'" size="small">广告 {{ row.adFilterEnabled ? "开" : "关" }}</el-tag>
              <el-tag :type="row.joinReviewEnabled ? 'warning' : 'info'" size="small">加群审 {{ row.joinReviewEnabled ? "开" : "关" }}</el-tag>
            </div>
          </div>
          <div class="record-meta">
            <span>默认板块：{{ row.defaultBoardSlug || "未设置" }}</span>
            <span>通知类型：{{ formatGroupNotifyCategories(row.notifyCategories).join(" / ") || "未设置" }}</span>
            <span>通知受众：{{ formatGroupNotifyAudiences(row.notifyAudiences).join(" / ") || "未设置" }}</span>
            <span>新成员欢迎：{{ row.memberWelcomeEnabled ? "开启" : "关闭" }}</span>
            <span>群管授权：{{ row.commandUserQqIds.length ? `${row.commandUserQqIds.length} 人` : "未设置" }}</span>
          </div>
          <div class="record-actions">
            <el-button link type="primary" :disabled="isGroupBusy(row)" @click="openGroupDialog(row)">编辑</el-button>
            <el-button link type="danger" :loading="isGroupBusy(row)" :disabled="isGroupBusy(row)" @click="removeGroup(row)">删除</el-button>
          </div>
        </article>
        <el-empty v-if="!groups.length" description="暂无群配置" />
      </div>
    </section>

    <section class="list-card">
      <div class="card-head">
        <div>
          <h3>绑定用户</h3>
          <p>QQ 号绑定到站内账号后，QQ 投稿会以该账号身份进入论坛审核流。</p>
        </div>
        <el-input v-model="bindingQuery" clearable placeholder="搜索 QQ / 用户" style="width: 220px" @keyup.enter="loadBindings()" />
      </div>
      <el-alert
        v-if="bindingsLoadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="bindingsLoadError"
      >
        <template #default>
          <el-button size="small" :loading="bindingsLoading" @click="loadBindings()">重试</el-button>
        </template>
      </el-alert>
      <el-table :data="bindings" v-loading="bindingsLoading" size="small" class="interactive-table">
        <el-table-column prop="qqId" label="QQ" width="150" />
        <el-table-column label="站内账号" min-width="190">
          <template #default="{ row }">
            <span>{{ row.user?.nickname }}（{{ row.user?.username }}）</span>
          </template>
        </el-table-column>
        <el-table-column prop="nickname" label="QQ 昵称" min-width="140" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" :loading="isBindingBusy(row)" :disabled="isBindingBusy(row)" @change="toggleBinding(row)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="danger" :loading="isBindingBusy(row)" :disabled="isBindingBusy(row)" @click="removeBinding(row)">解绑</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="record-list" v-loading="bindingsLoading">
        <article v-for="row in bindings" :key="`binding-${row.id}`" class="record-card">
          <div class="record-head">
            <div>
              <b>{{ row.user?.nickname || "未命名用户" }}</b>
              <span>{{ row.user?.username }} · QQ {{ row.qqId }}</span>
            </div>
            <el-switch v-model="row.enabled" :loading="isBindingBusy(row)" :disabled="isBindingBusy(row)" @change="toggleBinding(row)" />
          </div>
          <div class="record-meta">
            <span>QQ 昵称：{{ row.nickname || "未记录" }}</span>
            <span>站内身份：{{ row.user?.role || "user" }}</span>
          </div>
          <div class="record-actions">
            <el-button link type="danger" :loading="isBindingBusy(row)" :disabled="isBindingBusy(row)" @click="removeBinding(row)">解绑</el-button>
          </div>
        </article>
        <el-empty v-if="!bindings.length" description="暂无绑定记录" />
      </div>
    </section>

    <section class="list-card">
      <div class="card-head">
        <div>
          <h3>消息日志</h3>
          <p>记录 webhook、投稿、通知推送和 NapCat 调用结果。临时调试导出会附带原始 payload 和转发解析轨迹。</p>
        </div>
        <div class="filters">
          <el-select v-model="logFilter.eventType" clearable placeholder="事件" style="width: 130px" @change="loadLogs">
            <el-option label="投稿" value="post" />
            <el-option label="通知" value="notification" />
            <el-option label="消息" value="message" />
            <el-option label="群管命令" value="group-command" />
            <el-option label="加群审核" value="group-join-request" />
            <el-option label="广告过滤" value="group-ad-filter" />
            <el-option label="入群事件" value="group-member-increase" />
            <el-option label="新成员欢迎" value="group-member-welcome" />
            <el-option label="Webhook" value="webhook" />
          </el-select>
          <el-select v-model="logFilter.status" clearable placeholder="状态" style="width: 120px" @change="loadLogs">
            <el-option label="成功" value="ok" />
            <el-option label="忽略" value="ignored" />
            <el-option label="错误" value="error" />
          </el-select>
          <span class="log-meta">{{ lastLogAtText }}</span>
          <el-button plain :loading="refreshingLogs || logsLoading" :disabled="refreshingLogs || logsLoading" @click="refreshLogs">刷新</el-button>
          <el-button plain :icon="Download" :loading="debugDownloading" :disabled="debugDownloading" @click="downloadDebugLogs">下载调试日志</el-button>
        </div>
      </div>
      <el-alert
        v-if="logsLoadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="logsLoadError"
      >
        <template #default>
          <el-button size="small" :loading="logsLoading || refreshingLogs" @click="loadLogs">重试</el-button>
        </template>
      </el-alert>
      <div class="log-table-scroll">
        <el-table :data="logs" v-loading="logsLoading" size="small" class="log-table">
          <el-table-column prop="createdAt" label="时间" width="170">
            <template #default="{ row }">{{ formatLogTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="eventType" label="事件" width="110" />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="qqId" label="QQ" width="120" />
          <el-table-column prop="groupId" label="群" width="120" />
          <el-table-column prop="content" label="内容" min-width="220" show-overflow-tooltip />
          <el-table-column prop="result" label="结果" min-width="180" show-overflow-tooltip />
        </el-table>
      </div>
      <div class="pager">
        <el-pagination layout="prev, pager, next" :total="logTotal" :page-size="logFilter.size" v-model:current-page="logFilter.page" @current-change="loadLogs" />
      </div>
    </section>

    <el-dialog
      v-model="groupDialog.visible"
      title="QQ群配置"
      width="660px"
      append-to-body
      class="qqbot-group-dialog"
    >
      <el-form label-width="100px">
        <el-form-item label="群号">
          <el-input v-model="groupDialog.form.groupId" :disabled="Boolean(groupDialog.editingId)" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="groupDialog.form.name" />
        </el-form-item>
        <el-form-item label="默认板块">
          <el-select v-model="groupDialog.form.defaultBoardSlug" clearable filterable>
            <el-option v-for="board in postBoards" :key="board.slug" :label="`${board.name} / ${board.slug}`" :value="board.slug" />
          </el-select>
        </el-form-item>
        <el-form-item label="开关">
          <div class="check-grid">
            <el-checkbox v-model="groupDialog.form.enabled">启用</el-checkbox>
            <el-checkbox v-model="groupDialog.form.allowPosting">允许投稿</el-checkbox>
            <el-checkbox v-model="groupDialog.form.notificationEnabled">接收群通知</el-checkbox>
            <el-checkbox v-model="groupDialog.form.memberWelcomeEnabled">新成员欢迎</el-checkbox>
            <el-checkbox v-model="groupDialog.form.adFilterEnabled">广告过滤</el-checkbox>
            <el-checkbox v-model="groupDialog.form.joinReviewEnabled">快速审核加群</el-checkbox>
            <el-checkbox v-model="groupDialog.form.allowMute">允许禁言</el-checkbox>
            <el-checkbox v-model="groupDialog.form.allowKick">允许踢出</el-checkbox>
            <el-checkbox v-model="groupDialog.form.allowKickAndBlock">允许踢出并拉黑</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="欢迎私聊">
          <el-input
            v-model="groupDialog.form.memberWelcomeMessage"
            type="textarea"
            :rows="5"
            maxlength="1500"
            show-word-limit
            placeholder="欢迎 {nickname} 加入 {groupName}。"
            :disabled="!groupDialog.form.memberWelcomeEnabled"
          />
          <div class="form-tip">只对当前群生效。变量：{qq} / {nickname} / {groupId} / {groupName}</div>
        </el-form-item>
        <el-form-item label="通知类型">
          <el-checkbox-group v-model="groupDialog.form.notifyCategories">
            <el-checkbox label="system">系统公告 / 站务</el-checkbox>
            <el-checkbox label="school-feed">校园公告</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="通知受众">
          <el-checkbox-group v-model="groupDialog.form.notifyAudiences">
            <el-checkbox label="public">普通用户群</el-checkbox>
            <el-checkbox label="staff">管理群（管理员 / 论坛管理员）</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="授权用户">
          <el-select
            v-model="groupDialog.form.commandUserQqIds"
            multiple
            filterable
            allow-create
            default-first-option
            clearable
            collapse-tags
            collapse-tags-tooltip
            placeholder="输入可在群里执行群管命令的 QQ 号"
          />
          <div class="form-tip">这些用户可在当前群执行已开启的群管命令；新增/移除授权用户仍建议由群管理员或超级管理员执行。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="savingGroup" @click="groupDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="savingGroup" :disabled="savingGroup" @click="saveGroup">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Download } from "@element-plus/icons-vue";
import { adminApi, type QqBotConfig, type QqBotGroup } from "@/api/admin";

const config = ref<QqBotConfig | null>(null);
const boards = ref<any[]>([]);
const bindings = ref<any[]>([]);
const groups = ref<QqBotGroup[]>([]);
const logs = ref<any[]>([]);
const logTotal = ref(0);
const saving = ref(false);
const testing = ref(false);
const dispatching = ref(false);
const clearingToken = ref(false);
const creatingBindToken = ref(false);
const savingGroup = ref(false);
const bindingBusyId = ref<number | null>(null);
const groupBusyId = ref<number | null>(null);
const debugDownloading = ref(false);
const refreshingLogs = ref(false);
const configLoading = ref(false);
const boardsLoading = ref(false);
const bindingsLoading = ref(false);
const groupsLoading = ref(false);
const logsLoading = ref(false);
const configLoadError = ref("");
const boardsLoadError = ref("");
const bindingsLoadError = ref("");
const groupsLoadError = ref("");
const logsLoadError = ref("");
const bindingQuery = ref("");
const bindToken = ref<{ token: string; expiresAt: string } | null>(null);
let logRefreshTimer: number | null = null;
let configLoadSeq = 0;
let boardsLoadSeq = 0;
let bindingsLoadSeq = 0;
let groupsLoadSeq = 0;
let logsLoadSeq = 0;
let disposed = false;

const form = reactive({
  enabled: false,
  botQqId: "",
  napcatBaseUrl: "",
  accessToken: "",
  webhookSecret: "",
  defaultBoardSlug: "general",
  allowPrivatePost: true,
  allowGroupPost: false,
  notificationEnabled: true,
  notifyCategories: ["reply", "mention", "like", "system", "service-tool", "school-feed"] as string[],
  superAdminQqIds: [] as string[],
});

const test = reactive({ qqId: "", groupId: "", message: "药大拾间 QQBot 测试消息" });
const logFilter = reactive({ eventType: "", status: "", page: 1, size: 30 });
const defaultMemberWelcomeMessage = "欢迎加入本群，请先查看群公告了解群内规则和使用说明。\n\n如果想把课表添加到手机桌面，可以先打开站内课表页，再按页面提示完成添加。\n\n也欢迎前往个人中心绑定本 QQBot，绑定后可在 QQ 同步接收站内通知。建议顺手把本 QQBot 添加为好友，消息接收和后续操作体验会更顺畅。后续还会陆续接入更多实用功能，敬请期待。";
const groupDialog = reactive({
  visible: false,
  editingId: 0,
  form: {
    groupId: "",
    name: "",
    enabled: true,
    allowPosting: false,
    defaultBoardSlug: "",
    notificationEnabled: true,
    notifyCategories: ["system", "school-feed"] as Array<"system" | "school-feed">,
    notifyAudiences: ["public"] as Array<"public" | "staff">,
    memberWelcomeEnabled: false,
    memberWelcomeMessage: defaultMemberWelcomeMessage,
    adFilterEnabled: false,
    joinReviewEnabled: false,
    allowMute: false,
    allowKick: false,
    allowKickAndBlock: false,
    commandUserQqIds: [] as string[],
  },
});

const postBoards = computed(() => boards.value.filter((item) => !item.readOnly));
const configDisabled = computed(() => configLoading.value || Boolean(configLoadError.value));
const connectionStatusText = computed(() => {
  const status = config.value?.connectionStatus;
  if (status === "disabled") return "已关闭";
  if (status === "http") return "HTTP 模式";
  if (status === "connecting") return "连接中";
  if (status === "connected") return "已连接";
  if (status === "error") return "连接失败";
  return "待连接";
});
const lastLogAtText = computed(() => {
  const first = logs.value[0];
  if (!first?.createdAt) return "暂无日志";
  return `最新：${formatLogTime(first.createdAt)}`;
});

onMounted(async () => {
  disposed = false;
  await Promise.all([loadConfig(), loadBoards(), loadBindings(), loadGroups(), loadLogs()]);
  if (disposed) return;
  logRefreshTimer = window.setInterval(() => {
    if (document.hidden) return;
    loadLogs().catch(() => undefined);
  }, 15000);
});

onBeforeUnmount(() => {
  disposed = true;
  configLoadSeq += 1;
  boardsLoadSeq += 1;
  bindingsLoadSeq += 1;
  groupsLoadSeq += 1;
  logsLoadSeq += 1;
  if (logRefreshTimer !== null) {
    window.clearInterval(logRefreshTimer);
    logRefreshTimer = null;
  }
});

async function loadConfig() {
  const seq = ++configLoadSeq;
  configLoading.value = true;
  configLoadError.value = "";
  try {
    config.value = await adminApi.qqBotConfig({ suppressErrorMessage: true });
  } catch (error) {
    if (seq === configLoadSeq) {
      config.value = null;
      configLoadError.value = requestMessage(error) || "QQBot 配置加载失败，请稍后重试";
    }
    return;
  } finally {
    if (seq === configLoadSeq) configLoading.value = false;
  }
  if (seq !== configLoadSeq || !config.value) return;
  Object.assign(form, {
    enabled: config.value.enabled,
    botQqId: config.value.botQqId,
    napcatBaseUrl: config.value.napcatBaseUrl,
    accessToken: "",
    webhookSecret: config.value.webhookSecret,
    defaultBoardSlug: config.value.defaultBoardSlug,
    allowPrivatePost: config.value.allowPrivatePost,
    allowGroupPost: config.value.allowGroupPost,
    notificationEnabled: config.value.notificationEnabled,
    notifyCategories: [...config.value.notifyCategories],
    superAdminQqIds: [...config.value.superAdminQqIds],
  });
}

async function loadBoards() {
  const seq = ++boardsLoadSeq;
  boardsLoading.value = true;
  boardsLoadError.value = "";
  try {
    const next = await adminApi.boards({ suppressErrorMessage: true });
    if (seq === boardsLoadSeq) boards.value = next;
  } catch (error) {
    if (seq === boardsLoadSeq) {
      boards.value = [];
      boardsLoadError.value = requestMessage(error) || "板块列表加载失败，默认投稿板块暂不可选";
    }
  } finally {
    if (seq === boardsLoadSeq) boardsLoading.value = false;
  }
}

async function saveConfig() {
  if (saving.value || configDisabled.value) return;
  saving.value = true;
  try {
    config.value = await adminApi.updateQqBotConfig({
      ...form,
      accessToken: form.accessToken || undefined,
    });
    form.accessToken = "";
    await loadConfig();
    ElMessage.success("QQBot 配置已保存");
  } finally {
    saving.value = false;
  }
}

async function clearToken() {
  if (clearingToken.value || configDisabled.value) return;
  clearingToken.value = true;
  try {
    await ElMessageBox.confirm("确认清除 NapCat Access Token？", "清除 Token", { type: "warning" });
  } catch {
    clearingToken.value = false;
    return;
  }
  try {
    config.value = await adminApi.updateQqBotConfig({ clearAccessToken: true });
    await loadConfig();
    ElMessage.success("Token 已清除");
  } finally {
    clearingToken.value = false;
  }
}

async function createBindToken() {
  if (creatingBindToken.value) return;
  creatingBindToken.value = true;
  try {
    bindToken.value = await adminApi.createQqBotBindToken();
    ElMessage.success("绑定码已生成");
  } finally {
    creatingBindToken.value = false;
  }
}

async function sendTest() {
  if (testing.value) return;
  testing.value = true;
  try {
    await adminApi.sendQqBotTestMessage({ ...test });
    ElMessage.success("测试消息已发送");
    await Promise.all([loadLogs(), loadConfig()]);
  } catch (error) {
    await loadConfig();
    throw error;
  } finally {
    testing.value = false;
  }
}

async function dispatchNow() {
  if (dispatching.value || configDisabled.value) return;
  dispatching.value = true;
  try {
    const result = await adminApi.dispatchQqBotNotifications();
    ElMessage.success(`已派发 ${result.sent} 条`);
    await loadLogs();
  } finally {
    dispatching.value = false;
  }
}

async function loadBindings() {
  const seq = ++bindingsLoadSeq;
  bindingsLoading.value = true;
  bindingsLoadError.value = "";
  try {
    const next = await adminApi.qqBotBindings(
      { q: bindingQuery.value || undefined },
      { suppressErrorMessage: true },
    );
    if (seq === bindingsLoadSeq) bindings.value = next;
  } catch (error) {
    if (seq === bindingsLoadSeq) {
      bindings.value = [];
      bindingsLoadError.value = requestMessage(error) || "绑定用户加载失败，请稍后重试";
    }
  } finally {
    if (seq === bindingsLoadSeq) bindingsLoading.value = false;
  }
}

function isBindingBusy(row: any) {
  return bindingBusyId.value === row.id;
}

async function toggleBinding(row: any) {
  if (bindingBusyId.value !== null) return;
  bindingBusyId.value = row.id;
  const nextEnabled = Boolean(row.enabled);
  try {
    await adminApi.updateQqBotBinding(row.id, { enabled: nextEnabled });
  } catch (error) {
    row.enabled = !nextEnabled;
    throw error;
  } finally {
    bindingBusyId.value = null;
  }
}

async function removeBinding(row: any) {
  if (bindingBusyId.value !== null) return;
  bindingBusyId.value = row.id;
  try {
    const confirmed = await ElMessageBox.confirm(`确认解绑 QQ ${row.qqId}？`, "解绑 QQ", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    await adminApi.deleteQqBotBinding(row.id);
    await loadBindings();
  } finally {
    bindingBusyId.value = null;
  }
}

async function loadGroups() {
  const seq = ++groupsLoadSeq;
  groupsLoading.value = true;
  groupsLoadError.value = "";
  try {
    const next = await adminApi.qqBotGroups({ suppressErrorMessage: true });
    if (seq === groupsLoadSeq) groups.value = next;
  } catch (error) {
    if (seq === groupsLoadSeq) {
      groups.value = [];
      groupsLoadError.value = requestMessage(error) || "QQ群配置加载失败，请稍后重试";
    }
  } finally {
    if (seq === groupsLoadSeq) groupsLoading.value = false;
  }
}

function openGroupDialog(row?: any) {
  if (savingGroup.value || groupBusyId.value !== null || groupsLoadError.value) return;
  groupDialog.editingId = row?.id || 0;
  Object.assign(groupDialog.form, {
    groupId: row?.groupId || "",
    name: row?.name || "",
    enabled: row?.enabled ?? true,
    allowPosting: row?.allowPosting ?? false,
    defaultBoardSlug: row?.defaultBoardSlug || "",
    notificationEnabled: row?.notificationEnabled ?? true,
    notifyCategories: row?.notifyCategories?.length ? [...row.notifyCategories] : ["system", "school-feed"],
    notifyAudiences: row?.notifyAudiences?.length ? [...row.notifyAudiences] : ["public"],
    memberWelcomeEnabled: row?.memberWelcomeEnabled ?? false,
    memberWelcomeMessage: row?.memberWelcomeMessage || defaultMemberWelcomeMessage,
    adFilterEnabled: row?.adFilterEnabled ?? false,
    joinReviewEnabled: row?.joinReviewEnabled ?? false,
    allowMute: row?.allowMute ?? false,
    allowKick: row?.allowKick ?? false,
    allowKickAndBlock: row?.allowKickAndBlock ?? false,
    commandUserQqIds: row?.commandUserQqIds?.length ? [...row.commandUserQqIds] : [],
  });
  groupDialog.visible = true;
}

async function saveGroup() {
  if (savingGroup.value) return;
  savingGroup.value = true;
  groupBusyId.value = groupDialog.editingId || null;
  try {
    await adminApi.upsertQqBotGroup({
      ...groupDialog.form,
      defaultBoardSlug: groupDialog.form.defaultBoardSlug || null,
    });
    groupDialog.visible = false;
    await loadGroups();
    ElMessage.success("群配置已保存");
  } finally {
    savingGroup.value = false;
    groupBusyId.value = null;
  }
}

function isGroupBusy(row: any) {
  return groupBusyId.value === row.id;
}

async function removeGroup(row: any) {
  if (groupBusyId.value !== null) return;
  groupBusyId.value = row.id;
  try {
    const confirmed = await ElMessageBox.confirm(`确认删除群 ${row.groupId}？`, "删除群配置", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    await adminApi.deleteQqBotGroup(row.id);
    await loadGroups();
    ElMessage.success("群配置已删除");
  } finally {
    groupBusyId.value = null;
  }
}

function formatGroupNotifyCategories(items: Array<"system" | "school-feed"> = []) {
  return items.map((item) => item === "system" ? "系统公告" : "校园公告");
}

function formatGroupNotifyAudiences(items: Array<"public" | "staff"> = []) {
  return items.map((item) => item === "staff" ? "管理群" : "普通用户群");
}

async function loadLogs() {
  const seq = ++logsLoadSeq;
  logsLoading.value = true;
  logsLoadError.value = "";
  try {
    const data = await adminApi.qqBotLogs(logFilter, { suppressErrorMessage: true });
    if (seq !== logsLoadSeq) return;
    logs.value = data.list;
    logTotal.value = data.total;
  } catch (error) {
    if (seq !== logsLoadSeq) return;
    logs.value = [];
    logTotal.value = 0;
    logsLoadError.value = requestMessage(error) || "消息日志加载失败，请稍后重试";
  } finally {
    if (seq === logsLoadSeq) logsLoading.value = false;
  }
}

async function refreshLogs() {
  refreshingLogs.value = true;
  try {
    await loadLogs();
    ElMessage.success("日志已刷新");
  } finally {
    refreshingLogs.value = false;
  }
}

async function downloadDebugLogs() {
  debugDownloading.value = true;
  try {
    const params = new URLSearchParams();
    if (logFilter.eventType) params.set("eventType", logFilter.eventType);
    if (logFilter.status) params.set("status", logFilter.status);
    params.set("take", String(Math.max(logFilter.size, 80)));
    const response = await fetch(`/api/admin/qqbot/debug-export?${params.toString()}`, {
      credentials: "same-origin",
    });
    let message = "";
    if (!response.ok) {
      message = await response.text().catch(() => "");
      try {
        const parsed = JSON.parse(message);
        message = parsed?.message || message;
      } catch {
        // ignore invalid json
      }
      throw new Error(message || "调试日志下载失败");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
    saveBlob(blob, decodeURIComponent(match?.[1] || `qqbot-debug-${Date.now()}.json`));
    ElMessage.success("调试日志已下载");
  } catch (error: any) {
    ElMessage.error(error?.message || "调试日志下载失败");
  } finally {
    debugDownloading.value = false;
  }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function formatLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

</script>

<style scoped>
.qqbot-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.section-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, .8fr);
  gap: 14px;
}
.config-card,
.list-card {
  border: 1px solid #eef0f4;
  border-radius: 10px;
  padding: 16px;
  background: #fff;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 14px;
}
.card-head h3 {
  margin: 0;
  font-size: 16px;
  color: #111827;
}
.card-head p {
  margin: 5px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
.config-form {
  max-width: 860px;
}
.setup-guide {
  display: grid;
  gap: 10px;
  margin: 0 0 16px;
}
.setup-guide > div {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #eff6ff;
}
.setup-guide b {
  color: #1d4ed8;
  font-size: 13px;
}
.status-box {
  border-color: #dbe3ea;
  background: #f8fafc;
}
.setup-guide span,
.form-tip {
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}
.status-text {
  font-weight: 600;
}
.status-connected {
  color: #0f766e;
}
.status-connecting {
  color: #2563eb;
}
.status-error {
  color: #dc2626;
}
.status-disabled,
.status-http,
.status-idle {
  color: #475569;
}
.form-tip {
  margin-top: 5px;
}
.check-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.group-meta-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}
.bind-box {
  display: grid;
  gap: 10px;
}
.bind-token {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 8px;
  background: #f0fdf4;
  color: #166534;
}
.bind-token b {
  font-size: 24px;
  letter-spacing: 0;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
}
.log-meta {
  color: #6b7280;
  font-size: 12px;
}
.log-table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.log-table-scroll :deep(.log-table) {
  min-width: 1010px;
}
.interactive-table {
  display: block;
}
.record-list {
  display: none;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 12px;
}
.record-card {
  border: 1px solid #e7edf5;
  border-radius: 14px;
  padding: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.record-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.record-head b {
  display: block;
  color: #111827;
  font-size: 14px;
}
.record-head span {
  display: block;
  margin-top: 2px;
  color: #6b7280;
  font-size: 12px;
}
.record-meta {
  display: grid;
  gap: 5px;
  margin-top: 10px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
.record-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.record-list :deep(.el-empty) {
  grid-column: 1 / -1;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
@media (max-width: 1100px) {
  .section-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 720px) {
  .config-card,
  .list-card {
    padding: 12px;
  }
  .record-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .interactive-table {
    display: none;
  }
  .card-head,
  .actions,
  .filters {
    align-items: stretch;
    flex-direction: column;
  }
  .filters :deep(.el-select),
  .filters :deep(.el-button),
  .log-meta {
    width: 100% !important;
  }
  .setup-guide {
    grid-template-columns: 1fr;
  }
}
</style>
