<template>
  <div class="filestore-beta-legacy">
    <div class="admin-body">
      <div :class="['sidebar-scrim', { open: sidebarOpen }]" @click="sidebarOpen = false"></div>
      <div class="mobile-nav">
        <button type="button" class="icon-button" title="菜单" @click="sidebarOpen = true">☰</button>
        <div class="mobile-brand">
          <span class="brand-mark">药</span>
          <strong>文件收集工作台</strong>
        </div>
        <a class="back-to-site mobile-back-to-site" href="/services/tools/file_collect">返回</a>
      </div>
      <div class="toast-host" aria-live="polite">
        <div v-for="item in toasts" :key="item.id" :class="['toast', item.type]">{{ item.text }}</div>
      </div>

      <dialog ref="busyDialog" class="busy-dialog" aria-live="polite" @cancel.prevent>
        <div class="busy-content">
          <span class="busy-spinner" aria-hidden="true"></span>
          <div>
            <p class="eyebrow">{{ busyState.eyebrow }}</p>
            <h2>{{ busyState.title }}</h2>
            <p class="hint">{{ busyState.message }}</p>
            <p v-if="busyState.detail" class="busy-detail">{{ busyState.detail }}</p>
            <div v-if="busyState.total > 0" class="busy-progress">
              <progress :value="busyState.current" :max="busyState.total"></progress>
              <span>{{ busyState.current }}/{{ busyState.total }}</span>
            </div>
            <div v-if="busyState.cancelable" class="busy-actions">
              <button type="button" class="secondary" :disabled="busyState.cancelRequested" @click="cancelBusy">
                {{ busyState.cancelRequested ? "正在取消" : "取消" }}
              </button>
            </div>
          </div>
        </div>
      </dialog>

      <aside :class="['app-sidebar', { open: sidebarOpen }]">
        <div class="brand">
          <span class="brand-mark">药</span>
          <div>
            <strong>{{ siteTitle }}</strong>
            <small>CPU 校园小工具</small>
          </div>
          <button type="button" class="icon-button mobile-only-close" title="关闭" @click="sidebarOpen = false">×</button>
        </div>
        <a class="back-to-site sidebar-back-to-site" href="/services/tools/file_collect">← 返回文件收集菜单</a>
        <section class="sidebar-intro">
          <p class="sidebar-kicker">工作台</p>
          <h2>文件收集工作台</h2>
          <p>统一管理提交链接、回收记录、名单核对与文件导出。</p>
        </section>

        <button type="button" class="primary full" :disabled="loading || denied" @click="openEditor()">新建收集任务</button>
        <input v-model="taskQuery" class="sidebar-search" placeholder="搜索任务">
        <div class="task-list">
          <button
            v-for="task in filteredTasks"
            :key="task.id"
            type="button"
            :class="['task-card', { active: detail?.id === task.id }]"
            @click="selectTask(task.id)"
          >
            <span :class="['status-dot', task.status]"></span>
            <strong>{{ task.title }}</strong>
            <small>{{ task.status === 'open' ? '开放提交' : '停止提交' }} · {{ task.deadline ? formatDateOnly(task.deadline) : "无截止时间" }}</small>
            <small v-if="viewer?.isSuperAdmin && task.createdBy">{{ formatCreator(task.createdBy) }}</small>
          </button>
          <div v-if="!filteredTasks.length" class="table-empty">
            <strong>{{ tasks.length ? "没有匹配任务" : "暂无收集任务" }}</strong>
            <span>{{ tasks.length ? "换个关键词再试。" : "点击上方按钮新建一个任务。" }}</span>
          </div>
        </div>
      </aside>

      <main class="app-main">
        <header class="topbar">
          <div>
            <p class="eyebrow">任务工作台</p>
            <h1>{{ detail?.title || "请选择或新建任务" }}</h1>
            <p>{{ activeMeta }}</p>
          </div>
          <div class="top-actions">
            <button type="button" :disabled="!detail" @click="openEditor(detail)">编辑任务</button>
            <button v-if="viewer?.isSuperAdmin" type="button" :disabled="!detail" @click="bindTaskOwner">绑定创建者</button>
            <button type="button" :disabled="!detail" @click="copySubmitLink">复制链接</button>
            <button type="button" :disabled="!detail" @click="showQr">二维码</button>
            <button type="button" :disabled="!detail" @click="openFileManager">文件管理</button>
          </div>
        </header>

        <section v-if="denied && !loading" class="empty-dashboard">
          <div>
            <span class="empty-icon">!</span>
            <h2>暂时不能进入工作台</h2>
            <p>当前账号没有文件收集管理权限。旧版和 beta 提交链接仍可正常访问。</p>
            <button type="button" class="primary" @click="$router.push('/services/tools')">返回小工具</button>
          </div>
        </section>

        <section v-else-if="!detail" class="empty-dashboard">
          <div>
            <span class="empty-icon">+</span>
            <h2>{{ loading ? "正在加载任务" : "还没有选中任务" }}</h2>
            <p>创建一个收集任务后，系统会生成提交链接。提交者无需登录，填写表单并上传文件即可。</p>
            <button type="button" class="primary" :disabled="loading" @click="openEditor()">新建收集任务</button>
          </div>
        </section>

        <section v-else class="dashboard">
          <section class="summary-grid">
            <div class="metric">
              <span>{{ detail.stats?.expected ? "名单内已提交" : "已提交" }}</span>
              <b>{{ detail.stats?.expected ? detail.stats.inListSubmitted : detail.stats?.submitted || 0 }}</b>
              <small>{{ detail.stats?.expected ? `完成率 ${completionRate}%` : "未设置名单" }}</small>
            </div>
            <div class="metric">
              <span>应提交</span>
              <b>{{ detail.stats?.expected || "-" }}</b>
              <small>来自名单行数</small>
            </div>
            <div class="metric">
              <span>未提交</span>
              <b>{{ detail.stats?.missing?.length || 0 }}</b>
              <small>{{ detail.stats?.missing?.length ? "可复制催交通知" : "暂无缺交" }}</small>
            </div>
            <div class="metric">
              <span>名单外</span>
              <b>{{ detail.stats?.unexpected?.length || 0 }}</b>
              <small>{{ detail.stats?.unexpected?.length ? (detail.stats.unexpected || []).map(unexpectedLabel).join("、") : "暂无名单外提交" }}</small>
            </div>
            <div class="metric">
              <span>文件数</span>
              <b>{{ fileTotal(detail) }}</b>
              <small>已上传文件总数</small>
            </div>
          </section>

          <section class="share-panel">
            <div>
              <h2>提交入口</h2>
              <p>发给同学或放进通知里，提交者不需要账号。</p>
            </div>
            <div class="share-links">
              <div class="share-row">
                <span class="share-label">提交链接</span>
                <input :value="absoluteSubmitUrl(detail)" readonly>
                <button type="button" @click="copySubmitLink">复制</button>
              </div>
              <div class="share-row">
                <span class="share-label">成功名单</span>
                <input :value="absoluteStatusUrl(detail)" readonly>
                <button type="button" @click="copyStatusLink">复制</button>
              </div>
            </div>
          </section>

          <section class="work-grid">
            <div class="records-panel">
              <div class="panel-head">
                <div>
                  <h2>提交记录</h2>
                  <p>搜索提交人、编号或文件名，错误提交可以直接删除。</p>
                </div>
                <div class="table-tools">
                  <input v-model="submissionQuery" placeholder="搜索姓名、学号/考试号、文件">
                  <button type="button" @click="openFileManager">文件管理</button>
                  <button type="button" :disabled="repairing" @click="repairFilenames">修复乱码文件名</button>
                  <button type="button" :disabled="repairing" @click="repairRemoteFilenames">修复云端文件名</button>
                  <button type="button" @click="exportCsv">导出 CSV</button>
                  <button type="button" :disabled="zipDownloading" @click="downloadZip">下载 ZIP</button>
                </div>
              </div>
              <div v-if="!filteredSubmissions.length" class="table-empty">
                <strong>{{ detail.submissions?.length ? "没有匹配结果" : "暂无提交记录" }}</strong>
                <span>{{ detail.submissions?.length ? "换个关键词再试。" : "提交者上传后会显示在这里。" }}</span>
              </div>
              <div v-else class="submission-results">
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>提交人</th>
                        <th v-for="field in detail.fields.filter((field) => field.key !== 'name')" :key="field.key">{{ field.label }}</th>
                        <th v-for="field in detail.surveyFields || []" :key="field.id">{{ field.label }}</th>
                        <th>文件</th>
                        <th>提交时间</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="submission in filteredSubmissions" :key="submission.id">
                        <td>
                          <strong>{{ submission.data.name || `#${submission.id}` }}</strong>
                          <span class="cell-sub">IP {{ submission.ip || "-" }}</span>
                        </td>
                        <td v-for="field in detail.fields.filter((field) => field.key !== 'name')" :key="field.key">{{ submission.data[field.key] || "" }}</td>
                        <td v-for="field in detail.surveyFields || []" :key="field.id">{{ formatSurveyAnswer(submission.answers?.[field.id]) }}</td>
                        <td class="file-cell">
                          <div v-for="file in submission.files" :key="file.id" class="file-row">
                            <div>
                              <strong>{{ file.storedName }}</strong>
                              <span class="cell-sub">{{ file.originalName }} · {{ formatBytes(file.size) }}</span>
                            </div>
                            <div class="file-actions">
                              <button type="button" @click="previewFile(file)">查看</button>
                              <button type="button" @click="downloadFile(file)">下载</button>
                              <button type="button" class="danger" @click="deleteFile(file)">删除</button>
                            </div>
                          </div>
                        </td>
                        <td>
                          {{ formatDateTime(submission.createdAt) }}
                        </td>
                        <td>
                          <button type="button" class="icon-button danger" title="删除" @click="deleteSubmission(submission.id)">×</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="mobile-submission-list" aria-label="移动端提交记录">
                  <article v-for="submission in filteredSubmissions" :key="submission.id" class="mobile-submission-card">
                    <div class="mobile-submission-head">
                      <div>
                        <strong>{{ submission.data.name || `#${submission.id}` }}</strong>
                        <span>IP {{ submission.ip || "-" }}</span>
                      </div>
                      <button type="button" class="mobile-delete-submission" title="删除提交" @click="deleteSubmission(submission.id)">删除</button>
                    </div>
                    <dl class="mobile-submission-fields">
                      <template v-for="field in detail.fields.filter((field) => field.key !== 'name')" :key="field.key">
                        <dt>{{ field.label }}</dt>
                        <dd>{{ submission.data[field.key] || "-" }}</dd>
                      </template>
                      <template v-for="field in detail.surveyFields || []" :key="field.id">
                        <dt>{{ field.label }}</dt>
                        <dd>{{ formatSurveyAnswer(submission.answers?.[field.id]) || "-" }}</dd>
                      </template>
                      <dt>提交时间</dt>
                      <dd>{{ formatDateTime(submission.createdAt) }}</dd>
                    </dl>
                    <div class="mobile-submission-files">
                      <div v-for="file in submission.files" :key="file.id" class="mobile-file-card">
                        <div class="mobile-file-main">
                          <strong>{{ file.storedName }}</strong>
                          <span>{{ file.originalName }} · {{ formatBytes(file.size) }}</span>
                        </div>
                        <div class="file-actions">
                          <button type="button" @click="previewFile(file)">查看</button>
                          <button type="button" @click="downloadFile(file)">下载</button>
                          <button type="button" class="danger" @click="deleteFile(file)">删除</button>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              </div>
            </div>

            <aside class="side-panel">
              <div class="side-block">
                <div class="side-head">
                  <h2>缺交名单</h2>
                  <button type="button" :disabled="!detail.stats?.missing?.length" @click="copyMissing">复制</button>
                </div>
                <div class="missing-list">
                  <span v-for="item in detail.stats?.missing || []" :key="item">{{ item }}</span>
                  <span v-if="!detail.stats?.missing?.length">暂无缺交名单</span>
                </div>
              </div>

              <div class="side-block">
                <h2>名单外提交</h2>
                <div class="missing-list">
                  <span v-for="item in detail.stats?.unexpected || []" :key="item.id">{{ unexpectedLabel(item) }}</span>
                  <span v-if="!detail.stats?.unexpected?.length">暂无名单外提交</span>
                </div>
              </div>

              <div class="side-block">
                <h2>任务规则</h2>
                <dl class="rule-list">
                  <dt>状态</dt><dd><span :class="['status-dot', detail.status === 'closed' ? 'closed' : '']"></span>{{ detail.status === 'open' ? "开放提交" : "停止提交" }}</dd>
                  <dt>身份字段</dt><dd>{{ detail.fields.map((field) => field.label).join("、") }}</dd>
                  <dt>问卷题目</dt><dd>{{ detail.surveyFields?.length ? detail.surveyFields.map((field) => field.label).join("、") : "未启用" }}</dd>
                  <dt>文件类型</dt><dd>{{ detail.fileRules.allowedTypes.join(", ") || "不限" }}</dd>
                  <dt>大小/数量</dt><dd>{{ detail.fileRules.maxSizeMb }} MB · 最多 {{ detail.fileRules.maxCount }} 个</dd>
                  <dt>文件命名</dt><dd>{{ detail.renameTemplate }}</dd>
                  <dt>文件夹</dt><dd>{{ detail.folderTemplate || "{name}-{student_id}" }}</dd>
                  <dt>截止</dt><dd>{{ detail.deadline ? formatDateTime(detail.deadline) : "未设置" }}</dd>
                  <dt v-if="viewer?.isSuperAdmin">创建者</dt><dd v-if="viewer?.isSuperAdmin">{{ formatCreator(detail.createdBy) }}</dd>
                </dl>
              </div>
            </aside>
          </section>
        </section>

      </main>

      <aside :class="['editor-drawer', { open: editorVisible }]" :aria-hidden="editorVisible ? 'false' : 'true'">
        <div class="drawer-header-sticky">
          <div class="drawer-head">
            <div>
              <p class="eyebrow">任务配置</p>
              <h2>{{ editorMode === "edit" ? "编辑任务" : "新建任务" }}</h2>
            </div>
            <button type="button" class="icon-button" title="关闭" @click="closeEditor">×</button>
          </div>

          <div class="steps-container">
            <template v-for="(step, index) in steps" :key="step.value">
              <div :class="['step-dot', { active: currentStep === step.value, completed: currentStep > step.value }]" @click="currentStep = step.value">
              <span class="dot-num">{{ step.value }}</span>
              <span class="dot-text">{{ step.label }}</span>
              </div>
              <div v-if="index < steps.length - 1" class="step-line"></div>
            </template>
          </div>
        </div>

        <div class="drawer-scroll-content">
          <div v-show="currentStep === 1" class="step-content">
            <div class="step-guide">
              <h3>第 1 步：填写基本信息</h3>
              <p>起一个清晰的任务名称，并添加指引或截止时间，方便大家按时提交。</p>
            </div>
            <label>任务标题<span class="required-star">*</span>
              <input v-model="draft.title" placeholder="例如：期末作业收集、证件照收集">
            </label>
            <label>说明/公告
              <textarea v-model="draft.description" placeholder="说明提交范围、格式要求等..."></textarea>
            </label>
            <div class="form-row">
              <label>截止时间
                <input v-model="draft.deadline" type="datetime-local">
              </label>
              <label>提交状态
                <select v-model="draft.status">
                  <option value="open">开放提交</option>
                  <option value="closed">停止提交</option>
                </select>
              </label>
            </div>
          </div>

          <div v-show="currentStep === 2" class="step-content">
            <div class="step-guide">
              <h3>第 2 步：设置身份字段</h3>
              <p>这些字段用于识别提交人、覆盖旧提交、名单核对和文件自动命名，建议保留姓名和学号/考试号。</p>
            </div>
            <div class="editor-section">
              <div class="section-line">
                <h3>选择表单模板</h3>
                <div class="field-tools">
                  <select v-model="templateKey" title="选择模板">
                    <option v-for="option in templateOptions" :key="option.key" :value="option.key">{{ option.label }}</option>
                  </select>
                  <button type="button" class="chip" @click="applySelectedTemplate">应用模板</button>
                  <button type="button" class="chip danger" :disabled="!viewer?.isManager || !templateKey.startsWith('custom:')" @click="deleteSelectedTemplate">删除模板</button>
                </div>
              </div>
              <div class="section-line" style="margin-top: 16px;">
                <h3>表单字段列表</h3>
                <button type="button" class="chip primary" @click="addDraftField">+ 添加自定义字段</button>
              </div>
              <div class="field-stack" style="margin-top: 10px;">
                <div v-for="(field, index) in draft.fields" :key="index" class="field-row">
                  <label>变量
                    <input v-model="field.key" placeholder="name" @blur="field.key = normalizeFieldKey(field.key)">
                  </label>
                  <label>名称
                    <input v-model="field.label" placeholder="姓名">
                  </label>
                  <label>占位提示
                    <input v-model="field.placeholder" placeholder="请输入姓名">
                  </label>
                  <label>正则校验
                    <input v-model="field.pattern" placeholder="可选">
                  </label>
                  <label class="checkline">
                    <input v-model="field.required" type="checkbox">
                    必填
                  </label>
                  <div class="field-row-actions">
                    <button type="button" class="chip" title="AI 生成正则" @click="generateRegex(field)">AI 正则</button>
                    <button type="button" class="chip danger" :disabled="draft.fields.length <= 1" @click="draft.fields.splice(index, 1)">删除</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-show="currentStep === 3" class="step-content">
            <div class="step-guide">
              <h3>第 3 步：添加问卷题目（可选）</h3>
              <p>需要在上传文件前额外收集说明、选择或评分时，把题目放在这里；答案会进入提交记录和 CSV。</p>
            </div>
            <div class="editor-section">
              <div class="section-line">
                <div>
                  <h3>问卷题目</h3>
                  <p class="hint">不会参与文件命名，也不会影响覆盖提交的身份判断。</p>
                </div>
                <button type="button" class="chip primary" @click="addSurveyField">+ 添加题目</button>
              </div>

              <div v-if="!draft.surveyFields.length" class="survey-empty">
                <strong>暂未添加问卷题目</strong>
                <span>只需要收文件时可以跳过；需要备注、选项或评分时再添加。</span>
              </div>

              <div v-else class="survey-field-stack">
                <article v-for="(field, index) in draft.surveyFields" :key="field.id || index" class="survey-field-row">
                  <div class="survey-field-head">
                    <strong>题目 {{ index + 1 }}</strong>
                    <div class="field-row-actions">
                      <button type="button" class="chip" @click="duplicateSurveyField(index)">复制</button>
                      <button type="button" class="chip danger" @click="draft.surveyFields.splice(index, 1)">删除</button>
                    </div>
                  </div>
                  <div class="survey-field-grid">
                    <label>题目 ID
                      <input v-model="field.id" placeholder="q_1" @blur="field.id = normalizeSurveyFieldId(field.id)">
                    </label>
                    <label>题目标题
                      <input v-model="field.label" placeholder="例如：是否需要纸质版">
                    </label>
                    <label>题型
                      <select v-model="field.type" @change="normalizeSurveyField(field)">
                        <option v-for="type in filestoreBetaSurveyFieldTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
                      </select>
                    </label>
                    <label class="checkline survey-required">
                      <input v-model="field.required" type="checkbox">
                      必填
                    </label>
                    <label>题目说明
                      <input v-model="field.description" placeholder="选填，展示在题目下方">
                    </label>
                    <label>占位提示
                      <input v-model="field.placeholder" placeholder="选填">
                    </label>
                  </div>
                  <label v-if="field.type === 'single' || field.type === 'multiple'" class="survey-options-label">选项（每行一个）
                    <textarea :value="(field.options || []).join('\n')" placeholder="选项1&#10;选项2" @input="setSurveyOptions(field, $event)"></textarea>
                  </label>
                  <div v-if="field.type === 'number' || field.type === 'rating'" class="form-row three survey-number-row">
                    <label>最小值
                      <input v-model.number="field.min" type="number">
                    </label>
                    <label>最大值
                      <input v-model.number="field.max" type="number">
                    </label>
                    <label v-if="field.type === 'number'">步进
                      <input v-model.number="field.step" type="number" min="0.01" step="0.01">
                    </label>
                  </div>
                  <label v-if="field.type === 'text' || field.type === 'textarea'" class="survey-max-length">最大字数
                    <input v-model.number="field.maxLength" type="number" min="1" max="2000">
                  </label>
                </article>
              </div>
            </div>
          </div>

          <div v-show="currentStep === 4" class="step-content">
            <div class="step-guide">
              <h3>第 4 步：配置文件规则与命名</h3>
              <p>限制上传的文件格式与数量，并配置系统自动重命名规则，告别手动改名！</p>
            </div>
            <div class="editor-section">
              <h3>限制条件</h3>
              <div class="form-row three">
                <label>格式 (如 pdf,zip)
                  <input v-model="draft.allowedTypes">
                </label>
                <label>单文件大小 (MB)
                  <input v-model.number="draft.maxSizeMb" type="number" min="1" max="100">
                </label>
                <label>文件数量上限
                  <input v-model.number="draft.maxCount" type="number" min="1" max="20">
                </label>
              </div>

              <div class="rename-builder" style="margin-top: 18px;">
                <div class="rename-panel">
                  <label>文件命名格式
                    <input v-model="draft.renameTemplate">
                  </label>
                  <div class="rename-tools">
                    <button v-for="field in draft.fields" :key="`file-${field.key}`" type="button" class="chip" @click="insertToken('renameTemplate', `{${field.key}}`)">{{ field.label }}</button>
                    <button type="button" class="chip" @click="insertToken('renameTemplate', '{original}')">原文件名</button>
                    <button type="button" class="chip" @click="insertToken('renameTemplate', '{index}')">序号</button>
                    <button type="button" class="chip" @click="draft.renameTemplate = '{name}-{student_id}'">恢复默认</button>
                  </div>
                  <p class="rename-preview">{{ renamePreview }}</p>
                  <label v-if="editorMode === 'edit'" class="checkline rename-existing">
                    <input v-model="draft.renameExistingFiles" type="checkbox">
                    同步重命名已有文件
                  </label>
                </div>

                <div class="rename-panel">
                  <label>归档文件夹命名格式 (仅多文件有效)
                    <input v-model="draft.folderTemplate">
                  </label>
                  <div class="rename-tools">
                    <button v-for="field in draft.fields" :key="`folder-${field.key}`" type="button" class="chip" @click="insertToken('folderTemplate', `{${field.key}}`)">{{ field.label }}</button>
                    <button type="button" class="chip" @click="draft.folderTemplate = '{name}-{student_id}'">恢复默认</button>
                  </div>
                  <p class="rename-preview">{{ folderPreview }}</p>
                </div>
                <p class="hint">常用命名可以直接点击上方预设按钮。例如：{student_id|last:2} 会取学号/考试号的最后 2 位。</p>
              </div>
            </div>
          </div>

          <div v-show="currentStep === 5" class="step-content">
            <div class="step-guide">
              <h3>第 5 步：导入名单（可选）</h3>
              <p>提供全班同学学号或姓名名单，系统会自动计算出谁没提交，并能一键催缴。</p>
            </div>
            <div class="editor-section">
              <label>应提交人员名单 (每行一个，如学号/考试号/姓名)
                <textarea v-model="draft.expectedEntries" placeholder="2020240444&#10;2020240445&#10;2020240446"></textarea>
              </label>
            </div>
          </div>
        </div>

        <div class="drawer-actions">
          <button type="button" class="secondary prev-action" :disabled="currentStep <= 1" @click="currentStep -= 1">上一步</button>
          <button v-if="currentStep < lastStep" type="button" class="primary main-action" @click="currentStep += 1">下一步</button>
          <button v-else type="button" class="primary main-action" :disabled="saving" @click="saveTask">保存任务</button>
          <button type="button" class="secondary template-action" :disabled="!viewer?.isManager" @click="saveTemplateFromDraft">保存当前模版</button>
          <button type="button" class="danger delete-action" :disabled="editorMode !== 'edit' || saving" @click="deleteTask">删除任务</button>
        </div>
      </aside>
      <div :class="['drawer-scrim', { open: editorVisible }]" @click="closeEditor"></div>

      <dialog ref="qrDialog">
        <div class="dialog-head">
          <h2>提交二维码</h2>
          <button type="button" class="icon-button" @click="qrDialog?.close()">×</button>
        </div>
        <img v-if="qrData" :src="qrImageUrl" alt="提交二维码">
        <p class="hint">{{ qrData }}</p>
      </dialog>

      <dialog ref="fileDialog" class="wide-dialog">
        <div class="dialog-head">
          <div>
            <h2>文件管理</h2>
            <p class="hint">{{ detail?.title || "" }} · 共 {{ allFiles.length }} 个文件</p>
          </div>
          <button type="button" class="icon-button" @click="fileDialog?.close()">×</button>
        </div>
        <div class="file-manager-tools">
          <input v-model="fileQuery" placeholder="搜索文件名、姓名、编号">
          <button type="button" :disabled="repairing" @click="repairFilenames">修复乱码文件名</button>
          <button type="button" :disabled="repairing" @click="repairRemoteFilenames">修复云端文件名</button>
        </div>
        <div class="file-manager">
          <div v-if="!filteredFiles.length" class="table-empty">
            <strong>{{ allFiles.length ? "没有匹配文件" : "暂无文件" }}</strong>
            <span>{{ allFiles.length ? "换个关键词再试。" : "提交者上传后会显示在这里。" }}</span>
          </div>
          <article v-for="item in filteredFiles" :key="item.file.id" class="file-manager-row">
            <div>
              <strong>{{ item.file.storedName }}</strong>
              <span>{{ item.owner }} {{ item.identifier ? `· ${item.identifier}` : "" }} · {{ formatBytes(item.file.size) }}</span>
            </div>
            <div class="file-actions">
              <button type="button" @click="previewFile(item.file)">预览</button>
              <button type="button" @click="downloadFile(item.file)">下载</button>
              <button type="button" class="danger" @click="deleteFile(item.file)">删除</button>
            </div>
          </article>
        </div>
      </dialog>

      <dialog ref="confirmDialog">
        <div class="dialog-head">
          <div>
            <h2>{{ confirmState.title }}</h2>
            <p class="hint">{{ confirmState.body }}</p>
          </div>
        </div>
        <div class="dialog-actions">
          <button type="button" :class="confirmState.danger ? 'danger' : 'primary'" @click="resolveConfirm(true)">{{ confirmState.okText }}</button>
          <button type="button" @click="resolveConfirm(false)">取消</button>
        </div>
      </dialog>

      <dialog ref="promptDialog">
        <div class="dialog-head">
          <div>
            <h2>{{ promptState.title }}</h2>
            <p class="hint">{{ promptState.body }}</p>
          </div>
        </div>
        <label>{{ promptState.label }}
          <input v-model="promptState.value" @keyup.enter="resolvePrompt(true)">
        </label>
        <div class="dialog-actions">
          <button type="button" class="primary" @click="resolvePrompt(true)">{{ promptState.okText }}</button>
          <button type="button" @click="resolvePrompt(false)">取消</button>
        </div>
      </dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  filestoreBetaApi,
  filestoreBetaBlob,
  filestoreBetaUrl,
  type FilestoreBetaCreator,
  type FilestoreBetaField,
  type FilestoreBetaFile,
  type FilestoreBetaSettings,
  type FilestoreBetaSubmission,
  type FilestoreBetaSurveyField,
  type FilestoreBetaTask,
  type FilestoreBetaTemplate,
  type FilestoreBetaViewer,
} from "@/api/filestoreBeta";
import {
  applyTemplateToDraft,
  builtInFilestoreBetaTemplates,
  buildFilestoreBetaPayload,
  cloneFields,
  cloneSurveyFields,
  copyText,
  createFilestoreBetaDraft,
  filestoreBetaSurveyFieldTypes,
  formatDateForInput,
  formatDateTime,
  makeFilestoreBetaField,
  makeFilestoreBetaSurveyField,
  normalizeFieldKey,
  normalizeSurveyFieldId,
  openDirectUrl,
  previewStoredFileName,
  renderFilestoreBetaTemplate,
  requestErrorMessage,
  saveBlob,
  useScopedLegacyFilestoreCss,
  validateFilestoreBetaDraft,
  type FilestoreBetaDraft,
} from "@/views/services/filestoreBetaShared";
import { buildZip, formatBytes, uniqueZipPath, zipSafePathSegment } from "@/views/services/fileCollectExport";

