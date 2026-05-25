<template>
  <div class="tool-manage-page">
    <section class="manage-head">
      <div>
        <div class="kicker">校园小工具</div>
        <h2>小工具管理</h2>
        <p>管理器可维护工具设置和人员；开放管理入口后，登录用户可维护自己发起的内容。</p>
      </div>
      <el-button plain @click="$router.push('/services/tools')">
        <el-icon><ArrowLeft /></el-icon>
        返回小工具
      </el-button>
    </section>

    <section class="manage-panel" v-loading="loading">
      <el-empty v-if="!loading && !manageableTools.length" description="暂无可管理的小工具" />

      <template v-else>
        <el-tabs v-model="activeTool" @tab-change="switchActiveTool">
          <el-tab-pane
            v-for="tool in manageableTools"
            :key="tool.code"
            :name="tool.code"
            :label="tool.name"
          />
        </el-tabs>

        <div class="tool-admin-grid">
          <section v-if="activeTool !== 'grade_check'" class="admin-section questionnaire-section">
            <div class="section-head">
              <div>
                <h3>问卷</h3>
                <p>{{ activeTool === "feedback" ? "需求反馈已接入系统问卷，可查看反馈结果。" : canAdminActiveTool ? "创建、编辑、发布并统计在线问卷。" : "创建并管理你自己发起的问卷，发布后复制链接分享给填写人。" }}</p>
              </div>
              <el-button v-if="activeTool === 'questionnaire'" type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建问卷
              </el-button>
            </div>

            <div class="questionnaire-summary">
              <div>
                <b>{{ questionnaires.length }}</b>
                <span>问卷</span>
              </div>
              <div>
                <b>{{ openCount }}</b>
                <span>开放中</span>
              </div>
              <div>
                <b>{{ totalResponses }}</b>
                <span>答卷</span>
              </div>
            </div>

            <div class="questionnaire-list-cards">
              <article v-for="row in questionnaires" :key="row.id" class="questionnaire-row-card">
                <div class="q-row-main">
                  <div class="q-title-cell">
                    <b>{{ row.title }}</b>
                    <span>{{ row.slug }}</span>
                  </div>
                  <div class="q-row-tags">
                    <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
                    <el-tag size="small" effect="plain">{{ row.visibility === "login" ? "登录填写" : "公开填写" }}</el-tag>
                    <el-tag v-if="row.isSystem" size="small" type="info" effect="plain">系统问卷</el-tag>
                  </div>
                  <div class="q-row-meta">
                    <span>{{ row.fields?.length ?? 0 }} 题</span>
                    <span>{{ row.responseCount ?? 0 }} 份答卷</span>
                    <span>更新 {{ fmtDate(row.updatedAt) }}</span>
                    <span v-if="row.createdBy">发起人 {{ row.createdBy.nickname || row.createdBy.username }}</span>
                  </div>
                </div>
                <div class="q-row-actions">
                  <el-button v-if="!row.isSystem" size="small" @click="openEdit(row)">
                    <el-icon><Edit /></el-icon>
                    编辑
                  </el-button>
                  <el-button size="small" @click="openPreview(row)">
                    <el-icon><View /></el-icon>
                    预览
                  </el-button>
                  <el-button size="small" @click="openResponses(row)">
                    <el-icon><DataAnalysis /></el-icon>
                    结果
                  </el-button>
                  <el-dropdown trigger="click" @command="handleQuestionnaireCommand($event, row)">
                    <el-button size="small">
                      更多<el-icon><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="link">
                          <el-icon><Link /></el-icon>
                          复制链接
                        </el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="duplicate">
                          <el-icon><CopyDocument /></el-icon>
                          复制问卷
                        </el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="open" divided>开放</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="close">关闭</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="draft">设为草稿</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="delete" divided>
                          <el-icon><Delete /></el-icon>
                          删除
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </article>
              <el-empty v-if="!questionnaires.length" :description="canAdminActiveTool ? '暂无问卷' : '你还没有发起问卷'" />
            </div>
          </section>

          <section v-else class="admin-section questionnaire-section grade-check-section">
            <div class="section-head">
              <div>
                <h3>成绩表核对</h3>
                <p>{{ canAdminActiveTool ? "上传带有“学号”字段的 Excel，生成只展示本人记录的查询链接。" : "上传你发起的成绩核对表，发布后复制链接分享给同学。" }}</p>
              </div>
            </div>

            <div class="questionnaire-summary">
              <div>
                <b>{{ gradeChecks.length }}</b>
                <span>查询表</span>
              </div>
              <div>
                <b>{{ gradeOpenCount }}</b>
                <span>开放中</span>
              </div>
              <div>
                <b>{{ gradeTotalRows }}</b>
                <span>记录</span>
              </div>
            </div>

            <div class="grade-upload-panel">
              <div class="upload-copy">
                <h4>创建查询表</h4>
                <p>Excel 第一行作为表头。只有“学号”是必填字段，用来匹配登录用户；其他字段会原样展示给对应学生核对。</p>
              </div>
              <div class="template-actions">
                <el-button plain @click="downloadGradeTemplate">
                  <el-icon><Download /></el-icon>
                  下载示例文件
                </el-button>
              </div>
              <div class="field-rule-list">
                <div>
                  <b>必须包含</b>
                  <span>学号</span>
                  <small>字段名必须完全等于“学号”，且每行唯一</small>
                </div>
                <div>
                  <b>建议包含</b>
                  <span>姓名 / 课程 / 成绩 / 备注</span>
                  <small>这些字段不强制，上传后会作为核对项目展示</small>
                </div>
                <div>
                  <b>自动生成</b>
                  <span>问题反馈问卷</span>
                  <small>学生可反馈哪些项目存在问题</small>
                </div>
              </div>
              <div class="grade-form-grid">
                <el-input v-model="gradeForm.title" placeholder="查询表标题，例如：2026 春季药理学期末成绩核对" maxlength="120" />
                <el-select v-model="gradeForm.status">
                  <el-option label="开放查询" value="open" />
                  <el-option label="保存草稿" value="draft" />
                  <el-option label="暂时关闭" value="closed" />
                </el-select>
                <el-input v-model="gradeForm.description" class="grade-desc" type="textarea" :rows="2" placeholder="补充说明，例如核对截止时间、联系人等" maxlength="1000" />
              </div>
              <el-upload
                class="grade-uploader"
                drag
                :auto-upload="false"
                :show-file-list="false"
                accept=".xlsx,.xls"
                @change="handleGradeExcelFile"
              >
                <el-icon><UploadFilled /></el-icon>
                <div class="el-upload__text">拖拽 Excel 到这里，或点击选择文件</div>
                <template #tip>
                  <div class="el-upload__tip">支持 .xlsx / .xls，当前按第一张工作表读取。</div>
                </template>
              </el-upload>

              <div v-if="gradeForm.rows.length" class="grade-preview-box">
                <div class="grade-preview-head">
                  <div>
                    <b>{{ gradeFileName || "已读取表格" }}</b>
                    <span>{{ gradeForm.rows.length }} 行 · {{ gradeForm.columns.length }} 个字段</span>
                  </div>
                  <el-button type="primary" :loading="gradeSaving" @click="createGradeCheck">
                    <el-icon><Plus /></el-icon>
                    创建查询表
                  </el-button>
                </div>
                <div class="grade-columns">
                  <el-tag
                    v-for="column in gradeForm.columns"
                    :key="column"
                    size="small"
                    :type="column === gradeForm.studentIdColumn ? 'success' : 'info'"
                    effect="plain"
                  >
                    {{ column }}
                  </el-tag>
                </div>
                <div class="grade-preview-table-wrap">
                  <table class="grade-preview-table">
                    <thead>
                      <tr>
                        <th v-for="column in gradeForm.columns.slice(0, 6)" :key="column">{{ column }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, index) in gradeForm.rows.slice(0, 4)" :key="index">
                        <td v-for="column in gradeForm.columns.slice(0, 6)" :key="column">{{ row[column] || "-" }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div class="questionnaire-list-cards">
              <article v-for="row in gradeChecks" :key="row.id" class="questionnaire-row-card">
                <div class="q-row-main">
                  <div class="q-title-cell">
                    <b>{{ row.title }}</b>
                    <span>{{ row.slug }}</span>
                  </div>
                  <div class="q-row-tags">
                    <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
                    <el-tag size="small" effect="plain">{{ row.rowCount }} 条记录</el-tag>
                    <el-tag size="small" type="info" effect="plain">{{ row.columns.length }} 字段</el-tag>
                  </div>
                  <div class="q-row-meta">
                    <span>学号字段 {{ row.studentIdColumn }}</span>
                    <span>更新 {{ fmtDate(row.updatedAt) }}</span>
                    <span v-if="row.createdBy">发起人 {{ row.createdBy.nickname || row.createdBy.username }}</span>
                  </div>
                </div>
                <div class="q-row-actions">
                  <el-button size="small" @click="copyGradeLink(row)">
                    <el-icon><Link /></el-icon>
                    复制链接
                  </el-button>
                  <el-dropdown trigger="click" @command="handleGradeCommand($event, row)">
                    <el-button size="small">
                      更多<el-icon><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="open">开放</el-dropdown-item>
                        <el-dropdown-item command="close">关闭</el-dropdown-item>
                        <el-dropdown-item command="draft">设为草稿</el-dropdown-item>
                        <el-dropdown-item command="delete" divided>
                          <el-icon><Delete /></el-icon>
                          删除
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </article>
              <el-empty v-if="!gradeChecks.length" :description="canAdminActiveTool ? '暂无成绩核对表' : '你还没有发起成绩核对表'" />
            </div>
          </section>

          <section v-if="canAdminActiveTool" class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>使用权限</h3>
                <p>开启后，未登录用户不能打开或提交当前小工具。</p>
              </div>
            </div>
            <div class="access-setting">
              <div>
                <b>登录后使用</b>
                <span>{{ currentToolMeta?.requireLogin ? "当前需要登录" : "当前允许游客使用" }}</span>
              </div>
              <el-switch
                v-model="toolRequireLogin"
                :loading="settingSaving"
                @change="saveToolSetting"
              />
            </div>
            <div class="access-setting">
              <div>
                <b>开放管理入口</b>
                <span>{{ currentToolMeta?.allowPublicManage ? "所有登录用户可进入并管理自己创建的内容" : "仅管理器可进入管理" }}</span>
              </div>
              <el-switch
                v-model="toolAllowPublicManage"
                :loading="settingSaving"
                @change="savePublicManageSetting"
              />
            </div>
          </section>

          <section v-if="canAdminActiveTool" class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>管理器</h3>
                <p>被分配后可进入此页面管理当前小工具。</p>
              </div>
            </div>
            <div class="add-manager">
              <el-input v-model="managerUsername" placeholder="输入用户名" clearable @keyup.enter="addManager" />
              <el-button type="primary" :loading="managerSaving" @click="addManager">添加</el-button>
            </div>
            <div class="manager-list">
              <div v-for="manager in managers" :key="manager.id" class="manager-row">
                <div>
                  <b>{{ manager.user.nickname || manager.user.username }}</b>
                  <span>{{ manager.user.username }}</span>
                </div>
                <el-button text type="danger" @click="removeManager(manager.user.id)">移除</el-button>
              </div>
              <el-empty v-if="!managers.length" description="暂无单独分配的管理器" />
            </div>
          </section>
        </div>
      </template>
    </section>

    <el-dialog
      v-model="editorOpen"
      fullscreen
      class="questionnaire-builder-dialog"
      :show-close="false"
      modal-class="questionnaire-builder-overlay"
      :close-on-click-modal="false"
    >
      <template #header>
        <div class="builder-topbar">
          <div class="builder-titlebar">
            <button type="button" class="builder-back" @click="editorOpen = false">
              <el-icon><ArrowLeft /></el-icon>
            </button>
            <div>
              <b>{{ editorTitle }}</b>
              <span>{{ statusText(form.status) }} · {{ form.fields.length }} 题 · {{ requiredCount }} 题必填</span>
            </div>
          </div>
          <div class="builder-top-actions">
            <el-button plain @click="openPreview()">
              <el-icon><View /></el-icon>
              预览
            </el-button>
            <el-button :loading="saving" @click="submitEditor('draft')">保存草稿</el-button>
            <el-button type="primary" plain :loading="saving" @click="submitEditor()">保存</el-button>
            <el-button type="primary" :loading="saving" @click="submitEditor('open')">保存并开放</el-button>
          </div>
        </div>
      </template>

      <div class="builder-layout">
        <section class="type-palette">
          <div class="palette-title">
            <h4>常用题型</h4>
            <span>点击添加</span>
          </div>
          <button v-for="type in fieldTypeOptions" :key="type.value" type="button" @click="addField(type.value)">
            <el-icon><component :is="type.icon" /></el-icon>
            <span>
              <b>{{ type.label }}</b>
              <small>{{ type.hint }}</small>
            </span>
          </button>
        </section>

        <el-form label-position="top" class="questionnaire-editor">
          <div class="editor-card">
            <div class="cover-kicker">问卷封面</div>
            <el-form-item label="标题" required class="title-field">
              <el-input v-model="form.title" maxlength="120" placeholder="例如：校园服务满意度调查" />
            </el-form-item>
            <el-form-item label="说明">
              <el-input v-model="form.description" type="textarea" :rows="3" maxlength="1000" placeholder="填写说明、用途或截止提醒" />
            </el-form-item>
          </div>

          <div class="fields-head">
            <h4>题目设计</h4>
            <div>
              <el-button size="small" type="primary" plain @click="addField('single')">
                <el-icon><Plus /></el-icon>
                添加题目
              </el-button>
            </div>
          </div>

          <div class="field-editor-list">
            <article v-for="(field, index) in form.fields" :key="field.localKey" class="field-editor" :class="{ 'is-required': field.required }">
              <div class="field-index">Q{{ index + 1 }}</div>
              <div class="field-editor-body">
                <div class="field-meta-line">
                  <span>{{ fieldTypeText(field.type) }}</span>
                  <b v-if="field.required">必填</b>
                </div>
                <div class="field-editor-main">
                  <el-input v-model="field.label" placeholder="题目名称" maxlength="80" />
                  <el-select v-model="field.type" class="type-select" @change="normalizeEditableField(field)">
                    <el-option v-for="type in fieldTypeOptions" :key="type.value" :label="type.label" :value="type.value" />
                  </el-select>
                  <el-checkbox v-model="field.required">必填</el-checkbox>
                </div>
                <el-input v-model="field.description" placeholder="题目补充说明（选填）" maxlength="300" />
                <el-input
                  v-if="field.type === 'text' || field.type === 'textarea' || field.type === 'number' || field.type === 'date'"
                  v-model="field.placeholder"
                  placeholder="占位提示（选填）"
                  maxlength="120"
                />
                <el-input
                  v-if="field.type === 'single' || field.type === 'multiple'"
                  v-model="field.optionsText"
                  placeholder="选项，用换行分隔"
                  type="textarea"
                  :rows="4"
                />
                <div v-if="field.type === 'number' || field.type === 'rating' || field.type === 'text' || field.type === 'textarea'" class="advanced-grid">
                  <el-form-item v-if="field.type === 'number'" label="最小值">
                    <el-input-number v-model="field.min" :precision="2" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'number'" label="最大值">
                    <el-input-number v-model="field.max" :precision="2" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'number'" label="步进">
                    <el-input-number v-model="field.step" :min="0.01" :precision="2" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'rating'" label="最低分">
                    <el-input-number v-model="field.min" :min="0" :max="9" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'rating'" label="最高分">
                    <el-input-number v-model="field.max" :min="2" :max="10" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'text' || field.type === 'textarea'" label="字数上限">
                    <el-input-number v-model="field.maxLength" :min="1" :max="field.type === 'textarea' ? 2000 : 300" controls-position="right" />
                  </el-form-item>
                </div>
                <div class="field-actions">
                  <button type="button" :disabled="index === 0" @click="moveField(index, -1)">
                    <el-icon><ArrowUp /></el-icon>
                    上移
                  </button>
                  <button type="button" :disabled="index === form.fields.length - 1" @click="moveField(index, 1)">
                    <el-icon><ArrowDown /></el-icon>
                    下移
                  </button>
                  <button type="button" @click="duplicateField(index)">
                    <el-icon><CopyDocument /></el-icon>
                    复制
                  </button>
                  <button type="button" class="danger" @click="removeField(index)">
                    <el-icon><Delete /></el-icon>
                    删除
                  </button>
                </div>
              </div>
            </article>
            <el-empty v-if="!form.fields.length" description="从左侧选择题型开始设计问卷" />
          </div>
        </el-form>

        <aside class="builder-side">
          <section class="inspector-card">
            <h4>发布设置</h4>
            <el-form label-position="top">
              <el-form-item label="状态">
                <el-select v-model="form.status">
                  <el-option label="草稿" value="draft" />
                  <el-option label="开放" value="open" />
                  <el-option label="关闭" value="closed" />
                </el-select>
              </el-form-item>
              <el-form-item label="填写权限">
                <el-select v-model="form.visibility">
                  <el-option label="公开填写" value="public" />
                  <el-option label="登录后填写" value="login" />
                </el-select>
              </el-form-item>
              <div class="inspector-checks">
                <el-checkbox v-model="form.allowAnonymous">允许匿名填写</el-checkbox>
                <el-checkbox v-model="form.oneResponsePerUser">每个登录用户限填一次</el-checkbox>
              </div>
            </el-form>
          </section>

          <section class="inspector-card">
            <h4>发布检查</h4>
            <div class="check-row">
              <span>题目数</span>
              <b>{{ form.fields.length }}</b>
            </div>
            <div class="check-row">
              <span>必填题</span>
              <b>{{ requiredCount }}</b>
            </div>
            <p>发布前确认必填题、选项数量、匿名设置和登录限制。发布后仍可编辑，已有答卷会按题目 ID 保留。</p>
          </section>
        </aside>
      </div>
    </el-dialog>

    <el-drawer v-model="previewOpen" title="问卷预览" size="min(760px, 92vw)">
      <div class="preview-shell">
        <div class="preview-head">
          <h2>{{ previewQuestionnaire.title || "未命名问卷" }}</h2>
          <p>{{ previewQuestionnaire.description || "请按实际情况填写。" }}</p>
          <div class="meta-row">
            <el-tag size="small" effect="plain">{{ previewQuestionnaire.visibility === "login" ? "需登录" : "公开填写" }}</el-tag>
            <el-tag v-if="previewQuestionnaire.oneResponsePerUser" size="small" type="warning" effect="plain">每人一次</el-tag>
          </div>
        </div>
        <div class="preview-form">
          <section v-for="(field, index) in previewQuestionnaire.fields" :key="field.id" class="preview-field">
            <div class="preview-label">
              <b>{{ index + 1 }}. {{ field.label }}</b>
              <span v-if="field.required">*</span>
            </div>
            <p v-if="field.description">{{ field.description }}</p>
            <el-input v-if="field.type === 'text'" disabled :placeholder="field.placeholder || '单行文本'" />
            <el-input v-else-if="field.type === 'textarea'" disabled type="textarea" :rows="4" :placeholder="field.placeholder || '多行文本'" />
            <el-radio-group v-else-if="field.type === 'single'" disabled>
              <el-radio v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-radio>
            </el-radio-group>
            <el-checkbox-group v-else-if="field.type === 'multiple'" disabled>
              <el-checkbox v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-checkbox>
            </el-checkbox-group>
            <el-input-number v-else-if="field.type === 'number'" disabled :min="field.min" :max="field.max" :step="field.step || 1" />
            <el-date-picker v-else-if="field.type === 'date'" disabled type="date" placeholder="选择日期" />
            <div v-else-if="field.type === 'rating'" class="preview-rating">
              <span v-for="score in ratingRange(field)" :key="score">{{ score }}</span>
            </div>
          </section>
          <el-empty v-if="!previewQuestionnaire.fields.length" description="暂无题目" />
        </div>
      </div>
    </el-drawer>

    <el-dialog v-model="responsesOpen" width="min(920px, 96vw)">
      <template #header>
        <div class="responses-title">
          <div>
            <b>{{ responsesTitle }}</b>
            <span>{{ responses.length }} 份答卷</span>
          </div>
          <el-button size="small" plain @click="exportResponses">
            <el-icon><Download /></el-icon>
            导出 CSV
          </el-button>
        </div>
      </template>

      <el-tabs v-model="responsesTab">
        <el-tab-pane label="统计" name="stats">
          <div class="stats-list">
            <article v-for="stat in responseStats" :key="stat.field.id" class="stat-card">
              <div class="stat-head">
                <div>
                  <b>{{ stat.field.label }}</b>
                  <span>{{ fieldTypeText(stat.field.type) }} · {{ stat.answered }}/{{ responses.length }} 已答</span>
                </div>
                <el-tag v-if="stat.field.required" size="small" type="danger" effect="plain">必填</el-tag>
              </div>

              <div v-if="stat.choices.length" class="choice-stats">
                <div v-for="choice in stat.choices" :key="choice.label" class="choice-stat-row">
                  <span>{{ choice.label }}</span>
                  <el-progress :percentage="choice.percent" :show-text="false" />
                  <b>{{ choice.count }} / {{ choice.percent }}%</b>
                </div>
              </div>

              <div v-else-if="stat.numericCount" class="metric-grid">
                <div>
                  <span>平均</span>
                  <b>{{ stat.average }}</b>
                </div>
                <div>
                  <span>最小</span>
                  <b>{{ stat.min }}</b>
                </div>
                <div>
                  <span>最大</span>
                  <b>{{ stat.max }}</b>
                </div>
              </div>

              <div v-else-if="stat.samples.length" class="text-samples">
                <p v-for="sample in stat.samples" :key="sample">{{ sample }}</p>
              </div>

              <el-empty v-else description="暂无可统计数据" />
            </article>
            <el-empty v-if="!responseStats.length" description="暂无题目" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="明细" name="details">
          <div class="responses-list">
            <article v-for="item in responses" :key="item.id" class="response-card">
              <div class="response-head">
                <b>{{ item.respondent?.nickname || "匿名填写" }}</b>
                <span>{{ fmtDate(item.createdAt) }}</span>
              </div>
              <div class="answer-list">
                <div v-for="field in activeResponseFields" :key="field.id" class="answer-row">
                  <span>{{ field.label }}</span>
                  <b>{{ formatAnswer(item.answers[field.id]) }}</b>
                </div>
              </div>
            </article>
            <el-empty v-if="!responses.length" description="暂无答卷" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as XLSX from "xlsx";
import { ElMessage, ElMessageBox } from "element-plus";
import type { UploadFile } from "element-plus";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calendar,
  CopyDocument,
  DataAnalysis,
  Delete,
  DocumentAdd,
  Download,
  Edit,
  Link,
  Plus,
  Rank,
  Star,
  Tickets,
  UploadFilled,
  View,
} from "@element-plus/icons-vue";
import {
  toolsApi,
  type GradeCheckStatus,
  type GradeCheckTable,
  type Questionnaire,
  type QuestionnaireField,
  type QuestionnaireFieldType,
  type QuestionnaireResponse,
  type QuestionnaireStatus,
  type QuestionnaireVisibility,
  type ServiceToolCode,
  type ToolManager,
  type ToolMeta,
} from "@/api/tools";
import { fmtDate } from "@/utils/format";

