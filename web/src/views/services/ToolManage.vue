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
        <el-button plain type="primary" @click="$router.push('/services/tools/qqbot-reminders')">
          <el-icon><Bell /></el-icon>
          提醒设置
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

        <div v-if="activeTool === 'file_collect'" class="tool-admin-grid permission-only-grid">
          <section class="admin-section questionnaire-section">
            <div class="section-head">
              <div>
                <h3>文件收集</h3>
                <p>文件收集管理端已经接入 Filestore。任务创建、收件统计、文件浏览和导出都在工作台里完成，这里负责统一维护入口权限和管理器。</p>
              </div>
              <el-button type="primary" @click="openFilestoreTool">
                <el-icon><View /></el-icon>
                打开工作台
              </el-button>
            </div>
            <div class="empty-panel">
              {{ canAdminActiveTool ? "可在这里决定是否展示工具、是否要求登录，以及是否允许所有登录用户进入后只管理自己创建的任务。" : "你可以进入工作台创建和管理自己发起的文件收集任务；工具入口和权限开关由管理器维护。" }}
            </div>
          </section>

          <section v-if="canAdminActiveTool" class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>使用权限</h3>
                <p>可决定文件收集是否显示在小工具入口中，以及是否向所有登录用户开放“只管理自己任务”的工作台。</p>
              </div>
            </div>
            <div class="access-setting">
              <div>
                <b>展示在工具列表</b>
                <span>{{ currentToolMeta?.isVisible ? "当前会显示在小工具入口中" : "当前已从小工具入口中隐藏" }}</span>
              </div>
              <el-switch
                v-model="toolVisible"
                :loading="settingSaving"
                @change="saveToolVisibilitySetting"
              />
            </div>
            <div class="access-setting">
              <div>
                <b>登录后使用</b>
                <span>{{ currentToolMeta?.requireLogin ? "当前需要登录" : "当前允许游客打开工具详情页" }}</span>
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
                <span>{{ currentToolMeta?.allowPublicManage ? "所有登录用户都可进入工作台，但只能看到并管理自己创建的任务" : "仅管理器可进入文件收集工作台" }}</span>
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
                <p>被分配后可维护文件收集入口设置、全局模板，并查看全部任务。</p>
              </div>
            </div>
            <div class="add-manager">
              <el-input v-model="managerUsername" placeholder="输入用户名" clearable :disabled="managerSaving || managerRemovingId !== null" @keyup.enter="addManager" />
              <el-button type="primary" :loading="managerSaving" :disabled="managerSaving || managerRemovingId !== null || !managerUsername.trim()" @click="addManager">添加</el-button>
            </div>
            <div class="manager-list">
              <div v-for="manager in managers" :key="manager.id" class="manager-row">
                <div>
                  <b>{{ manager.user.nickname || manager.user.username }}</b>
                  <span>{{ manager.user.username }}</span>
                </div>
                <el-button text type="danger" :loading="managerRemovingId === manager.user.id" :disabled="managerSaving || managerRemovingId !== null" @click="removeManager(manager.user.id)">移除</el-button>
              </div>
              <el-empty v-if="!managers.length" description="暂无单独分配的管理器" />
            </div>
          </section>
        </div>

        <div v-else-if="activeTool === 'pdf_tools'" class="tool-admin-grid permission-only-grid">
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

          <section v-if="canAdminActiveTool" class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>使用权限</h3>
                <p>可决定 PDF 工具是否展示在小工具入口，以及是否要求登录后使用。</p>
              </div>
            </div>
            <div class="access-setting">
              <div>
                <b>展示在工具列表</b>
                <span>{{ currentToolMeta?.isVisible ? "当前会显示在小工具入口中" : "当前已从小工具入口中隐藏" }}</span>
              </div>
              <el-switch
                v-model="toolVisible"
                :loading="settingSaving"
                @change="saveToolVisibilitySetting"
              />
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
          </section>

          <section v-if="canAdminActiveTool" class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>管理器</h3>
                <p>被分配后可维护 PDF 工具入口设置。</p>
              </div>
            </div>
            <div class="add-manager">
              <el-input v-model="managerUsername" placeholder="输入用户名" clearable :disabled="managerSaving || managerRemovingId !== null" @keyup.enter="addManager" />
              <el-button type="primary" :loading="managerSaving" :disabled="managerSaving || managerRemovingId !== null || !managerUsername.trim()" @click="addManager">添加</el-button>
            </div>
            <div class="manager-list">
              <div v-for="manager in managers" :key="manager.id" class="manager-row">
                <div>
                  <b>{{ manager.user.nickname || manager.user.username }}</b>
                  <span>{{ manager.user.username }}</span>
                </div>
                <el-button text type="danger" :loading="managerRemovingId === manager.user.id" :disabled="managerSaving || managerRemovingId !== null" @click="removeManager(manager.user.id)">移除</el-button>
              </div>
              <el-empty v-if="!managers.length" description="暂无单独分配的管理器" />
            </div>
          </section>
        </div>

        <div v-else-if="activeTool === 'cloud_drive'" class="tool-admin-grid permission-only-grid">
          <section class="admin-section questionnaire-section">
            <div class="section-head">
              <div>
                <h3>云盘</h3>
                <p>云盘本体在小工具页里使用，这里只维护访问权限和管理器。接好世纪互联文档库后，管理器可直接在工具页上传、整理和删除文件。</p>
              </div>
              <el-button type="primary" @click="openCloudDriveTool">
                <el-icon><View /></el-icon>
                打开云盘
              </el-button>
            </div>
            <div class="empty-panel">
              共享文件目录、上传队列和预览下载都在“云盘”工具页里完成；此页面保留通用权限配置，方便控制谁能看、谁能改。
            </div>
          </section>

          <section v-if="canAdminActiveTool" class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>使用权限</h3>
                <p>可决定云盘是否需要登录浏览，以及是否允许所有登录用户一起管理文件。</p>
              </div>
            </div>
            <div class="access-setting">
              <div>
                <b>展示在工具列表</b>
                <span>{{ currentToolMeta?.isVisible ? "当前会显示在小工具入口中" : "当前已从小工具入口中隐藏" }}</span>
              </div>
              <el-switch
                v-model="toolVisible"
                :loading="settingSaving"
                @change="saveToolVisibilitySetting"
              />
            </div>
            <div class="access-setting">
              <div>
                <b>登录后使用</b>
                <span>{{ currentToolMeta?.requireLogin ? "当前需要登录" : "当前允许游客访问" }}</span>
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
                <span>{{ currentToolMeta?.allowPublicManage ? "所有登录用户都可上传和整理文件" : "仅管理器可修改文件" }}</span>
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
                <p>被分配后可直接进入云盘工具页管理目录、上传文件和删除内容。</p>
              </div>
            </div>
            <div class="add-manager">
              <el-input v-model="managerUsername" placeholder="输入用户名" clearable :disabled="managerSaving || managerRemovingId !== null" @keyup.enter="addManager" />
              <el-button type="primary" :loading="managerSaving" :disabled="managerSaving || managerRemovingId !== null || !managerUsername.trim()" @click="addManager">添加</el-button>
            </div>
            <div class="manager-list">
              <div v-for="manager in managers" :key="manager.id" class="manager-row">
                <div>
                  <b>{{ manager.user.nickname || manager.user.username }}</b>
                  <span>{{ manager.user.username }}</span>
                </div>
                <el-button text type="danger" :loading="managerRemovingId === manager.user.id" :disabled="managerSaving || managerRemovingId !== null" @click="removeManager(manager.user.id)">移除</el-button>
              </div>
              <el-empty v-if="!managers.length" description="暂无单独分配的管理器" />
            </div>
          </section>
        </div>

        <div v-else class="tool-admin-grid">
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

          <section v-else-if="false" class="admin-section questionnaire-section grade-check-section">
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

          <section v-if="canAdminActiveTool" class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>使用权限</h3>
                <p>开启后，未登录用户不能打开或提交当前小工具。</p>
              </div>
            </div>
            <div class="access-setting">
              <div>
                <b>展示在工具列表</b>
                <span>{{ currentToolMeta?.isVisible ? "当前会显示在小工具入口中" : "当前已从小工具入口中隐藏" }}</span>
              </div>
              <el-switch
                v-model="toolVisible"
                :loading="settingSaving"
                @change="saveToolVisibilitySetting"
              />
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
              <el-input v-model="managerUsername" placeholder="输入用户名" clearable :disabled="managerSaving || managerRemovingId !== null" @keyup.enter="addManager" />
              <el-button type="primary" :loading="managerSaving" :disabled="managerSaving || managerRemovingId !== null || !managerUsername.trim()" @click="addManager">添加</el-button>
            </div>
            <div class="manager-list">
              <div v-for="manager in managers" :key="manager.id" class="manager-row">
                <div>
                  <b>{{ manager.user.nickname || manager.user.username }}</b>
                  <span>{{ manager.user.username }}</span>
                </div>
                <el-button text type="danger" :loading="managerRemovingId === manager.user.id" :disabled="managerSaving || managerRemovingId !== null" @click="removeManager(manager.user.id)">移除</el-button>
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

    <el-dialog v-model="fileManagerOpen" width="min(980px, 96dvw)" class="responsive-tool-dialog file-manager-dialog">
      <template #header>
        <div class="responses-title">
          <div>
            <b>{{ fileManagerTask?.title || "文件管理" }}</b>
            <span>{{ fileManagerFiles.length }} 个文件</span>
          </div>
          <el-button v-if="fileManagerTask" size="small" plain :loading="zipDownloading" :disabled="zipDownloading" @click="downloadFileCollectionZip(fileManagerTask)">
            <el-icon><Download /></el-icon>
            下载 ZIP
          </el-button>
          <el-button v-if="fileManagerTask" size="small" plain :loading="fileNameRepairing" :disabled="fileNameRepairing" @click="repairFileCollectionFilenames(fileManagerTask)">
            <el-icon><Refresh /></el-icon>
            修复乱码文件名
          </el-button>
        </div>
      </template>
      <div class="file-manager-toolbar">
        <el-input v-model="fileManagerKeyword" clearable placeholder="搜索文件名、提交人、学号或填写内容" />
      </div>
      <div class="file-manager-list">
        <article v-for="item in fileManagerFiles" :key="item.id" class="file-manager-card">
          <div class="file-manager-main">
            <strong>{{ item.storedName }}</strong>
            <span>{{ item.folderPath }}</span>
            <small>{{ item.submission.identity || `提交 #${item.submission.id}` }} · {{ fmtDate(item.submission.createdAt) }} · {{ formatBytes(item.size) }}</small>
          </div>
          <div class="file-manager-actions">
            <button type="button" :disabled="isFileActionDisabled(item.id)" @click="previewFileCollectFile(item.id, item.storedName)">
              <el-icon><View /></el-icon>
              {{ filePreviewingId === item.id ? "预览中" : "预览" }}
            </button>
            <button type="button" :disabled="isFileActionDisabled(item.id)" @click="downloadFileCollectFile(item.id, item.storedName)">
              <el-icon><Download /></el-icon>
              {{ fileDownloadingId === item.id ? "下载中" : "下载" }}
            </button>
            <button type="button" :disabled="isFileActionDisabled(item.id)" @click="deleteFileCollectFile(item.id)">
              <el-icon><Delete /></el-icon>
              删除
            </button>
          </div>
        </article>
        <el-empty v-if="!fileManagerFiles.length" description="暂无匹配文件" />
      </div>
    </el-dialog>
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
  Bell,
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
  type FileCollectField,
  type FileCollectStatus,
  type FileCollectSubmission,
  type FileCollectTask,
  type FileCollectTemplate,
  type FileCollectVisibility,
  type GradeCheckStatus,
  type GradeCheckTable,
  type Questionnaire,
  type QuestionnaireBranchAction,
  type QuestionnaireBranchRule,
  type QuestionnaireField,
  type QuestionnaireFieldType,
  type QuestionnaireResponse,
  type QuestionnaireStatus,
  type QuestionnaireVisibility,
  type ServiceToolCode,
  type ToolManager,
  type ToolMeta,
} from "@/api/tools";
import { getToken } from "@/api/request";
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
  branching: Record<string, QuestionnaireBranchRule>;
};