type ToastType = "" | "ok" | "error";
type FileRow = {
  submission: FilestoreBetaSubmission;
  file: FilestoreBetaFile;
  owner: string;
  identifier: string;
};

const router = useRouter();
const loading = ref(false);
const denied = ref(false);
const saving = ref(false);
const repairing = ref(false);
const zipDownloading = ref(false);
const sidebarOpen = ref(false);
const editorVisible = ref(false);
const editorMode = ref<"create" | "edit">("create");
const currentStep = ref(1);
const editingId = ref<number | null>(null);
const taskQuery = ref("");
const submissionQuery = ref("");
const fileQuery = ref("");
const templateKey = ref("builtin:0");
const qrData = ref("");
const viewer = ref<FilestoreBetaViewer | null>(null);
const settings = ref<FilestoreBetaSettings>({ siteUrl: "", siteTitle: "", taskTemplates: [] });
const tasks = ref<FilestoreBetaTask[]>([]);
const detail = ref<FilestoreBetaTask | null>(null);
const draft = reactive<FilestoreBetaDraft>(createFilestoreBetaDraft());
const qrDialog = ref<HTMLDialogElement | null>(null);
const fileDialog = ref<HTMLDialogElement | null>(null);
const confirmDialog = ref<HTMLDialogElement | null>(null);
const promptDialog = ref<HTMLDialogElement | null>(null);
const busyDialog = ref<HTMLDialogElement | null>(null);
const toasts = ref<Array<{ id: number; text: string; type: ToastType }>>([]);
const confirmState = reactive({ title: "确认操作", body: "", okText: "确认", danger: true });
const promptState = reactive({ title: "输入名称", body: "", label: "名称", value: "", okText: "保存" });
const busyState = reactive({
  eyebrow: "请稍候",
  title: "正在处理",
  message: "系统正在读取数据，请不要关闭页面。",
  detail: "",
  current: 0,
  total: 0,
  cancelable: false,
  cancelRequested: false,
});
let confirmResolver: ((value: boolean) => void) | null = null;
let promptResolver: ((value: string | null) => void) | null = null;
let toastId = 0;