type EditableField = {
  localKey: string;
  id: string;
  label: string;
  type: QuestionnaireFieldType;
  required: boolean;
  placeholder: string;
  description: string;
  optionsText: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
};

type FieldStat = {
  field: QuestionnaireField;
  answered: number;
  choices: Array<{ label: string; count: number; percent: number }>;
  numericCount: number;
  average?: number;
  min?: number;
  max?: number;
  samples: string[];
};

const fieldTypeOptions: Array<{ value: QuestionnaireFieldType; label: string; hint: string; icon: unknown }> = [
  { value: "single", label: "单选", hint: "从多个选项中选一项", icon: Tickets },
  { value: "multiple", label: "多选", hint: "可同时选择多个选项", icon: DocumentAdd },
  { value: "text", label: "填空", hint: "短文本、姓名、联系方式", icon: Edit },
  { value: "textarea", label: "多行文本", hint: "意见、说明、开放反馈", icon: Rank },
  { value: "rating", label: "评分", hint: "满意度、推荐度、星级", icon: Star },
  { value: "number", label: "数字", hint: "人数、金额、分数", icon: DataAnalysis },
  { value: "date", label: "日期", hint: "报名日期、预约时间", icon: Calendar },
];

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const allTools = ref<ToolMeta[]>([]);
const manageableCodes = ref<ServiceToolCode[]>([]);
const adminCodes = ref<ServiceToolCode[]>([]);
const activeTool = ref<ServiceToolCode>("questionnaire");
const questionnaires = ref<Questionnaire[]>([]);
const managers = ref<ToolManager[]>([]);
const managerUsername = ref("");
const managerSaving = ref(false);
const settingSaving = ref(false);
const gradeChecks = ref<GradeCheckTable[]>([]);
const gradeSaving = ref(false);
const gradeFileName = ref("");
const gradeForm = reactive({
  title: "",
  description: "",
  status: "open" as GradeCheckStatus,
  studentIdColumn: "学号",
  columns: [] as string[],
  rows: [] as Array<Record<string, string>>,
});

