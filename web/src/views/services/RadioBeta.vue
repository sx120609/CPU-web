<template>
  <div class="radio-page">
    <section class="radio-hero">
      <div class="hero-copy">
        <div class="hero-brand">
          <img :src="brandLogo" :alt="brandName" class="hero-logo" />
        </div>
        <div class="hero-kicker">校园小工具 / {{ brandName }}</div>
        <h1>{{ brandTitle }}</h1>
        <p>
          先把药苑之声的播出时段、节目排班和点歌留言收进来。整体还是药大拾间的壳，
          但会保留一点原站首页那种更像“真实站务工作台”的业务气质。
        </p>
        <div class="hero-actions">
          <el-button type="primary" @click="scrollToRequest">我要点歌</el-button>
          <el-button v-if="canManage" plain @click="scrollToManage">进入工作台</el-button>
          <el-button v-else-if="loginRequired" plain @click="goLogin">登录后使用</el-button>
        </div>
      </div>
      <div class="hero-side">
        <div class="hero-badge">一期复刻</div>
        <div class="hero-semester">{{ overview?.currentSemester?.name || "待配置当前学期" }}</div>
        <div class="hero-sub">
          {{ overview?.currentSemester?.description || "先接入节目编排、时段管理和点歌留言，后续再补投票、通知与更多站务流程。" }}
        </div>
      </div>
    </section>

    <section v-if="pageError" class="radio-alert">
      <el-alert :title="pageError" type="warning" :closable="false" show-icon>
        <template #default>
          <div class="alert-actions">
            <el-button size="small" :loading="loadingOverview" @click="loadOverview">重试</el-button>
            <el-button v-if="loginRequired" size="small" plain @click="goLogin">去登录</el-button>
          </div>
        </template>
      </el-alert>
    </section>

    <section class="radio-overview" v-loading="loadingOverview">
      <article class="stat-card">
        <span class="stat-label">当前学期</span>
        <b>{{ overview?.currentSemester?.code || "未设置" }}</b>
        <small>{{ overview?.currentSemester?.status === "active" ? "进行中" : "待启用" }}</small>
      </article>
      <article class="stat-card">
        <span class="stat-label">播出时段</span>
        <b>{{ overview?.playTimes.length || 0 }}</b>
        <small>按周常规时段</small>
      </article>
      <article class="stat-card">
        <span class="stat-label">已发布节目</span>
        <b>{{ overview?.scheduleItems.length || 0 }}</b>
        <small>一期先做节目排班</small>
      </article>
      <article class="stat-card accent">
        <span class="stat-label">点歌留言</span>
        <b>{{ overview?.requestSummary.total || 0 }}</b>
        <small>{{ overview?.requestSummary.pending || 0 }} 条待处理</small>
      </article>
    </section>

    <section class="radio-main">
      <div class="radio-column">
        <article class="panel">
          <div class="panel-head">
            <div>
              <h2>本周播出时段</h2>
              <p>先用结构化时段把药苑之声的节目安排沉淀下来，后面再接更复杂的排班逻辑。</p>
            </div>
            <el-tag type="success" effect="plain" round>{{ overview?.playTimes.length || 0 }} 个时段</el-tag>
          </div>
          <div v-if="playTimeGroups.length" class="weekday-grid">
            <div v-for="group in playTimeGroups" :key="group.weekday" class="weekday-card">
              <div class="weekday-head">
                <strong>{{ group.label }}</strong>
                <span>{{ group.items.length }} 个时段</span>
              </div>
              <div class="weekday-items">
                <div v-for="item in group.items" :key="item.id" class="slot-row">
                  <div class="slot-time">{{ item.startTime }} - {{ item.endTime }}</div>
                  <div class="slot-main">
                    <b>{{ item.name }}</b>
                    <small>{{ item.location || "待定地点" }}</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <el-empty v-else description="还没有配置播出时段" />
        </article>

        <article class="panel">
          <div class="panel-head">
            <div>
              <h2>节目安排</h2>
              <p>这里展示当前学期已经发布的节目，风格会保留一点原药苑之声那种栏目化感觉。</p>
            </div>
            <el-tag type="warning" effect="plain" round>{{ overview?.scheduleItems.length || 0 }} 个节目</el-tag>
          </div>
          <div v-if="overview?.scheduleItems.length" class="schedule-list">
            <article v-for="item in overview.scheduleItems" :key="item.id" class="schedule-card">
              <div class="schedule-topline">
                <span class="schedule-pill">{{ weekdayLabel(item.playTime?.weekday) }}</span>
                <span class="schedule-meta">{{ item.playTime?.startTime || "待定时间" }}{{ item.playTime?.location ? ` · ${item.playTime.location}` : "" }}</span>
              </div>
              <h3>{{ item.title }}</h3>
              <p v-if="item.subtitle" class="schedule-subtitle">{{ item.subtitle }}</p>
              <p class="schedule-summary">{{ item.summary || "这个节目还在补充简介，先把主流程接进来。" }}</p>
              <div class="schedule-foot">
                <span>{{ item.hostNames || "主持人待补充" }}</span>
                <span>{{ item.requestCount }} 条相关点歌</span>
              </div>
              <div v-if="item.tags.length" class="tag-row">
                <span v-for="tag in item.tags" :key="tag" class="tag-chip">{{ tag }}</span>
              </div>
            </article>
          </div>
          <el-empty v-else description="当前还没有发布节目" />
        </article>
      </div>

      <aside ref="requestSectionRef" class="radio-side-column">
        <article class="panel request-panel">
          <div class="panel-head compact">
            <div>
              <h2>点歌留言</h2>
              <p>先做最小可用版本，后面再接审核、投票和自动通知。</p>
            </div>
          </div>

          <div class="request-summary">
            <div>
              <b>{{ overview?.requestSummary.pending || 0 }}</b>
              <span>待处理</span>
            </div>
            <div>
              <b>{{ overview?.requestSummary.fulfilled || 0 }}</b>
              <span>已完成</span>
            </div>
          </div>

          <div v-if="loginRequired && !hasToken" class="login-block">
            <p>当前药苑之声配置为登录后才能使用，登录后就能点歌和进入个人工作台。</p>
            <el-button type="primary" @click="goLogin">去登录</el-button>
          </div>

          <form v-else class="request-form" @submit.prevent="submitRequest">
            <label class="field">
              <span>称呼</span>
              <input v-model.trim="requestForm.nickname" maxlength="40" placeholder="例如 小王 / 23药学张同学" />
            </label>
            <label class="field">
              <span>节目</span>
              <select v-model="requestForm.scheduleItemId">
                <option :value="null">不指定节目</option>
                <option v-for="item in requestablePrograms" :key="item.id" :value="item.id">
                  {{ item.title }}{{ item.playTime?.startTime ? ` · ${item.playTime.startTime}` : "" }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>歌曲名</span>
              <input v-model.trim="requestForm.songTitle" maxlength="120" placeholder="例如 晴天" />
            </label>
            <label class="field">
              <span>歌手</span>
              <input v-model.trim="requestForm.artist" maxlength="120" placeholder="例如 周杰伦" />
            </label>
            <label class="field">
              <span>想对谁说</span>
              <input v-model.trim="requestForm.dedication" maxlength="200" placeholder="例如 送给准备考试的室友" />
            </label>
            <label class="field">
              <span>联系方式</span>
              <input v-model.trim="requestForm.contact" maxlength="120" placeholder="选填，便于药苑之声回访" />
            </label>
            <label class="field">
              <span>留言</span>
              <textarea v-model.trim="requestForm.message" maxlength="1000" rows="5" placeholder="你想在广播里说的话、点歌原因或氛围描述都可以写在这里。" />
            </label>
            <el-button type="primary" native-type="submit" :loading="submittingRequest">提交点歌</el-button>
          </form>
        </article>
      </aside>
    </section>

    <section v-if="canManage" ref="manageSectionRef" class="manage-shell" v-loading="loadingManage">
      <div class="manage-head">
        <div>
          <div class="manage-kicker">工作台</div>
          <h2>{{ brandName }}工作台</h2>
          <p>这里先接学期、时段、节目和点歌处理四条主链，方便后面继续扩。</p>
        </div>
        <el-button plain @click="loadManageData">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-tabs v-model="manageTab" class="manage-tabs">
        <el-tab-pane label="📚 学期" name="semesters">
          <div class="manager-panel">
            <div class="manager-head">
              <div>
                <h3>学期配置</h3>
                <p>用来标记当前广播周期，也决定前台默认展示哪一批节目和时段。</p>
              </div>
              <el-button type="primary" @click="openSemesterDialog()">新增学期</el-button>
            </div>
            <el-table :data="manageData.semesters" stripe>
              <el-table-column prop="name" label="学期名" min-width="180" />
              <el-table-column prop="code" label="编码" width="140" />
              <el-table-column label="状态" width="120">
                <template #default="{ row }">
                  <el-tag :type="semesterStatusTag(row.status)">{{ semesterStatusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="当前学期" width="110">
                <template #default="{ row }">
                  <el-tag v-if="row.isCurrent" type="success">当前</el-tag>
                  <span v-else class="muted">否</span>
                </template>
              </el-table-column>
              <el-table-column label="节目 / 时段" width="130">
                <template #default="{ row }">
                  {{ row.counts?.scheduleItems || 0 }} / {{ row.counts?.playTimes || 0 }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button text type="primary" @click="openSemesterDialog(row)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="🕒 时段" name="playTimes">
          <div class="manager-panel">
            <div class="manager-head">
              <div>
                <h3>播出时段</h3>
                <p>先按星期和固定时间配置时段，后面节目会挂在这些时段上。</p>
              </div>
              <el-button type="primary" @click="openPlayTimeDialog()">新增时段</el-button>
            </div>
            <el-table :data="manageData.playTimes" stripe>
              <el-table-column label="星期" width="100">
                <template #default="{ row }">{{ weekdayLabel(row.weekday) }}</template>
              </el-table-column>
              <el-table-column prop="name" label="时段名" min-width="160" />
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ row.startTime }} - {{ row.endTime }}</template>
              </el-table-column>
              <el-table-column prop="location" label="地点" min-width="140" />
              <el-table-column label="学期" min-width="150">
                <template #default="{ row }">{{ row.semester?.name || "通用" }}</template>
              </el-table-column>
              <el-table-column label="启用" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? "启用" : "停用" }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button text type="primary" @click="openPlayTimeDialog(row)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="🎙 节目" name="schedules">
          <div class="manager-panel">
            <div class="manager-head">
              <div>
                <h3>节目编排</h3>
                <p>节目是广播站真正的业务主体，这里先把名称、主持人、简介和点歌开关收好。</p>
              </div>
              <el-button type="primary" @click="openScheduleDialog()">新增节目</el-button>
            </div>
            <el-table :data="manageData.scheduleItems" stripe>
              <el-table-column prop="title" label="节目名" min-width="180" />
              <el-table-column label="时段" min-width="180">
                <template #default="{ row }">
                  {{ row.playTime ? `${weekdayLabel(row.playTime.weekday)} ${row.playTime.startTime} ${row.playTime.name}` : "未绑定时段" }}
                </template>
              </el-table-column>
              <el-table-column prop="hostNames" label="主持人" min-width="140" />
              <el-table-column label="状态" width="120">
                <template #default="{ row }">
                  <el-tag :type="scheduleStatusTag(row.status)">{{ scheduleStatusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="点歌" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.requestEnabled ? 'success' : 'info'">{{ row.requestEnabled ? "开放" : "关闭" }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="留言数" width="100">
                <template #default="{ row }">{{ row.requestCount }}</template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button text type="primary" @click="openScheduleDialog(row)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="💌 点歌" name="requests">
          <div class="manager-panel">
            <div class="manager-head">
              <div>
                <h3>点歌处理</h3>
                <p>先保留最基础的处理状态和备注，足够一期人工流转。</p>
              </div>
            </div>
            <el-table :data="manageData.requests" stripe>
              <el-table-column prop="nickname" label="称呼" width="120" />
              <el-table-column prop="songTitle" label="歌曲" min-width="160" />
              <el-table-column prop="artist" label="歌手" min-width="140" />
              <el-table-column label="节目" min-width="180">
                <template #default="{ row }">{{ row.scheduleItem?.title || "未指定" }}</template>
              </el-table-column>
              <el-table-column label="状态" width="120">
                <template #default="{ row }">
                  <el-tag :type="requestStatusTag(row.status)">{{ requestStatusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="留言" min-width="220">
                <template #default="{ row }">
                  <span class="line-clamp-two">{{ row.message || row.dedication || "无" }}</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="170" fixed="right">
                <template #default="{ row }">
                  <el-button text type="primary" @click="openRequestDialog(row)">处理</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="semesterDialog.visible" :title="semesterDialog.editingId ? '编辑学期' : '新增学期'" width="560px">
      <el-form label-position="top" class="dialog-form">
        <el-form-item label="学期名">
          <el-input v-model.trim="semesterDialog.form.name" maxlength="80" />
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model.trim="semesterDialog.form.code" maxlength="40" placeholder="例如 2026-fall" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model.trim="semesterDialog.form.description" type="textarea" :rows="3" maxlength="1000" />
        </el-form-item>
        <div class="dialog-grid">
          <el-form-item label="开始日期">
            <el-input v-model="semesterDialog.form.startDate" type="date" />
          </el-form-item>
          <el-form-item label="结束日期">
            <el-input v-model="semesterDialog.form.endDate" type="date" />
          </el-form-item>
        </div>
        <div class="dialog-grid">
          <el-form-item label="状态">
            <el-select v-model="semesterDialog.form.status">
              <el-option label="草稿" value="draft" />
              <el-option label="进行中" value="active" />
              <el-option label="已归档" value="archived" />
            </el-select>
          </el-form-item>
          <el-form-item label="当前学期">
            <el-switch v-model="semesterDialog.form.isCurrent" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="semesterDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="semesterDialog.saving" @click="saveSemester">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="playTimeDialog.visible" :title="playTimeDialog.editingId ? '编辑时段' : '新增时段'" width="560px">
      <el-form label-position="top" class="dialog-form">
        <el-form-item label="时段名">
          <el-input v-model.trim="playTimeDialog.form.name" maxlength="80" />
        </el-form-item>
        <div class="dialog-grid triple">
          <el-form-item label="星期">
            <el-select v-model="playTimeDialog.form.weekday">
              <el-option v-for="item in weekdayOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="开始时间">
            <el-input v-model="playTimeDialog.form.startTime" type="time" />
          </el-form-item>
          <el-form-item label="结束时间">
            <el-input v-model="playTimeDialog.form.endTime" type="time" />
          </el-form-item>
        </div>
        <div class="dialog-grid">
          <el-form-item label="所属学期">
            <el-select v-model="playTimeDialog.form.semesterId" clearable placeholder="通用">
              <el-option v-for="item in manageData.semesters" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="playTimeDialog.form.sortOrder" :min="0" :max="999" style="width: 100%" />
          </el-form-item>
        </div>
        <el-form-item label="地点">
          <el-input v-model.trim="playTimeDialog.form.location" maxlength="120" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model.trim="playTimeDialog.form.note" type="textarea" :rows="3" maxlength="600" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="playTimeDialog.form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="playTimeDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="playTimeDialog.saving" @click="savePlayTime">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="scheduleDialog.visible" :title="scheduleDialog.editingId ? '编辑节目' : '新增节目'" width="720px">
      <el-form label-position="top" class="dialog-form">
        <el-form-item label="节目名">
          <el-input v-model.trim="scheduleDialog.form.title" maxlength="120" />
        </el-form-item>
        <div class="dialog-grid">
          <el-form-item label="副标题">
            <el-input v-model.trim="scheduleDialog.form.subtitle" maxlength="120" />
          </el-form-item>
          <el-form-item label="主持人">
            <el-input v-model.trim="scheduleDialog.form.hostNames" maxlength="160" placeholder="例如 阿青 / 小刘" />
          </el-form-item>
        </div>
        <div class="dialog-grid">
          <el-form-item label="所属学期">
            <el-select v-model="scheduleDialog.form.semesterId" clearable placeholder="通用">
              <el-option v-for="item in manageData.semesters" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="绑定时段">
            <el-select v-model="scheduleDialog.form.playTimeId" clearable placeholder="暂不绑定">
              <el-option
                v-for="item in manageData.playTimes"
                :key="item.id"
                :label="`${weekdayLabel(item.weekday)} ${item.startTime} ${item.name}`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
        </div>
        <div class="dialog-grid">
          <el-form-item label="状态">
            <el-select v-model="scheduleDialog.form.status">
              <el-option label="草稿" value="draft" />
              <el-option label="已发布" value="published" />
              <el-option label="已归档" value="archived" />
            </el-select>
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="scheduleDialog.form.sortOrder" :min="0" :max="999" style="width: 100%" />
          </el-form-item>
        </div>
        <div class="dialog-grid">
          <el-form-item label="开始时间">
            <el-input v-model="scheduleDialog.form.startsAt" type="datetime-local" />
          </el-form-item>
          <el-form-item label="结束时间">
            <el-input v-model="scheduleDialog.form.endsAt" type="datetime-local" />
          </el-form-item>
        </div>
        <el-form-item label="标签">
          <el-input v-model="scheduleDialog.tagsInput" maxlength="200" placeholder="用中文逗号分开，例如 校园 / 深夜 / 点歌" />
        </el-form-item>
        <el-form-item label="封面图">
          <el-input v-model.trim="scheduleDialog.form.coverImage" maxlength="800" placeholder="先预留图片地址，后面可接上传流程" />
        </el-form-item>
        <el-form-item label="节目简介">
          <el-input v-model.trim="scheduleDialog.form.summary" type="textarea" :rows="4" maxlength="2000" />
        </el-form-item>
        <el-form-item label="开放点歌">
          <el-switch v-model="scheduleDialog.form.requestEnabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="scheduleDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="scheduleDialog.saving" @click="saveSchedule">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="requestDialog.visible" title="处理点歌" width="560px">
      <el-form v-if="requestDialog.row" label-position="top" class="dialog-form">
        <el-form-item label="点歌人">
          <el-input :model-value="requestDialog.row.nickname" disabled />
        </el-form-item>
        <div class="dialog-grid">
          <el-form-item label="歌曲">
            <el-input :model-value="requestDialog.row.songTitle" disabled />
          </el-form-item>
          <el-form-item label="歌手">
            <el-input :model-value="requestDialog.row.artist || '未填写'" disabled />
          </el-form-item>
        </div>
        <el-form-item label="归属节目">
          <el-select v-model="requestDialog.form.scheduleItemId" clearable placeholder="未指定">
            <el-option v-for="item in manageData.scheduleItems" :key="item.id" :label="item.title" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理状态">
          <el-select v-model="requestDialog.form.status">
            <el-option label="待处理" value="pending" />
            <el-option label="已通过" value="approved" />
            <el-option label="已播出" value="fulfilled" />
            <el-option label="已拒绝" value="rejected" />
          </el-select>
        </el-form-item>
        <el-form-item label="留言内容">
          <div class="request-note-card">
            <p>{{ requestDialog.row.dedication || "未填写送达对象" }}</p>
            <p>{{ requestDialog.row.message || "未填写附加留言" }}</p>
          </div>
        </el-form-item>
        <el-form-item label="管理备注">
          <el-input v-model.trim="requestDialog.form.adminNote" type="textarea" :rows="4" maxlength="1000" />
        </el-form-item>
      </el-form>
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
import { Refresh } from "@element-plus/icons-vue";
import { radioApi, type RadioManageBootstrap, type RadioOverview, type RadioPlayTime, type RadioScheduleItem, type RadioSemester, type RadioSongRequest } from "@/api/radio";
import { getToken } from "@/api/request";
import { toolsApi } from "@/api/tools";
import brandLogo from "@/assets/brands/yaoyuanzhisheng-seal.png";

const router = useRouter();
const route = useRoute();
const brandName = "药苑之声";
const brandTitle = `${brandName} beta`;

const loadingOverview = ref(false);
const loadingManage = ref(false);
const submittingRequest = ref(false);
const loginRequired = ref(false);
const pageError = ref("");
const hasToken = computed(() => Boolean(getToken()));
const canManage = ref(false);
const manageTab = ref("semesters");
const overview = ref<RadioOverview | null>(null);
const manageData = reactive<RadioManageBootstrap>({
  semesters: [],
  playTimes: [],
  scheduleItems: [],
  requests: [],
});
const requestSectionRef = ref<HTMLElement | null>(null);
const manageSectionRef = ref<HTMLElement | null>(null);

const requestForm = reactive<{
  nickname: string;
  scheduleItemId: number | null;
  songTitle: string;
  artist: string;
  dedication: string;
  contact: string;
  message: string;
}>({
  nickname: "",
  scheduleItemId: null,
  songTitle: "",
  artist: "",
  dedication: "",
  contact: "",
  message: "",
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

const weekdayOptions = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

const playTimeGroups = computed(() => {
  const map = new Map<number, RadioPlayTime[]>();
  for (const item of overview.value?.playTimes ?? []) {
    const list = map.get(item.weekday) ?? [];
    list.push(item);
    map.set(item.weekday, list);
  }
  return weekdayOptions
    .map((option) => ({
      weekday: option.value,
      label: option.label,
      items: (map.get(option.value) ?? []).slice().sort((left, right) => left.startTime.localeCompare(right.startTime) || left.sortOrder - right.sortOrder),
    }))
    .filter((group) => group.items.length);
});

const requestablePrograms = computed(() =>
  (overview.value?.scheduleItems ?? []).filter((item) => item.requestEnabled)
);

onMounted(async () => {
  await Promise.all([loadOverview(), initPermission()]);
  if (canManage.value) {
    await loadManageData();
  }
  if (route.query.manage === "1" && canManage.value) {
    await nextTick();
    scrollToManage();
  }
});

async function initPermission() {
  canManage.value = false;
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
    canManage.value = canManage.value || perms.toolCodes.includes("radio_beta") || perms.adminToolCodes.includes("radio_beta");
  } catch {
    // ignore
  }
}

async function loadOverview() {
  loadingOverview.value = true;
  pageError.value = "";
  loginRequired.value = false;
  try {
    overview.value = await radioApi.overview();
  } catch (error) {
    overview.value = null;
    const status = responseStatus(error);
    if (status === 401) {
      loginRequired.value = true;
      pageError.value = `${brandName}当前需要登录后使用。`;
      return;
    }
    pageError.value = responseMessage(error) || `${brandName}概览加载失败`;
  } finally {
    loadingOverview.value = false;
  }
}

async function loadManageData() {
  if (!canManage.value) return;
  loadingManage.value = true;
  try {
    const next = await radioApi.manageBootstrap();
    manageData.semesters = next.semesters;
    manageData.playTimes = next.playTimes;
    manageData.scheduleItems = next.scheduleItems;
    manageData.requests = next.requests;
  } catch (error) {
    const status = responseStatus(error);
    if (status === 401 || status === 403) {
      canManage.value = false;
      return;
    }
    ElMessage.error(responseMessage(error) || `${brandName}工作台加载失败`);
  } finally {
    loadingManage.value = false;
  }
}

async function submitRequest() {
  if (!requestForm.songTitle.trim()) {
    ElMessage.warning("请先填写歌曲名");
    return;
  }
  submittingRequest.value = true;
  try {
    await radioApi.submitRequest({
      nickname: requestForm.nickname || undefined,
      scheduleItemId: requestForm.scheduleItemId,
      songTitle: requestForm.songTitle,
      artist: requestForm.artist || undefined,
      dedication: requestForm.dedication || undefined,
      contact: requestForm.contact || undefined,
      message: requestForm.message || undefined,
    });
    ElMessage.success(`点歌已提交，${brandName}后台现在能直接看到这条记录了`);
    requestForm.nickname = "";
    requestForm.scheduleItemId = null;
    requestForm.songTitle = "";
    requestForm.artist = "";
    requestForm.dedication = "";
    requestForm.contact = "";
    requestForm.message = "";
    await loadOverview();
    if (canManage.value) await loadManageData();
  } catch (error) {
    const status = responseStatus(error);
    if (status === 401) {
      loginRequired.value = true;
      goLogin();
      return;
    }
    ElMessage.error(responseMessage(error) || "点歌提交失败");
  } finally {
    submittingRequest.value = false;
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
    await Promise.all([loadOverview(), loadManageData()]);
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
    await Promise.all([loadOverview(), loadManageData()]);
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
    await Promise.all([loadOverview(), loadManageData()]);
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
    ElMessage.success("点歌处理结果已保存");
    await Promise.all([loadOverview(), loadManageData()]);
  } catch (error) {
    ElMessage.error(responseMessage(error) || "点歌处理保存失败");
  } finally {
    requestDialog.saving = false;
  }
}

function goLogin() {
  router.push({ name: "login", query: { redirect: route.fullPath } });
}

function scrollToRequest() {
  requestSectionRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToManage() {
  manageSectionRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function weekdayLabel(value?: number | null) {
  return weekdayOptions.find((item) => item.value === value)?.label || "未排期";
}

function semesterStatusText(value: string) {
  if (value === "active") return "进行中";
  if (value === "archived") return "已归档";
  return "草稿";
}

function semesterStatusTag(value: string) {
  if (value === "active") return "success";
  if (value === "archived") return "info";
  return "warning";
}

function scheduleStatusText(value: string) {
  if (value === "published") return "已发布";
  if (value === "archived") return "已归档";
  return "草稿";
}

function scheduleStatusTag(value: string) {
  if (value === "published") return "success";
  if (value === "archived") return "info";
  return "warning";
}

function requestStatusText(value: string) {
  if (value === "approved") return "已通过";
  if (value === "fulfilled") return "已播出";
  if (value === "rejected") return "已拒绝";
  return "待处理";
}

function requestStatusTag(value: string) {
  if (value === "approved") return "success";
  if (value === "fulfilled") return "success";
  if (value === "rejected") return "danger";
  return "warning";
}

function splitTags(raw: string) {
  return raw
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function toDateInput(value?: string | null) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function toDateTimeLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function normalizeDateField(value: string) {
  return value.trim() ? value.trim() : null;
}

function normalizeDateTimeField(value: string) {
  return value.trim() ? value.trim() : null;
}

function responseStatus(error: unknown) {
  return (error as { response?: { status?: number } })?.response?.status;
}

function responseMessage(error: unknown) {
  return (error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
    || (error as { message?: string })?.message
    || "";
}
</script>

<style scoped>
.radio-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.radio-hero,
.radio-overview,
.panel,
.manage-shell {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 18px;
  box-shadow: var(--cpu-shadow-sm);
}

.radio-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
  gap: 18px;
  padding: 24px;
  background:
    radial-gradient(circle at top left, rgba(166, 54, 42, 0.16), transparent 34%),
    radial-gradient(circle at top right, rgba(47, 125, 79, 0.18), transparent 34%),
    linear-gradient(135deg, rgba(246, 248, 242, 0.94) 0%, rgba(255, 255, 255, 0.96) 52%, rgba(20, 143, 123, 0.08) 100%);
}

.hero-brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 132px;
  height: 132px;
  padding: 10px;
  border-radius: 32px;
  background: linear-gradient(180deg, rgba(255, 248, 245, 0.92) 0%, rgba(255, 255, 255, 0.98) 100%);
  border: 1px solid rgba(166, 54, 42, 0.1);
  box-shadow: 0 14px 28px rgba(166, 54, 42, 0.08);
}

.hero-logo {
  width: 100%;
  height: auto;
}

.hero-kicker {
  color: #a6362a;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.manage-kicker {
  color: #2f7d4f;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero-copy h1,
.manage-head h2 {
  margin: 8px 0 0;
  font-size: 30px;
  color: var(--cpu-text);
}

.hero-copy p,
.manage-head p {
  margin: 10px 0 0;
  color: var(--cpu-text-secondary);
  line-height: 1.8;
  font-size: 14px;
}

.hero-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
}

.hero-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: 16px;
  background: rgba(255, 250, 248, 0.88);
  border: 1px solid rgba(166, 54, 42, 0.12);
}

.hero-badge {
  align-self: flex-start;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(166, 54, 42, 0.1);
  color: #a6362a;
  font-size: 12px;
  font-weight: 700;
}

.hero-semester {
  font-size: 22px;
  font-weight: 700;
  color: #1f3b2b;
}

.hero-sub {
  color: #537062;
  line-height: 1.7;
  font-size: 13px;
}

.radio-alert {
  margin-top: -2px;
}

.alert-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.radio-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(247, 250, 247, 0.92) 100%);
  border: 1px solid rgba(47, 125, 79, 0.1);
}

.stat-card.accent {
  background: linear-gradient(135deg, rgba(20, 143, 123, 0.12) 0%, rgba(245, 158, 11, 0.1) 100%);
}

.stat-label {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.stat-card b {
  font-size: 26px;
  color: #1f3b2b;
  line-height: 1;
}

.stat-card small {
  color: #5f6f67;
  font-size: 12px;
}

.radio-main {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.85fr);
  gap: 16px;
}

.radio-column,
.radio-side-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  padding: 18px;
}

.panel-head,
.manager-head,
.manage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.panel-head.compact {
  margin-bottom: 12px;
}

.panel-head h2,
.manager-head h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 18px;
}

.panel-head p,
.manager-head p {
  margin: 6px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.weekday-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.weekday-card {
  border: 1px solid rgba(47, 125, 79, 0.12);
  border-radius: 14px;
  padding: 14px;
  background: linear-gradient(180deg, rgba(249, 251, 247, 0.86) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.weekday-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.weekday-head strong {
  color: #1f3b2b;
  font-size: 15px;
}

.weekday-head span {
  color: var(--cpu-text-muted);
  font-size: 12px;
}

.weekday-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.slot-row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(15, 118, 110, 0.08);
}

.slot-time {
  font-weight: 700;
  color: #2f7d4f;
  font-size: 13px;
}

.slot-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.slot-main b,
.schedule-card h3 {
  color: var(--cpu-text);
}

.slot-main small,
.schedule-foot {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.schedule-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.schedule-card {
  padding: 16px;
  border-radius: 16px;
  border: 1px solid rgba(47, 125, 79, 0.12);
  background:
    radial-gradient(circle at top right, rgba(47, 125, 79, 0.08), transparent 30%),
    linear-gradient(180deg, rgba(248, 252, 249, 0.92) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.schedule-topline,
.schedule-foot,
.tag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.schedule-topline {
  margin-bottom: 10px;
}

.schedule-pill {
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(47, 125, 79, 0.12);
  color: #2f7d4f;
  font-size: 12px;
  font-weight: 700;
}

.schedule-meta {
  color: #5d6f66;
  font-size: 12px;
}

.schedule-card h3 {
  margin: 0;
  font-size: 18px;
}

.schedule-subtitle {
  margin: 6px 0 0;
  color: #36624c;
  font-size: 13px;
  font-weight: 600;
}

.schedule-summary {
  margin: 10px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.schedule-foot {
  justify-content: space-between;
  margin-top: 14px;
}

.tag-row {
  margin-top: 12px;
}

.tag-chip {
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.08);
  color: #0f766e;
  font-size: 11px;
}

.request-panel {
  position: sticky;
  top: 84px;
}

.request-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.request-summary > div {
  padding: 12px;
  border-radius: 14px;
  background: rgba(47, 125, 79, 0.08);
  border: 1px solid rgba(47, 125, 79, 0.1);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.request-summary b {
  font-size: 22px;
  color: #1f3b2b;
}

.request-summary span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.request-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field span {
  font-size: 13px;
  font-weight: 600;
  color: var(--cpu-text-secondary);
}

.field input,
.field select,
.field textarea {
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--cpu-border);
  background: rgba(255, 255, 255, 0.92);
  color: var(--cpu-text);
  font: inherit;
  outline: none;
}

.field textarea {
  min-height: 118px;
  resize: vertical;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: #2f7d4f;
  box-shadow: 0 0 0 3px rgba(47, 125, 79, 0.12);
}

.login-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.login-block p,
.request-note-card p {
  margin: 0;
  color: var(--cpu-text-secondary);
  line-height: 1.7;
  font-size: 13px;
}

.manage-shell {
  padding: 20px;
}

.manage-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.manager-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dialog-form {
  display: flex;
  flex-direction: column;
}

.dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.dialog-grid.triple {
  grid-template-columns: 1fr 1fr 1fr;
}

.request-note-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
  border: 1px solid var(--cpu-border-soft);
}

.line-clamp-two {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.muted {
  color: var(--cpu-text-muted);
  font-size: 12px;
}

@media (max-width: 1100px) {
  .radio-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .radio-main {
    grid-template-columns: 1fr;
  }

  .request-panel {
    position: static;
  }
}

@media (max-width: 860px) {
  .radio-hero {
    grid-template-columns: 1fr;
    padding: 18px;
  }

  .schedule-list,
  .weekday-grid {
    grid-template-columns: 1fr;
  }

  .dialog-grid,
  .dialog-grid.triple {
    grid-template-columns: 1fr;
    gap: 0;
  }
}

@media (max-width: 640px) {
  .radio-page {
    gap: 14px;
  }

  .radio-overview {
    grid-template-columns: 1fr;
    padding: 14px;
  }

  .hero-copy h1,
  .manage-head h2 {
    font-size: 24px;
  }

  .hero-actions {
    flex-direction: column;
  }

  .hero-actions .el-button {
    width: 100%;
  }

  .slot-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .panel,
  .manage-shell {
    padding: 14px;
    border-radius: 14px;
  }
}
</style>