useScopedLegacyFilestoreCss();

const steps = [
  { value: 1, label: "基本信息" },
  { value: 2, label: "身份字段" },
  { value: 3, label: "问卷题目" },
  { value: 4, label: "上传规则" },
  { value: 5, label: "核对名单" },
];
const lastStep = steps[steps.length - 1].value;

const siteTitle = computed(() => settings.value.siteTitle || "药大拾间文件收集");
const filteredTasks = computed(() => {
  const query = taskQuery.value.trim().toLowerCase();
  if (!query) return tasks.value;
  return tasks.value.filter((task) => `${task.title} ${task.description} ${task.slug}`.toLowerCase().includes(query));
});
const filteredSubmissions = computed(() => {
  const rows = detail.value?.submissions || [];
  const query = submissionQuery.value.trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((submission) => `${JSON.stringify(submission.data)} ${JSON.stringify(submission.answers || {})} ${submission.files.map((file) => file.storedName).join(" ")}`.toLowerCase().includes(query));
});
const totalFileSize = computed(() => (detail.value?.submissions || []).reduce((sum, item) => sum + item.files.reduce((inner, file) => inner + file.size, 0), 0));
const completionRate = computed(() => {
  const stats = detail.value?.stats;
  if (!stats?.expected) return 0;
  const submitted = stats.inListSubmitted ?? stats.submitted ?? 0;
  return Math.round((submitted / stats.expected) * 100);
});
const activeMeta = computed(() => {
  const task = detail.value;
  if (!task) return "任务链接、统计、提交记录和缺交名单会集中显示在这里。";
  const parts = [
    task.status === "open" ? "开放提交" : "停止提交",
    task.deadline ? `截止 ${formatDateTime(task.deadline)}` : "未设置截止时间",
    `${task.stats?.submitted || 0} 份提交`,
  ];
  if (viewer.value?.isSuperAdmin) parts.push(`创建者 ${formatCreator(task.createdBy)}`);
  return parts.join(" · ");
});
const templateOptions = computed(() => [
  ...builtInFilestoreBetaTemplates.map((template, index) => ({ key: `builtin:${index}`, label: template.name, template })),
  ...settings.value.taskTemplates.map((template) => ({ key: `custom:${template.id}`, label: template.name, template })),
]);
const renamePreview = computed(() => {
  const data = sampleData();
  const first = previewStoredFileName(draft.renameTemplate, data, "材料.jpg", 1, 3);
  const second = previewStoredFileName(draft.renameTemplate, data, "材料.jpg", 2, 3);
  return `预览：${first} / ${second}`;
});
const folderPreview = computed(() => `预览：${renderFilestoreBetaTemplate(draft.folderTemplate, sampleData())}`);
const qrImageUrl = computed(() => filestoreBetaUrl(`/api/qrcode?${new URLSearchParams({ data: qrData.value, size: "260" })}`));
const allFiles = computed<FileRow[]>(() => {
  const rows: FileRow[] = [];
  for (const submission of detail.value?.submissions || []) {
    const fields = detail.value?.fields || [];
    const owner = submission.data.name || submission.data[fields[0]?.key || ""] || `#${submission.id}`;
    const identifier = submission.data.student_id || fields.map((field) => submission.data[field.key]).find((value) => value && value !== owner) || "";
    for (const file of submission.files) rows.push({ submission, file, owner, identifier });
  }
  return rows;
});
const filteredFiles = computed(() => {
  const query = fileQuery.value.trim().toLowerCase();
  if (!query) return allFiles.value;
  return allFiles.value.filter((item) => `${item.owner} ${item.identifier} ${item.file.storedName} ${item.file.originalName}`.toLowerCase().includes(query));
});