const editorOpen = ref(false);
const editorMode = ref<"create" | "edit">("create");
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive({
  title: "",
  description: "",
  status: "draft" as QuestionnaireStatus,
  visibility: "public" as QuestionnaireVisibility,
  allowAnonymous: true,
  oneResponsePerUser: false,
  fields: [] as EditableField[],
});

const previewOpen = ref(false);
const previewQuestionnaire = reactive({
  title: "",
  description: "",
  visibility: "public" as QuestionnaireVisibility,
  oneResponsePerUser: false,
  fields: [] as QuestionnaireField[],
});

const responsesOpen = ref(false);
const responsesTab = ref<"stats" | "details">("stats");
const responsesTitle = ref("答卷");
const responses = ref<QuestionnaireResponse[]>([]);
const activeResponseFields = ref<QuestionnaireField[]>([]);

const manageableTools = computed(() => allTools.value.filter((tool) => manageableCodes.value.includes(tool.code)));
const currentToolMeta = computed(() => allTools.value.find((tool) => tool.code === activeTool.value));
const canAdminActiveTool = computed(() => adminCodes.value.includes(activeTool.value));
const openCount = computed(() => questionnaires.value.filter((item) => item.status === "open").length);
const totalResponses = computed(() => questionnaires.value.reduce((sum, item) => sum + (item.responseCount ?? 0), 0));
const gradeOpenCount = computed(() => gradeChecks.value.filter((item) => item.status === "open").length);
const gradeTotalRows = computed(() => gradeChecks.value.reduce((sum, item) => sum + item.rowCount, 0));
const editorTitle = computed(() => editorMode.value === "create" ? "新建问卷" : "编辑问卷");
const requiredCount = computed(() => form.fields.filter((field) => field.required).length);
const toolRequireLogin = computed({
  get: () => Boolean(currentToolMeta.value?.requireLogin),
  set: (value: boolean) => {
    const target = currentToolMeta.value;
    if (target) target.requireLogin = value;
  },
});
const toolAllowPublicManage = computed({
  get: () => Boolean(currentToolMeta.value?.allowPublicManage),
  set: (value: boolean) => {
    const target = currentToolMeta.value;
    if (target) target.allowPublicManage = value;
  },
});