type EditableBranchAction = "next" | QuestionnaireBranchAction;

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

type FileCollectTemplateDraft = {
  key: string;
  name: string;
  description?: string | null;
  visibility: FileCollectVisibility;
  fields: FileCollectField[];
  fileRules: {
    allowedTypes: string[];
    maxSizeMb: number;
    maxCount: number;
  };
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  customId?: number;
};

type RenameSliceMode = "whole" | "last" | "first";

type RenameInsertState = {
  fieldId: string;
  mode: RenameSliceMode;
  count: number;
};

type RenameQuickToken = {
  label: string;
  token: string;
  group: "system";
};

const builtInFileCollectTemplates: FileCollectTemplateDraft[] = [
  {
    key: "builtin:student",
    name: "学号模板",
    description: "适合按姓名和学号收作业、照片、报名材料。",
    visibility: "public",
    fields: [
      { id: "name", label: "姓名", required: true, placeholder: "请输入姓名" },
      { id: "student_id", label: "学号", required: true, placeholder: "请输入学号" },
    ],
    fileRules: { allowedTypes: ["pdf", "doc", "docx", "jpg", "png", "zip"], maxSizeMb: 20, maxCount: 1 },
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
    expectedEntries: "",
  },
  {
    key: "builtin:exam",
    name: "考试号模板",
    description: "适合按姓名和考试号收准考证、考试材料或确认文件。",
    visibility: "public",
    fields: [
      { id: "name", label: "姓名", required: true, placeholder: "请输入姓名" },
      { id: "student_id", label: "考试号", required: true, placeholder: "请输入考试号" },
    ],
    fileRules: { allowedTypes: ["pdf", "jpg", "png", "zip"], maxSizeMb: 20, maxCount: 1 },
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
    expectedEntries: "",
  },
];

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
const fileManagerKeyword = ref("");
let xlsxModule: typeof import("xlsx") | null = null;
const zipDownloading = ref(false);
const fileCollectForm = reactive({
  title: "",
  description: "",
  status: "open" as FileCollectStatus,
  visibility: "public" as FileCollectVisibility,
  allowedTypes: "pdf,doc,docx,jpg,png,zip",
  maxSizeMb: 20,
  maxCount: 1,
  renameTemplate: "{name}-{student_id}",
  folderTemplate: "{name}-{student_id}",
  expectedEntries: "",
  fields: [
    { localKey: "fc-name", id: "name", label: "姓名", required: true, placeholder: "请输入姓名", pattern: "" },
    { localKey: "fc-student", id: "student_id", label: "学号", required: true, placeholder: "请输入学号", pattern: "" },
  ] as Array<FileCollectField & { localKey: string }>,
});
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
const fileTemplateOptions = computed<FileCollectTemplateDraft[]>(() => [
  ...builtInFileCollectTemplates,
  ...fileCollectTemplates.value.map((item) => ({
    key: `custom:${item.id}`,
    customId: item.id,
    name: item.name,
    description: item.description,
    visibility: item.visibility,
    fields: item.fields,
    fileRules: item.fileRules,
    renameTemplate: item.renameTemplate,
    folderTemplate: item.folderTemplate,
    expectedEntries: item.expectedEntries,
  })),
]);
const selectedFileTemplate = computed(() => fileTemplateOptions.value.find((item) => item.key === fileCollectTemplateKey.value));
const fileCollectVariableFields = computed(() => normalizeFileCollectFields().filter((field) => field.id && field.label).slice(0, 20));
const fileRenameQuickTokens: RenameQuickToken[] = [
  { label: "连接符 -", token: "-", group: "system" },
  { label: "原文件名", token: "{original}", group: "system" },
  { label: "多文件序号", token: "{index}", group: "system" },
];
const fileFolderQuickTokens: RenameQuickToken[] = [
  { label: "连接符 -", token: "-", group: "system" },
];
const fileManagerFiles = computed(() => {
  const keyword = fileManagerKeyword.value.trim().toLowerCase();
  const task = fileManagerTask.value;
  return fileManagerSubmissions.value.flatMap((submission) => submission.files.map((file) => ({
    ...file,
    submission,
    folderPath: task ? zipEntryPath(task, submission, file) : file.storedName,
  }))).filter((item) => {
    if (!keyword) return true;
    const dataText = JSON.stringify(item.submission.data).toLowerCase();
    return `${item.storedName} ${item.originalName} ${item.submission.identity} ${dataText}`.toLowerCase().includes(keyword);
  });
});