onMounted(async () => {
  await load();
});

function toast(text: string, type: ToastType = "") {
  const id = ++toastId;
  toasts.value.push({ id, text, type });
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((item) => item.id !== id);
  }, 2800);
}

type BusyOptions = {
  eyebrow?: string;
  title?: string;
  message?: string;
  detail?: string;
  current?: number;
  total?: number;
  cancelable?: boolean;
};

class BusyCanceledError extends Error {
  constructor() {
    super("操作已取消");
    this.name = "BusyCanceledError";
  }
}

function setBusy(options: BusyOptions = {}) {
  busyState.eyebrow = options.eyebrow || "请稍候";
  busyState.title = options.title || "正在处理";
  busyState.message = options.message || "系统正在读取数据，请不要关闭页面。";
  busyState.detail = options.detail || "";
  busyState.current = Math.max(0, Number(options.current || 0));
  busyState.total = Math.max(0, Number(options.total || 0));
  busyState.cancelable = Boolean(options.cancelable);
  busyState.cancelRequested = false;
}

async function showBusy(options: BusyOptions = {}) {
  setBusy(options);
  await nextTick();
  if (!busyDialog.value?.open) busyDialog.value?.showModal();
}

function updateBusy(options: BusyOptions = {}) {
  if (options.eyebrow !== undefined) busyState.eyebrow = options.eyebrow;
  if (options.title !== undefined) busyState.title = options.title;
  if (options.message !== undefined) busyState.message = options.message;
  if (options.detail !== undefined) busyState.detail = options.detail;
  if (options.current !== undefined) busyState.current = Math.max(0, Number(options.current));
  if (options.total !== undefined) busyState.total = Math.max(0, Number(options.total));
  if (options.cancelable !== undefined) busyState.cancelable = Boolean(options.cancelable);
}