const responseStats = computed<FieldStat[]>(() => activeResponseFields.value.map((field) => buildFieldStat(field)));

onMounted(init);

async function init() {
  loading.value = true;
  try {
    const [tools, perms] = await Promise.all([
      toolsApi.tools(),
      toolsApi.myPermissions(),
    ]);
    allTools.value = tools;
    manageableCodes.value = perms.toolCodes;
    adminCodes.value = perms.adminToolCodes ?? [];
    activeTool.value = pickInitialTool();
    if (manageableCodes.value.length) {
      await syncActiveToolQuery();
      await reloadActive();
    }
  } finally {
    loading.value = false;
  }
}

function pickInitialTool(): ServiceToolCode {
  const requested = normalizeToolQuery(route.query.tool);
  if (requested && manageableCodes.value.includes(requested)) return requested;
  return manageableCodes.value.includes("questionnaire") ? "questionnaire" : manageableCodes.value[0] ?? "questionnaire";
}

function normalizeToolQuery(value: unknown): ServiceToolCode | "" {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  return (["feedback", "questionnaire", "grade_check"] as ServiceToolCode[]).includes(raw as ServiceToolCode)
    ? raw as ServiceToolCode
    : "";
}

async function syncActiveToolQuery() {
  if (route.query.tool === activeTool.value) return;
  await router.replace({ path: route.path, query: { ...route.query, tool: activeTool.value } });
}

async function switchActiveTool() {
  await syncActiveToolQuery();
  await reloadActive();
}

async function reloadActive() {
  if (!activeTool.value) return;
  const managerList = canAdminActiveTool.value ? await toolsApi.managers(activeTool.value) : [];
  managers.value = managerList;
  if (activeTool.value === "grade_check") {
    gradeChecks.value = await toolsApi.gradeChecks({ manage: "1" });
    questionnaires.value = [];
    return;
  }
  const questionnaireList = await toolsApi.questionnaires({ toolCode: activeTool.value, manage: "1" });
  questionnaires.value = questionnaireList;
  gradeChecks.value = [];
}

async function saveToolSetting(value: string | number | boolean) {
  settingSaving.value = true;
  const previous = !Boolean(value);
  try {
    const updated = await toolsApi.updateToolSetting(activeTool.value, { requireLogin: Boolean(value) });
    const target = currentToolMeta.value;
    if (target) target.requireLogin = updated.requireLogin;
    ElMessage.success(updated.requireLogin ? "已设为登录后使用" : "已允许游客使用");
  } catch (e) {
    const target = currentToolMeta.value;
    if (target) target.requireLogin = previous;
    throw e;
  } finally {
    settingSaving.value = false;
  }
}

async function savePublicManageSetting(value: string | number | boolean) {
  settingSaving.value = true;
  const previous = !Boolean(value);
  try {
    const updated = await toolsApi.updateToolSetting(activeTool.value, { allowPublicManage: Boolean(value) });
    const target = currentToolMeta.value;
    if (target) target.allowPublicManage = updated.allowPublicManage;
    ElMessage.success(updated.allowPublicManage ? "已允许所有登录用户进入管理" : "已改为仅管理器可管理");
  } catch (e) {
    const target = currentToolMeta.value;
    if (target) target.allowPublicManage = previous;
    throw e;
  } finally {
    settingSaving.value = false;
  }
}

function openCreate() {
  editorMode.value = "create";
  editingId.value = null;
  resetEditorForm();
  addField("single");
  editorOpen.value = true;
}

async function openEdit(row: Questionnaire) {
  if (row.isSystem) return;
  editorMode.value = "edit";
  editingId.value = row.id;
  const source = row.fields ? row : await toolsApi.questionnaire(row.slug);
  resetEditorForm(source);
  editorOpen.value = true;
}

function resetEditorForm(source?: Questionnaire) {
  form.title = source?.title ?? "";
  form.description = source?.description ?? "";
  form.status = source?.status ?? "draft";
  form.visibility = source?.visibility ?? "public";
  form.allowAnonymous = source?.allowAnonymous ?? true;
  form.oneResponsePerUser = source?.oneResponsePerUser ?? false;
  form.fields = (source?.fields ?? []).map(toEditableField);
}

function toEditableField(field: QuestionnaireField): EditableField {
  return {
    localKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    id: field.id,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    placeholder: field.placeholder ?? "",
    description: field.description ?? "",
    optionsText: (field.options ?? []).join("\n"),
    min: field.min,
    max: field.max,
    step: field.step,
    maxLength: field.maxLength,
  };
}

function addField(type: QuestionnaireFieldType = "text", afterIndex?: number) {
  const field = makeEditableField(type);
  if (typeof afterIndex === "number") form.fields.splice(afterIndex + 1, 0, field);
  else form.fields.push(field);
}

function makeEditableField(type: QuestionnaireFieldType): EditableField {
  const field: EditableField = {
    localKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    id: makeFieldId(),
    label: "",
    type,
    required: false,
    placeholder: "",
    description: "",
    optionsText: "",
  };
  normalizeEditableField(field);
  return field;
}

function normalizeEditableField(field: EditableField) {
  if (field.type === "single" || field.type === "multiple") {
    if (!field.optionsText.trim()) field.optionsText = "选项1\n选项2";
  } else {
    field.optionsText = "";
  }
  if (field.type === "rating") {
    field.min = field.min ?? 1;
    field.max = field.max ?? 5;
    field.step = undefined;
  } else if (field.type === "number") {
    field.step = field.step ?? 1;
  } else if (field.type === "text") {
    field.maxLength = field.maxLength ?? 300;
  } else if (field.type === "textarea") {
    field.maxLength = field.maxLength ?? 2000;
  }
}

