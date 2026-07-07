<template>
  <div class="tool-manage-page">
    <section class="manage-head">
      <div class="manage-head-copy">
        <div class="kicker">校园小工具</div>
        <h2>小工具管理</h2>
        <p>管理器可维护工具设置和人员；开放管理入口后，登录用户可维护自己发起的内容。</p>
      </div>
      <div class="manage-head-actions">
        <el-button plain @click="$router.push('/services/tools')">
          <el-icon><ArrowLeft /></el-icon>
          小工具列表
        </el-button>
      </div>
    </section>

    <section class="manage-panel" v-loading="loading">
      <el-empty v-if="!loading && !manageableTools.length" description="暂无可管理的小工具" />

      <template v-else>
        <el-tabs v-model="activeTool" class="manage-tool-tabs" @tab-change="switchActiveTool">
          <el-tab-pane
            v-for="tool in manageableTools"
            :key="tool.code"
            :name="tool.code"
            :label="tool.name"
          />
        </el-tabs>

        <div v-if="activeTool === 'pdf_tools'" class="tool-admin-grid permission-only-grid">
          <section class="admin-section questionnaire-section">
            <div class="section-head">
              <div>
                <h3>PDF 工具</h3>
                <p>PDF 工具在浏览器本地完成合并、拆分、压缩和转换。这里维护入口可见性、登录要求和管理器。</p>
              </div>
              <el-button type="primary" @click="openPdfTool">
                <el-icon><View /></el-icon>
                打开工具
              </el-button>
            </div>
            <div class="empty-panel">
              工具不会保存用户上传的文件；常见处理会在当前设备完成，适合公开给同学临时整理 PDF 材料。
            </div>
          </section>

          <ToolAccessSettings
            v-if="canAdminActiveTool"
            description="可决定 PDF 工具是否展示在小工具入口，以及是否要求登录后使用。"
            :visible="Boolean(currentToolMeta?.isVisible)"
            :visible-text="currentToolMeta?.isVisible ? '当前会显示在小工具入口中' : '当前已从小工具入口中隐藏'"
            :require-login="Boolean(currentToolMeta?.requireLogin)"
            :require-login-text="currentToolMeta?.requireLogin ? '当前需要登录' : '当前允许游客使用'"
            :show-public-manage="false"
            :saving="settingSaving"
            @change:visible="saveToolVisibilitySetting"
            @change:require-login="saveToolSetting"
          />

          <ToolManagerPanel
            v-if="canAdminActiveTool"
            v-model:username="managerUsername"
            description="被分配后可维护 PDF 工具入口设置。"
            :managers="managers"
            :saving="managerSaving"
            :removing-id="managerRemovingId"
            @add="addManager"
            @remove="removeManager"
          />
        </div>

        <div v-else class="tool-admin-grid">
          <section v-if="activeTool !== 'grade_check' && activeTool !== 'file_collect'" class="admin-section questionnaire-section">
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
                    <span v-if="row.createdBy">发起人 {{ row.createdBy?.nickname || row.createdBy?.username }}</span>
                  </div>
                </div>
                <div class="q-row-actions">
                  <el-button v-if="!row.isSystem" size="small" :disabled="isQuestionnaireBusy(row)" @click="openEdit(row)">
                    <el-icon><Edit /></el-icon>
                    编辑
                  </el-button>
                  <el-button size="small" :disabled="isQuestionnaireBusy(row)" @click="openPreview(row)">
                    <el-icon><View /></el-icon>
                    预览
                  </el-button>
                  <el-button size="small" :loading="isQuestionnaireBusy(row)" :disabled="isQuestionnaireBusy(row)" @click="openResponses(row)">
                    <el-icon><DataAnalysis /></el-icon>
                    结果
                  </el-button>
                  <el-dropdown trigger="click" @command="handleQuestionnaireCommand($event, row)">
                    <el-button size="small" :loading="isQuestionnaireBusy(row)" :disabled="isQuestionnaireBusy(row)">
                      更多<el-icon><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="link">
                          <el-icon><Link /></el-icon>
                          复制链接
                        </el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="duplicate" :disabled="isQuestionnaireBusy(row)">
                          <el-icon><CopyDocument /></el-icon>
                          复制问卷
                        </el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="open" divided :disabled="isQuestionnaireBusy(row)">开放</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="close" :disabled="isQuestionnaireBusy(row)">关闭</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="draft" :disabled="isQuestionnaireBusy(row)">设为草稿</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="delete" divided :disabled="isQuestionnaireBusy(row)">
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

          <section v-else-if="activeTool === 'file_collect'" class="admin-section questionnaire-section grade-check-section">
            <div class="section-head">
              <div>
                <h3>文件收集</h3>
                <p>{{ canAdminActiveTool ? "创建提交链接，集中收取作业、材料、照片等文件。" : "创建并管理你自己发起的文件收集任务。" }}</p>
              </div>
            </div>

            <div class="questionnaire-summary">
              <div>
                <b>{{ fileCollections.length }}</b>
                <span>收集任务</span>
              </div>
              <div>
                <b>{{ fileOpenCount }}</b>
                <span>开放中</span>
              </div>
              <div>
                <b>{{ fileTotalSubmissions }}</b>
                <span>提交记录</span>
              </div>
            </div>

            <div class="grade-upload-panel">
              <div class="upload-copy">
                <h4>创建收集任务</h4>
                <p>提交者通过链接填写字段并上传文件；使用相同学号或姓名再次提交时，会覆盖旧提交。</p>
              </div>
              <div class="file-template-bar">
                <div>
                  <b>任务模板</b>
                  <span>{{ selectedFileTemplate?.description || "选择模板后可一键套用字段、文件规则和命名规则。" }}</span>
                </div>
                <el-select v-model="fileCollectTemplateKey" placeholder="选择模板" :disabled="fileCollectTemplateSaving">
                  <el-option-group label="内置模板">
                    <el-option
                      v-for="item in builtInFileCollectTemplates"
                      :key="item.key"
                      :label="item.name"
                      :value="item.key"
                    />
                  </el-option-group>
                  <el-option-group v-if="fileCollectTemplates.length" label="我的模板">
                    <el-option
                      v-for="item in fileCollectTemplates"
                      :key="item.id"
                      :label="item.name"
                      :value="`custom:${item.id}`"
                    />
                  </el-option-group>
                </el-select>
                <el-button plain :disabled="fileCollectTemplateSaving" @click="applySelectedFileTemplate">套用</el-button>
                <el-button plain :loading="fileCollectTemplateSaving" :disabled="fileCollectTemplateSaving" @click="saveCurrentFileTemplate">保存为模板</el-button>
                <el-button
                  v-if="selectedFileTemplate?.customId"
                  text
                  type="danger"
                  :loading="fileCollectTemplateSaving"
                  :disabled="fileCollectTemplateSaving"
                  @click="deleteSelectedFileTemplate"
                >
                  删除模板
                </el-button>
              </div>
              <div class="grade-form-grid">
                <el-input v-model="fileCollectForm.title" placeholder="任务标题，例如：2026 春季药理学作业收集" maxlength="120" />
                <el-select v-model="fileCollectForm.status">
                  <el-option label="开放提交" value="open" />
                  <el-option label="保存草稿" value="draft" />
                  <el-option label="暂时关闭" value="closed" />
                </el-select>
                <el-select v-model="fileCollectForm.visibility">
                  <el-option label="公开链接提交" value="public" />
                  <el-option label="登录后提交" value="login" />
                </el-select>
                <el-input v-model="fileCollectForm.description" class="grade-desc" type="textarea" :rows="2" placeholder="补充说明，例如提交要求、截止时间、命名说明等" maxlength="1000" />
              </div>
              <div class="file-field-editor">
                <div class="file-field-head">
                  <b>填写字段</b>
                  <el-button size="small" plain @click="addFileCollectField">
                    <el-icon><Plus /></el-icon>
                    添加字段
                  </el-button>
                </div>
                <div v-for="(field, index) in fileCollectForm.fields" :key="field.localKey" class="file-field-row">
                  <label class="compact-field">
                    <span>显示名称</span>
                    <el-input v-model="field.label" placeholder="给提交者看的名称，如 姓名" />
                  </label>
                  <label class="compact-field">
                    <span>变量名</span>
                    <el-input v-model="field.id" placeholder="用于命名，如 student_id 或 考试号" />
                  </label>
                  <label class="compact-field">
                    <span>填写提示</span>
                    <el-input v-model="field.placeholder" placeholder="输入框提示，如 请输入学号" />
                  </label>
                  <el-checkbox v-model="field.required">必填</el-checkbox>
                  <el-button text type="danger" :disabled="fileCollectForm.fields.length <= 1" @click="removeFileCollectField(index)">删除</el-button>
                </div>
              </div>
              <div class="file-rule-grid">
                <label class="config-field">
                  <span>允许文件类型</span>
                  <el-input v-model="fileCollectForm.allowedTypes" placeholder="例如 pdf,docx,jpg,png,zip" />
                  <small>多个类型用英文逗号隔开；留空表示不限制扩展名。</small>
                </label>
                <label class="config-field">
                  <span>单个文件大小</span>
                  <el-input-number v-model="fileCollectForm.maxSizeMb" :min="1" :max="100" controls-position="right" />
                  <small>单位 MB，最大 100。</small>
                </label>
                <label class="config-field">
                  <span>每人最多文件数</span>
                  <el-input-number v-model="fileCollectForm.maxCount" :min="1" :max="20" controls-position="right" />
                  <small>多文件会自动追加序号。</small>
                </label>
              </div>

              <div class="rename-builder">
                <div class="rename-head">
                  <div>
                    <b>文件命名</b>
                    <span>选择字段和取值方式后插入变量，不需要手写花括号。</span>
                  </div>
                  <el-input v-model="fileCollectForm.renameTemplate" placeholder="例如 {name}-{student_id|last:2}" />
                </div>
                <div class="rename-insert-grid">
                  <label class="config-field">
                    <span>字段</span>
                    <el-select v-model="fileRenameInsert.fieldId" placeholder="选择字段">
                      <el-option
                        v-for="field in fileCollectVariableFields"
                        :key="`rename-${field.id}`"
                        :label="`${field.label}（${field.id}）`"
                        :value="field.id"
                      />
                    </el-select>
                  </label>
                  <label class="config-field">
                    <span>取值</span>
                    <el-radio-group v-model="fileRenameInsert.mode">
                      <el-radio-button label="whole">完整</el-radio-button>
                      <el-radio-button label="last">后几位</el-radio-button>
                      <el-radio-button label="first">前几位</el-radio-button>
                    </el-radio-group>
                  </label>
                  <label class="config-field">
                    <span>位数</span>
                    <el-input-number v-model="fileRenameInsert.count" :min="1" :max="99" controls-position="right" :disabled="fileRenameInsert.mode === 'whole'" />
                  </label>
                  <el-button class="rename-insert-action" type="primary" @click="insertRenameVariable">
                    <el-icon><Plus /></el-icon>
                    插入变量
                  </el-button>
                </div>
                <div class="rename-token-list">
                  <span class="rename-token-label">快捷插入</span>
                  <button
                    v-for="item in fileRenameQuickTokens"
                    :key="`${item.label}-${item.token}`"
                    type="button"
                    :class="['rename-token', `rename-token-${item.group}`]"
                    @click="insertRenameToken(item.token)"
                  >
                    {{ item.label }}
                  </button>
                </div>
                <small class="rename-example">
                  例：字段选“考试号”，取值选“后几位”，位数填 2，会插入 {student_id|last:2}，保存为“张三-08.pdf”。
                </small>
              </div>

              <div class="rename-builder">
                <div class="rename-head">
                  <div>
                    <b>多文件文件夹</b>
                    <span>同一次提交多个文件时，下载 ZIP 会按这个规则放进同一个文件夹。</span>
                  </div>
                  <el-input v-model="fileCollectForm.folderTemplate" placeholder="例如 {name}-{student_id}" />
                </div>
                <div class="rename-insert-grid">
                  <label class="config-field">
                    <span>字段</span>
                    <el-select v-model="fileFolderInsert.fieldId" placeholder="选择字段">
                      <el-option
                        v-for="field in fileCollectVariableFields"
                        :key="`folder-${field.id}`"
                        :label="`${field.label}（${field.id}）`"
                        :value="field.id"
                      />
                    </el-select>
                  </label>
                  <label class="config-field">
                    <span>取值</span>
                    <el-radio-group v-model="fileFolderInsert.mode">
                      <el-radio-button label="whole">完整</el-radio-button>
                      <el-radio-button label="last">后几位</el-radio-button>
                      <el-radio-button label="first">前几位</el-radio-button>
                    </el-radio-group>
                  </label>
                  <label class="config-field">
                    <span>位数</span>
                    <el-input-number v-model="fileFolderInsert.count" :min="1" :max="99" controls-position="right" :disabled="fileFolderInsert.mode === 'whole'" />
                  </label>
                  <el-button class="rename-insert-action" type="primary" @click="insertFolderVariable">
                    <el-icon><Plus /></el-icon>
                    插入变量
                  </el-button>
                </div>
                <div class="rename-token-list">
                  <span class="rename-token-label">快捷插入</span>
                  <button
                    v-for="item in fileFolderQuickTokens"
                    :key="`folder-${item.label}-${item.token}`"
                    type="button"
                    :class="['rename-token', `rename-token-${item.group}`]"
                    @click="insertFolderToken(item.token)"
                  >
                    {{ item.label }}
                  </button>
                </div>
                <small class="rename-example">
                  例：多文件提交会在 ZIP 中显示为“张三-08/张三-08-1.pdf、张三-08-2.jpg”。
                </small>
              </div>

              <div class="expected-list-box">
                <label class="config-field">
                  <span>应提交名单</span>
                  <el-input v-model="fileCollectForm.expectedEntries" type="textarea" :rows="3" placeholder="选填，一行一个学号、考试号或姓名，用于后续核对缺交" maxlength="20000" />
                </label>
              </div>
              <div class="grade-preview-head">
                <div>
                  <b>命名变量</b>
                  <span>字段变量支持完整值、前几位、后几位；文件名还可用 {original} 和 {index}。</span>
                </div>
                <el-button type="primary" :loading="fileCollectSaving" :disabled="fileCollectSaving" @click="createFileCollection">
                  <el-icon><Plus /></el-icon>
                  创建收集任务
                </el-button>
              </div>
            </div>

            <div class="questionnaire-list-cards">
              <article v-for="row in fileCollections" :key="row.id" class="questionnaire-row-card file-collection-card">
                <div class="q-row-main">
                  <div class="q-title-cell">
                    <b>{{ row.title }}</b>
                    <span>{{ row.slug }}</span>
                  </div>
                  <div class="q-row-tags">
                    <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
                    <el-tag size="small" effect="plain">{{ row.submissionCount }} 份提交</el-tag>
                    <el-tag size="small" type="info" effect="plain">{{ row.fileCount }} 个文件</el-tag>
                  </div>
                  <div class="q-row-meta">
                    <span>{{ row.visibility === "login" ? "登录提交" : "公开提交" }}</span>
                    <span>更新 {{ fmtDate(row.updatedAt) }}</span>
                    <span v-if="row.createdBy">发起人 {{ row.createdBy?.nickname || row.createdBy?.username }}</span>
                  </div>
                </div>
                <div class="file-collection-actions">
                  <el-button class="file-primary-action" type="primary" :loading="isFileCollectBusy(row)" :disabled="isFileCollectBusy(row)" @click="openFileSubmissions(row)">
                    <el-icon><DataAnalysis /></el-icon>
                    提交记录
                  </el-button>
                  <div class="file-secondary-actions">
                    <button type="button" class="file-tool-action" :disabled="isFileCollectBusy(row)" @click="copyFileCollectLink(row)">
                      <el-icon><Link /></el-icon>
                      <span>链接</span>
                    </button>
                    <button type="button" class="file-tool-action" :disabled="isFileCollectBusy(row)" @click="openFileManager(row)">
                      <el-icon><View /></el-icon>
                      <span>文件</span>
                    </button>
                    <button type="button" class="file-tool-action" :disabled="zipDownloading || isFileCollectBusy(row)" @click="downloadFileCollectionZip(row)">
                      <el-icon><Download /></el-icon>
                      <span>{{ zipDownloading ? "打包中" : "ZIP" }}</span>
                    </button>
                  </div>
                  <el-dropdown trigger="click" class="file-more-dropdown" @command="handleFileCollectCommand($event, row)">
                    <button type="button" class="file-menu-action" :disabled="isFileCollectBusy(row)">
                      更多<el-icon><ArrowDown /></el-icon>
                    </button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="open" :disabled="isFileCollectBusy(row)">开放</el-dropdown-item>
                        <el-dropdown-item command="close" :disabled="isFileCollectBusy(row)">关闭</el-dropdown-item>
                        <el-dropdown-item command="draft" :disabled="isFileCollectBusy(row)">设为草稿</el-dropdown-item>
                        <el-dropdown-item command="delete" divided :disabled="isFileCollectBusy(row)">
                          <el-icon><Delete /></el-icon>
                          删除
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </article>
              <el-empty v-if="!fileCollections.length" :description="canAdminActiveTool ? '暂无文件收集任务' : '你还没有发起文件收集任务'" />
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
                  <small>学生提交后，可在列表中的“反馈结果”查看</small>
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
                  <el-button type="primary" :loading="gradeSaving" :disabled="gradeSaving" @click="createGradeCheck">
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
                <div class="q-row-actions grade-check-actions">
                  <el-button size="small" :disabled="isGradeCheckBusy(row)" @click="copyGradeLink(row)">
                    <el-icon><Link /></el-icon>
                    复制链接
                  </el-button>
                  <el-button size="small" :loading="isGradeCheckBusy(row)" :disabled="isGradeCheckBusy(row) || !row.feedbackQuestionnaireSlug" @click="openGradeFeedback(row)">
                    <el-icon><DataAnalysis /></el-icon>
                    反馈结果
                  </el-button>
                  <el-dropdown trigger="click" @command="handleGradeCommand($event, row)">
                    <el-button size="small" :loading="isGradeCheckBusy(row)" :disabled="isGradeCheckBusy(row)">
                      更多<el-icon><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="open" :disabled="isGradeCheckBusy(row)">开放</el-dropdown-item>
                        <el-dropdown-item command="close" :disabled="isGradeCheckBusy(row)">关闭</el-dropdown-item>
                        <el-dropdown-item command="draft" :disabled="isGradeCheckBusy(row)">设为草稿</el-dropdown-item>
                        <el-dropdown-item command="delete" divided :disabled="isGradeCheckBusy(row)">
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

          <ToolAccessSettings
            v-if="canAdminActiveTool"
            description="开启后，未登录用户不能打开或提交当前小工具。"
            :visible="Boolean(currentToolMeta?.isVisible)"
            :visible-text="currentToolMeta?.isVisible ? '当前会显示在小工具入口中' : '当前已从小工具入口中隐藏'"
            :require-login="Boolean(currentToolMeta?.requireLogin)"
            :require-login-text="currentToolMeta?.requireLogin ? '当前需要登录' : '当前允许游客使用'"
            :allow-public-manage="Boolean(currentToolMeta?.allowPublicManage)"
            :public-manage-text="currentToolMeta?.allowPublicManage ? '所有登录用户可进入并管理自己创建的内容' : '仅管理器可进入管理'"
            :saving="settingSaving"
            @change:visible="saveToolVisibilitySetting"
            @change:require-login="saveToolSetting"
            @change:public-manage="savePublicManageSetting"
          />

          <ToolManagerPanel
            v-if="canAdminActiveTool"
            v-model:username="managerUsername"
            description="被分配后可进入此页面管理当前小工具。"
            :managers="managers"
            :saving="managerSaving"
            :removing-id="managerRemovingId"
            @add="addManager"
            @remove="removeManager"
          />
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
            <el-button class="builder-desktop-action" :loading="saving" :disabled="saving" @click="submitEditor('draft')">保存草稿</el-button>
            <el-button class="builder-desktop-action" type="primary" plain :loading="saving" :disabled="saving" @click="submitEditor()">保存</el-button>
            <el-button class="builder-desktop-action" type="primary" :loading="saving" :disabled="saving" @click="submitEditor('open')">保存并开放</el-button>
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

        <section class="mobile-publish-card builder-mobile-only">
          <div class="mobile-publish-head">
            <div>
              <b>发布设置</b>
              <span>{{ statusText(form.status) }} · {{ form.visibility === "login" ? "登录填写" : "公开填写" }}</span>
            </div>
            <strong>{{ form.fields.length }} 题</strong>
          </div>
          <div class="mobile-publish-grid">
            <el-select v-model="form.status" aria-label="问卷状态">
              <el-option label="草稿" value="draft" />
              <el-option label="开放" value="open" />
              <el-option label="关闭" value="closed" />
            </el-select>
            <el-select v-model="form.visibility" aria-label="填写权限">
              <el-option label="公开填写" value="public" />
              <el-option label="登录后填写" value="login" />
            </el-select>
          </div>
          <div class="mobile-publish-checks">
            <el-checkbox v-model="form.allowAnonymous">匿名</el-checkbox>
            <el-checkbox v-model="form.oneResponsePerUser">限每人一次</el-checkbox>
          </div>
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
                <div v-if="field.type === 'single'" class="branch-editor">
                  <div class="branch-head">
                    <b>选项分支</b>
                    <span>默认继续下一题，可让某个选项提前结束问卷。</span>
                  </div>
                  <div v-if="editableOptions(field).length" class="branch-rule-list">
                    <div v-for="option in editableOptions(field)" :key="option" class="branch-rule-row">
                      <span>{{ option }}</span>
                      <el-select
                        :model-value="branchRuleAction(field, option)"
                        @update:model-value="setBranchRuleAction(field, option, $event as EditableBranchAction, index)"
                      >
                        <el-option label="继续下一题" value="next" />
                        <el-option label="结束问卷" value="end" />
                        <el-option label="跳到后面的题" value="jump" :disabled="!branchTargetOptions(index).length" />
                      </el-select>
                      <el-select
                        v-if="branchRuleAction(field, option) === 'jump'"
                        :model-value="field.branching[option]?.targetId || ''"
                        placeholder="选择目标题"
                        @update:model-value="setBranchRuleTarget(field, option, String($event))"
                      >
                        <el-option
                          v-for="target in branchTargetOptions(index)"
                          :key="target.id"
                          :label="target.label"
                          :value="target.id"
                        />
                      </el-select>
                    </div>
                  </div>
                  <p v-else>先在上方填写选项，再配置分支。</p>
                </div>
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
                  <button type="button" @click="addField('single', index)">
                    <el-icon><Plus /></el-icon>
                    下方加题
                  </button>
                  <button type="button" class="danger" @click="removeField(index)">
                    <el-icon><Delete /></el-icon>
                    删除
                  </button>
                </div>
              </div>
            </article>
            <el-empty v-if="!form.fields.length" description="从题型条添加题目" />
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

      <div class="builder-mobile-savebar builder-mobile-only">
        <el-button :loading="saving" :disabled="saving" @click="submitEditor('draft')">草稿</el-button>
        <el-button type="primary" plain :loading="saving" :disabled="saving" @click="submitEditor()">保存</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="submitEditor('open')">开放</el-button>
      </div>
    </el-dialog>

    <el-drawer v-model="previewOpen" title="问卷预览" size="min(760px, 92dvw)">
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

    <el-dialog v-model="responsesOpen" width="min(920px, 96dvw)" class="responsive-tool-dialog">
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

    <el-dialog v-model="fileSubmissionsOpen" width="min(920px, 96dvw)" class="responsive-tool-dialog">
      <template #header>
        <div class="responses-title">
          <div>
            <b>{{ fileSubmissionTask?.title || "提交记录" }}</b>
            <span>{{ fileSubmissions.length }} 份提交</span>
          </div>
          <el-button v-if="fileSubmissionTask" size="small" plain @click="copyFileCollectLink(fileSubmissionTask)">
            <el-icon><Link /></el-icon>
            复制提交链接
          </el-button>
          <el-button v-if="fileSubmissionTask" size="small" plain :loading="fileNameRepairing" :disabled="fileNameRepairing" @click="repairFileCollectionFilenames(fileSubmissionTask)">
            <el-icon><Refresh /></el-icon>
            修复乱码文件名
          </el-button>
        </div>
      </template>
      <div v-loading="fileSubmissionLoading" class="responses-list">
        <article v-for="item in fileSubmissions" :key="item.id" class="response-card">
          <div class="response-head">
            <div>
              <b>{{ item.identity || `提交 #${item.id}` }}</b>
              <span>{{ fmtDate(item.createdAt) }} · {{ item.files.length }} 个文件</span>
            </div>
            <el-button text type="danger" :loading="fileSubmissionDeletingId === item.id" :disabled="fileSubmissionDeletingId === item.id" @click="deleteFileSubmission(item.id)">删除</el-button>
          </div>
          <div class="answer-list">
            <div v-for="field in fileSubmissionTask?.fields || []" :key="field.id" class="answer-row">
              <span>{{ field.label }}</span>
              <b>{{ item.data[field.id] || "-" }}</b>
            </div>
          </div>
          <div class="file-download-list">
            <button
              v-for="file in item.files"
              :key="file.id"
              type="button"
              :class="{ busy: isFileTransferBusy(file.id) }"
              :disabled="isFileTransferBusy(file.id)"
              :aria-busy="isFileTransferBusy(file.id)"
              @click="downloadFileCollectFile(file.id, file.storedName)"
            >
              <el-icon><Download /></el-icon>
              <span>{{ fileDownloadingId === file.id ? "下载中" : file.storedName }}</span>
              <small>{{ formatBytes(file.size) }}</small>
            </button>
          </div>
        </article>
        <el-empty v-if="!fileSubmissions.length" description="暂无提交记录" />
      </div>
    </el-dialog>

    <FileCollectFileManagerDialog
      v-model="fileManagerOpen"
      :task="fileManagerTask"
      :submissions="fileManagerSubmissions"
      :loading="fileSubmissionLoading"
      :zip-downloading="zipDownloading"
      :file-name-repairing="fileNameRepairing"
      :deleting-id="fileDeletingId"
      :downloading-id="fileDownloadingId"
      :previewing-id="filePreviewingId"
      @download-zip="downloadFileCollectionZip"
      @repair-names="repairFileCollectionFilenames"
      @preview-file="previewFileCollectFile"
      @download-file="downloadFileCollectFile"
      @delete-file="deleteFileCollectFile"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
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
  Refresh,
  Star,
  Tickets,
  UploadFilled,
  View,
} from "@element-plus/icons-vue";
import {
  toolsApi,
  type FileCollectStatus,
  type FileCollectSubmission,
  type FileCollectTask,
  type FileCollectTemplate,
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
import {
  fetchFileCollectAccess,
  fetchFileCollectBlob,
  openDirectFileAccess,
  requestMessage,
  saveBlob,
} from "@/views/services/fileCollectFiles";
import {
  buildZip,
  formatBytes,
  uniqueZipPath,
  zipEntryPath,
  zipSafePathSegment,
  type FileCollectZipEntry,
} from "@/views/services/fileCollectExport";
import {
  applyFileTemplateToForm,
  buildFieldVariableToken as buildFileCollectFieldVariableToken,
  buildFileCollectionPayload,
  buildFileCollectionTemplatePayload,
  buildFileTemplateOptions,
  builtInFileCollectTemplates,
  createDefaultFileCollectForm,
  fileCollectVariableFields as buildFileCollectVariableFields,
  fileFolderQuickTokens,
  fileRenameQuickTokens,
  getFileCollectValidationMessage,
  makeFileCollectField,
  normalizeFileCollectFields as normalizeEditableFileCollectFields,
  syncRenameInsertFields as syncFileRenameInsertFields,
  type FileCollectTemplateDraft,
  type RenameInsertState,
} from "@/views/services/fileCollectManage";
import {
  branchRuleAction,
  branchTargetOptions as buildBranchTargetOptions,
  buildFieldStat as buildQuestionnaireFieldStat,
  buildFields as buildQuestionnaireFields,
  cloneEditableField,
  csvEscape,
  duplicateQuestionnaireFields,
  editableOptions,
  formatAnswer,
  getEditorValidationMessage,
  makeEditableField,
  normalizeEditableField,
  normalizeField,
  ratingRange,
  sanitizeFilename,
  setBranchRuleAction as updateBranchRuleAction,
  setBranchRuleTarget,
  toEditableField,
  type EditableBranchAction,
  type EditableField,
  type FieldStat,
} from "@/views/services/questionnaireManage";
import FileCollectFileManagerDialog from "@/views/services/components/FileCollectFileManagerDialog.vue";
import ToolAccessSettings from "@/views/services/components/ToolAccessSettings.vue";
import ToolManagerPanel from "@/views/services/components/ToolManagerPanel.vue";

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
const questionnaireBusyId = ref<number | null>(null);
const managers = ref<ToolManager[]>([]);
const managerUsername = ref("");
const managerSaving = ref(false);
const managerRemovingId = ref<number | null>(null);
const settingSaving = ref(false);
const gradeChecks = ref<GradeCheckTable[]>([]);
const gradeCheckBusyId = ref<number | null>(null);
const gradeSaving = ref(false);
const gradeFileName = ref("");
const fileCollections = ref<FileCollectTask[]>([]);
const fileCollectBusyId = ref<number | null>(null);
const fileCollectTemplates = ref<FileCollectTemplate[]>([]);
const fileCollectTemplateKey = ref("builtin:student");
const fileCollectSaving = ref(false);
const fileCollectTemplateSaving = ref(false);
const fileSubmissionLoading = ref(false);
const fileSubmissionDeletingId = ref<number | null>(null);
const fileSubmissionsOpen = ref(false);
const fileSubmissionTask = ref<FileCollectTask | null>(null);
const fileSubmissions = ref<FileCollectSubmission[]>([]);
const fileManagerOpen = ref(false);
const fileManagerTask = ref<FileCollectTask | null>(null);
const fileManagerSubmissions = ref<FileCollectSubmission[]>([]);
const fileDeletingId = ref<number | null>(null);
const fileDownloadingId = ref<number | null>(null);
const filePreviewingId = ref<number | null>(null);
const fileNameRepairing = ref(false);
let xlsxModule: typeof import("xlsx") | null = null;
const zipDownloading = ref(false);
const fileCollectForm = reactive(createDefaultFileCollectForm());
const fileRenameInsert = reactive<RenameInsertState>({
  fieldId: "name",
  mode: "whole",
  count: 2,
});
const fileFolderInsert = reactive<RenameInsertState>({
  fieldId: "name",
  mode: "whole",
  count: 2,
});
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
const fileOpenCount = computed(() => fileCollections.value.filter((item) => item.status === "open").length);
const fileTotalSubmissions = computed(() => fileCollections.value.reduce((sum, item) => sum + item.submissionCount, 0));
const fileTemplateOptions = computed<FileCollectTemplateDraft[]>(() => buildFileTemplateOptions(fileCollectTemplates.value));
const selectedFileTemplate = computed(() => fileTemplateOptions.value.find((item) => item.key === fileCollectTemplateKey.value));
const fileCollectVariableFields = computed(() => buildFileCollectVariableFields(fileCollectForm.fields));
function isFileTransferBusy(id: number) {
  return zipDownloading.value || fileDownloadingId.value === id || filePreviewingId.value === id;
}

function isFileActionDisabled(id: number) {
  return fileDeletingId.value !== null || isFileTransferBusy(id);
}

const editorTitle = computed(() => editorMode.value === "create" ? "新建问卷" : "编辑问卷");
const requiredCount = computed(() => form.fields.filter((field) => field.required).length);
const responseStats = computed<FieldStat[]>(() => activeResponseFields.value.map((field) => buildQuestionnaireFieldStat(field, responses.value)));

onMounted(init);

async function init() {
  loading.value = true;
  try {
    const [tools, perms] = await Promise.all([
      toolsApi.tools(),
      toolsApi.myPermissions(),
    ]);
    allTools.value = tools;
    const availableCodes = uniqueToolCodes([
      ...perms.toolCodes,
      ...(perms.adminToolCodes ?? []),
    ]);
    if (availableCodes.includes("file_collect") && availableCodes.length === 1) {
      await router.replace({ name: "service-filestore" });
      return;
    }
    manageableCodes.value = availableCodes.filter((code) => code !== "file_collect");
    adminCodes.value = (perms.adminToolCodes ?? []).filter((code) => code !== "file_collect");
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
  return (["feedback", "questionnaire", "grade_check", "file_collect", "pdf_tools"] as ServiceToolCode[]).includes(raw as ServiceToolCode)
    ? raw as ServiceToolCode
    : "";
}

function uniqueToolCodes(items: ServiceToolCode[]) {
  return Array.from(new Set(items));
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
    fileCollections.value = [];
    return;
  }
  if (activeTool.value === "file_collect") {
    const [tasks, templates] = await Promise.all([
      toolsApi.fileCollections({ manage: "1" }),
      toolsApi.fileCollectionTemplates(),
    ]);
    fileCollections.value = tasks;
    fileCollectTemplates.value = templates;
    questionnaires.value = [];
    gradeChecks.value = [];
    return;
  }
  if (activeTool.value === "pdf_tools") {
    questionnaires.value = [];
    gradeChecks.value = [];
    fileCollections.value = [];
    return;
  }
  const questionnaireList = await toolsApi.questionnaires({ toolCode: activeTool.value, manage: "1" });
  questionnaires.value = questionnaireList;
  gradeChecks.value = [];
  fileCollections.value = [];
}

function openPdfTool() {
  router.push("/services/tools/pdf_tools");
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

async function saveToolVisibilitySetting(value: string | number | boolean) {
  settingSaving.value = true;
  const previous = !Boolean(value);
  try {
    const updated = await toolsApi.updateToolSetting(activeTool.value, { isVisible: Boolean(value) });
    const target = currentToolMeta.value;
    if (target) target.isVisible = updated.isVisible;
    ElMessage.success(updated.isVisible ? "已显示在工具列表中" : "已从工具列表中隐藏");
  } catch (e) {
    const target = currentToolMeta.value;
    if (target) target.isVisible = previous;
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

function addField(type: QuestionnaireFieldType = "text", afterIndex?: number) {
  const field = makeEditableField(type);
  if (typeof afterIndex === "number") form.fields.splice(afterIndex + 1, 0, field);
  else form.fields.push(field);
}

function duplicateField(index: number) {
  const source = form.fields[index];
  if (!source) return;
  form.fields.splice(index + 1, 0, cloneEditableField(source));
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
  if (saving.value) return;
  if (statusOverride) form.status = statusOverride;
  const fields = buildQuestionnaireFields(form.fields);
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

function branchTargetOptions(index: number) {
  return buildBranchTargetOptions(form.fields, index);
}

function setBranchRuleAction(field: EditableField, option: string, action: EditableBranchAction, index: number) {
  updateBranchRuleAction(field, option, action, branchTargetOptions(index));
}

function validateEditor(fields: QuestionnaireField[]) {
  const message = getEditorValidationMessage(form.title, fields);
  if (!message) return true;
  ElMessage.warning(message);
  return false;
}

function isQuestionnaireBusy(row: Questionnaire) {
  return questionnaireBusyId.value === row.id;
}

async function runQuestionnaireAction(row: Questionnaire, action: () => Promise<void>) {
  if (questionnaireBusyId.value !== null) return;
  questionnaireBusyId.value = row.id;
  try {
    await action();
  } finally {
    questionnaireBusyId.value = null;
  }
}

async function handleQuestionnaireCommand(command: string | number | object, row: Questionnaire) {
  const action = String(command);
  if (action === "link") return copyLink(row);
  if (action === "duplicate") return duplicateQuestionnaire(row);
  if (questionnaireBusyId.value !== null) return;
  if (action === "delete") {
    await runQuestionnaireAction(row, async () => {
      const ok = await ElMessageBox.confirm(`删除问卷“${row.title}”？答卷也会一起删除。`, "确认删除", { type: "warning" })
        .then(() => true).catch(() => false);
      if (!ok) return;
      await toolsApi.deleteQuestionnaire(row.id);
      ElMessage.success("已删除");
      await reloadActive();
    });
  } else {
    await runQuestionnaireAction(row, async () => {
      const status = action === "open" ? "open" : action === "close" ? "closed" : "draft";
      await toolsApi.updateQuestionnaire(row.id, { status });
      ElMessage.success("状态已更新");
      await reloadActive();
    });
  }
}

async function duplicateQuestionnaire(row: Questionnaire) {
  await runQuestionnaireAction(row, async () => {
    const source = row.fields ? row : await toolsApi.questionnaire(row.slug);
    await toolsApi.createQuestionnaire({
      toolCode: "questionnaire",
      title: `${source.title} 副本`,
      description: source.description ?? undefined,
      status: "draft",
      visibility: source.visibility,
      allowAnonymous: source.allowAnonymous,
      oneResponsePerUser: source.oneResponsePerUser,
      fields: duplicateQuestionnaireFields(source),
    });
    ElMessage.success("已复制为草稿");
    await reloadActive();
  });
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
    const XLSX = await loadXlsx();
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
  if (gradeSaving.value) return;
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

function isGradeCheckBusy(row: GradeCheckTable) {
  return gradeCheckBusyId.value === row.id;
}

async function runGradeCheckAction(row: GradeCheckTable, action: () => Promise<void>) {
  if (gradeCheckBusyId.value !== null) return;
  gradeCheckBusyId.value = row.id;
  try {
    await action();
  } finally {
    gradeCheckBusyId.value = null;
  }
}

async function handleGradeCommand(command: string | number | object, row: GradeCheckTable) {
  const action = String(command);
  if (gradeCheckBusyId.value !== null) return;
  if (action === "delete") {
    await runGradeCheckAction(row, async () => {
      const ok = await ElMessageBox.confirm(`删除查询表“${row.title}”？关联的反馈问卷和已提交答卷也会一起删除。`, "确认删除", { type: "warning" })
        .then(() => true).catch(() => false);
      if (!ok) return;
      await toolsApi.deleteGradeCheck(row.id);
      ElMessage.success("已删除查询表和关联反馈");
      await reloadActive();
    });
  } else {
    await runGradeCheckAction(row, async () => {
      const status = action === "open" ? "open" : action === "close" ? "closed" : "draft";
      await toolsApi.updateGradeCheck(row.id, { status });
      ElMessage.success("状态已更新");
      await reloadActive();
    });
  }
}

function copyGradeLink(row: GradeCheckTable) {
  const path = `${window.location.origin}/services/tools/grade-checks/${row.slug}`;
  navigator.clipboard?.writeText(path).then(
    () => ElMessage.success("链接已复制"),
    () => ElMessage.info(path)
  );
}

async function openGradeFeedback(row: GradeCheckTable) {
  if (!row.feedbackQuestionnaireSlug) {
    ElMessage.info("该查询表暂未生成反馈问卷");
    return;
  }
  await runGradeCheckAction(row, async () => {
    const feedback = await toolsApi.questionnaire(row.feedbackQuestionnaireSlug!);
    await openResponses(feedback);
  });
}

function applyFileTemplate(template: FileCollectTemplateDraft, resetTitle = false) {
  applyFileTemplateToForm(fileCollectForm, template, resetTitle);
  syncRenameInsertFields();
}

function applySelectedFileTemplate() {
  const template = selectedFileTemplate.value;
  if (!template) return;
  applyFileTemplate(template);
  ElMessage.success("已套用模板");
}

function insertRenameToken(token: string) {
  fileCollectForm.renameTemplate = `${fileCollectForm.renameTemplate || ""}${token}`;
}

function insertFolderToken(token: string) {
  fileCollectForm.folderTemplate = `${fileCollectForm.folderTemplate || ""}${token}`;
}

function insertRenameVariable() {
  const token = makeFieldVariableToken(fileRenameInsert);
  if (token) insertRenameToken(token);
}

function insertFolderVariable() {
  const token = makeFieldVariableToken(fileFolderInsert);
  if (token) insertFolderToken(token);
}

function makeFieldVariableToken(state: RenameInsertState) {
  const result = buildFileCollectFieldVariableToken(state, fileCollectVariableFields.value);
  if (result.message) ElMessage.warning(result.message);
  return result.token;
}

function syncRenameInsertFields() {
  syncFileRenameInsertFields([fileRenameInsert, fileFolderInsert], fileCollectVariableFields.value);
}

async function saveCurrentFileTemplate() {
  if (fileCollectTemplateSaving.value) return;
  fileCollectTemplateSaving.value = true;
  try {
    const fields = normalizeFileCollectFields();
    if (!fields.length || fields.some((field) => !field.id || !field.label)) {
      ElMessage.warning("请先完善填写字段");
      return;
    }
    const name = await ElMessageBox.prompt("给这个模板起个名字", "保存模板", {
      inputValue: fileCollectForm.title.trim() || "我的文件收集模板",
      inputPattern: /^.{1,60}$/,
      inputErrorMessage: "模板名称需在 1-60 个字符内",
    }).then((result) => result.value.trim()).catch(() => "");
    if (!name) return;

    const created = await toolsApi.createFileCollectionTemplate(buildFileCollectionTemplatePayload(name, fileCollectForm));
    fileCollectTemplates.value = [created, ...fileCollectTemplates.value];
    fileCollectTemplateKey.value = `custom:${created.id}`;
    ElMessage.success("模板已保存");
  } finally {
    fileCollectTemplateSaving.value = false;
  }
}

async function deleteSelectedFileTemplate() {
  const template = selectedFileTemplate.value;
  if (!template?.customId || fileCollectTemplateSaving.value) return;
  fileCollectTemplateSaving.value = true;
  try {
    const ok = await ElMessageBox.confirm(`删除模板“${template.name}”？`, "确认删除", { type: "warning" })
      .then(() => true).catch(() => false);
    if (!ok) return;
    await toolsApi.deleteFileCollectionTemplate(template.customId);
    fileCollectTemplates.value = fileCollectTemplates.value.filter((item) => item.id !== template.customId);
    fileCollectTemplateKey.value = "builtin:student";
    ElMessage.success("模板已删除");
  } finally {
    fileCollectTemplateSaving.value = false;
  }
}

function addFileCollectField() {
  const field = makeFileCollectField(fileCollectForm.fields.length);
  fileCollectForm.fields.push(field);
  fileRenameInsert.fieldId = field.id;
  fileFolderInsert.fieldId = field.id;
}

function removeFileCollectField(index: number) {
  fileCollectForm.fields.splice(index, 1);
  syncRenameInsertFields();
}

function normalizeFileCollectFields() {
  return normalizeEditableFileCollectFields(fileCollectForm.fields);
}

function validateFileCollectForm() {
  const message = getFileCollectValidationMessage(fileCollectForm);
  if (message) {
    ElMessage.warning(message);
    return false;
  }
  return true;
}

async function createFileCollection() {
  if (fileCollectSaving.value) return;
  if (!validateFileCollectForm()) return;
  fileCollectSaving.value = true;
  try {
    await toolsApi.createFileCollection(buildFileCollectionPayload(fileCollectForm));
    ElMessage.success(fileCollectForm.status === "open" ? "收集任务已创建并开放" : "收集任务已创建");
    resetFileCollectForm();
    await reloadActive();
  } finally {
    fileCollectSaving.value = false;
  }
}

function resetFileCollectForm() {
  fileCollectTemplateKey.value = "builtin:student";
  applyFileTemplate(builtInFileCollectTemplates[0], true);
}

function copyFileCollectLink(row: FileCollectTask) {
  const link = `${window.location.origin}/filestore/submit/${row.slug}`;
  navigator.clipboard?.writeText(link).then(
    () => ElMessage.success("链接已复制"),
    () => ElMessage.info(link)
  );
}

async function handleFileCollectCommand(command: string | number | object, row: FileCollectTask) {
  const action = String(command);
  if (fileCollectBusyId.value !== null) return;
  if (action === "delete") {
    await runFileCollectAction(row, async () => {
      const ok = await ElMessageBox.confirm(`删除收集任务“${row.title}”？提交记录和文件也会一起删除。`, "确认删除", { type: "warning" })
        .then(() => true).catch(() => false);
      if (!ok) return;
      await toolsApi.deleteFileCollection(row.id);
      ElMessage.success("已删除");
      await reloadActive();
    });
  } else {
    await runFileCollectAction(row, async () => {
      const status = action === "open" ? "open" : action === "close" ? "closed" : "draft";
      await toolsApi.updateFileCollection(row.id, { status });
      ElMessage.success("状态已更新");
      await reloadActive();
    });
  }
}

function isFileCollectBusy(row: FileCollectTask) {
  return fileCollectBusyId.value === row.id;
}

async function runFileCollectAction(row: FileCollectTask, action: () => Promise<void>) {
  if (fileCollectBusyId.value !== null) return;
  fileCollectBusyId.value = row.id;
  try {
    await action();
  } finally {
    fileCollectBusyId.value = null;
  }
}

async function openFileSubmissions(row: FileCollectTask) {
  if (fileSubmissionLoading.value) return;
  fileSubmissionsOpen.value = true;
  fileSubmissionLoading.value = true;
  try {
    const data = await loadFileCollectionSubmissions(row.id);
    fileSubmissionTask.value = data.task;
    fileSubmissions.value = data.list;
  } finally {
    fileSubmissionLoading.value = false;
  }
}

async function loadFileCollectionSubmissions(id: number) {
  return toolsApi.fileCollectionSubmissions(id);
}

async function deleteFileSubmission(id: number) {
  if (fileSubmissionDeletingId.value !== null) return;
  fileSubmissionDeletingId.value = id;
  try {
    const ok = await ElMessageBox.confirm("删除这条提交记录及其文件？", "确认删除", { type: "warning" })
      .then(() => true).catch(() => false);
    if (!ok) return;
    await toolsApi.deleteFileCollectionSubmission(id);
    fileSubmissions.value = fileSubmissions.value.filter((item) => item.id !== id);
    ElMessage.success("已删除");
    await reloadActive();
  } finally {
    fileSubmissionDeletingId.value = null;
  }
}

async function openFileManager(row: FileCollectTask) {
  if (fileSubmissionLoading.value) return;
  fileManagerOpen.value = true;
  fileSubmissionLoading.value = true;
  try {
    const data = await loadFileCollectionSubmissions(row.id);
    fileManagerTask.value = data.task;
    fileManagerSubmissions.value = data.list;
  } finally {
    fileSubmissionLoading.value = false;
  }
}

async function refreshFileCollectionDetail(id: number) {
  const data = await loadFileCollectionSubmissions(id);
  if (fileSubmissionTask.value?.id === id) {
    fileSubmissionTask.value = data.task;
    fileSubmissions.value = data.list;
  }
  if (fileManagerTask.value?.id === id) {
    fileManagerTask.value = data.task;
    fileManagerSubmissions.value = data.list;
  }
}

async function repairFileCollectionFilenames(row: FileCollectTask) {
  if (fileNameRepairing.value) return;
  const ok = await ElMessageBox.confirm(
    "系统会尝试恢复由上传编码导致的历史乱码文件名，只更新可明确恢复的原始名和展示名，不移动实际文件。继续？",
    "修复乱码文件名",
    { type: "warning", confirmButtonText: "开始修复" },
  ).then(() => true).catch(() => false);
  if (!ok) return;
  fileNameRepairing.value = true;
  try {
    const result = await toolsApi.repairFileCollectionFilenames(row.id);
    await refreshFileCollectionDetail(row.id);
    await reloadActive();
    const lostText = result.unrecoverable ? `，${result.unrecoverable} 个已丢失编码信息无法自动恢复` : "";
    ElMessage.success(result.updated ? `已恢复 ${result.updated} 个文件名${lostText}` : `没有发现可恢复的乱码文件名${lostText}`);
  } catch (error) {
    ElMessage.error(requestMessage(error) || "修复失败");
  } finally {
    fileNameRepairing.value = false;
  }
}

async function deleteFileCollectFile(id: number) {
  if (fileDeletingId.value !== null) return;
  fileDeletingId.value = id;
  try {
    const ok = await ElMessageBox.confirm("删除这个文件？提交记录会保留，但该文件无法恢复。", "确认删除", { type: "warning" })
      .then(() => true).catch(() => false);
    if (!ok) return;
    await toolsApi.deleteFileCollectionFile(id);
    fileManagerSubmissions.value = fileManagerSubmissions.value.map((submission) => ({
      ...submission,
      files: submission.files.filter((file) => file.id !== id),
    }));
    fileSubmissions.value = fileSubmissions.value.map((submission) => ({
      ...submission,
      files: submission.files.filter((file) => file.id !== id),
    }));
    ElMessage.success("文件已删除");
    await reloadActive();
  } finally {
    fileDeletingId.value = null;
  }
}

async function downloadFileCollectFile(id: number, filename: string) {
  if (isFileActionDisabled(id)) return;
  fileDownloadingId.value = id;
  try {
    ElMessage.info("正在获取下载链接...");
    const access = await fetchFileCollectAccess(id, "download");
    if (access.backend === "onedrive-cn" && access.url) {
      openDirectFileAccess(access.url, access.filename || filename, "download");
      ElMessage.success("已向浏览器发起下载，请查看下载列表");
      return;
    }
    const blob = await fetchFileCollectBlob(id, "download");
    saveBlob(blob, filename);
    ElMessage.success("已向浏览器发起下载，请查看下载列表");
  } catch (error) {
    ElMessage.error(requestMessage(error) || "下载失败");
  } finally {
    fileDownloadingId.value = null;
  }
}

async function previewFileCollectFile(id: number, filename: string) {
  if (isFileActionDisabled(id)) return;
  filePreviewingId.value = id;
  try {
    const access = await fetchFileCollectAccess(id, "preview");
    if (access.url) {
      openDirectFileAccess(access.url, access.filename || filename, "preview");
      return;
    }
    if (access.previewMessage) {
      ElMessage.warning(access.previewMessage);
      return;
    }
    const blob = await fetchFileCollectBlob(id, "preview");
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) ElMessage.info(filename);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    ElMessage.error(requestMessage(error) || "预览失败");
  } finally {
    filePreviewingId.value = null;
  }
}

async function downloadFileCollectionZip(row: FileCollectTask) {
  if (zipDownloading.value) return;
  zipDownloading.value = true;
  try {
    const data = await loadFileCollectionSubmissions(row.id);
    const fileCount = data.list.reduce((sum, submission) => sum + submission.files.length, 0);
    if (!fileCount) {
      ElMessage.info("当前任务还没有可下载的文件");
      return;
    }
    const entries: FileCollectZipEntry[] = [];
    const usedPaths = new Set<string>();
    let current = 0;
    for (const submission of data.list) {
      for (const file of submission.files) {
        current += 1;
        ElMessage.info(`正在读取文件 ${current}/${fileCount}`);
        const blob = await fetchFileCollectBlob(file.id, "download");
        entries.push({
          path: uniqueZipPath(zipEntryPath(data.task, submission, file), usedPaths),
          bytes: new Uint8Array(await blob.arrayBuffer()),
          date: new Date(submission.createdAt || Date.now()),
        });
      }
    }
    saveBlob(buildZip(entries), `${zipSafePathSegment(data.task.title)}.zip`);
    ElMessage.success("ZIP 已生成");
  } finally {
    zipDownloading.value = false;
  }
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

async function downloadGradeTemplate() {
  const XLSX = await loadXlsx();
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

async function loadXlsx() {
  if (!xlsxModule) xlsxModule = await import("xlsx");
  return xlsxModule;
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
  if (managerSaving.value || managerRemovingId.value !== null) return;
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
  if (managerSaving.value || managerRemovingId.value !== null) return;
  managerRemovingId.value = userId;
  try {
    const ok = await ElMessageBox.confirm("移除该用户的小工具管理权限？", "确认", { type: "warning" })
      .then(() => true).catch(() => false);
    if (!ok) return;
    await toolsApi.removeManager(activeTool.value, userId);
    ElMessage.success("已移除");
    await reloadActive();
  } finally {
    managerRemovingId.value = null;
  }
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

function statusText(status: QuestionnaireStatus | GradeCheckStatus | FileCollectStatus) {
  if (status === "open") return "开放";
  if (status === "closed") return "关闭";
  return "草稿";
}

function statusTag(status: QuestionnaireStatus | GradeCheckStatus | FileCollectStatus): "success" | "info" | "warning" {
  if (status === "open") return "success";
  if (status === "closed") return "info";
  return "warning";
}

function fieldTypeText(type: QuestionnaireFieldType) {
  return fieldTypeOptions.find((item) => item.value === type)?.label ?? type;
}
</script>

<style scoped src="./styles/tool-manage-shell.css"></style>
<style scoped src="./styles/tool-manage-admin.css"></style>
<style scoped src="./styles/tool-manage-builder.css"></style>
<style scoped src="./styles/tool-manage-results.css"></style>
<style scoped src="./styles/tool-manage-files.css"></style>
<style scoped src="./styles/tool-manage-responsive.css"></style>