function hideBusy() {
  if (busyDialog.value?.open) busyDialog.value.close();
  setBusy();
}

function cancelBusy() {
  if (!busyState.cancelable || busyState.cancelRequested) return;
  busyState.cancelRequested = true;
  busyState.message = "正在取消当前操作，已读取的临时数据会被丢弃。";
}

function throwIfBusyCanceled() {
  if (busyState.cancelRequested) throw new BusyCanceledError();
}

async function withBusy<T>(options: BusyOptions, work: () => Promise<T>) {
  await showBusy(options);
  try {
    return await work();
  } finally {
    hideBusy();
  }
}

function confirmInApp(options: { title?: string; body?: string; okText?: string; danger?: boolean } = {}) {
  confirmState.title = options.title || "确认操作";
  confirmState.body = options.body || "";
  confirmState.okText = options.okText || "确认";
  confirmState.danger = options.danger !== false;
  confirmDialog.value?.showModal();
  return new Promise<boolean>((resolve) => {
    confirmResolver = resolve;
  });
}

function resolveConfirm(value: boolean) {
  confirmDialog.value?.close();
  confirmResolver?.(value);
  confirmResolver = null;
}

function promptInApp(options: { title?: string; body?: string; label?: string; value?: string; okText?: string } = {}) {
  promptState.title = options.title || "输入名称";
  promptState.body = options.body || "";
  promptState.label = options.label || "名称";
  promptState.value = options.value || "";
  promptState.okText = options.okText || "保存";
  promptDialog.value?.showModal();
  return new Promise<string | null>((resolve) => {
    promptResolver = resolve;
  });
}