function duplicateField(index: number) {
  const source = form.fields[index];
  if (!source) return;
  const copy: EditableField = {
    ...source,
    id: makeFieldId(),
    localKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: source.label ? `${source.label} 副本` : "",
  };
  form.fields.splice(index + 1, 0, copy);
}

function removeField(index: number) {
  form.fields.splice(index, 1);
}

function moveField(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= form.fields.length) return;
  const [item] = form.fields.splice(index, 1);
  form.fields.splice(target, 0, item);
}

async function submitEditor(statusOverride?: QuestionnaireStatus) {
  if (statusOverride) form.status = statusOverride;
  const fields = buildFields();
  if (!validateEditor(fields)) return;

  saving.value = true;
  try {
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      status: form.status,
      visibility: form.visibility,
      allowAnonymous: form.allowAnonymous,
      oneResponsePerUser: form.oneResponsePerUser,
      fields,
    };
    if (editorMode.value === "edit" && editingId.value) {
      await toolsApi.updateQuestionnaire(editingId.value, payload);
      ElMessage.success("问卷已保存");
    } else {
      await toolsApi.createQuestionnaire({ toolCode: "questionnaire", ...payload });
      ElMessage.success(form.status === "open" ? "问卷已创建并开放" : "问卷已创建");
    }
    editorOpen.value = false;
    await reloadActive();
  } finally {
    saving.value = false;
  }
}

function buildFields(): QuestionnaireField[] {
  return form.fields
    .map((field) => normalizeField(field, false))
    .filter((field): field is QuestionnaireField => Boolean(field));
}

function normalizeField(field: EditableField, allowUntitled: boolean): QuestionnaireField | null {
  const label = field.label.trim();
  if (!label && !allowUntitled) return null;
  const result: QuestionnaireField = {
    id: field.id,
    label: label || "未命名题目",
    type: field.type,
    required: field.required,
    placeholder: field.placeholder.trim() || undefined,
    description: field.description.trim() || undefined,
    options: field.type === "single" || field.type === "multiple"
      ? field.optionsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      : undefined,
    min: field.min,
    max: field.max,
    step: field.step,
    maxLength: field.maxLength,
  };
  return result;
}

function validateEditor(fields: QuestionnaireField[]) {
  if (!form.title.trim()) {
    ElMessage.warning("请填写标题");
    return false;
  }
  if (!fields.length) {
    ElMessage.warning("至少添加 1 个题目");
    return false;
  }
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.id)) {
      ElMessage.warning(`题目 ID 重复：${field.id}`);
      return false;
    }
    ids.add(field.id);
    if ((field.type === "single" || field.type === "multiple") && (!field.options || field.options.length < 2)) {
      ElMessage.warning(`选项题“${field.label}”至少需要 2 个选项`);
      return false;
    }
    if (field.type === "rating" && (field.min ?? 1) >= (field.max ?? 5)) {
      ElMessage.warning(`评分题“${field.label}”的最高分需要大于最低分`);
      return false;
    }
    if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ElMessage.warning(`数字题“${field.label}”的最小值不能大于最大值`);
      return false;
    }
  }
  return true;
}

async function handleQuestionnaireCommand(command: string | number | object, row: Questionnaire) {
  const action = String(command);
  if (action === "link") return copyLink(row);
  if (action === "duplicate") return duplicateQuestionnaire(row);
  if (action === "delete") {
    const ok = await ElMessageBox.confirm(`删除问卷“${row.title}”？答卷也会一起删除。`, "确认删除", { type: "warning" })
      .then(() => true).catch(() => false);
    if (!ok) return;
    await toolsApi.deleteQuestionnaire(row.id);
    ElMessage.success("已删除");
  } else {
    const status = action === "open" ? "open" : action === "close" ? "closed" : "draft";
    await toolsApi.updateQuestionnaire(row.id, { status });
    ElMessage.success("状态已更新");
  }
  await reloadActive();
}

async function duplicateQuestionnaire(row: Questionnaire) {
  const source = row.fields ? row : await toolsApi.questionnaire(row.slug);
  await toolsApi.createQuestionnaire({
    toolCode: "questionnaire",
    title: `${source.title} 副本`,
    description: source.description ?? undefined,
    status: "draft",
    visibility: source.visibility,
    allowAnonymous: source.allowAnonymous,
    oneResponsePerUser: source.oneResponsePerUser,
    fields: (source.fields ?? []).map((field) => ({ ...field, id: makeFieldId() })),
  });
  ElMessage.success("已复制为草稿");
  await reloadActive();
}

function openPreview(row?: Questionnaire) {
  const fields = row
    ? (row.fields ?? [])
    : form.fields.map((field) => normalizeField(field, true)).filter((field): field is QuestionnaireField => Boolean(field));
  previewQuestionnaire.title = row?.title ?? form.title;
  previewQuestionnaire.description = row?.description ?? form.description;
  previewQuestionnaire.visibility = row?.visibility ?? form.visibility;
  previewQuestionnaire.oneResponsePerUser = row?.oneResponsePerUser ?? form.oneResponsePerUser;
  previewQuestionnaire.fields = fields;
  previewOpen.value = true;
}

async function openResponses(row: Questionnaire) {
  const data = await toolsApi.responses(row.id);
  responsesTitle.value = row.title;
  activeResponseFields.value = data.questionnaire.fields ?? [];
  responses.value = data.list;
  responsesTab.value = "stats";
  responsesOpen.value = true;
}

function copyLink(row: Questionnaire) {
  const path = `${window.location.origin}/services/tools/questionnaires/${row.slug}`;
  navigator.clipboard?.writeText(path).then(
    () => ElMessage.success("链接已复制"),
    () => ElMessage.info(path)
  );
}

async function handleGradeExcelFile(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      ElMessage.warning("Excel 中没有工作表");
      return;
    }
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    const headerRow = matrix.find((row) => row.some((cell) => String(cell ?? "").trim()));
    if (!headerRow) {
      ElMessage.warning("Excel 没有表头");
      return;
    }
    const columns = headerRow.map((cell) => String(cell ?? "").trim()).filter(Boolean);
    if (!columns.includes("学号")) {
      ElMessage.warning("Excel 必须包含“学号”字段");
      return;
    }
    if (new Set(columns).size !== columns.length) {
      ElMessage.warning("Excel 表头不能重复");
      return;
    }
    const headerIndex = matrix.indexOf(headerRow);
    const rows = matrix.slice(headerIndex + 1)
      .map((line) => {
        const row: Record<string, string> = {};
        columns.forEach((column, index) => {
          row[column] = String(line[index] ?? "").trim();
        });
        return row;
      })
      .filter((row) => columns.some((column) => row[column]));
    if (!rows.length) {
      ElMessage.warning("Excel 至少需要 1 行有效数据");
      return;
    }
    const duplicate = findDuplicateStudentId(rows, "学号");
    if (duplicate) {
      ElMessage.warning(`学号重复：${duplicate}`);
      return;
    }
    gradeFileName.value = file.name;
    gradeForm.studentIdColumn = "学号";
    gradeForm.columns = columns;
    gradeForm.rows = rows;
    if (!gradeForm.title.trim()) gradeForm.title = file.name.replace(/\.(xlsx|xls)$/i, "");
    ElMessage.success(`已读取 ${rows.length} 行`);
  } catch {
    ElMessage.error("Excel 解析失败，请检查文件格式");
  }
}

async function createGradeCheck() {
  if (!gradeForm.title.trim()) {
    ElMessage.warning("请填写查询表标题");
    return;
  }
  if (!gradeForm.columns.includes(gradeForm.studentIdColumn) || !gradeForm.rows.length) {
    ElMessage.warning("请先上传包含“学号”字段的 Excel");
    return;
  }
  gradeSaving.value = true;
  try {
    await toolsApi.createGradeCheck({
      title: gradeForm.title.trim(),
      description: gradeForm.description.trim() || undefined,
      status: gradeForm.status,
      studentIdColumn: gradeForm.studentIdColumn,
      columns: gradeForm.columns,
      rows: gradeForm.rows,
    });
    ElMessage.success(gradeForm.status === "open" ? "查询表已创建并开放" : "查询表已创建");
    resetGradeForm();
    await reloadActive();
  } finally {
    gradeSaving.value = false;
  }
}

