<template>
  <div class="radio-console-page">
    <div class="console-shell">
      <aside class="console-sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-logo-shell">
            <img :src="brandLogo" :alt="radioBrandName" class="sidebar-logo" />
          </div>
          <div class="sidebar-copy">
            <span class="sidebar-kicker">Radio Console</span>
            <h1>{{ radioBrandTitle }}</h1>
            <p>真正独立出来的后台工作台，负责时段、节目、投稿和审核流转。</p>
          </div>
        </div>

        <nav class="sidebar-nav" aria-label="药苑之声控制台导航">
          <button
            v-for="item in consolePanels"
            :key="item.value"
            :class="['sidebar-link', { active: currentPanel === item.value }]"
            type="button"
            @click="switchPanel(item.value)"
          >
            <span>{{ item.kicker }}</span>
            <strong>{{ item.label }}</strong>
          </button>
        </nav>

        <div class="sidebar-summary">
          <div class="summary-card">
            <span>当前学期</span>
            <strong>{{ overview?.currentSemester?.name || "待配置" }}</strong>
            <small>{{ overview?.currentSemester?.code || "尚未指定当前学期" }}</small>
          </div>
          <div class="summary-grid">
            <article>
              <b>{{ manageData.semesters.length }}</b>
              <span>学期</span>
            </article>
            <article>
              <b>{{ manageData.playTimes.length }}</b>
              <span>时段</span>
            </article>
            <article>
              <b>{{ manageData.scheduleItems.length }}</b>
              <span>节目</span>
            </article>
            <article>
              <b>{{ pendingRequests.length }}</b>
              <span>待处理</span>
            </article>
          </div>
        </div>

        <div class="sidebar-actions">
          <el-button plain @click="goPublic">返回前台</el-button>
          <el-button plain :loading="loadingOverview || loadingManage" @click="refreshConsole">刷新数据</el-button>
        </div>
      </aside>

      <main class="console-main">
        <header class="console-header">
          <div class="console-title">
            <span class="console-kicker">{{ currentPanelMeta.kicker }}</span>
            <h2>{{ currentPanelMeta.label }}</h2>
            <p>{{ currentPanelMeta.description }}</p>
          </div>
          <div class="console-header-actions">
            <el-button v-if="loginRequired && !hasToken" type="primary" @click="goLogin">去登录</el-button>
            <el-button plain @click="goPublic">返回前台</el-button>
          </div>
        </header>

        <section v-if="pageError" class="console-alert">
          <el-alert :title="pageError" type="warning" :closable="false" show-icon>
            <template #default>
              <div class="alert-actions">
                <el-button size="small" :loading="loadingOverview || loadingManage" @click="refreshConsole">重试</el-button>
                <el-button v-if="loginRequired" size="small" plain @click="goLogin">去登录</el-button>
              </div>
            </template>
          </el-alert>
        </section>

        <section v-if="!canManage" class="permission-shell">
          <el-empty description="当前账号没有药苑之声管理权限">
            <el-button v-if="loginRequired && !hasToken" type="primary" @click="goLogin">登录后重试</el-button>
            <el-button plain @click="goPublic">返回前台</el-button>
          </el-empty>
        </section>

        <section v-else class="console-content" v-loading="loadingOverview || loadingManage">
          <template v-if="currentPanel === 'overview'">
            <div class="overview-grid">
              <article class="overview-card stat-card">
                <span>当前学期</span>
                <b>{{ overview?.currentSemester?.code || "未设置" }}</b>
                <small>{{ overview?.currentSemester?.name || "待配置当前学期" }}</small>
              </article>
              <article class="overview-card stat-card">
                <span>播出时段</span>
                <b>{{ manageData.playTimes.length }}</b>
                <small>按周维护基础播出结构</small>
              </article>
              <article class="overview-card stat-card">
                <span>已发布节目</span>
                <b>{{ publishedSchedules.length }}</b>
                <small>正在前台展示的栏目数量</small>
              </article>
              <article class="overview-card stat-card accent">
                <span>待处理投稿</span>
                <b>{{ pendingRequests.length }}</b>
                <small>{{ manageData.requests.length }} 条近期待审记录</small>
              </article>
            </div>

            <div class="overview-grid split">
              <article class="console-card">
                <div class="card-head">
                  <div>
                    <span class="card-kicker">Semester</span>
                    <h3>当前学期与排期骨架</h3>
                  </div>
                </div>
                <div class="overview-list">
                  <div class="overview-row">
                    <span>当前学期</span>
                    <strong>{{ overview?.currentSemester?.name || "未配置" }}</strong>
                  </div>
                  <div class="overview-row">
                    <span>前台可点歌节目</span>
                    <strong>{{ requestEnabledSchedules.length }}</strong>
                  </div>
                  <div class="overview-row">
                    <span>本周时段分布</span>
                    <strong>{{ activeWeekdayCount }}</strong>
                  </div>
                </div>
              </article>

              <article class="console-card">
                <div class="card-head">
                  <div>
                    <span class="card-kicker">Queue</span>
                    <h3>待处理投稿队列</h3>
                  </div>
                </div>
                <div v-if="pendingRequests.length" class="queue-list">
                  <button
                    v-for="item in pendingRequests.slice(0, 6)"
                    :key="item.id"
                    class="queue-item"
                    type="button"
                    @click="openRequestDialog(item)"
                  >
                    <div>
                      <strong>{{ item.songTitle }}</strong>
                      <span>{{ item.artist || "歌手待补充" }}</span>
                    </div>
                    <small>{{ formatDateTime(item.createdAt) }}</small>
                  </button>
                </div>
                <el-empty v-else description="当前没有待处理投稿" />
              </article>
            </div>

            <article class="console-card">
              <div class="card-head">
                <div>
                  <span class="card-kicker">Recent</span>
                  <h3>前台近期投稿预览</h3>
                </div>
              </div>
              <div v-if="overview?.recentRequests.length" class="recent-grid">
                <article v-for="item in overview?.recentRequests.slice(0, 8)" :key="item.id" class="recent-card">
                  <div class="recent-head">
                    <strong>{{ item.songTitle }}</strong>
                    <el-tag :type="requestStatusTag(item.status)" size="small" round>{{ requestStatusText(item.status) }}</el-tag>
                  </div>
                  <p>{{ item.artist || "歌手待补充" }}</p>
                  <small>{{ item.nickname || "匿名" }} · {{ formatDateTime(item.createdAt) }}</small>
                </article>
              </div>
              <el-empty v-else description="前台还没有投稿记录" />
            </article>
          </template>

          <article v-else-if="currentPanel === 'semesters'" class="console-card">
            <div class="card-head">
              <div>
                <span class="card-kicker">Semester</span>
                <h3>学期管理</h3>
                <p>维护广播站运行周期、当前学期标记和基础说明。</p>
              </div>
              <el-button type="primary" @click="openSemesterDialog()">新增学期</el-button>
            </div>
            <el-table :data="manageData.semesters" stripe>
              <el-table-column prop="code" label="编码" min-width="120" />
              <el-table-column prop="name" label="名称" min-width="160" />
              <el-table-column label="状态" width="120">
                <template #default="{ row }">
                  <el-tag :type="semesterStatusTag(row.status)" size="small" round>{{ semesterStatusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="当前学期" width="110">
                <template #default="{ row }">{{ row.isCurrent ? "是" : "否" }}</template>
              </el-table-column>
              <el-table-column label="时间范围" min-width="180">
                <template #default="{ row }">
                  {{ formatDate(row.startDate) || "未设开始" }} - {{ formatDate(row.endDate) || "未设结束" }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openSemesterDialog(row)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </article>

          <article v-else-if="currentPanel === 'playTimes'" class="console-card">
            <div class="card-head">
              <div>
                <span class="card-kicker">Play Times</span>
                <h3>播出时段</h3>
                <p>管理每周常规时段，为节目编排和点歌归属提供基础槽位。</p>
              </div>
              <el-button type="primary" @click="openPlayTimeDialog()">新增时段</el-button>
            </div>
            <el-table :data="manageData.playTimes" stripe>
              <el-table-column label="星期" width="90">
                <template #default="{ row }">{{ weekdayLabel(row.weekday) }}</template>
              </el-table-column>
              <el-table-column prop="name" label="时段名" min-width="140" />
              <el-table-column label="时间" width="140">
                <template #default="{ row }">{{ row.startTime }} - {{ row.endTime }}</template>
              </el-table-column>
              <el-table-column prop="location" label="地点" min-width="120" />
              <el-table-column label="启用" width="90">
                <template #default="{ row }">{{ row.enabled ? "是" : "否" }}</template>
              </el-table-column>
              <el-table-column label="所属学期" min-width="150">
                <template #default="{ row }">{{ row.semester?.name || "通用" }}</template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openPlayTimeDialog(row)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </article>

          <article v-else-if="currentPanel === 'schedules'" class="console-card">
            <div class="card-head">
              <div>
                <span class="card-kicker">Programs</span>
                <h3>节目管理</h3>
                <p>维护前台公开展示的栏目内容、主持人信息和可点歌开关。</p>
              </div>
              <el-button type="primary" @click="openScheduleDialog()">新增节目</el-button>
            </div>
            <el-table :data="manageData.scheduleItems" stripe>
              <el-table-column prop="title" label="节目名" min-width="180" />
              <el-table-column prop="subtitle" label="副标题" min-width="160" />
              <el-table-column label="状态" width="110">
                <template #default="{ row }">
                  <el-tag :type="scheduleStatusTag(row.status)" size="small" round>{{ scheduleStatusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="时段" min-width="180">
                <template #default="{ row }">
                  {{ row.playTime ? `${weekdayLabel(row.playTime.weekday)} ${row.playTime.startTime} ${row.playTime.name}` : "未绑定时段" }}
                </template>
              </el-table-column>
              <el-table-column label="点歌" width="90">
                <template #default="{ row }">{{ row.requestEnabled ? "开放" : "关闭" }}</template>
              </el-table-column>
              <el-table-column label="投稿数" width="90">
                <template #default="{ row }">{{ row.requestCount }}</template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openScheduleDialog(row)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </article>

          <article v-else class="console-card">
            <div class="card-head">
              <div>
                <span class="card-kicker">Requests</span>
                <h3>投稿审核</h3>
                <p>查看歌曲来源、试听已锁定音源，并直接完成审核流转。</p>
              </div>
            </div>
            <div class="music-auth-card" v-loading="musicAuthLoading">
              <div class="music-auth-main">
                <div v-if="qqMusicAuth?.loggedIn" class="music-auth-avatar">
                  <img v-if="qqMusicAuth.avatarUrl" :src="qqMusicAuth.avatarUrl" :alt="qqMusicAuth.nickname || 'QQ 音乐'" referrerpolicy="no-referrer" />
                  <span v-else>{{ (qqMusicAuth.nickname || "Q").slice(0, 1) }}</span>
                </div>
                <div v-else class="music-auth-avatar fallback">Q</div>
                <div class="music-auth-copy">
                  <strong>{{ qqMusicAuth?.nickname || "QQ 音乐未登录" }}</strong>
                  <p>{{ qqMusicAuthSummary }}</p>
                  <small>{{ qqMusicAuthDetail }}</small>
                </div>
              </div>
              <div class="music-auth-actions">
                <el-button plain @click="openQqMusicSite">打开 QQ 音乐</el-button>
                <el-button type="primary" plain @click="openQqSyncDialog">{{ qqMusicAuth?.loggedIn ? "重新同步登录态" : "傻瓜版登录" }}</el-button>
                <el-button plain @click="openQqCookieDialog">高级方式</el-button>
                <el-button v-if="qqMusicAuth?.source === 'database'" plain @click="clearQqMusicCookie">清除共享登录态</el-button>
              </div>
            </div>
            <el-table :data="manageData.requests" stripe>
              <el-table-column prop="nickname" label="投稿人" min-width="120" />
              <el-table-column prop="songTitle" label="歌曲名" min-width="180" />
              <el-table-column prop="artist" label="歌手" min-width="160" />
              <el-table-column label="音源" width="120">
                <template #default="{ row }">
                  {{ row.sourceProvider ? musicProviderLabel(row.sourceProvider) : "未锁定" }}
                </template>
              </el-table-column>
              <el-table-column label="状态" width="120">
                <template #default="{ row }">
                  <el-tag :type="requestStatusTag(row.status)" size="small" round>{{ requestStatusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="提交时间" min-width="160">
                <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="140" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openRequestDialog(row)">处理</el-button>
                </template>
              </el-table-column>
            </el-table>
          </article>
        </section>
      </main>
    </div>

    <el-dialog v-model="semesterDialog.visible" :title="semesterDialog.editingId ? '编辑学期' : '新增学期'" width="560px">
      <div class="dialog-form">
        <div class="dialog-grid">
          <label class="field">
            <span>学期编码</span>
            <input v-model.trim="semesterDialog.form.code" type="text" maxlength="40" />
          </label>
          <label class="field">
            <span>学期名称</span>
            <input v-model.trim="semesterDialog.form.name" type="text" maxlength="80" />
          </label>
          <label class="field">
            <span>状态</span>
            <select v-model="semesterDialog.form.status">
              <option value="draft">草稿</option>
              <option value="active">进行中</option>
              <option value="archived">已归档</option>
            </select>
          </label>
          <label class="field checkbox-field">
            <span>设为当前学期</span>
            <input v-model="semesterDialog.form.isCurrent" type="checkbox" />
          </label>
          <label class="field">
            <span>开始日期</span>
            <input v-model="semesterDialog.form.startDate" type="date" />
          </label>
          <label class="field">
            <span>结束日期</span>
            <input v-model="semesterDialog.form.endDate" type="date" />
          </label>
        </div>
        <label class="field">
          <span>学期说明</span>
          <textarea v-model.trim="semesterDialog.form.description" maxlength="1000" />
        </label>
      </div>
      <template #footer>
        <el-button @click="semesterDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="semesterDialog.saving" @click="saveSemester">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="playTimeDialog.visible" :title="playTimeDialog.editingId ? '编辑播出时段' : '新增播出时段'" width="620px">
      <div class="dialog-form">
        <div class="dialog-grid">
          <label class="field">
            <span>所属学期</span>
            <select v-model="playTimeDialog.form.semesterId">
              <option :value="null">通用时段</option>
              <option v-for="item in manageData.semesters" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>时段名称</span>
            <input v-model.trim="playTimeDialog.form.name" type="text" maxlength="80" />
          </label>
          <label class="field">
            <span>星期</span>
            <select v-model="playTimeDialog.form.weekday">
              <option v-for="item in weekdayOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>开始时间</span>
            <input v-model="playTimeDialog.form.startTime" type="time" />
          </label>
          <label class="field">
            <span>结束时间</span>
            <input v-model="playTimeDialog.form.endTime" type="time" />
          </label>
          <label class="field">
            <span>地点</span>
            <input v-model.trim="playTimeDialog.form.location" type="text" maxlength="120" />
          </label>
          <label class="field">
            <span>排序</span>
            <input v-model.number="playTimeDialog.form.sortOrder" type="number" min="0" max="999" />
          </label>
          <label class="field checkbox-field">
            <span>启用</span>
            <input v-model="playTimeDialog.form.enabled" type="checkbox" />
          </label>
        </div>
        <label class="field">
          <span>备注</span>
          <textarea v-model.trim="playTimeDialog.form.note" maxlength="600" />
        </label>
      </div>
      <template #footer>
        <el-button @click="playTimeDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="playTimeDialog.saving" @click="savePlayTime">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="scheduleDialog.visible" :title="scheduleDialog.editingId ? '编辑节目' : '新增节目'" width="760px">
      <div class="dialog-form">
        <div class="dialog-grid triple">
          <label class="field">
            <span>所属学期</span>
            <select v-model="scheduleDialog.form.semesterId">
              <option :value="null">通用节目</option>
              <option v-for="item in manageData.semesters" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>关联时段</span>
            <select v-model="scheduleDialog.form.playTimeId">
              <option :value="null">暂不绑定</option>
              <option v-for="item in manageData.playTimes" :key="item.id" :value="item.id">
                {{ `${weekdayLabel(item.weekday)} ${item.startTime} ${item.name}` }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>状态</span>
            <select v-model="scheduleDialog.form.status">
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
              <option value="archived">已归档</option>
            </select>
          </label>
        </div>
        <div class="dialog-grid">
          <label class="field">
            <span>节目名称</span>
            <input v-model.trim="scheduleDialog.form.title" type="text" maxlength="120" />
          </label>
          <label class="field">
            <span>副标题</span>
            <input v-model.trim="scheduleDialog.form.subtitle" type="text" maxlength="120" />
          </label>
          <label class="field">
            <span>主持人</span>
            <input v-model.trim="scheduleDialog.form.hostNames" type="text" maxlength="160" />
          </label>
          <label class="field">
            <span>标签</span>
            <input v-model.trim="scheduleDialog.tagsInput" type="text" maxlength="300" placeholder="多个标签用中文或英文逗号分隔" />
          </label>
          <label class="field">
            <span>封面图</span>
            <input v-model.trim="scheduleDialog.form.coverImage" type="text" maxlength="800" />
          </label>
          <label class="field">
            <span>排序</span>
            <input v-model.number="scheduleDialog.form.sortOrder" type="number" min="0" max="999" />
          </label>
          <label class="field">
            <span>开始时间</span>
            <input v-model="scheduleDialog.form.startsAt" type="datetime-local" />
          </label>
          <label class="field">
            <span>结束时间</span>
            <input v-model="scheduleDialog.form.endsAt" type="datetime-local" />
          </label>
          <label class="field checkbox-field">
            <span>开放点歌</span>
            <input v-model="scheduleDialog.form.requestEnabled" type="checkbox" />
          </label>
        </div>
        <label class="field">
          <span>节目简介</span>
          <textarea v-model.trim="scheduleDialog.form.summary" maxlength="2000" />
        </label>
      </div>
      <template #footer>
        <el-button @click="scheduleDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="scheduleDialog.saving" @click="saveSchedule">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="qqSyncDialog.visible" title="QQ 音乐傻瓜版登录" width="760px">
      <div class="dialog-form" v-loading="qqSyncDialog.loading">
        <div class="cookie-login-note">
          <strong>怎么用</strong>
          <p>先把下面这个红色按钮拖到浏览器收藏栏，然后点“打开 QQ 音乐”去登录。</p>
          <p>登录完成后，在 QQ 音乐网页里点一下刚刚收藏的“同步 QQ 音乐登录态”，系统会自动把共享登录态带回控制台。</p>
          <p>如果当前只有网页登录态，没有播放票据，同步按钮会自动帮你打开 QQ 音乐播放器预热，不需要你自己翻 Cookie。</p>
          <p v-if="qqSyncExpiresText">这次生成的同步按钮有效期到：{{ qqSyncExpiresText }}。</p>
        </div>
        <div class="bookmarklet-card">
          <span>拖到收藏栏</span>
          <a class="bookmarklet-chip" :href="qqSyncDialog.bookmarklet">同步 QQ 音乐登录态</a>
          <small>以后需要更新登录态时，直接去 QQ 音乐网页点这个收藏按钮就行。</small>
        </div>
      </div>
      <template #footer>
        <el-button @click="qqSyncDialog.visible = false">先关掉</el-button>
        <el-button plain @click="openQqCookieDialog">高级手动方式</el-button>
        <el-button plain :loading="qqSyncDialog.loading" @click="refreshQqSyncDialog">重新生成同步按钮</el-button>
        <el-button type="primary" plain @click="openQqMusicSite">打开 QQ 音乐</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="qqCookieDialog.visible" title="保存 QQ 音乐共享登录态" width="720px">
      <div class="dialog-form">
        <div class="cookie-login-note">
          <strong>高级手动方式</strong>
          <p>如果你不想用上面的傻瓜版同步，也可以先在浏览器打开 QQ 音乐并完成登录，再把浏览器里的 Cookie 粘贴到这里保存。</p>
          <p>保存后控制台会复用这份共享登录态去拉试听；如果仍提示缺少播放授权，通常需要在 QQ 音乐网页播放器里真正打开一次歌曲，再重新复制一遍 Cookie。</p>
        </div>
        <label class="field">
          <span>QQ 音乐 Cookie</span>
          <textarea v-model.trim="qqCookieDialog.cookie" maxlength="20000" placeholder="uin=...; qm_keyst=...; p_skey=...;" />
        </label>
      </div>
      <template #footer>
        <el-button @click="qqCookieDialog.visible = false">取消</el-button>
        <el-button plain @click="openQqMusicSite">打开 QQ 音乐</el-button>
        <el-button type="primary" :loading="qqCookieDialog.saving" @click="saveQqMusicCookie">保存登录态</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="requestDialog.visible" :title="requestDialog.row ? `处理投稿 #${requestDialog.row.id}` : '处理投稿'" width="720px" @closed="closeManagePreview">
      <div v-if="requestDialog.row" class="dialog-form">
        <div class="request-note-card">
          <strong>{{ requestDialog.row.songTitle }}</strong>
          <p>{{ requestDialog.row.artist || "歌手待补充" }}</p>
          <small>{{ requestDialog.row.nickname || "匿名" }} · {{ formatDateTime(requestDialog.row.createdAt) }}</small>
          <p v-if="requestDialog.row.message">{{ requestDialog.row.message }}</p>
          <p v-if="requestDialog.row.dedication">祝福：{{ requestDialog.row.dedication }}</p>
        </div>

        <div v-if="requestDialog.row.sourceSelection" class="source-preview-card">
          <div>
            <strong>已锁定音源</strong>
            <p>{{ requestDialog.row.sourceProvider ? musicProviderLabel(requestDialog.row.sourceProvider) : "未知音源" }}</p>
          </div>
          <el-button plain :loading="managePreview.loading && managePreview.trackKey === resultTrackKey(requestDialog.row.sourceSelection)" @click="previewRequestSource">
            试听音源
          </el-button>
        </div>

        <div v-if="managePreview.streamUrl || managePreview.notice" class="request-preview-player">
          <div class="preview-head">
            <div class="preview-meta">
              <strong>{{ managePreview.title }}</strong>
              <span>{{ managePreview.subtitle }}</span>
            </div>
            <el-button text @click="closeManagePreview">关闭试听</el-button>
          </div>
          <audio ref="managePreviewAudioRef" :src="managePreview.streamUrl" controls preload="none" />
          <small v-if="managePreview.notice">{{ managePreview.notice }}</small>
        </div>

        <div class="dialog-grid">
          <label class="field">
            <span>挂载栏目</span>
            <select v-model="requestDialog.form.scheduleItemId">
              <option :value="null">暂不挂栏目</option>
              <option v-for="item in manageData.scheduleItems" :key="item.id" :value="item.id">{{ item.title }}</option>
            </select>
          </label>
          <label class="field">
            <span>审核状态</span>
            <select v-model="requestDialog.form.status">
              <option value="pending">待处理</option>
              <option value="approved">已通过</option>
              <option value="fulfilled">已播出</option>
              <option value="rejected">已拒绝</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span>管理员备注</span>
          <textarea v-model.trim="requestDialog.form.adminNote" maxlength="1000" />
        </label>
      </div>
      <template #footer>
        <el-button @click="requestDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="requestDialog.saving" @click="saveRequestReview">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  radioApi,
  type RadioManageBootstrap,
  type RadioMusicAuthStatus,
  type RadioMusicSyncSession,
  type RadioMusicSelection,
  type RadioOverview,
  type RadioPlayTime,
  type RadioScheduleItem,
  type RadioSemester,
  type RadioSongRequest,
} from "@/api/radio";
import { getToken } from "@/api/request";
import { toolsApi } from "@/api/tools";
import brandLogo from "@/assets/brands/yaoyuanzhisheng-seal.png";
import {
  musicProviderLabel,
  normalizeDateField,
  normalizeDateTimeField,
  radioBrandName,
  radioBrandTitle,
  requestStatusTag,
  requestStatusText,
  responseMessage,
  responseStatus,
  resultTrackKey,
  scheduleStatusTag,
  scheduleStatusText,
  semesterStatusTag,
  semesterStatusText,
  splitTags,
  toDateInput,
  toDateTimeLocalInput,
  weekdayLabel,
  weekdayOptions,
} from "@/views/services/radio-beta/shared";

type ConsolePanel = "overview" | "semesters" | "playTimes" | "schedules" | "requests";

const router = useRouter();
const route = useRoute();

const consolePanels: Array<{ value: ConsolePanel; label: string; kicker: string; description: string }> = [
  { value: "overview", label: "总览", kicker: "Overview", description: "先看当前学期、节目发布量和待处理投稿堆积情况。" },
  { value: "semesters", label: "学期管理", kicker: "Semester", description: "维护广播站的学期周期与当前学期状态。" },
  { value: "playTimes", label: "播出时段", kicker: "Play Times", description: "配置每周时段，为前台排期和栏目归属提供骨架。" },
  { value: "schedules", label: "节目管理", kicker: "Programs", description: "维护栏目内容、主持人信息和是否开放点歌。" },
  { value: "requests", label: "投稿审核", kicker: "Requests", description: "查看用户投稿、试听锁定音源并完成审核流转。" },
];

const loadingOverview = ref(false);
const loadingManage = ref(false);
const loginRequired = ref(false);
const canManage = ref(false);
const pageError = ref("");
const currentPanel = ref<ConsolePanel>("overview");
const hasToken = computed(() => Boolean(getToken()));
const overview = ref<RadioOverview | null>(null);
const managePreviewAudioRef = ref<HTMLAudioElement | null>(null);

const manageData = reactive<RadioManageBootstrap>({
  semesters: [],
  playTimes: [],
  scheduleItems: [],
  requests: [],
});

const managePreview = reactive({
  loading: false,
  trackKey: "",
  streamUrl: "",
  title: "",
  subtitle: "",
  notice: "",
});

const musicAuthLoading = ref(false);
const musicAuth = ref<RadioMusicAuthStatus | null>(null);
const qqSyncDialog = reactive({
  visible: false,
  loading: false,
  bookmarklet: "",
  session: null as RadioMusicSyncSession | null,
});
const qqCookieDialog = reactive({
  visible: false,
  saving: false,
  cookie: "",
});

const semesterDialog = reactive({
  visible: false,
  saving: false,
  editingId: 0,
  form: {
    code: "",
    name: "",
    description: "",
    status: "draft" as "draft" | "active" | "archived",
    isCurrent: false,
    startDate: "",
    endDate: "",
  },
});

const playTimeDialog = reactive({
  visible: false,
  saving: false,
  editingId: 0,
  form: {
    semesterId: null as number | null,
    name: "",
    weekday: 1,
    startTime: "12:00",
    endTime: "13:00",
    location: "",
    note: "",
    enabled: true,
    sortOrder: 0,
  },
});

const scheduleDialog = reactive({
  visible: false,
  saving: false,
  editingId: 0,
  tagsInput: "",
  form: {
    semesterId: null as number | null,
    playTimeId: null as number | null,
    title: "",
    subtitle: "",
    hostNames: "",
    summary: "",
    coverImage: "",
    status: "draft" as "draft" | "published" | "archived",
    requestEnabled: true,
    startsAt: "",
    endsAt: "",
    sortOrder: 0,
  },
});

const requestDialog = reactive({
  visible: false,
  saving: false,
  row: null as RadioSongRequest | null,
  form: {
    scheduleItemId: null as number | null,
    status: "pending" as "pending" | "approved" | "fulfilled" | "rejected",
    adminNote: "",
  },
});

const currentPanelMeta = computed(() =>
  consolePanels.find((item) => item.value === currentPanel.value) || consolePanels[0]
);

const pendingRequests = computed(() =>
  manageData.requests.filter((item) => item.status === "pending")
);

const publishedSchedules = computed(() =>
  manageData.scheduleItems.filter((item) => item.status === "published")
);

const requestEnabledSchedules = computed(() =>
  manageData.scheduleItems.filter((item) => item.requestEnabled)
);

const activeWeekdayCount = computed(() =>
  new Set(manageData.playTimes.filter((item) => item.enabled).map((item) => item.weekday)).size
);

const qqMusicAuth = computed(() => musicAuth.value?.qq ?? null);

const qqMusicAuthSummary = computed(() => {
  const status = qqMusicAuth.value;
  if (!status?.loggedIn) return "当前还没有可用的 QQ 音乐共享登录态，部分歌曲会因为缺少播放授权而无法试听。";
  if (!status.playbackKeyReady) return "网页登录态已经存在，但还没有拿到播放票据，当前依然可能拉不起试听。";
  return "共享登录态可用，控制台现在会优先用这份 QQ 音乐登录态去拉试听。";
});

const qqMusicAuthDetail = computed(() => {
  const status = qqMusicAuth.value;
  if (!status) return "正在读取 QQ 音乐登录状态。";
  const sourceText = status.source === "database"
    ? "来自控制台保存的共享登录态"
    : status.source === "env"
      ? "来自服务端环境变量"
      : "当前没有可用登录态";
  const playbackText = status.loggedIn
    ? (status.playbackKeyReady ? "已拿到播放票据" : "缺少播放票据")
    : "未登录";
  return [sourceText, playbackText, status.updatedAt ? `最近保存：${formatDateTime(status.updatedAt)}` : ""]
    .filter(Boolean)
    .join(" · ");
});

const qqSyncExpiresText = computed(() =>
  qqSyncDialog.session?.expiresAt ? formatDateTime(qqSyncDialog.session.expiresAt) : ""
);

onMounted(async () => {
  const panel = String(route.query.panel || "");
  if (panel === "overview" || panel === "semesters" || panel === "playTimes" || panel === "schedules" || panel === "requests") {
    currentPanel.value = panel;
  }
  await initPermission();
  if (canManage.value) {
    await refreshConsole();
  }
  await handleQqMusicSyncFeedback();
});

async function initPermission() {
  canManage.value = false;
  loginRequired.value = false;
  try {
    const toolMetas = await toolsApi.tools({ suppressErrorMessage: true });
    const current = toolMetas.find((item) => item.code === "radio_beta");
    if (current?.requireLogin && !hasToken.value) loginRequired.value = true;
    canManage.value = Boolean(current?.canManage);
  } catch {
    canManage.value = false;
  }
  if (!hasToken.value) return;
  try {
    const perms = await toolsApi.myPermissions({
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    canManage.value = canManage.value
      || perms.toolCodes.includes("radio_beta")
      || perms.adminToolCodes.includes("radio_beta");
  } catch {
    // ignore
  }
}

async function refreshConsole() {
  if (!canManage.value) return;
  await Promise.all([loadOverview(), loadManageData(), loadMusicAuth()]);
}

async function loadOverview() {
  loadingOverview.value = true;
  pageError.value = "";
  try {
    overview.value = await radioApi.overview();
  } catch (error) {
    overview.value = null;
    const status = responseStatus(error);
    if (status === 401) {
      loginRequired.value = true;
      pageError.value = `${radioBrandName}当前需要登录后使用。`;
      return;
    }
    pageError.value = responseMessage(error) || `${radioBrandName}概览加载失败`;
  } finally {
    loadingOverview.value = false;
  }
}

async function loadManageData() {
  loadingManage.value = true;
  try {
    const next = await radioApi.manageBootstrap();
    manageData.semesters = next.semesters;
    manageData.playTimes = next.playTimes;
    manageData.scheduleItems = next.scheduleItems;
    manageData.requests = next.requests;
  } catch (error) {
    const status = responseStatus(error);
    if (status === 401) {
      loginRequired.value = true;
      canManage.value = false;
      pageError.value = `${radioBrandName}控制台需要登录后使用。`;
      return;
    }
    if (status === 403) {
      canManage.value = false;
      pageError.value = "当前账号没有药苑之声管理权限。";
      return;
    }
    pageError.value = responseMessage(error) || `${radioBrandName}工作台加载失败`;
  } finally {
    loadingManage.value = false;
  }
}

async function loadMusicAuth() {
  musicAuthLoading.value = true;
  try {
    musicAuth.value = await radioApi.musicAuthStatus();
  } catch (error) {
    const status = responseStatus(error);
    if (status === 401) {
      loginRequired.value = true;
      return;
    }
    if (status === 403) return;
    ElMessage.error(responseMessage(error) || "QQ 音乐登录态读取失败");
  } finally {
    musicAuthLoading.value = false;
  }
}

function buildQqMusicSyncReturnPath() {
  return router.resolve({
    name: "service-radio-beta-console",
    query: {
      panel: currentPanel.value,
    },
  }).href;
}

function buildQqMusicBookmarklet(token: string) {
  const endpoint = `${window.location.origin}/api/radio/music-auth/qq-sync/complete`;
  const playerUrl = "https://y.qq.com/n/ryqq/player";
  const script = [
    "(function(){",
    `const token=${JSON.stringify(token)};`,
    `const endpoint=${JSON.stringify(endpoint)};`,
    `const playerUrl=${JSON.stringify(playerUrl)};`,
    'const parse=function(text){const out={};String(text||"").split(";").forEach(function(part){const raw=String(part||"").trim();if(!raw)return;const idx=raw.indexOf("=");if(idx<=0)return;out[raw.slice(0,idx).trim()]=raw.slice(idx+1).trim();});return out;};',
    'const normalizeUin=function(raw){const digits=String(raw||"").replace(/\\D/g,"");return digits.replace(/^0+/,"")||digits;};',
    'const hasLogin=function(obj){const uin=normalizeUin(Number(obj.login_type)===2?(obj.wxuin||obj.uin||obj.p_uin||""):(obj.uin||obj.qqmusic_uin||obj.wxuin||obj.p_uin||""));const key=obj.qm_keyst||obj.qqmusic_key||obj.music_key||obj.p_skey||obj.skey||obj.psrf_qqaccess_token||obj.psrf_qqrefresh_token||obj.wxrefresh_token||obj.wxskey||"";return !!(uin&&key);};',
    'const hasPlayback=function(obj){const uin=normalizeUin(Number(obj.login_type)===2?(obj.wxuin||obj.uin||obj.p_uin||""):(obj.uin||obj.qqmusic_uin||obj.wxuin||obj.p_uin||""));const key=obj.qm_keyst||obj.qqmusic_key||obj.music_key||obj.wxskey||"";return !!(uin&&key);};',
    'const submit=function(cookie){const form=document.createElement("form");form.method="POST";form.action=endpoint;form.style.display="none";const push=function(name,value){const input=document.createElement("input");input.type="hidden";input.name=name;input.value=value;form.appendChild(input);};push("token",token);push("cookie",cookie);(document.body||document.documentElement).appendChild(form);form.submit();};',
    'if(!/(^|\\.)y\\.qq\\.com$/i.test(location.hostname)){alert("请先在 QQ 音乐网页里点击这个同步按钮。");return;}',
    'const currentCookie=document.cookie||"";const currentObj=parse(currentCookie);',
    'if(hasPlayback(currentObj)){submit(currentCookie);return;}',
    'if(!hasLogin(currentObj)){alert("请先在当前 QQ 音乐页面完成登录，再点一次同步按钮。");return;}',
    'const popup=window.open(playerUrl,"_blank");',
    'if(!popup){alert("已经检测到你登录了 QQ，但浏览器拦住了播放器预热窗口。请允许弹窗后重试，或者手动打开 QQ 音乐播放器页再点一次同步按钮。");return;}',
    'alert("已检测到 QQ 登录，正在自动补全播放授权，请稍等几秒，不用自己找 Cookie。");',
    'const started=Date.now();',
    'const timer=setInterval(function(){try{const cookie=popup.document.cookie||"";const obj=parse(cookie);if(hasPlayback(obj)){clearInterval(timer);try{popup.close();}catch(e){}submit(cookie);return;}if(Date.now()-started>25000){clearInterval(timer);alert("已经帮你打开播放器预热，但暂时还没拿到播放票据。请在打开的 QQ 音乐页面停留几秒后，再点一次同步按钮。");}}catch(e){}},1200);',
    "})();",
  ].join("");
  return `javascript:${script}`;
}

async function openQqSyncDialog() {
  qqSyncDialog.visible = true;
  qqSyncDialog.loading = true;
  try {
    const session = await radioApi.createQqMusicSyncSession({
      returnPath: buildQqMusicSyncReturnPath(),
    });
    qqSyncDialog.session = session;
    qqSyncDialog.bookmarklet = buildQqMusicBookmarklet(session.token);
  } catch (error) {
    qqSyncDialog.visible = false;
    ElMessage.error(responseMessage(error) || "QQ 音乐同步按钮生成失败");
  } finally {
    qqSyncDialog.loading = false;
  }
}

async function refreshQqSyncDialog() {
  if (!qqSyncDialog.visible) {
    await openQqSyncDialog();
    return;
  }
  qqSyncDialog.loading = true;
  try {
    const session = await radioApi.createQqMusicSyncSession({
      returnPath: buildQqMusicSyncReturnPath(),
    });
    qqSyncDialog.session = session;
    qqSyncDialog.bookmarklet = buildQqMusicBookmarklet(session.token);
    ElMessage.success("同步按钮已重新生成");
  } catch (error) {
    ElMessage.error(responseMessage(error) || "同步按钮刷新失败");
  } finally {
    qqSyncDialog.loading = false;
  }
}

async function handleQqMusicSyncFeedback() {
  const result = String(route.query.qqMusicSync || "").trim();
  if (!result) return;
  const message = String(route.query.qqMusicSyncMessage || "").trim();
  await loadMusicAuth().catch(() => undefined);
  if (result === "success") ElMessage.success(message || "QQ 音乐共享登录态已同步");
  else if (result === "partial") ElMessage.warning(message || "QQ 音乐登录态已同步，但还没拿到播放票据");
  else ElMessage.error(message || "QQ 音乐共享登录态同步失败");
  const nextQuery = { ...route.query };
  delete nextQuery.qqMusicSync;
  delete nextQuery.qqMusicSyncMessage;
  await router.replace({ query: nextQuery }).catch(() => undefined);
}

function switchPanel(panel: ConsolePanel) {
  currentPanel.value = panel;
}

function openQqMusicSite() {
  window.open("https://y.qq.com/n/ryqq/player", "_blank", "noopener,noreferrer");
}

function openQqCookieDialog() {
  qqSyncDialog.visible = false;
  qqCookieDialog.visible = true;
  qqCookieDialog.saving = false;
  qqCookieDialog.cookie = "";
}

async function saveQqMusicCookie() {
  const cookie = qqCookieDialog.cookie.trim();
  if (!cookie) {
    ElMessage.warning("先粘贴 QQ 音乐 Cookie 再保存");
    return;
  }
  qqCookieDialog.saving = true;
  try {
    const status = await radioApi.saveQqMusicCookie({ cookie });
    musicAuth.value = status;
    qqCookieDialog.visible = false;
    qqCookieDialog.cookie = "";
    if (status.qq.loggedIn && status.qq.playbackKeyReady) {
      ElMessage.success("QQ 音乐共享登录态已保存，当前可以直接拉试听");
    } else if (status.qq.loggedIn) {
      ElMessage.warning("登录态已保存，但还没拿到播放票据；建议在 QQ 音乐网页播放器里打开一次歌曲后重新复制 Cookie");
    } else {
      ElMessage.warning("Cookie 已提交，但当前还没有识别到有效的 QQ 音乐登录态");
    }
  } catch (error) {
    ElMessage.error(responseMessage(error) || "QQ 音乐登录态保存失败");
  } finally {
    qqCookieDialog.saving = false;
  }
}

async function clearQqMusicCookie() {
  try {
    const status = await radioApi.clearQqMusicCookie();
    musicAuth.value = status;
    ElMessage.success("QQ 音乐共享登录态已清除");
  } catch (error) {
    ElMessage.error(responseMessage(error) || "QQ 音乐登录态清除失败");
  }
}

function openSemesterDialog(row?: RadioSemester) {
  semesterDialog.visible = true;
  semesterDialog.saving = false;
  semesterDialog.editingId = row?.id ?? 0;
  semesterDialog.form.code = row?.code ?? "";
  semesterDialog.form.name = row?.name ?? "";
  semesterDialog.form.description = row?.description ?? "";
  semesterDialog.form.status = row?.status ?? "draft";
  semesterDialog.form.isCurrent = row?.isCurrent ?? false;
  semesterDialog.form.startDate = toDateInput(row?.startDate);
  semesterDialog.form.endDate = toDateInput(row?.endDate);
}

async function saveSemester() {
  if (!semesterDialog.form.code.trim() || !semesterDialog.form.name.trim()) {
    ElMessage.warning("请先填写学期名和编码");
    return;
  }
  semesterDialog.saving = true;
  try {
    const payload = {
      code: semesterDialog.form.code.trim(),
      name: semesterDialog.form.name.trim(),
      description: semesterDialog.form.description.trim() || undefined,
      status: semesterDialog.form.status,
      isCurrent: semesterDialog.form.isCurrent,
      startDate: normalizeDateField(semesterDialog.form.startDate),
      endDate: normalizeDateField(semesterDialog.form.endDate),
    };
    if (semesterDialog.editingId) {
      await radioApi.updateSemester(semesterDialog.editingId, payload);
    } else {
      await radioApi.createSemester(payload);
    }
    semesterDialog.visible = false;
    ElMessage.success("学期已保存");
    await refreshConsole();
  } catch (error) {
    ElMessage.error(responseMessage(error) || "学期保存失败");
  } finally {
    semesterDialog.saving = false;
  }
}

function openPlayTimeDialog(row?: RadioPlayTime) {
  playTimeDialog.visible = true;
  playTimeDialog.saving = false;
  playTimeDialog.editingId = row?.id ?? 0;
  playTimeDialog.form.semesterId = row?.semesterId ?? null;
  playTimeDialog.form.name = row?.name ?? "";
  playTimeDialog.form.weekday = row?.weekday ?? 1;
  playTimeDialog.form.startTime = row?.startTime ?? "12:00";
  playTimeDialog.form.endTime = row?.endTime ?? "13:00";
  playTimeDialog.form.location = row?.location ?? "";
  playTimeDialog.form.note = row?.note ?? "";
  playTimeDialog.form.enabled = row?.enabled ?? true;
  playTimeDialog.form.sortOrder = row?.sortOrder ?? 0;
}

async function savePlayTime() {
  if (!playTimeDialog.form.name.trim()) {
    ElMessage.warning("请先填写时段名");
    return;
  }
  playTimeDialog.saving = true;
  try {
    const payload = {
      semesterId: playTimeDialog.form.semesterId,
      name: playTimeDialog.form.name.trim(),
      weekday: playTimeDialog.form.weekday,
      startTime: playTimeDialog.form.startTime,
      endTime: playTimeDialog.form.endTime,
      location: playTimeDialog.form.location.trim() || undefined,
      note: playTimeDialog.form.note.trim() || undefined,
      enabled: playTimeDialog.form.enabled,
      sortOrder: playTimeDialog.form.sortOrder,
    };
    if (playTimeDialog.editingId) {
      await radioApi.updatePlayTime(playTimeDialog.editingId, payload);
    } else {
      await radioApi.createPlayTime(payload);
    }
    playTimeDialog.visible = false;
    ElMessage.success("播出时段已保存");
    await refreshConsole();
  } catch (error) {
    ElMessage.error(responseMessage(error) || "播出时段保存失败");
  } finally {
    playTimeDialog.saving = false;
  }
}

function openScheduleDialog(row?: RadioScheduleItem) {
  scheduleDialog.visible = true;
  scheduleDialog.saving = false;
  scheduleDialog.editingId = row?.id ?? 0;
  scheduleDialog.form.semesterId = row?.semesterId ?? null;
  scheduleDialog.form.playTimeId = row?.playTimeId ?? null;
  scheduleDialog.form.title = row?.title ?? "";
  scheduleDialog.form.subtitle = row?.subtitle ?? "";
  scheduleDialog.form.hostNames = row?.hostNames ?? "";
  scheduleDialog.form.summary = row?.summary ?? "";
  scheduleDialog.form.coverImage = row?.coverImage ?? "";
  scheduleDialog.form.status = row?.status ?? "draft";
  scheduleDialog.form.requestEnabled = row?.requestEnabled ?? true;
  scheduleDialog.form.startsAt = toDateTimeLocalInput(row?.startsAt);
  scheduleDialog.form.endsAt = toDateTimeLocalInput(row?.endsAt);
  scheduleDialog.form.sortOrder = row?.sortOrder ?? 0;
  scheduleDialog.tagsInput = (row?.tags ?? []).join("，");
}

async function saveSchedule() {
  if (!scheduleDialog.form.title.trim()) {
    ElMessage.warning("请先填写节目名");
    return;
  }
  scheduleDialog.saving = true;
  try {
    const payload = {
      semesterId: scheduleDialog.form.semesterId,
      playTimeId: scheduleDialog.form.playTimeId,
      title: scheduleDialog.form.title.trim(),
      subtitle: scheduleDialog.form.subtitle.trim() || undefined,
      hostNames: scheduleDialog.form.hostNames.trim() || undefined,
      summary: scheduleDialog.form.summary.trim() || undefined,
      coverImage: scheduleDialog.form.coverImage.trim() || undefined,
      status: scheduleDialog.form.status,
      requestEnabled: scheduleDialog.form.requestEnabled,
      startsAt: normalizeDateTimeField(scheduleDialog.form.startsAt),
      endsAt: normalizeDateTimeField(scheduleDialog.form.endsAt),
      sortOrder: scheduleDialog.form.sortOrder,
      tags: splitTags(scheduleDialog.tagsInput),
    };
    if (scheduleDialog.editingId) {
      await radioApi.updateSchedule(scheduleDialog.editingId, payload);
    } else {
      await radioApi.createSchedule(payload);
    }
    scheduleDialog.visible = false;
    ElMessage.success("节目已保存");
    await refreshConsole();
  } catch (error) {
    ElMessage.error(responseMessage(error) || "节目保存失败");
  } finally {
    scheduleDialog.saving = false;
  }
}

function openRequestDialog(row: RadioSongRequest) {
  requestDialog.visible = true;
  requestDialog.saving = false;
  requestDialog.row = row;
  requestDialog.form.scheduleItemId = row.scheduleItemId ?? null;
  requestDialog.form.status = row.status;
  requestDialog.form.adminNote = row.adminNote ?? "";
  resetPreviewState();
}

async function saveRequestReview() {
  if (!requestDialog.row) return;
  requestDialog.saving = true;
  try {
    await radioApi.updateRequest(requestDialog.row.id, {
      scheduleItemId: requestDialog.form.scheduleItemId,
      status: requestDialog.form.status,
      adminNote: requestDialog.form.adminNote.trim() || null,
    });
    requestDialog.visible = false;
    ElMessage.success("投稿处理结果已保存");
    await refreshConsole();
  } catch (error) {
    ElMessage.error(responseMessage(error) || "投稿处理保存失败");
  } finally {
    requestDialog.saving = false;
  }
}

async function previewRequestSource() {
  const selection = requestDialog.row?.sourceSelection;
  if (!selection || !requestDialog.row) {
    ElMessage.warning("这条投稿还没有锁定音源");
    return;
  }
  await previewSource(selection, requestDialog.row.songTitle, requestDialog.row.artist || "");
}

async function previewSource(selection: RadioMusicSelection, title: string, artist: string) {
  managePreview.loading = true;
  managePreview.trackKey = resultTrackKey(selection);
  managePreview.notice = "";
  try {
    const resolved = await radioApi.resolveMusic({
      provider: selection.provider,
      trackId: selection.trackId,
      mediaMid: selection.mediaMid ?? undefined,
      quality: "standard",
    });
    if (!resolved.streamUrl) {
      managePreview.streamUrl = "";
      managePreview.title = title;
      managePreview.subtitle = [musicProviderLabel(selection.provider), artist].filter(Boolean).join(" · ");
      managePreview.notice = resolved.message || "当前音源没有返回可播放地址";
      ElMessage.warning(managePreview.notice);
      return;
    }
    managePreview.streamUrl = resolved.streamUrl;
    managePreview.title = title;
    managePreview.subtitle = [musicProviderLabel(selection.provider), artist].filter(Boolean).join(" · ");
    managePreview.notice = resolved.trial ? "当前返回的是试听片段。" : (resolved.message || "");
    await nextTick();
    if (managePreviewAudioRef.value) {
      try {
        managePreviewAudioRef.value.pause();
      } catch {
        // ignore
      }
      managePreviewAudioRef.value.load();
      await managePreviewAudioRef.value.play().catch(() => undefined);
    }
  } catch (error) {
    managePreview.streamUrl = "";
    managePreview.notice = responseMessage(error) || "试听解析失败";
    ElMessage.error(managePreview.notice);
  } finally {
    managePreview.loading = false;
  }
}

function stopPreviewAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
  } catch {
    // ignore
  }
}

function closeManagePreview() {
  stopPreviewAudio(managePreviewAudioRef.value);
  resetPreviewState();
}

function resetPreviewState() {
  managePreview.loading = false;
  managePreview.trackKey = "";
  managePreview.streamUrl = "";
  managePreview.title = "";
  managePreview.subtitle = "";
  managePreview.notice = "";
}

function goPublic() {
  router.push({ name: "service-radio-beta" });
}

function goLogin() {
  router.push({ name: "login", query: { redirect: route.fullPath } });
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return "时间待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
</script>

<style scoped>
.radio-console-page {
  --console-red: #b43225;
  --console-ink: #233429;
  --console-line: rgba(84, 98, 77, 0.16);
  --console-green: #2f7d4f;
  min-height: calc(100vh - 160px);
}

.console-shell {
  display: grid;
  grid-template-columns: 312px minmax(0, 1fr);
  gap: 18px;
}

.console-sidebar,
.console-main {
  border-radius: 24px;
  border: 1px solid var(--console-line);
  background:
    linear-gradient(180deg, rgba(248, 245, 239, 0.94) 0%, rgba(255, 255, 255, 0.98) 100%);
  box-shadow: 0 20px 48px rgba(35, 52, 41, 0.08);
}

.console-sidebar {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 22px;
  position: sticky;
  top: 88px;
  align-self: start;
}

.sidebar-brand {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sidebar-logo-shell {
  display: grid;
  place-items: center;
  width: 108px;
  height: 108px;
  padding: 12px;
  border-radius: 28px;
  border: 1px solid rgba(180, 50, 37, 0.14);
  background: rgba(255, 249, 247, 0.96);
}

.sidebar-logo {
  width: 100%;
  height: auto;
}

.sidebar-copy,
.console-title,
.summary-card,
.card-head > div,
.preview-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-kicker,
.console-kicker,
.card-kicker,
.sidebar-link span {
  color: var(--console-red);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sidebar-copy h1,
.console-title h2,
.card-head h3 {
  margin: 0;
  color: var(--console-ink);
}

.sidebar-copy h1 {
  font-size: 28px;
}

.sidebar-copy p,
.console-title p,
.summary-card small,
.overview-row span,
.recent-card p,
.recent-card small,
.queue-item span,
.queue-item small,
.preview-meta span,
.request-preview-player small,
.request-note-card p,
.request-note-card small {
  margin: 0;
  color: #5b6858;
  line-height: 1.7;
}

.sidebar-nav,
.sidebar-actions,
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sidebar-link {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid var(--console-line);
  background: rgba(255, 255, 255, 0.84);
  color: var(--console-ink);
  text-align: left;
  cursor: pointer;
}

.sidebar-link strong {
  font-size: 17px;
}

.sidebar-link.active {
  border-color: rgba(180, 50, 37, 0.26);
  background: linear-gradient(135deg, rgba(180, 50, 37, 0.08) 0%, rgba(255, 255, 255, 0.96) 100%);
  box-shadow: 0 10px 20px rgba(180, 50, 37, 0.08);
}

.sidebar-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: auto;
}

.summary-card,
.summary-grid article,
.overview-card,
.console-card,
.recent-card,
.request-note-card,
.source-preview-card,
.request-preview-player {
  border-radius: 20px;
  border: 1px solid var(--console-line);
  background: rgba(255, 255, 255, 0.92);
}

.summary-card {
  padding: 16px;
}

.summary-card strong,
.overview-row strong,
.request-note-card strong,
.preview-meta strong {
  color: var(--console-ink);
}

.summary-grid,
.overview-grid,
.recent-grid,
.dialog-grid {
  display: grid;
  gap: 14px;
}

.summary-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-grid article {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
}

.summary-grid b,
.overview-card b {
  font-size: 26px;
  line-height: 1;
  color: var(--console-red);
}

.console-main {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px;
}

.console-header,
.card-head,
.source-preview-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.console-header-actions,
.alert-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.console-title h2 {
  font-size: 32px;
  line-height: 1.12;
}

.permission-shell {
  min-height: 320px;
  display: grid;
  place-items: center;
}

.console-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.overview-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.overview-grid.split {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.overview-card,
.console-card {
  padding: 20px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-card span,
.stat-card small {
  color: #5b6858;
}

.stat-card.accent {
  background: linear-gradient(135deg, rgba(47, 125, 79, 0.08) 0%, rgba(180, 50, 37, 0.08) 100%);
}

.overview-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.overview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(247, 243, 235, 0.72);
}

.queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--console-line);
  background: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  text-align: left;
}

.queue-item div,
.recent-head,
.request-note-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.queue-item strong,
.recent-head strong {
  color: var(--console-ink);
}

.recent-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.recent-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dialog-grid.triple {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field span {
  font-size: 13px;
  font-weight: 600;
  color: #596657;
}

.field input[type="text"],
.field input[type="date"],
.field input[type="time"],
.field input[type="datetime-local"],
.field input[type="number"],
.field select,
.field textarea {
  width: 100%;
  min-height: 44px;
  padding: 11px 12px;
  border-radius: 12px;
  border: 1px solid var(--console-line);
  background: rgba(255, 255, 255, 0.96);
  color: var(--console-ink);
  font: inherit;
  outline: none;
}

.field textarea {
  min-height: 120px;
  resize: vertical;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: rgba(180, 50, 37, 0.3);
  box-shadow: 0 0 0 4px rgba(180, 50, 37, 0.08);
}

.checkbox-field {
  justify-content: center;
}

.checkbox-field input[type="checkbox"] {
  width: 18px;
  height: 18px;
  margin-top: 6px;
}

.request-note-card,
.source-preview-card,
.request-preview-player {
  padding: 16px;
}

.music-auth-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--console-line);
  background: linear-gradient(135deg, rgba(180, 50, 37, 0.06) 0%, rgba(255, 255, 255, 0.94) 100%);
}

.music-auth-main,
.music-auth-actions,
.preview-head,
.cookie-login-note {
  display: flex;
  gap: 12px;
}

.music-auth-main {
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
}

.music-auth-avatar {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  overflow: hidden;
  background: rgba(180, 50, 37, 0.1);
  color: var(--console-red);
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 700;
  flex: 0 0 auto;
}

.music-auth-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.music-auth-avatar.fallback {
  border: 1px dashed rgba(180, 50, 37, 0.22);
}

.music-auth-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.music-auth-copy strong,
.cookie-login-note strong {
  color: var(--console-ink);
}

.music-auth-copy p,
.music-auth-copy small,
.cookie-login-note p {
  margin: 0;
  color: #5b6858;
  line-height: 1.7;
}

.music-auth-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.bookmarklet-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border-radius: 18px;
  border: 1px dashed rgba(180, 50, 37, 0.26);
  background: linear-gradient(135deg, rgba(180, 50, 37, 0.08) 0%, rgba(247, 243, 235, 0.94) 100%);
}

.bookmarklet-card span,
.bookmarklet-card small {
  color: #5b6858;
}

.bookmarklet-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 20px;
  border-radius: 16px;
  background: linear-gradient(135deg, #b43225 0%, #d04f39 100%);
  color: #fff8f5;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-decoration: none;
  box-shadow: 0 14px 28px rgba(180, 50, 37, 0.18);
  width: fit-content;
}

.bookmarklet-chip:hover {
  color: #fffdfb;
  transform: translateY(-1px);
}

.preview-head {
  align-items: flex-start;
  justify-content: space-between;
}

.cookie-login-note {
  flex-direction: column;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(180, 50, 37, 0.14);
  background: rgba(247, 243, 235, 0.72);
}

@media (max-width: 1280px) {
  .console-shell {
    grid-template-columns: 1fr;
  }

  .console-sidebar {
    position: static;
  }

  .overview-grid,
  .recent-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .overview-grid,
  .overview-grid.split,
  .dialog-grid,
  .dialog-grid.triple,
  .recent-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .console-main,
  .console-sidebar {
    padding: 16px;
    border-radius: 20px;
  }

  .console-header,
  .card-head,
  .source-preview-card {
    flex-direction: column;
    align-items: stretch;
  }

  .music-auth-card,
  .preview-head {
    flex-direction: column;
    align-items: stretch;
  }

  .bookmarklet-chip {
    width: 100%;
  }

  .console-title h2 {
    font-size: 26px;
  }

  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