function resolvePrompt(ok: boolean) {
  const value = ok ? promptState.value.trim() : null;
  promptDialog.value?.close();
  promptResolver?.(value);
  promptResolver = null;
}

async function load() {
  loading.value = true;
  denied.value = false;
  try {
    const me = await filestoreBetaApi.me();
    viewer.value = me;
    settings.value = me.settings;
    await loadTasks();
  } catch (error) {
    if ((error as { status?: number }).status === 401) {
      router.push({ name: "login", query: { redirect: "/services/tools/filestore-beta" } });
      return;
    }
    if ((error as { status?: number }).status === 403) {
      denied.value = true;
      return;
    }
    toast(requestErrorMessage(error, "任务加载失败"), "error");
  } finally {
    loading.value = false;
  }
}

async function loadTasks() {
  tasks.value = await filestoreBetaApi.tasks();
  if (!tasks.value.length) {
    detail.value = null;
    return;
  }
  const selected = tasks.value.find((task) => task.id === detail.value?.id) || tasks.value[0];
  await selectTask(selected.id);
}

async function selectTask(id: number) {
  try {
    detail.value = await filestoreBetaApi.task(id);
    sidebarOpen.value = false;
  } catch (error) {
    toast(requestErrorMessage(error, "任务详情加载失败"), "error");
  }
}

function resetDraft() {
  Object.assign(draft, createFilestoreBetaDraft());
}

function openEditor(task?: FilestoreBetaTask | null) {
  resetDraft();
  currentStep.value = 1;
  if (task) {
    editorMode.value = "edit";
    editingId.value = task.id;
    draft.title = task.title;
    draft.description = task.description || "";
    draft.deadline = formatDateForInput(task.deadline);
    draft.status = task.status;
    draft.fields = cloneFields(task.fields);
    draft.surveyFields = cloneSurveyFields(task.surveyFields || []);
    draft.allowedTypes = task.fileRules.allowedTypes.join(",");
    draft.maxSizeMb = task.fileRules.maxSizeMb;
    draft.maxCount = task.fileRules.maxCount;
    draft.renameTemplate = task.renameTemplate;
    draft.folderTemplate = task.folderTemplate;
    draft.expectedEntries = task.expectedEntries || "";
  } else {
    editorMode.value = "create";
    editingId.value = null;
  }
  editorVisible.value = true;
}

function closeEditor() {
  editorVisible.value = false;
}

function selectedTemplate() {
  return templateOptions.value.find((item) => item.key === templateKey.value)?.template;
}

function applySelectedTemplate() {
  const template = selectedTemplate();
  if (!template) return;
  applyTemplateToDraft(draft, template, editorMode.value === "create");
  toast("模板已应用", "ok");
}

function addDraftField() {
  draft.fields.push(makeFilestoreBetaField(draft.fields.length));
}

function addSurveyField() {
  draft.surveyFields.push(makeFilestoreBetaSurveyField(draft.surveyFields.length));
}

function duplicateSurveyField(index: number) {
  const source = draft.surveyFields[index];
  if (!source) return;
  draft.surveyFields.splice(index + 1, 0, {
    ...source,
    id: normalizeSurveyFieldId(`${source.id || "q"}_copy_${Date.now().toString(36).slice(-4)}`),
    label: source.label ? `${source.label} 副本` : "",
    options: [...(source.options || [])],
    branching: source.branching ? { ...source.branching } : undefined,
  });
}

function normalizeSurveyField(field: FilestoreBetaSurveyField) {
  if (field.type === "single" || field.type === "multiple") {
    if (!field.options?.length) field.options = ["选项1", "选项2"];
  } else {
    field.options = undefined;
    field.branching = undefined;
  }
  if (field.type === "rating") {
    field.min = field.min ?? 1;
    field.max = field.max ?? 5;
    field.step = undefined;
  } else if (field.type === "number") {
    field.step = field.step || 1;
  } else if (field.type === "text") {
    field.maxLength = field.maxLength || 300;
  } else if (field.type === "textarea") {
    field.maxLength = field.maxLength || 2000;
  }
}