function isFileTransferBusy(id: number) {
  return zipDownloading.value || fileDownloadingId.value === id || filePreviewingId.value === id;
}

function isFileActionDisabled(id: number) {
  return fileDeletingId.value !== null || isFileTransferBusy(id);
}

const editorTitle = computed(() => editorMode.value === "create" ? "新建问卷" : "编辑问卷");
const requiredCount = computed(() => form.fields.filter((field) => field.required).length);
const toolRequireLogin = computed({
  get: () => Boolean(currentToolMeta.value?.requireLogin),
  set: (value: boolean) => {
    const target = currentToolMeta.value;
    if (target) target.requireLogin = value;
  },
});
const toolVisible = computed({
  get: () => currentToolMeta.value?.isVisible !== false,
  set: (value: boolean) => {
    const target = currentToolMeta.value;
    if (target) target.isVisible = value;
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
    manageableCodes.value = uniqueToolCodes([
      ...perms.toolCodes,
      ...(perms.adminToolCodes ?? []),
    ]);
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
  return (["feedback", "questionnaire", "grade_check", "file_collect", "cloud_drive", "pdf_tools"] as ServiceToolCode[]).includes(raw as ServiceToolCode)
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
  if (activeTool.value === "cloud_drive" || activeTool.value === "pdf_tools") {
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

function openCloudDriveTool() {
  router.push("/services/tools/cloud_drive");
}

function openPdfTool() {
  router.push("/services/tools/pdf_tools");
}

function openFilestoreTool() {
  router.push("/services/tools/filestore");
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
    branching: cloneBranching(field.branching),
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
    branching: {},
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
  if (field.type === "single") {
    syncBranchRules(field);
  } else {
    field.branching = {};
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
    branching: cloneBranching(source.branching),
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
  if (saving.value) return;
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
  const options = field.type === "single" || field.type === "multiple"
    ? editableOptions(field)
    : undefined;
  const result: QuestionnaireField = {
    id: field.id,
    label: label || "未命名题目",
    type: field.type,
    required: field.required,
    placeholder: field.placeholder.trim() || undefined,
    description: field.description.trim() || undefined,
    options,
    min: field.min,
    max: field.max,
    step: field.step,
    maxLength: field.maxLength,
  };
  const branching = normalizeBranching(field, options ?? []);
  if (branching) result.branching = branching;
  return result;
}

function editableOptions(field: EditableField) {
  return field.optionsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function cloneBranching(source?: Record<string, QuestionnaireBranchRule>): Record<string, QuestionnaireBranchRule> {
  return Object.fromEntries(
    Object.entries(source ?? {}).map(([option, rule]) => [option, { ...rule }])
  );
}

function syncBranchRules(field: EditableField) {
  const options = new Set(editableOptions(field));
  for (const option of Object.keys(field.branching)) {
    if (!options.has(option)) delete field.branching[option];
  }
}

function normalizeBranching(field: EditableField, options: string[]) {
  if (field.type !== "single") return undefined;
  const optionSet = new Set(options);
  const rules: Record<string, QuestionnaireBranchRule> = {};
  for (const [option, rule] of Object.entries(field.branching)) {
    if (!optionSet.has(option)) continue;
    if (rule.action === "end") {
      rules[option] = { action: "end" };
    } else if (rule.action === "jump" && rule.targetId) {
      rules[option] = { action: "jump", targetId: rule.targetId };
    }
  }
  return Object.keys(rules).length ? rules : undefined;
}

function remapBranchingTargets(source: Record<string, QuestionnaireBranchRule> | undefined, idMap: Map<string, string>) {
  if (!source) return undefined;
  const rules: Record<string, QuestionnaireBranchRule> = {};
  for (const [option, rule] of Object.entries(source)) {
    if (rule.action === "end") {
      rules[option] = { action: "end" };
    } else if (rule.action === "jump" && rule.targetId && idMap.has(rule.targetId)) {
      rules[option] = { action: "jump", targetId: idMap.get(rule.targetId) };
    }
  }
  return Object.keys(rules).length ? rules : undefined;
}

function branchRuleAction(field: EditableField, option: string): EditableBranchAction {
  return field.branching[option]?.action ?? "next";
}

function branchTargetOptions(index: number) {
  return form.fields.slice(index + 1).map((field, offset) => ({
    id: field.id,
    label: `Q${index + offset + 2} ${field.label.trim() || "未命名题目"}`,
  }));
}

function setBranchRuleAction(field: EditableField, option: string, action: EditableBranchAction, index: number) {
  if (action === "next") {
    delete field.branching[option];
    return;
  }
  if (action === "end") {
    field.branching[option] = { action: "end" };
    return;
  }
  const currentTarget = field.branching[option]?.targetId;
  const targets = branchTargetOptions(index);
  field.branching[option] = {
    action: "jump",
    targetId: targets.some((item) => item.id === currentTarget) ? currentTarget : targets[0]?.id,
  };
}

function setBranchRuleTarget(field: EditableField, option: string, targetId: string) {
  field.branching[option] = { action: "jump", targetId };
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
  const fieldIndexById = new Map(fields.map((field, index) => [field.id, index]));
  for (const [index, field] of fields.entries()) {
    if (ids.has(field.id)) {
      ElMessage.warning(`题目 ID 重复：${field.id}`);
      return false;
    }
    ids.add(field.id);
    if ((field.type === "single" || field.type === "multiple") && (!field.options || field.options.length < 2)) {
      ElMessage.warning(`选项题“${field.label}”至少需要 2 个选项`);
      return false;
    }
    if (field.branching) {
      if (field.type !== "single") {
        ElMessage.warning(`只有单选题“${field.label}”可以配置分支`);
        return false;
      }
      const allowed = new Set(field.options ?? []);
      for (const [option, rule] of Object.entries(field.branching)) {
        if (!allowed.has(option)) {
          ElMessage.warning(`题目“${field.label}”的分支选项不存在：${option}`);
          return false;
        }
        if (rule.action === "jump") {
          const targetIndex = fieldIndexById.get(rule.targetId ?? "");
          if (targetIndex === undefined || targetIndex <= index) {
            ElMessage.warning(`题目“${field.label}”只能跳到后面的题`);
            return false;
          }
        }
      }
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
    const sourceFields = source.fields ?? [];
    const idMap = new Map(sourceFields.map((field) => [field.id, makeFieldId()]));
    await toolsApi.createQuestionnaire({
      toolCode: "questionnaire",
      title: `${source.title} 副本`,
      description: source.description ?? undefined,
      status: "draft",
      visibility: source.visibility,
      allowAnonymous: source.allowAnonymous,
      oneResponsePerUser: source.oneResponsePerUser,
      fields: sourceFields.map((field) => ({
        ...field,
        id: idMap.get(field.id) ?? makeFieldId(),
        branching: remapBranchingTargets(field.branching, idMap),
      })),
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
  if (resetTitle) {
    fileCollectForm.title = "";
    fileCollectForm.description = "";
    fileCollectForm.status = "open";
  } else if (!fileCollectForm.description.trim() && template.description) {
    fileCollectForm.description = template.description;
  }
  fileCollectForm.visibility = template.visibility;
  fileCollectForm.allowedTypes = template.fileRules.allowedTypes.join(",");
  fileCollectForm.maxSizeMb = template.fileRules.maxSizeMb;
  fileCollectForm.maxCount = template.fileRules.maxCount;
  fileCollectForm.renameTemplate = template.renameTemplate;
  fileCollectForm.folderTemplate = template.folderTemplate;
  fileCollectForm.expectedEntries = template.expectedEntries;
  fileCollectForm.fields = template.fields.map((field, index) => ({
    localKey: `fc-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    id: field.id,
    label: field.label,
    required: Boolean(field.required),
    placeholder: field.placeholder || "",
    pattern: field.pattern || "",
  }));
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
  const token = buildFieldVariableToken(fileRenameInsert);
  if (token) insertRenameToken(token);
}

function insertFolderVariable() {
  const token = buildFieldVariableToken(fileFolderInsert);
  if (token) insertFolderToken(token);
}

function buildFieldVariableToken(state: RenameInsertState) {
  const fields = fileCollectVariableFields.value;
  const fallback = fields[0]?.id || "";
  const fieldId = fields.some((field) => field.id === state.fieldId) ? state.fieldId : fallback;
  if (!fieldId) {
    ElMessage.warning("请先添加可用于命名的填写字段");
    return "";
  }
  state.fieldId = fieldId;
  if (state.mode === "whole") return `{${fieldId}}`;
  const count = clampSliceCount(state.count);
  state.count = count;
  return `{${fieldId}|${state.mode}:${count}}`;
}

function syncRenameInsertFields() {
  const fields = fileCollectVariableFields.value;
  const fallback = fields[0]?.id || "";
  for (const state of [fileRenameInsert, fileFolderInsert]) {
    if (!fallback) {
      state.fieldId = "";
    } else if (!fields.some((field) => field.id === state.fieldId)) {
      state.fieldId = fallback;
    }
  }
}

function clampSliceCount(value: number) {
  const count = Math.round(Number(value) || 1);
  return Math.min(99, Math.max(1, count));
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

    const created = await toolsApi.createFileCollectionTemplate({
      name,
      description: fileCollectForm.description.trim() || undefined,
      visibility: fileCollectForm.visibility,
      fields,
      fileRules: {
        allowedTypes: fileCollectForm.allowedTypes.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
        maxSizeMb: Number(fileCollectForm.maxSizeMb) || 20,
        maxCount: Number(fileCollectForm.maxCount) || 1,
      },
      renameTemplate: fileCollectForm.renameTemplate.trim() || "{name}-{student_id}",
      folderTemplate: fileCollectForm.folderTemplate.trim() || "{name}-{student_id}",
      expectedEntries: fileCollectForm.expectedEntries.trim() || "",
    });
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
  const id = `field_${fileCollectForm.fields.length + 1}`;
  fileCollectForm.fields.push({
    localKey: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    id,
    label: "新字段",
    required: false,
    placeholder: "",
    pattern: "",
  });
  fileRenameInsert.fieldId = id;
  fileFolderInsert.fieldId = id;
}

function removeFileCollectField(index: number) {
  fileCollectForm.fields.splice(index, 1);
  syncRenameInsertFields();
}

function normalizeFileCollectFields() {
  return fileCollectForm.fields.map((field) => ({
    id: field.id.trim(),
    label: field.label.trim(),
    required: Boolean(field.required),
    placeholder: field.placeholder?.trim() || undefined,
    pattern: field.pattern?.trim() || undefined,
  }));
}

function validateFileCollectForm() {
  if (!fileCollectForm.title.trim()) {
    ElMessage.warning("请填写收集任务标题");
    return false;
  }
  const fields = normalizeFileCollectFields();
  if (!fields.length || fields.some((field) => !field.id || !field.label)) {
    ElMessage.warning("请完善填写字段");
    return false;
  }
  if (new Set(fields.map((field) => field.id)).size !== fields.length) {
    ElMessage.warning("字段 ID 不能重复");
    return false;
  }
  const invalid = fields.find((field) => !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(field.id));
  if (invalid) {
    ElMessage.warning(`变量名“${invalid.id}”只能包含中文、英文、数字和下划线`);
    return false;
  }
  return true;
}

async function createFileCollection() {
  if (fileCollectSaving.value) return;
  if (!validateFileCollectForm()) return;
  fileCollectSaving.value = true;
  try {
    await toolsApi.createFileCollection({
      title: fileCollectForm.title.trim(),
      description: fileCollectForm.description.trim() || undefined,
      status: fileCollectForm.status,
      visibility: fileCollectForm.visibility,
      fields: normalizeFileCollectFields(),
      fileRules: {
        allowedTypes: fileCollectForm.allowedTypes.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
        maxSizeMb: Number(fileCollectForm.maxSizeMb) || 20,
        maxCount: Number(fileCollectForm.maxCount) || 1,
      },
      renameTemplate: fileCollectForm.renameTemplate.trim() || "{name}-{student_id}",
      folderTemplate: fileCollectForm.folderTemplate.trim() || "{name}-{student_id}",
      expectedEntries: fileCollectForm.expectedEntries.trim() || undefined,
    });
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
  const link = `${window.location.origin}/services/tools/file-collections/${row.slug}`;
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
    fileManagerKeyword.value = "";
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

async function fetchFileCollectBlob(id: number, action: "download" | "preview") {
  const response = await fetch(`/api/tools/file-collection-files/${id}/${action}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) {
    const fallback = action === "preview" ? "预览失败" : "下载失败";
    let message = await response.text().catch(() => "");
    try {
      const parsed = JSON.parse(message);
      message = parsed?.message || message;
    } catch {
      // Non-JSON error body; use the raw text if present.
    }
    throw new Error(message || fallback);
  }
  return response.blob();
}

type FileCollectFileAccess = {
  backend: "local" | "onedrive-cn";
  url: string;
  viewer?: "office" | "onedrive" | null;
  previewMessage?: string;
  filename?: string;
  mimeType?: string;
};

async function fetchFileCollectAccess(id: number, action: "download" | "preview") {
  const response = await fetch(`/api/tools/file-collection-files/${id}/access?action=${action}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || (action === "preview" ? "预览失败" : "下载失败"));
  }
  return payload as FileCollectFileAccess;
}

function openDirectFileAccess(url: string, filename: string, action: "download" | "preview") {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  if (action === "preview") anchor.target = "_blank";
  if (action === "download" && filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function requestMessage(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof responseMessage === "string") return responseMessage;
  }
  return error instanceof Error ? error.message : "";
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
    const entries: Array<{ path: string; bytes: Uint8Array; date: Date }> = [];
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

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function zipSafePathSegment(value: string) {
  return cleanRenderedName(String(value || "file").replace(/[\\/:*?"<>|]+/g, "_"));
}

function cleanRenderedName(value: string) {
  return safeStoredName(value).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
}

function safeStoredName(value: string) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160) || "file";
}

function renderFileCollectTemplate(template: string, data: Record<string, string>, originalName = "", index = 1, totalCount = 1) {
  const extIndex = originalName.lastIndexOf(".");
  const original = extIndex > 0 ? originalName.slice(0, extIndex) : originalName;
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, zipSafePathSegment(value)])),
    index: totalCount > 1 ? String(index) : "",
    original: zipSafePathSegment(original),
  };
  const rendered = String(template || "{name}-{student_id}").replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  return cleanRenderedName(rendered);
}

function zipEntryPath(task: FileCollectTask, submission: FileCollectSubmission, file: FileCollectSubmission["files"][number]) {
  if (submission.files.length <= 1) return zipSafePathSegment(file.storedName);
  const folder = renderFileCollectTemplate(task.folderTemplate || "{name}-{student_id}", submission.data);
  return `${folder}/${zipSafePathSegment(file.storedName)}`;
}

function uniqueZipPath(path: string, used: Set<string>) {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  let next = `${dir}${stem}-${index}${ext}`;
  while (used.has(next)) {
    index += 1;
    next = `${dir}${stem}-${index}${ext}`;
  }
  used.add(next);
  return next;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipHeader(fields: Array<[number, number]>) {
  const bytes = new Uint8Array(fields.reduce((sum, item) => sum + item[1], 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [value, size] of fields) {
    if (size === 2) view.setUint16(offset, value, true);
    if (size === 4) view.setUint32(offset, value, true);
    offset += size;
  }
  return bytes;
}

function buildZip(entries: Array<{ path: string; bytes: Uint8Array; date: Date }>) {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = entry.bytes;
    const crc = crc32(data);
    const { time, day } = dosDateTime(entry.date);
    const local = zipHeader([
      [0x04034b50, 4], [20, 2], [0x0800, 2], [0, 2], [time, 2], [day, 2],
      [crc, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2],
    ]);
    parts.push(blobPart(local), blobPart(name), blobPart(data));
    const centralHeader = zipHeader([
      [0x02014b50, 4], [20, 2], [20, 2], [0x0800, 2], [0, 2], [time, 2], [day, 2],
      [crc, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2],
      [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4],
    ]);
    central.push(blobPart(centralHeader), blobPart(name));
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + (part as ArrayBuffer).byteLength, 0);
  const end = zipHeader([
    [0x06054b50, 4], [0, 2], [0, 2], [entries.length, 2], [entries.length, 2],
    [centralSize, 4], [offset, 4], [0, 2],
  ]);
  return new Blob([...parts, ...central, blobPart(end)], { type: "application/zip" });
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
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
.manage-head-copy {
  min-width: 0;
  max-width: 720px;
}
.manage-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: 0 0 auto;
  margin-top: 2px;
}
.manage-head-actions .el-button {
  min-width: 116px;
  margin-left: 0;
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
  width: 100dvw !important;
  height: 100dvh !important;
  max-height: none !important;
  min-height: 100dvh;
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
  height: calc(100dvh - 64px);
  overflow: hidden;
}
.builder-mobile-only {
  display: none;
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
.permission-only-grid {
  grid-template-columns: minmax(0, 520px);
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
  overflow-wrap: anywhere;
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
  min-width: 0;
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
  min-width: 0;
  overflow: hidden;
}
.q-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.q-title-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.q-title-cell b { color: #111827; font-size: 15px; overflow-wrap: anywhere; line-height: 1.45; }
.q-title-cell span { color: #9ca3af; font-size: 12px; word-break: break-all; }
.q-row-tags,
.q-row-meta,
.q-row-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}
.q-row-meta {
  color: #6b7280;
  font-size: 12px;
}
.q-row-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
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
.file-collection-card {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  align-items: stretch;
  border-color: #dbeafe;
  background:
    linear-gradient(135deg, #ffffff 0%, #f8fbff 100%);
}
.file-collection-card .q-row-main {
  justify-content: center;
}
.file-collection-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  gap: 8px;
  align-content: center;
  padding-left: 14px;
  border-left: 1px solid #e5edf8;
}
.file-primary-action {
  grid-column: 1 / -1;
  width: 100%;
  min-height: 38px;
  border-radius: 8px;
  font-weight: 650;
}
.file-secondary-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}
.file-tool-action,
.file-menu-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  color: #1d4ed8;
  background: #eff6ff;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  min-width: 0;
  transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.15s;
}
.file-tool-action span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-tool-action:hover,
.file-menu-action:hover {
  border-color: #93c5fd;
  background: #dbeafe;
  transform: translateY(-1px);
}
.file-tool-action:disabled {
  color: #94a3b8;
  cursor: not-allowed;
  background: #f8fafc;
  border-color: #e5e7eb;
  transform: none;
}
.file-menu-action {
  min-width: 78px;
  color: #475569;
  border-color: #e5e7eb;
  background: #fff;
}
.file-more-dropdown {
  min-width: 0;
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
.manager-row b { color: #111827; overflow-wrap: anywhere; }
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
.inspector-card,
.mobile-publish-card {
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
.mobile-publish-card {
  gap: 12px;
  padding: 14px;
  border-color: #d7f3ea;
  background: #f7fffb;
}
.mobile-publish-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.mobile-publish-head div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mobile-publish-head b {
  color: #0f172a;
  font-size: 15px;
}
.mobile-publish-head span {
  color: #64748b;
  font-size: 12px;
}
.mobile-publish-head strong {
  flex: 0 0 auto;
  color: #0f766e;
  font-size: 13px;
}
.mobile-publish-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.mobile-publish-grid :deep(.el-select) {
  width: 100%;
}
.mobile-publish-checks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.mobile-publish-checks :deep(.el-checkbox) {
  min-width: 0;
  height: 32px;
  margin-right: 0;
}
.mobile-publish-checks :deep(.el-checkbox__label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  gap: 8px;
}
.advanced-grid :deep(.el-form-item) { margin-bottom: 0; }
.branch-editor {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
}
.branch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.branch-head b {
  color: #1d4ed8;
  font-size: 13px;
}
.branch-head span,
.branch-editor p {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
.branch-rule-list {
  display: grid;
  gap: 8px;
}
.branch-rule-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 150px minmax(170px, 1fr);
  gap: 8px;
  align-items: center;
}
.branch-rule-row > span {
  min-width: 0;
  color: #334155;
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.branch-rule-row :deep(.el-select) {
  width: 100%;
}
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
  min-width: 0;
  overflow: hidden;
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
  min-width: 0;
}
.stat-head div,
.response-head div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.stat-head b,
.response-head b {
  color: #111827;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.stat-head span,
.response-head span {
  color: #9ca3af;
  font-size: 12px;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
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
  min-width: 0;
  overflow-wrap: anywhere;
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
.answer-row b { font-weight: 500; word-break: break-word; overflow-wrap: anywhere; min-width: 0; }
.file-field-editor {
  display: grid;
  gap: 10px;
  margin: 14px 0;
}
.file-template-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px auto auto auto;
  gap: 10px;
  align-items: center;
  padding: 12px;
  border: 1px solid #e0f2fe;
  border-radius: 8px;
  margin: 14px 0;
  background: #f0f9ff;
  min-width: 0;
}
.file-template-bar > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.file-template-bar b { color: #0f172a; }
.file-template-bar span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
.file-template-bar :deep(.el-select) { width: 100%; }
.file-field-head,
.file-field-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.file-field-head {
  justify-content: space-between;
  color: #111827;
}
.file-field-row {
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fff;
}
.compact-field,
.config-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.compact-field { flex: 1; }
.compact-field span,
.config-field span {
  color: #334155;
  font-size: 12px;
  font-weight: 650;
}
.config-field small,
.rename-example {
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}
.file-rule-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px 180px;
  gap: 12px;
  align-items: start;
  margin-top: 14px;
}
.file-rule-grid :deep(.el-input-number) { width: 100%; }
.rename-builder,
.expected-list-box {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #dbe7f3;
  border-radius: 8px;
  margin-top: 12px;
  background: #fff;
}
.rename-head {
  display: grid;
  grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
.rename-head > div {
  display: grid;
  gap: 4px;
}
.rename-head b {
  color: #111827;
}
.rename-head span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
.rename-token-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}
.rename-insert-grid {
  display: grid;
  grid-template-columns: minmax(200px, 1.2fr) minmax(220px, 1fr) 112px;
  gap: 10px;
  align-items: end;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}
.rename-insert-grid .config-field {
  gap: 7px;
}
.rename-insert-grid :deep(.el-select),
.rename-insert-grid :deep(.el-input-number) {
  width: 100%;
}
.rename-insert-grid :deep(.el-radio-group) {
  display: flex;
  width: 100%;
}
.rename-insert-grid :deep(.el-radio-button) {
  flex: 1;
}
.rename-insert-grid :deep(.el-radio-button__inner) {
  width: 100%;
  height: 34px;
  padding: 0 8px;
  color: #475569;
  background: #fff;
  font-weight: 650;
  line-height: 32px;
}
.rename-insert-grid :deep(.el-radio-button.is-active .el-radio-button__inner) {
  border-color: #0f766e;
  background: #0f766e;
  box-shadow: -1px 0 0 0 #0f766e;
  color: #fff;
}
.rename-insert-action {
  grid-column: 1 / -1;
  justify-self: end;
  min-width: 118px;
  min-height: 36px;
  border-radius: 8px;
  font-weight: 650;
}
.rename-token-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 650;
}
.rename-token {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid #d7dee8;
  border-radius: 999px;
  color: #334155;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
  transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.15s;
}
.rename-token:hover {
  border-color: #99f6e4;
  color: #0f766e;
  background: #f0fdfa;
  transform: translateY(-1px);
}
.rename-token-system {
  border-color: #d7dee8;
  color: #334155;
  background: #fff;
}
.file-download-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.file-download-list button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  color: #1d4ed8;
  background: #eff6ff;
  cursor: pointer;
}
.file-download-list button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.file-download-list span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.file-download-list small { color: #64748b; }
.file-manager-toolbar { margin-bottom: 12px; }
.file-manager-list {
  display: grid;
  gap: 10px;
  max-height: min(62dvh, 620px);
  overflow: auto;
}
.file-manager-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fff;
  min-width: 0;
  overflow: hidden;
}
.file-manager-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.file-manager-main strong,
.file-manager-main span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.file-manager-main strong { color: #111827; }
.file-manager-main span { color: #2563eb; font-size: 13px; }
.file-manager-main small { color: #64748b; overflow-wrap: anywhere; min-width: 0; }
.file-manager-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.file-manager-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  min-height: 34px;
  padding: 6px 12px;
  background: #fff;
  color: #334155;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  min-width: 0;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.file-manager-actions button:hover {
  color: #1d4ed8;
  border-color: #bfdbfe;
  background: #eff6ff;
}
.file-manager-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}
.file-manager-actions button:last-child {
  color: #dc2626;
  border-color: #fecaca;
  background: #fef2f2;
}
.file-manager-actions button:last-child:hover {
  border-color: #fca5a5;
  background: #fee2e2;
}
@media (max-width: 1100px) {
  .file-template-bar {
    grid-template-columns: minmax(0, 1fr) 220px;
  }
  .file-template-bar :deep(.el-button) {
    min-width: 0;
    margin-left: 0;
  }
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
@media (max-width: 980px) {
  .rename-insert-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .tool-admin-grid { grid-template-columns: 1fr; }
  .managers-section { order: -1; }
}
@media (max-width: 760px) {
  :global(.questionnaire-builder-dialog.el-dialog) {
    background: #f6f8fb;
  }
  :global(.questionnaire-builder-dialog .el-dialog__header) {
    position: relative;
    z-index: 12;
  }
  :global(.questionnaire-builder-dialog .el-dialog__body) {
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 72px);
    overflow: hidden;
    background: #f6f8fb;
  }
  .builder-mobile-only {
    display: block;
  }
  .builder-topbar {
    height: 72px;
    align-items: center;
    flex-direction: row;
    gap: 10px;
    padding: 10px 12px;
  }
  .builder-titlebar {
    flex: 1 1 auto;
    min-width: 0;
    gap: 10px;
  }
  .builder-titlebar b,
  .builder-titlebar span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .builder-titlebar b {
    font-size: 16px;
  }
  .builder-titlebar span {
    font-size: 11px;
  }
  .builder-back {
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
  }
  .builder-top-actions {
    flex: 0 0 auto;
    overflow: visible;
    padding-bottom: 0;
  }
  .builder-top-actions .builder-desktop-action,
  .builder-top-actions :deep(.builder-desktop-action) {
    display: none;
  }
  .builder-top-actions :deep(.el-button) {
    min-width: 70px;
    height: 38px;
    padding: 0 10px;
  }
  .builder-layout {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
    padding: 0 12px 16px;
    -webkit-overflow-scrolling: touch;
  }
  .type-palette {
    position: sticky;
    top: 0;
    z-index: 8;
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 8px;
    margin: 0 -12px;
    padding: 10px 12px;
    overflow-x: auto;
    border: 0;
    border-bottom: 1px solid #e6edf6;
    border-radius: 0;
    background: rgba(246, 248, 251, 0.96);
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
    scrollbar-width: none;
  }
  .type-palette::-webkit-scrollbar {
    display: none;
  }
  .palette-title { display: none; }
  .type-palette button {
    flex: 0 0 108px;
    min-height: 48px;
    gap: 7px;
    padding: 8px;
    border-radius: 8px;
  }
  .type-palette button:hover {
    transform: none;
    box-shadow: none;
  }
  .type-palette .el-icon {
    width: 28px;
    height: 28px;
    font-size: 16px;
  }
  .type-palette b {
    font-size: 12px;
  }
  .type-palette small {
    display: none;
  }
  .mobile-publish-card.builder-mobile-only {
    display: grid;
  }
  .questionnaire-editor {
    gap: 12px;
    overflow: visible;
    padding: 0 0 82px;
    background: transparent;
  }
  .editor-card,
  .fields-head,
  .field-editor-list {
    width: 100%;
    max-width: none;
    align-self: stretch;
  }
  .editor-card {
    padding: 18px;
    border-top: 0;
    border-left: 4px solid var(--builder-primary);
    box-shadow: none;
  }
  .cover-kicker {
    margin-bottom: 8px;
  }
  .title-field :deep(.el-input__wrapper) {
    min-height: 42px;
  }
  .title-field :deep(.el-input__inner) {
    height: 42px;
    font-size: 18px;
  }
  .fields-head {
    margin-top: 0;
    padding: 0 1px;
  }
  .fields-head :deep(.el-button) {
    min-height: 36px;
    margin-left: 0;
  }
  .field-editor-list {
    gap: 10px;
  }
  .field-editor {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 14px;
    border-left: 1px solid var(--builder-border);
    border-top: 4px solid transparent;
    box-shadow: none;
  }
  .field-editor:hover {
    transform: none;
    box-shadow: none;
  }
  .field-editor.is-required {
    border-top-color: var(--builder-primary);
    border-left-color: var(--builder-border);
  }
  .field-index {
    width: auto;
    min-width: 44px;
    justify-self: start;
  }
  .field-editor-main,
  .advanced-grid { grid-template-columns: 1fr; }
  .field-editor :deep(.el-select),
  .field-editor :deep(.el-input-number),
  .advanced-grid :deep(.el-input-number) {
    width: 100%;
  }
  .branch-editor {
    padding: 10px;
  }
  .branch-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
  .branch-rule-row {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 8px;
    border: 1px solid #e5edf8;
    border-radius: 8px;
    background: #fff;
  }
  .field-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: stretch;
    gap: 7px;
    padding-top: 8px;
  }
  .field-actions button {
    justify-content: center;
    height: 36px;
    min-width: 0;
    padding: 0 6px;
  }
  .builder-side { display: none; }
  .builder-mobile-savebar.builder-mobile-only {
    display: grid;
    grid-template-columns: 0.85fr 1fr 1fr;
    gap: 8px;
    flex: 0 0 auto;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid #e5eaf3;
    background: #fff;
    box-shadow: 0 -10px 26px rgba(15, 23, 42, 0.1);
  }
  .builder-mobile-savebar :deep(.el-button) {
    height: 42px;
    margin-left: 0;
    border-radius: 8px;
    font-weight: 650;
  }
}
@media (max-width: 700px) {
  :global(.responsive-tool-dialog.el-dialog) {
    width: 96dvw !important;
    margin-top: 10px !important;
  }
  :global(.responsive-tool-dialog .el-dialog__header) {
    padding: 14px 14px 10px;
  }
  :global(.responsive-tool-dialog .el-dialog__body) {
    max-height: calc(100dvh - 112px);
    overflow: auto;
    padding: 12px 14px 16px;
  }
  .manage-head {
    flex-direction: column;
    padding: 16px;
  }
  .manage-head-copy {
    max-width: none;
  }
  .manage-head-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }
  .manage-head-actions .el-button {
    width: 100%;
    min-width: 0;
  }
  .manage-panel,
  .admin-section { padding: 14px; }
  .manage-tool-tabs {
    margin-inline: -14px;
    padding-inline: 14px;
  }
  .manage-tool-tabs :deep(.el-tabs__header) {
    margin-bottom: 14px;
  }
  .manage-tool-tabs :deep(.el-tabs__nav-wrap) {
    overflow: visible;
  }
  .manage-tool-tabs :deep(.el-tabs__nav-scroll) {
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .manage-tool-tabs :deep(.el-tabs__nav-scroll::-webkit-scrollbar) {
    display: none;
  }
  .manage-tool-tabs :deep(.el-tabs__nav) {
    float: none;
    min-width: max-content;
    white-space: nowrap;
  }
  .manage-tool-tabs :deep(.el-tabs__item) {
    flex: 0 0 auto;
    padding: 0 16px;
  }
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
  .responses-title {
    align-items: stretch;
    flex-direction: column;
    padding-right: 26px;
  }
  .responses-title .el-button {
    width: 100%;
  }
  .response-head,
  .stat-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .file-template-bar { grid-template-columns: 1fr; }
  .file-rule-grid,
  .rename-head,
  .rename-insert-grid { grid-template-columns: 1fr; }
  .file-field-row { flex-direction: column; align-items: stretch; }
  .rename-insert-grid {
    padding: 10px;
  }
  .rename-insert-action {
    width: 100%;
    justify-self: stretch;
  }
  .rename-insert-grid > .el-button,
  .rename-token,
  .file-manager-actions button,
  .file-download-list button {
    min-height: 40px;
  }
  .rename-token {
    flex: 1 1 112px;
  }
  .file-download-list {
    display: grid;
    grid-template-columns: 1fr;
  }
  .file-download-list button {
    justify-content: center;
  }
  .file-manager-card { grid-template-columns: 1fr; }
  .file-manager-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .file-manager-actions button {
    width: 100%;
  }
  .file-collection-card {
    background: #fff;
  }
  .file-collection-actions {
    padding-left: 0;
    padding-top: 10px;
    border-left: 0;
    border-top: 1px solid #e5edf8;
  }
  .file-primary-action {
    min-height: 42px;
  }
  .file-secondary-actions {
    grid-column: 1 / -1;
  }
  .file-tool-action,
  .file-menu-action {
    min-height: 40px;
  }
  .file-more-dropdown {
    grid-column: 1 / -1;
  }
  .file-menu-action {
    width: 100%;
  }
  .questionnaire-row-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .q-row-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-content: stretch;
  }
  .grade-check-actions {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .q-row-actions .el-button,
  .q-row-actions :deep(.el-dropdown),
  .q-row-actions :deep(.el-dropdown .el-button) {
    width: 100%;
    margin-left: 0;
  }
  .add-manager { flex-direction: column; }
  .answer-row,
  .choice-stat-row { grid-template-columns: 1fr; gap: 5px; }
  .choice-stat-row b { text-align: left; }
  .metric-grid { grid-template-columns: 1fr; }
}
</style>