async function handleGradeCommand(command: string | number | object, row: GradeCheckTable) {
  const action = String(command);
  if (action === "delete") {
    const ok = await ElMessageBox.confirm(`删除查询表“${row.title}”？`, "确认删除", { type: "warning" })
      .then(() => true).catch(() => false);
    if (!ok) return;
    await toolsApi.deleteGradeCheck(row.id);
    ElMessage.success("已删除");
  } else {
    const status = action === "open" ? "open" : action === "close" ? "closed" : "draft";
    await toolsApi.updateGradeCheck(row.id, { status });
    ElMessage.success("状态已更新");
  }
  await reloadActive();
}

function copyGradeLink(row: GradeCheckTable) {
  const path = `${window.location.origin}/services/tools/grade-checks/${row.slug}`;
  navigator.clipboard?.writeText(path).then(
    () => ElMessage.success("链接已复制"),
    () => ElMessage.info(path)
  );
}

function resetGradeForm() {
  gradeFileName.value = "";
  gradeForm.title = "";
  gradeForm.description = "";
  gradeForm.status = "open";
  gradeForm.studentIdColumn = "学号";
  gradeForm.columns = [];
  gradeForm.rows = [];
}

function downloadGradeTemplate() {
  const dataRows = [
    { 学号: "20260001", 姓名: "张三", 课程: "药理学", 平时成绩: "88", 期末成绩: "91", 总评成绩: "90", 备注: "请核对姓名和成绩" },
    { 学号: "20260002", 姓名: "李四", 课程: "药理学", 平时成绩: "84", 期末成绩: "86", 总评成绩: "85", 备注: "" },
  ];
  const helpRows = [
    { 字段名: "学号", 是否必填: "必填", 说明: "字段名必须完全等于“学号”。系统用它匹配登录用户，只向学生展示自己学号对应的一行。", 示例: "20260001" },
    { 字段名: "姓名", 是否必填: "选填", 说明: "建议保留，便于学生核对身份。", 示例: "张三" },
    { 字段名: "课程", 是否必填: "选填", 说明: "可替换为考试名称、班级、批次等你需要展示的信息。", 示例: "药理学" },
    { 字段名: "平时成绩 / 期末成绩 / 总评成绩", 是否必填: "选填", 说明: "成绩字段名称不限，上传后会原样展示。", 示例: "88" },
    { 字段名: "备注", 是否必填: "选填", 说明: "可写核对说明、补充状态、处理提示等。", 示例: "请核对姓名和成绩" },
  ];
  const dataSheet = XLSX.utils.json_to_sheet(dataRows, { header: ["学号", "姓名", "课程", "平时成绩", "期末成绩", "总评成绩", "备注"] });
  XLSX.utils.sheet_add_aoa(dataSheet, [
    [],
    ["注意事项（上传前请删除本行及以下内容）"],
    ["字段名", "是否必填", "说明", "示例"],
    ...helpRows.map((row) => [row.字段名, row.是否必填, row.说明, row.示例]),
  ], { origin: `A${dataRows.length + 3}` });
  dataSheet["!cols"] = [{ wch: 24 }, { wch: 10 }, { wch: 58 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 24 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, "可上传示例");
  XLSX.writeFile(workbook, "成绩表核对示例.xlsx");
}

function findDuplicateStudentId(rows: Array<Record<string, string>>, column: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const studentId = String(row[column] ?? "").replace(/\s+/g, "");
    if (!studentId) continue;
    if (seen.has(studentId)) return studentId;
    seen.add(studentId);
  }
  return "";
}

async function addManager() {
  const username = managerUsername.value.trim();
  if (!username) {
    ElMessage.warning("请输入用户名");
    return;
  }
  managerSaving.value = true;
  try {
    await toolsApi.addManager(activeTool.value, { username });
    managerUsername.value = "";
    ElMessage.success("已添加管理器");
    await reloadActive();
  } finally {
    managerSaving.value = false;
  }
}

async function removeManager(userId: number) {
  const ok = await ElMessageBox.confirm("移除该用户的小工具管理权限？", "确认", { type: "warning" })
    .then(() => true).catch(() => false);
  if (!ok) return;
  await toolsApi.removeManager(activeTool.value, userId);
  ElMessage.success("已移除");
  await reloadActive();
}

function buildFieldStat(field: QuestionnaireField): FieldStat {
  const optionCounts = new Map<string, number>();
  const samples: string[] = [];
  const numbers: number[] = [];
  let answered = 0;

  if (field.type === "single" || field.type === "multiple") {
    for (const option of field.options ?? []) optionCounts.set(option, 0);
  }
  if (field.type === "rating") {
    const min = Math.max(0, Math.round(field.min ?? 1));
    const max = Math.min(10, Math.round(field.max ?? 5));
    for (let value = min; value <= max; value += 1) optionCounts.set(String(value), 0);
  }

  for (const response of responses.value) {
    const raw = response.answers[field.id];
    if (Array.isArray(raw)) {
      const values = raw.map(String).map((item) => item.trim()).filter(Boolean);
      if (!values.length) continue;
      answered += 1;
      for (const value of values) optionCounts.set(value, (optionCounts.get(value) ?? 0) + 1);
      continue;
    }

    const value = String(raw ?? "").trim();
    if (!value) continue;
    answered += 1;
    if (field.type === "single" || field.type === "date" || field.type === "rating") {
      optionCounts.set(value, (optionCounts.get(value) ?? 0) + 1);
    }
    if (field.type === "number" || field.type === "rating") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) numbers.push(numeric);
    }
    if ((field.type === "text" || field.type === "textarea") && samples.length < 8) {
      samples.push(value);
    }
  }

  const choices = Array.from(optionCounts.entries())
    .filter(([, count]) => field.type !== "date" || count > 0)
    .slice(0, field.type === "date" ? 10 : undefined)
    .map(([label, count]) => ({
      label,
      count,
      percent: answered ? Math.round((count / answered) * 100) : 0,
    }));

  const sum = numbers.reduce((total, item) => total + item, 0);
  return {
    field,
    answered,
    choices,
    numericCount: numbers.length,
    average: numbers.length ? round(sum / numbers.length) : undefined,
    min: numbers.length ? Math.min(...numbers) : undefined,
    max: numbers.length ? Math.max(...numbers) : undefined,
    samples,
  };
}