function setSurveyOptions(field: FilestoreBetaSurveyField, event: Event) {
  const value = (event.target as HTMLTextAreaElement).value;
  field.options = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function sampleData() {
  return Object.fromEntries(draft.fields.map((field) => [field.key || field.id, field.placeholder || field.label || "示例"]));
}

function insertToken(target: "renameTemplate" | "folderTemplate", token: string) {
  draft[target] = `${draft[target] || ""}${token}`;
}

async function saveTask() {
  const message = validateFilestoreBetaDraft(draft);
  if (message) {
    toast(message, "error");
    return;
  }
  saving.value = true;
  try {
    const payload = buildFilestoreBetaPayload(draft);
    const saved = editorMode.value === "edit" && editingId.value
      ? await filestoreBetaApi.updateTask(editingId.value, payload)
      : await filestoreBetaApi.createTask(payload);
    closeEditor();
    toast(editorMode.value === "edit" ? "任务已更新" : "任务已创建", "ok");
    await loadTasks();
    await selectTask(saved.id);
  } catch (error) {
    toast(requestErrorMessage(error, "保存失败"), "error");
  } finally {
    saving.value = false;
  }
}

async function deleteTask() {
  if (!editingId.value) return;
  if (!await confirmInApp({ title: "删除任务", body: `删除任务「${draft.title}」及所有提交文件？此操作不可恢复。`, okText: "删除" })) return;
  try {
    await filestoreBetaApi.deleteTask(editingId.value);
    closeEditor();
    detail.value = null;
    await loadTasks();
    toast("任务已删除", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "删除失败"), "error");
  }
}

function absoluteSubmitUrl(task = detail.value) {
  return task ? new URL(`/services/tools/filestore-beta/submit/${task.slug}`, window.location.origin).toString() : "";
}

function absoluteStatusUrl(task = detail.value) {
  return task ? new URL(`/services/tools/filestore-beta/status/${task.slug}`, window.location.origin).toString() : "";
}

async function copySubmitLink() {
  if (!detail.value) return;
  await copyText(absoluteSubmitUrl(detail.value));
  toast("提交链接已复制", "ok");
}

async function copyStatusLink() {
  if (!detail.value) return;
  await copyText(absoluteStatusUrl(detail.value));
  toast("成功名单链接已复制", "ok");
}

function showQr() {
  if (!detail.value) return;
  qrData.value = absoluteSubmitUrl(detail.value);
  nextTick(() => qrDialog.value?.showModal());
}

function openFileManager() {
  fileQuery.value = "";
  nextTick(() => fileDialog.value?.showModal());
}

function fileTotal(task: FilestoreBetaTask) {
  return (task.submissions || []).reduce((sum, submission) => sum + submission.files.length, 0);
}

function unexpectedLabel(item: { id: number; name: string; identity: string }) {
  return item.identity || item.name || `#${item.id}`;
}

function formatCreator(user?: FilestoreBetaCreator | null) {
  if (!user) return "未绑定";
  return `${user.displayName || user.username || "未命名"}（${user.username || user.userId}）`;
}

function formatDateOnly(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

function formatSurveyAnswer(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join("、") : String(value || "");
}

async function copyMissing() {
  const missing = detail.value?.stats?.missing || [];
  if (!missing.length) return;
  await copyText(missing.join("\n"));
  toast("缺交名单已复制", "ok");
}

async function exportCsv() {
  const task = detail.value;
  if (!task) return;
  try {
    const { blob, filename } = await withBusy(
      { title: "正在导出 CSV", message: "正在读取提交记录并生成表格文件。" },
      () => filestoreBetaBlob(`/api/tasks/${task.id}/export.csv`),
    );
    saveBlob(blob, filename || `${task.title}.csv`);
    toast("CSV 已生成", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "CSV 导出失败"), "error");
  }
}

async function downloadZip() {
  const task = detail.value;
  if (!task?.submissions?.length) {
    toast("暂无文件可打包");
    return;
  }
  const fileCount = fileTotal(task);
  zipDownloading.value = true;
  try {
    const zipBlob = await withBusy(
      { title: "正在下载 ZIP", message: "正在读取文件 0/" + fileCount, current: 0, total: fileCount, cancelable: true },
      async () => {
        const entries = [];
        const usedPaths = new Set<string>();
        let current = 0;
        for (const submission of task.submissions || []) {
          for (const file of submission.files) {
            throwIfBusyCanceled();
            current += 1;
            updateBusy({
              message: `正在读取文件 ${current}/${fileCount}`,
              detail: file.storedName,
              current,
              total: fileCount,
            });
            const { blob } = await filestoreBetaBlob(`/api/files/${file.id}/download`);
            throwIfBusyCanceled();
            entries.push({
              path: uniqueZipPath(zipEntryPath(task, submission, file), usedPaths),
              bytes: new Uint8Array(await blob.arrayBuffer()),
              date: new Date(file.createdAt || submission.createdAt),
            });
            throwIfBusyCanceled();
          }
        }
        updateBusy({ title: "正在生成 ZIP", message: "浏览器正在打包文件，请稍候。", detail: "", current: fileCount, total: fileCount });
        throwIfBusyCanceled();
        return buildZip(entries);
      }
    );
    saveBlob(zipBlob, `${zipSafePathSegment(task.title)}.zip`);
    toast("ZIP 已生成", "ok");
  } catch (error) {
    if (error instanceof BusyCanceledError) toast("已取消 ZIP 下载");
    else toast(requestErrorMessage(error, "ZIP 打包失败"), "error");
  } finally {
    zipDownloading.value = false;
  }
}

function zipEntryPath(task: FilestoreBetaTask, submission: FilestoreBetaSubmission, file: FilestoreBetaFile) {
  if (submission.files.length <= 1) return zipSafePathSegment(file.storedName);
  const folder = renderFilestoreBetaTemplate(task.folderTemplate || "{name}-{student_id}", submission.data);
  return `${folder}/${zipSafePathSegment(file.storedName)}`;
}

async function repairFilenames() {
  const taskId = detail.value?.id;
  if (!taskId || repairing.value) return;
  if (!await confirmInApp({ title: "修复乱码文件名", body: "将按当前数据库中的编码信息修复历史文件名，是否继续？", okText: "开始修复" })) return;
  repairing.value = true;
  try {
    const result = await withBusy(
      { title: "正在修复乱码文件名", message: "系统正在扫描历史文件名并更新可恢复项。" },
      () => filestoreBetaApi.repairFilenames(taskId),
    );
    await withBusy(
      { title: "正在刷新任务", message: "正在读取修复后的提交记录。" },
      () => selectTask(taskId),
    );
    toast(`已修复 ${result.updated} 个，保持不变 ${result.unchanged} 个`, "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "修复失败"), "error");
  } finally {
    repairing.value = false;
  }
}

async function repairRemoteFilenames() {
  const taskId = detail.value?.id;
  if (!taskId || repairing.value) return;
  if (!await confirmInApp({ title: "修复云端文件名", body: "将检查世纪互联中的文件路径和远端文件名，冲突项会跳过。是否继续？", okText: "开始修复" })) return;
  repairing.value = true;
  try {
    const result = await withBusy(
      { title: "正在修复云端文件名", message: "正在检查世纪互联文件路径和远端文件名。" },
      () => filestoreBetaApi.repairRemoteFilenames(taskId),
    );
    await withBusy(
      { title: "正在刷新任务", message: "正在读取修复后的提交记录。" },
      () => selectTask(taskId),
    );
    toast(`修复 ${result.repaired} 个，同步 ${result.synced} 个，冲突 ${result.conflicts} 个，失败 ${result.failed} 个`, "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "云端修复失败"), "error");
  } finally {
    repairing.value = false;
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function openPreviewLoadingWindow(file: FilestoreBetaFile) {
  const previewWindow = window.open("about:blank", "_blank");
  if (!previewWindow) return null;
  previewWindow.opener = null;
  previewWindow.document.write(`
    <title>正在加载文件...</title>
    <body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;">
      <div style="padding:24px;">
        <h1 style="font-size:18px;margin:0 0 8px;">正在加载文件...</h1>
        <p style="margin:0;color:#64748b;font-size:14px;">${escapeHtml(file.storedName)}</p>
      </div>
    </body>
  `);
  previewWindow.document.close();
  return previewWindow;
}

async function previewFile(file: FilestoreBetaFile) {
  const previewWindow = openPreviewLoadingWindow(file);
  try {
    await showBusy({ title: "正在查看文件", message: "正在获取文件预览地址。", detail: file.storedName });
    const access = await filestoreBetaApi.fileAccess(file.id, "preview");
    if (access.url) {
      if (previewWindow && !previewWindow.closed) previewWindow.location.replace(access.url);
      else openDirectUrl(access.url, access.filename || file.storedName, "preview");
      return;
    }
    if (access.previewMessage) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      toast(access.previewMessage);
      return;
    }
    updateBusy({ message: "正在读取文件内容。", detail: file.storedName });
    const { blob, type } = await filestoreBetaApi.fileBlob(file.id, "preview");
    const url = URL.createObjectURL(type ? blob.slice(0, blob.size, type) : blob);
    if (previewWindow && !previewWindow.closed) previewWindow.location.replace(url);
    else window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    if (previewWindow && !previewWindow.closed) previewWindow.close();
    toast(requestErrorMessage(error, "预览失败"), "error");
  } finally {
    hideBusy();
  }
}

async function downloadFile(file: FilestoreBetaFile) {
  try {
    await showBusy({ title: "正在下载文件", message: "正在获取下载链接。", detail: file.storedName });
    const access = await filestoreBetaApi.fileAccess(file.id, "download");
    if (access.url) {
      openDirectUrl(access.url, access.filename || file.storedName, "download");
      toast("已向浏览器发起下载，请查看下载列表", "ok");
      return;
    }
    updateBusy({ message: "正在读取文件内容。", detail: file.storedName });
    const { blob, filename } = await filestoreBetaApi.fileBlob(file.id, "download");
    saveBlob(blob, filename || file.storedName);
    toast("已向浏览器发起下载，请查看下载列表", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "下载失败"), "error");
  } finally {
    hideBusy();
  }
}

async function deleteFile(file: FilestoreBetaFile) {
  const taskId = detail.value?.id;
  if (!taskId || !await confirmInApp({ title: "删除文件", body: `删除文件「${file.storedName}」？`, okText: "删除" })) return;
  try {
    await withBusy(
      { title: "正在删除文件", message: "正在从服务器移除文件。", detail: file.storedName },
      () => filestoreBetaApi.deleteFile(file.id),
    );
    await withBusy(
      { title: "正在刷新任务", message: "正在读取最新提交记录。" },
      () => selectTask(taskId),
    );
    toast("文件已删除", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "删除失败"), "error");
  }
}

async function deleteSubmission(id: number) {
  const taskId = detail.value?.id;
  if (!taskId || !await confirmInApp({ title: "删除提交", body: `删除提交 #${id} 及其文件？`, okText: "删除" })) return;
  try {
    await withBusy(
      { title: "正在删除提交", message: "正在删除该提交记录及其文件。", detail: `#${id}` },
      () => filestoreBetaApi.deleteSubmission(id),
    );
    await withBusy(
      { title: "正在刷新任务", message: "正在读取最新提交记录。" },
      () => selectTask(taskId),
    );
    toast("提交已删除", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "删除失败"), "error");
  }
}

async function generateRegex(field: FilestoreBetaField) {
  const prompt = await promptInApp({
    title: "AI 生成正则",
    body: "描述这个字段的校验规则，例如：必须是 10 位数字",
    label: "规则描述",
    value: "",
    okText: "生成",
  });
  if (!prompt?.trim()) return;
  try {
    const result = await filestoreBetaApi.generateRegex(prompt.trim());
    field.pattern = result.regex || field.pattern;
    field.placeholder = result.placeholder || field.placeholder;
    toast(result.description || "正则已生成", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "正则生成失败"), "error");
  }
}

async function bindTaskOwner() {
  if (!detail.value) return;
  const keyword = await promptInApp({
    title: "绑定创建者",
    body: "输入平台用户名，或输入能唯一匹配的昵称。系统只会匹配有文件收集管理权限的账号。",
    label: "平台用户",
    okText: "查找",
  });
  if (!keyword?.trim()) return;
  try {
    const users = await filestoreBetaApi.searchUsers(keyword.trim());
    const normalized = keyword.trim().toLowerCase();
    const target = users.find((item) => item.username.toLowerCase() === normalized)
      || users.find((item) => item.displayName.toLowerCase() === normalized)
      || users[0];
    if (!target) throw new Error("未找到可绑定的文件收集管理员");
    if (!await confirmInApp({ title: "确认绑定", body: `确认绑定给 ${target.displayName}（${target.username}）？`, okText: "绑定", danger: false })) return;
    detail.value = await filestoreBetaApi.bindOwner(detail.value.id, target.userId);
    await loadTasks();
    toast("创建者已更新", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "绑定失败"), "error");
  }
}

async function saveTemplateFromDraft() {
  if (!viewer.value?.isManager) return;
  const name = await promptInApp({
    title: "保存当前模版",
    body: "输入模板名称，之后可在新任务中复用。",
    label: "模板名称",
    value: draft.title.trim() || "文件收集模板",
    okText: "保存",
  });
  if (!name) return;
  try {
    const payload = buildFilestoreBetaPayload({ ...draft, title: name });
    const existing = settings.value.taskTemplates.find((item) => item.name === name);
    const next: FilestoreBetaTemplate[] = [
      ...settings.value.taskTemplates.filter((item) => item.name !== name),
      {
        id: existing?.id,
        name,
        description: draft.description.trim(),
        fields: payload.fields,
        surveyFields: payload.surveyFields,
        fileRules: payload.fileRules,
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: payload.expectedEntries,
      },
    ];
    settings.value = await filestoreBetaApi.saveSettings({ taskTemplates: next });
    toast("模板已保存", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "模板保存失败"), "error");
  }
}

async function deleteSelectedTemplate() {
  if (!viewer.value?.isManager || !templateKey.value.startsWith("custom:")) return;
  const id = Number(templateKey.value.slice("custom:".length));
  const target = settings.value.taskTemplates.find((item) => item.id === id);
  if (!target || !await confirmInApp({ title: "删除模板", body: `删除全局模板「${target.name}」？`, okText: "删除" })) return;
  try {
    settings.value = await filestoreBetaApi.saveSettings({
      taskTemplates: settings.value.taskTemplates.filter((item) => item.id !== id),
    });
    templateKey.value = "builtin:0";
    toast("模板已删除", "ok");
  } catch (error) {
    toast(requestErrorMessage(error, "模板删除失败"), "error");
  }
}
</script>