function exportResponses() {
  const headers = ["提交时间", "填写人", ...activeResponseFields.value.map((field) => field.label)];
  const rows = responses.value.map((item) => [
    fmtDate(item.createdAt),
    item.respondent?.nickname || item.respondent?.username || "匿名填写",
    ...activeResponseFields.value.map((field) => formatAnswer(item.answers[field.id])),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(responsesTitle.value)}-答卷.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function makeFieldId() {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function statusText(status: QuestionnaireStatus) {
  if (status === "open") return "开放";
  if (status === "closed") return "关闭";
  return "草稿";
}

function statusTag(status: QuestionnaireStatus): "success" | "info" | "warning" {
  if (status === "open") return "success";
  if (status === "closed") return "info";
  return "warning";
}

function fieldTypeText(type: QuestionnaireFieldType) {
  return fieldTypeOptions.find((item) => item.value === type)?.label ?? type;
}

function ratingRange(field: QuestionnaireField) {
  const min = Math.max(0, Math.round(field.min ?? 1));
  const max = Math.min(10, Math.round(field.max ?? 5));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}

function formatAnswer(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join("、") || "-";
  return value || "-";
}

function csvEscape(value: string) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "questionnaire";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
</script>

<style scoped>
.tool-manage-page { display: flex; flex-direction: column; gap: 18px; }
.manage-head,
.manage-panel {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.manage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px;
}
.kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 650;
  margin-bottom: 5px;
}
.manage-head h2 { margin: 0; font-size: 22px; color: #111827; }
.manage-head p { margin: 6px 0 0; color: #6b7280; font-size: 13px; line-height: 1.7; }
.manage-panel { padding: 16px 18px 20px; min-height: 240px; }
:global(.questionnaire-builder-dialog.el-dialog) {
  --builder-primary: #267dff;
  --builder-primary-dark: #1765d8;
  --builder-primary-soft: #eef5ff;
  --builder-border: #e5eaf3;
  --builder-muted: #6b7280;
  width: 100vw !important;
  height: 100vh !important;
  max-height: none !important;
  min-height: 100vh;
  max-width: none;
  margin: 0 !important;
  padding: 0 !important;
  border-radius: 0;
  background: #f3f6fb;
  box-shadow: none;
  transform: none !important;
}
:global(.questionnaire-builder-overlay) {
  background: #f3f6fb !important;
}
:global(.questionnaire-builder-overlay .el-overlay-dialog) {
  align-items: stretch !important;
  justify-content: stretch !important;
  padding: 0 !important;
  overflow: hidden;
}
:global(.questionnaire-builder-dialog .el-dialog__header) {
  padding: 0;
  margin: 0;
  border-bottom: 1px solid var(--builder-border);
  background: #fff;
  box-shadow: 0 1px 10px rgba(17, 24, 39, 0.04);
}
:global(.questionnaire-builder-dialog .el-dialog__body) {
  padding: 0;
  height: calc(100vh - 64px);
  overflow: hidden;
}
.builder-topbar {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 24px;
}
.builder-titlebar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.builder-titlebar div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.builder-titlebar b { color: #111827; font-size: 17px; }
.builder-titlebar span { color: #6b7280; font-size: 12px; }
.builder-back {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--builder-border);
  border-radius: 8px;
  color: #4b5563;
  background: #fff;
  cursor: pointer;
  transition: all 0.18s ease;
}
.builder-back:hover {
  color: var(--builder-primary);
  border-color: #b8d7ff;
  background: var(--builder-primary-soft);
}
.builder-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.builder-top-actions :deep(.el-button) {
  height: 34px;
  border-radius: 6px;
}
.builder-top-actions :deep(.el-button--primary) {
  --el-button-bg-color: var(--builder-primary);
  --el-button-border-color: var(--builder-primary);
  --el-button-hover-bg-color: var(--builder-primary-dark);
  --el-button-hover-border-color: var(--builder-primary-dark);
}
.builder-top-actions :deep(.el-button--primary.is-plain) {
  --el-button-bg-color: #fff;
  --el-button-border-color: #b8d7ff;
  --el-button-text-color: var(--builder-primary);
  --el-button-hover-bg-color: var(--builder-primary-soft);
  --el-button-hover-border-color: var(--builder-primary);
  --el-button-hover-text-color: var(--builder-primary);
}
.tool-admin-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
}
.admin-section {
  border: 1px solid #eef0f4;
  border-radius: 10px;
  padding: 16px;
  background: #fff;
}
.questionnaire-section { grid-row: span 2; }
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.section-head h3 { margin: 0; color: #111827; font-size: 16px; }
.section-head p { margin: 5px 0 0; color: #6b7280; font-size: 13px; line-height: 1.6; }
.questionnaire-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.questionnaire-summary div {
  padding: 10px 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.questionnaire-summary b { display: block; color: #111827; font-size: 20px; }
.questionnaire-summary span { color: #6b7280; font-size: 12px; }
.grade-upload-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid #e5eaf3;
  border-radius: 10px;
  background: #f8fbff;
  margin-bottom: 14px;
}
.upload-copy h4 {
  margin: 0;
  color: #111827;
  font-size: 15px;
}
.upload-copy p {
  margin: 5px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
.template-actions {
  position: absolute;
  top: 14px;
  right: 14px;
}
.template-actions :deep(.el-button) {
  height: 32px;
  border-radius: 6px;
}
.field-rule-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding-top: 2px;
}
.field-rule-list div {
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #fff;
}
.field-rule-list b,
.field-rule-list span,
.field-rule-list small {
  display: block;
}
.field-rule-list b {
  color: #2563eb;
  font-size: 12px;
  margin-bottom: 5px;
}
.field-rule-list span {
  color: #111827;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field-rule-list small {
  margin-top: 5px;
  color: #6b7280;
  font-size: 11px;
  line-height: 1.5;
}
.grade-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px;
  gap: 10px;
}
.grade-desc {
  grid-column: 1 / -1;
}
.grade-uploader :deep(.el-upload-dragger) {
  padding: 24px 16px;
  border-radius: 10px;
  background: #fff;
}
.grade-uploader :deep(.el-icon) {
  color: #2563eb;
}
.grade-preview-box {
  border: 1px solid #dbeafe;
  border-radius: 10px;
  padding: 12px;
  background: #fff;
}
.grade-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.grade-preview-head div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.grade-preview-head b {
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grade-preview-head span {
  color: #6b7280;
  font-size: 12px;
}
.grade-columns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.grade-preview-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #eef0f4;
  border-radius: 8px;
}
.grade-preview-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  font-size: 12px;
}
.grade-preview-table th,
.grade-preview-table td {
  padding: 9px 10px;
  border-bottom: 1px solid #eef0f4;
  color: #374151;
  text-align: left;
  white-space: nowrap;
}
.grade-preview-table th {
  color: #6b7280;
  background: #f9fafb;
  font-weight: 650;
}
.questionnaire-list-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.questionnaire-row-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
}
.q-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.q-title-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.q-title-cell b { color: #111827; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-title-cell span { color: #9ca3af; font-size: 12px; word-break: break-all; }
.q-row-tags,
.q-row-meta,
.q-row-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}
.q-row-meta {
  color: #6b7280;
  font-size: 12px;
}
.q-row-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.q-row-meta span + span::before {
  content: "";
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #c4cdd8;
}
.q-row-actions {
  justify-content: flex-end;
}
.add-manager {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.manager-list { display: flex; flex-direction: column; gap: 8px; }
.access-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.access-setting + .access-setting { margin-top: 10px; }
.access-setting div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.access-setting b { color: #111827; }
.access-setting span { color: #6b7280; font-size: 12px; }
.manager-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.manager-row div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.manager-row b { color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.manager-row span { color: #6b7280; font-size: 12px; }
.builder-layout {
  height: 100%;
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 286px;
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.type-palette,
.editor-card,
.field-editor,
.inspector-card {
  border: 1px solid var(--builder-border);
  border-radius: 8px;
  background: #fff;
}
.type-palette {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 16px;
  height: 100%;
  max-height: 100%;
  overflow: auto;
  border-width: 0 1px 0 0;
  border-radius: 0;
  box-shadow: 5px 0 18px rgba(17, 24, 39, 0.025);
}
.palette-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 2px 2px 8px;
}
.palette-title span {
  color: #6b7280;
  font-size: 12px;
}
.type-palette h4,
.fields-head h4 {
  margin: 0;
  color: #111827;
  font-size: 16px;
}
.type-palette button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  min-height: 58px;
  padding: 10px 11px;
  border: 1px solid var(--builder-border);
  border-radius: 8px;
  background: #f9fbff;
  color: #374151;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: all 0.18s ease;
}
.type-palette button:hover {
  transform: translateY(-1px);
  border-color: #b8d7ff;
  color: var(--builder-primary);
  background: var(--builder-primary-soft);
  box-shadow: 0 6px 16px rgba(38, 125, 255, 0.12);
}
.type-palette .el-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 7px;
  color: var(--builder-primary);
  background: #eaf3ff;
  font-size: 17px;
}
.type-palette button span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.type-palette b { font-size: 13px; }
.type-palette small { color: #9ca3af; font-size: 11px; line-height: 1.35; }
.questionnaire-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  overflow: auto;
  padding: 26px 24px 44px;
  background:
    linear-gradient(90deg, rgba(229, 234, 243, 0.55) 1px, transparent 1px),
    linear-gradient(180deg, rgba(229, 234, 243, 0.55) 1px, transparent 1px),
    #f3f6fb;
  background-size: 28px 28px;
}
.editor-card {
  max-width: 850px;
  width: 100%;
  align-self: center;
  padding: 30px 34px 28px;
  border-top: 4px solid var(--builder-primary);
  box-shadow: 0 12px 32px rgba(17, 24, 39, 0.08);
}
.cover-kicker {
  color: var(--builder-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  margin-bottom: 12px;
}
.editor-card :deep(.el-select) { width: 100%; }
.editor-card :deep(.el-form-item__label),
.field-editor :deep(.el-form-item__label),
.inspector-card :deep(.el-form-item__label) {
  color: #4b5563;
  font-weight: 600;
}
.title-field :deep(.el-input__wrapper) {
  min-height: 48px;
  padding: 0 2px;
  border-radius: 0;
  box-shadow: 0 1px 0 #d1d9e6;
}
.title-field :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 2px 0 var(--builder-primary);
}
.title-field :deep(.el-input__inner) {
  height: 48px;
  color: #111827;
  font-size: 22px;
  font-weight: 700;
}
.editor-card :deep(.el-textarea__inner) {
  min-height: 86px !important;
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e5eaf3 inset;
}
.title-field { min-width: 0; }
.fields-head {
  max-width: 850px;
  width: 100%;
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 2px;
  padding: 0 2px;
}
.fields-head > div { display: flex; gap: 8px; }
.fields-head :deep(.el-button--primary.is-plain) {
  --el-button-bg-color: #fff;
  --el-button-border-color: #b8d7ff;
  --el-button-text-color: var(--builder-primary);
  --el-button-hover-bg-color: var(--builder-primary-soft);
  --el-button-hover-border-color: var(--builder-primary);
  --el-button-hover-text-color: var(--builder-primary);
}
.field-editor-list {
  max-width: 850px;
  width: 100%;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field-editor {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 16px;
  padding: 20px 22px;
  background: #fff;
  border-left: 4px solid transparent;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.055);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}
.field-editor:hover {
  transform: translateY(-1px);
  border-color: #b8d7ff;
  border-left-color: var(--builder-primary);
  box-shadow: 0 12px 30px rgba(38, 125, 255, 0.13);
}
.field-editor.is-required {
  border-left-color: var(--builder-primary);
}
.field-index {
  width: 42px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid #b8d7ff;
  border-radius: 999px;
  color: var(--builder-primary);
  background: var(--builder-primary-soft);
  font-size: 11px;
  font-weight: 700;
}
.field-editor-body { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.field-meta-line {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #9ca3af;
  font-size: 12px;
}
.field-meta-line span {
  color: var(--builder-primary);
  font-weight: 700;
}
.field-meta-line b {
  padding: 1px 7px;
  border-radius: 999px;
  color: #dc2626;
  background: #fef2f2;
  font-size: 11px;
}
.field-editor-main {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 160px 80px;
  gap: 10px;
  align-items: center;
}
.field-editor :deep(.el-input__wrapper),
.field-editor :deep(.el-select__wrapper),
.inspector-card :deep(.el-select__wrapper) {
  border-radius: 7px;
  box-shadow: 0 0 0 1px #e5eaf3 inset;
}
.field-editor :deep(.el-input__wrapper.is-focus),
.field-editor :deep(.el-select__wrapper.is-focused),
.inspector-card :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px var(--builder-primary) inset;
}
.field-editor :deep(.el-checkbox__input.is-checked .el-checkbox__inner),
.inspector-card :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: var(--builder-primary);
  border-color: var(--builder-primary);
}
.field-editor :deep(.el-checkbox__input.is-checked + .el-checkbox__label),
.inspector-card :deep(.el-checkbox__input.is-checked + .el-checkbox__label) {
  color: var(--builder-primary);
}
.advanced-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr));
  gap: 8px;
}
.advanced-grid :deep(.el-form-item) { margin-bottom: 0; }
.field-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px dashed #e5eaf3;
}
.field-actions button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #6b7280;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  transition: all 0.16s ease;
}
.field-actions button:hover:not(:disabled) {
  color: var(--builder-primary);
  border-color: #b8d7ff;
  background: var(--builder-primary-soft);
}
.field-actions button.danger:hover:not(:disabled) {
  color: #dc2626;
  border-color: #fecaca;
  background: #fef2f2;
}
.field-actions button:disabled {
  color: #c4cdd8;
  cursor: not-allowed;
}
.builder-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  overflow: auto;
  padding: 18px 16px;
  border-left: 1px solid var(--builder-border);
  background: #fff;
  box-shadow: -5px 0 18px rgba(17, 24, 39, 0.025);
}
.inspector-card {
  padding: 16px;
  background: #fbfcff;
}
.inspector-card h4 {
  margin: 0 0 14px;
  color: #111827;
  font-size: 16px;
}
.inspector-card :deep(.el-select) { width: 100%; }
.inspector-checks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.check-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #edf1f7;
  color: #6b7280;
  font-size: 13px;
}
.check-row b { color: var(--builder-primary); font-size: 18px; }
.inspector-card p {
  margin: 12px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.7;
}
.preview-shell { max-width: 720px; margin: 0 auto; }
.preview-head {
  padding-bottom: 18px;
  border-bottom: 1px solid #eef0f4;
  margin-bottom: 14px;
}
.preview-head h2 { margin: 0; color: #111827; font-size: 22px; }
.preview-head p { margin: 7px 0 0; color: #6b7280; line-height: 1.7; }
.meta-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.preview-form { display: flex; flex-direction: column; gap: 12px; }
.preview-field {
  padding: 14px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fff;
}
.preview-label {
  display: flex;
  gap: 4px;
  color: #111827;
  margin-bottom: 8px;
}
.preview-label span { color: #dc2626; }
.preview-field p { margin: 0 0 10px; color: #6b7280; font-size: 12px; line-height: 1.6; }
.preview-field :deep(.el-radio-group),
.preview-field :deep(.el-checkbox-group) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.preview-rating {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.preview-rating span {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #4b5563;
  background: #fff;
  font-weight: 650;
}
.responses-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-right: 32px;
}
.responses-title div { display: flex; flex-direction: column; gap: 3px; }
.responses-title b { color: #111827; font-size: 16px; }
.responses-title span { color: #6b7280; font-size: 12px; }
.stats-list,
.responses-list { display: flex; flex-direction: column; gap: 12px; }
.stat-card,
.response-card {
  border: 1px solid #eef0f4;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}
.stat-head,
.response-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f3f4f6;
  margin-bottom: 10px;
}
.stat-head div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.stat-head b,
.response-head b { color: #111827; }
.stat-head span,
.response-head span { color: #9ca3af; font-size: 12px; }
.choice-stats { display: flex; flex-direction: column; gap: 10px; }
.choice-stat-row {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr) 76px;
  gap: 10px;
  align-items: center;
  color: #374151;
  font-size: 13px;
}
.choice-stat-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.choice-stat-row b { color: #111827; font-weight: 600; text-align: right; }
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.metric-grid div {
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.metric-grid span { display: block; color: #6b7280; font-size: 12px; }
.metric-grid b { color: #111827; font-size: 18px; }
.text-samples { display: flex; flex-direction: column; gap: 8px; }
.text-samples p {
  margin: 0;
  padding: 9px 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  color: #374151;
  background: #fafafa;
  line-height: 1.6;
}
.answer-list { display: grid; gap: 7px; }
.answer-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 10px;
  color: #374151;
  font-size: 13px;
}
.answer-row span { color: #6b7280; }
.answer-row b { font-weight: 500; word-break: break-word; }
@media (max-width: 1100px) {
  .builder-layout {
    grid-template-columns: 190px minmax(0, 1fr);
  }
  .builder-side {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: visible;
  }
}
@media (max-width: 900px) {
  .tool-admin-grid { grid-template-columns: 1fr; }
  .managers-section { order: -1; }
}
@media (max-width: 760px) {
  :global(.questionnaire-builder-dialog .el-dialog__body) {
    height: calc(100vh - 116px);
    overflow: auto;
  }
  .builder-topbar {
    height: auto;
    align-items: stretch;
    flex-direction: column;
    padding: 12px;
  }
  .builder-top-actions {
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .builder-layout {
    display: flex;
    flex-direction: column;
    overflow: visible;
    padding: 12px;
  }
  .type-palette {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: visible;
  }
  .palette-title { grid-column: 1 / -1; }
  .field-editor-main,
  .advanced-grid { grid-template-columns: 1fr; }
  .builder-side { display: flex; }
}
@media (max-width: 700px) {
  .manage-head {
    flex-direction: column;
    padding: 16px;
  }
  .manage-head .el-button { width: 100%; }
  .manage-panel,
  .admin-section { padding: 14px; }
  .section-head { flex-direction: column; align-items: stretch; }
  .section-head .el-button { width: 100%; }
  .questionnaire-summary { grid-template-columns: 1fr; }
  .template-actions {
    position: static;
  }
  .template-actions .el-button { width: 100%; }
  .field-rule-list { grid-template-columns: 1fr; }
  .grade-form-grid { grid-template-columns: 1fr; }
  .grade-preview-head { align-items: stretch; flex-direction: column; }
  .grade-preview-head .el-button { width: 100%; }
  .questionnaire-row-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .q-row-actions { justify-content: flex-start; }
  .q-row-actions .el-button { flex: 1; }
  .add-manager { flex-direction: column; }
  .answer-row,
  .choice-stat-row { grid-template-columns: 1fr; gap: 5px; }
  .choice-stat-row b { text-align: left; }
  .metric-grid { grid-template-columns: 1fr; }
}
</style>
