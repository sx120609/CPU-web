<template>
  <div class="post-page">
    <header class="post-page-header" :class="{ 'second-hand-page-header': isSecondHandPost }">
      <div>
        <span v-if="isSecondHandPost" class="page-eyebrow">SECOND-HAND FORUM</span>
        <h2 class="page-title">{{ pageTitle }}</h2>
        <p v-if="isSecondHandPost">把关键信息写清楚，再通过帖子和评论完成后续沟通。</p>
      </div>
      <el-button v-if="isSecondHandPost" plain @click="router.push('/market')">返回二手交流</el-button>
    </header>

    <div v-if="loadError && !loading" class="cpu-card post-load-state">
      <el-empty :description="loadError">
        <el-button type="primary" :loading="loading" @click="loadInitial">重试</el-button>
      </el-empty>
    </div>

    <div v-else v-loading="loading" class="cpu-card form">
      <el-form label-position="top" :model="form">
        <el-form-item label="选择板块" required>
          <el-select v-model="form.boardSlug" placeholder="选择要发帖的板块" :disabled="!!editingId" @change="onBoardChange">
            <el-option-group v-for="(group, label) in groupedBoards" :key="label" :label="label">
              <el-option
                v-for="b in group"
                :key="b.slug"
                :value="b.slug"
                :label="`${b.icon ?? ''} ${b.name}`"
                :disabled="b.readOnly"
              >
                <span class="option-icon">{{ b.icon }}</span>{{ b.name }}
                <span class="option-note">{{ b.readOnly ? '不可发帖' : '' }}</span>
              </el-option>
            </el-option-group>
          </el-select>
          <div v-if="currentBoard" class="board-hint">
            {{ currentBoard.description }}
          </div>
        </el-form-item>

        <div class="publish-mode-picker" role="radiogroup" aria-label="发布形式">
          <button
            type="button"
            class="publish-mode-option"
            :class="{ active: publishMode === 'say' }"
            role="radio"
            :aria-checked="publishMode === 'say'"
            @click="selectPublishMode('say')"
          >
            <b>发说说</b>
            <span>只写正文，内容流直接展示正文摘要</span>
          </button>
          <button
            type="button"
            class="publish-mode-option"
            :class="{ active: publishMode === 'post' }"
            role="radio"
            :aria-checked="publishMode === 'post'"
            @click="selectPublishMode('post')"
          >
            <b>发帖子</b>
            <span>标题加正文，适合信息较完整的内容</span>
          </button>
        </div>

        <el-form-item v-if="currentBoard?.anonymousEnabled" label="匿名发布">
          <div class="anonymous-box" :class="{ disabled: !anonymousEnabledForForm }">
            <el-switch v-model="form.anonymous" :disabled="!anonymousEnabledForForm || !!editingId" />
            <div class="anonymous-copy">
              <b>{{ editingId ? "保持匿名状态" : "使用匿名积分发帖" }}</b>
              <p>{{ anonymousHint }}</p>
            </div>
          </div>
        </el-form-item>

        <!-- 二手交流板块：保留必要的信息结构，不产生站内交易 -->
        <section v-if="isSecondHandPost" class="second-hand-form" aria-labelledby="second-hand-form-title">
          <div class="second-hand-form-head">
            <div>
              <span class="section-step">01</span>
              <div>
                <h3 id="second-hand-form-title">选择发布方式</h3>
                <p>先说明你是想出闲置、收求购，还是聊聊二手相关话题。</p>
              </div>
            </div>
            <span class="forum-only-badge">论坛信息帖</span>
          </div>

          <div class="second-hand-kind-grid" role="radiogroup" aria-label="发布方式">
            <button
              v-for="option in SECOND_HAND_KINDS"
              :key="option.value"
              type="button"
              class="second-hand-kind"
              :class="{ active: meta.marketKind === option.value }"
              role="radio"
              :aria-checked="meta.marketKind === option.value"
              @click="meta.marketKind = option.value"
            >
              <span class="second-hand-kind__icon">{{ option.icon }}</span>
              <span>
                <b>{{ option.label }}</b>
                <small>{{ option.description }}</small>
              </span>
              <span class="second-hand-kind__check">✓</span>
            </button>
          </div>

          <template v-if="meta.marketKind !== 'discuss'">
            <div class="second-hand-section">
              <div class="second-hand-section-title">
                <span class="section-step">02</span>
                <div>
                  <h3>填写物品信息</h3>
                  <p>{{ meta.marketKind === 'wanted' ? '让大家快速判断是否有合适的物品。' : '清楚说明分类、成色与价格，减少重复询问。' }}</p>
                </div>
              </div>

              <div class="market-form-grid">
                <el-form-item label="物品分类" required>
                  <el-select v-model="meta.category" placeholder="请选择分类" class="market-field-control">
                    <el-option
                      v-for="category in SECOND_HAND_CATEGORIES"
                      :key="category.value"
                      :value="category.value"
                      :label="`${category.icon} ${category.label}`"
                    />
                  </el-select>
                </el-form-item>

                <el-form-item v-if="meta.marketKind === 'sell'" label="物品成色" required>
                  <el-select v-model="meta.condition" placeholder="请选择成色" class="market-field-control">
                    <el-option v-for="condition in SECOND_HAND_CONDITIONS" :key="condition" :label="condition" :value="condition" />
                  </el-select>
                </el-form-item>

                <el-form-item label="价格方式" required>
                  <el-radio-group v-model="meta.priceType" class="market-price-type">
                    <el-radio-button value="fixed">{{ meta.marketKind === 'wanted' ? '明确预算' : '明确标价' }}</el-radio-button>
                    <el-radio-button value="negotiable">面议</el-radio-button>
                  </el-radio-group>
                </el-form-item>

                <el-form-item
                  v-if="meta.priceType === 'fixed'"
                  :label="meta.marketKind === 'wanted' ? '预算（元）' : '价格（元）'"
                  required
                >
                  <el-input-number
                    v-model="meta.price"
                    :min="0.01"
                    :max="999999"
                    :precision="2"
                    :step="10"
                    controls-position="right"
                    placeholder="请输入金额"
                    class="market-field-control"
                  />
                  <el-checkbox v-if="meta.marketKind === 'sell'" v-model="meta.negotiable" class="market-negotiable">
                    可小议
                  </el-checkbox>
                </el-form-item>
              </div>

              <div class="market-image-option">
                <div class="market-image-copy">
                  <span class="market-image-icon">图片</span>
                  <div>
                    <b>物品图片 <small>选填</small></b>
                    <p>可以不上传；选择后会自动加入正文并参与统一图片审核。</p>
                  </div>
                </div>
                <div class="market-image-actions">
                  <span v-if="marketImageCount">已添加 {{ marketImageCount }} 张</span>
                  <el-button plain @click="openSecondHandImagePicker">{{ marketImageCount ? '继续添加' : '选择图片' }}</el-button>
                </div>
              </div>
            </div>

            <div class="second-hand-section">
              <div class="second-hand-section-title">
                <span class="section-step">03</span>
                <div>
                  <h3>约定沟通与交接</h3>
                  <p>这里只展示意向，具体安排请在评论或双方自行选择的方式中确认。</p>
                </div>
              </div>

              <div class="market-form-grid">
                <el-form-item label="交接偏好" required>
                  <el-select v-model="meta.tradeMode" placeholder="请选择" class="market-field-control">
                    <el-option v-for="mode in SECOND_HAND_TRADE_MODES" :key="mode" :label="mode" :value="mode" />
                  </el-select>
                </el-form-item>

                <el-form-item label="所在校区">
                  <el-select
                    v-model="meta.campus"
                    filterable
                    allow-create
                    default-first-option
                    clearable
                    placeholder="选择或填写校区"
                    class="market-field-control"
                  >
                    <el-option v-for="campus in SECOND_HAND_CAMPUSES" :key="campus" :label="campus" :value="campus" />
                  </el-select>
                </el-form-item>

                <el-form-item label="参考地点（可选）" class="market-location-field">
                  <el-input
                    v-model="meta.location"
                    maxlength="80"
                    show-word-limit
                    placeholder="例如：江宁校区图书馆门口；建议选择公开场所"
                  />
                </el-form-item>
              </div>
            </div>
          </template>

          <div v-else class="second-hand-discuss-prompt">
            <span>💬</span>
            <div>
              <b>按普通讨论帖发布</b>
              <p>适合交流避坑经验、询价、鉴别和物品循环建议，不需要填写商品表单。</p>
            </div>
          </div>

          <div class="second-hand-safety">
            <b>发布提醒</b>
            <span>本站不提供下单、支付、担保、退款或结算；请勿发布违法违规物品、处方药及考试作弊资料。</span>
          </div>
        </section>

        <!-- 提问板块特化 -->
        <template v-if="boardType === 'question'">
          <el-form-item label="悬赏（声望）">
            <el-input-number v-model="meta.bounty" :min="0" :max="999" :step="5" />
            <span class="cpu-muted" style="margin-left:8px">采纳回答者获得声望</span>
          </el-form-item>
        </template>

        <!-- 课程点评特化 -->
        <template v-if="boardType === 'coursereview'">
          <el-form-item label="评价的课程" required>
            <el-select
              v-model="meta.courseId"
              filterable
              placeholder="搜课程名 / 代码"
              :loading="coursesLoading"
              :disabled="coursesLoading"
              no-data-text="暂无课程数据"
              @change="onCourseChange"
            >
              <el-option
                v-for="c in courses"
                :key="c.id"
                :value="c.id"
                :label="`${c.code} ${c.name}${c.teachers?.length ? ' - ' + c.teachers.map((t: any) => t.name).join('、') : ''}`"
              >
                <span>{{ c.code }} · {{ c.name }}</span>
                <span class="option-note">
                  {{ c.teachers?.length ? c.teachers.map((t: any) => t.name).join('、') : '暂无老师' }}
                </span>
              </el-option>
            </el-select>
            <div v-if="courseLoadError" class="field-error">
              <span>{{ courseLoadError }}</span>
              <button type="button" class="text-retry-btn" :disabled="coursesLoading" @click="loadCoursesForReview(true)">
                重试
              </button>
            </div>
          </el-form-item>
          <el-form-item label="授课老师" required>
            <div class="teacher-pick-row">
              <el-select
                v-model="meta.courseTeacherId"
                placeholder="先选已知老师"
                clearable
                filterable
                style="flex:1; min-width:160px"
                :disabled="!meta.courseId"
                @change="onPickKnownTeacher"
              >
                <el-option
                  v-for="t in teacherOptions"
                  :key="t.courseTeacherId"
                  :value="t.courseTeacherId"
                  :label="t.name"
                />
              </el-select>
              <span class="or-text">或</span>
              <el-input
                v-model="meta.teacherName"
                placeholder="输入老师姓名"
                maxlength="40"
                style="flex:1; min-width:160px"
                :disabled="!meta.courseId"
                @input="onTypeNewTeacher"
              />
            </div>
            <div class="cpu-muted" style="margin-top:4px">
              二选一。若列表里没有这位老师，直接在右侧输入即可。
            </div>
          </el-form-item>
          <div class="rate-row">
            <el-form-item label="难度"><el-rate v-model="meta.ratings.difficulty" /></el-form-item>
            <el-form-item label="收获"><el-rate v-model="meta.ratings.reward" /></el-form-item>
            <el-form-item label="推荐度"><el-rate v-model="meta.ratings.recommend" /></el-form-item>
            <el-form-item label="给分"><el-rate v-model="meta.ratings.givingScore" /></el-form-item>
          </div>
          <el-form-item label="学期">
            <el-input v-model="meta.semester" placeholder="例如 2024-2025-1" style="max-width:240px" />
          </el-form-item>
        </template>

        <el-form-item v-if="publishMode === 'post'" label="标题" required>
          <el-input v-model="form.title" placeholder="一句话概括主要内容" maxlength="120" show-word-limit />
        </el-form-item>

        <el-form-item :label="postContentLabel" required>
          <div class="post-editor-shell">
            <div v-if="isSecondHandPost" class="second-hand-description-guide">
              <span>✦</span>
              <div>
                <b>{{ secondHandDescriptionTitle }}</b>
                <p>{{ secondHandDescriptionHint }}</p>
              </div>
            </div>
            <div class="post-editor-toolbar">
              <div class="editor-mode-switch" role="tablist" aria-label="正文编辑模式">
                <button
                  type="button"
                  class="editor-mode-btn"
                  :class="{ active: editorMode === 'visual' }"
                  @click="setEditorMode('visual')"
                >
                  可视化编辑
                </button>
                <button
                  type="button"
                  class="editor-mode-btn"
                  :class="{ active: editorMode === 'markup' }"
                  @click="setEditorMode('markup')"
                >
                  Markdown / HTML
                </button>
              </div>
              <el-button size="small" type="primary" plain :disabled="smartPostBusy" @click="openSmartPost">
                {{ smartPostBusy ? "Agent 后台处理中" : "智慧发帖" }}
              </el-button>
            </div>

            <p class="editor-mode-hint">
              <template v-if="editorMode === 'visual'">
                适合直接排版、插图和视频。想写源码可切到 Markdown / HTML 高级模式。
              </template>
              <template v-else>
                高级模式支持 Markdown 和安全 HTML。切回可视化后，会按最终渲染效果继续编辑。
              </template>
            </p>

            <RichTextEditor
              v-if="editorMode === 'visual'"
              ref="editorRef"
              v-model="form.content"
              :max-length="CONTENT_MAX"
              :draft-key="contentDraftKey"
              :restore-draft="false"
            />

            <div v-else class="markup-editor-shell">
              <div class="markup-helper-row">
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupHeadingSnippet)">小标题</button>
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupQuoteSnippet)">引用</button>
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupListSnippet)">列表</button>
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupTableSnippet)">表格</button>
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupCenterSnippet)">居中 HTML</button>
              </div>
              <textarea
                ref="markupTextareaRef"
                v-model="form.content"
                class="markup-editor"
                placeholder="在这里输入 Markdown 或安全 HTML，例如标题、列表、表格、blockquote、video、img 等。"
                spellcheck="false"
              ></textarea>
              <div class="markup-meta">
                <span>支持 Markdown、表格、引用，以及安全 HTML 标签。</span>
                <span :class="{ warn: form.content.length > CONTENT_MAX }">{{ form.content.length }} / {{ CONTENT_MAX }}</span>
              </div>
              <div class="markup-preview">
                <div class="markup-preview__head">
                  <strong>实时预览</strong>
                  <span>按帖子最终展示效果渲染</span>
                </div>
                <div v-if="isMarkupContentEmpty(form.content)" class="markup-preview__empty">
                  写点内容后，这里会显示预览效果。
                </div>
                <MarkdownView v-else :content="form.content" />
              </div>
            </div>
          </div>
        </el-form-item>

        <el-alert
          v-if="auth.user?.status === 'muted'"
          type="error"
          :closable="false"
          show-icon
          :title="mutedNotice"
        />

        <el-alert
          v-if="auth.user?.topicSubmissionLocked"
          type="warning"
          :closable="false"
          show-icon
          title="你有内容正在人工复核，暂时不能继续提交新内容"
        />

        <el-form-item class="form-actions">
          <el-button type="primary" :loading="submitting" :disabled="submitDisabled" @click="submit">{{ submitButtonLabel }}</el-button>
          <el-button :disabled="submitting" @click="$router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-dialog
      v-model="smartPostOpen"
      title="智慧发帖 Agent"
      width="min(620px, 94vw)"
      :close-on-click-modal="!smartPostRunning"
      :close-on-press-escape="!smartPostRunning"
      :show-close="!smartPostRunning"
    >
      <div class="smart-post-dialog">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          :title="smartPostOperation === 'format'
            ? '整理排版只执行一次专用模型请求。提交后可离开此页；它只生成可编辑草稿，不会自动发布。'
            : 'Agent 会在后台分三轮分析材料、生成草稿并核验定稿。提交后可离开此页；它只生成可编辑草稿，不会自动发布。'"
        />
        <label class="smart-post-field">
          <span>处理方式</span>
          <el-radio-group v-model="smartPostOperation">
            <el-radio-button value="compose">生成帖子</el-radio-button>
            <el-radio-button value="polish">内容润色</el-radio-button>
            <el-radio-button value="format">整理排版</el-radio-button>
          </el-radio-group>
        </label>
        <label v-if="smartPostOperation !== 'format'" class="smart-post-field">
          <span>{{ smartPostOperation === "polish" ? "补充材料" : "宣传材料" }}（可选，最多 8 个）</span>
          <input
            ref="smartPostFileInputRef"
            class="smart-post-file-input"
            type="file"
            multiple
            accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif"
            @change="handleSmartPostFileChange"
          />
          <div class="smart-post-file-row">
            <el-button :disabled="smartPostRunning || smartPostFiles.length >= 8" @click="smartPostFileInputRef?.click()">
              {{ smartPostFiles.length ? "继续添加" : "选择文件" }}
            </el-button>
            <span>{{ smartPostFiles.length ? `已选 ${smartPostFiles.length} 个 · 共 ${formatFileSize(smartPostFilesTotalSize)}` : "图片 / PPTX / Word / PDF / 文本；总计最大 40MB" }}</span>
            <el-button v-if="smartPostFiles.length" text type="danger" :disabled="smartPostRunning" @click="clearSmartPostFiles">全部移除</el-button>
          </div>
          <ul v-if="smartPostFiles.length" class="smart-post-file-list">
            <li v-for="(file, index) in smartPostFiles" :key="`${file.name}-${file.size}-${file.lastModified}`">
              <span :title="file.name">{{ file.name }}</span>
              <small>{{ formatFileSize(file.size) }}</small>
              <el-button text type="danger" :disabled="smartPostRunning" @click.prevent="removeSmartPostFile(index)">移除</el-button>
            </li>
          </ul>
        </label>
        <div v-else class="smart-post-mode-note">
          整理排版只处理编辑器中的现有标题和正文，不会上传附件。
        </div>
        <label class="smart-post-field">
          <span>附加要求（可选）</span>
          <el-input
            v-model="smartPostInstruction"
            type="textarea"
            :rows="3"
            maxlength="1000"
            show-word-limit
            placeholder="例如：面向本科生、保留报名方式、语气真诚简洁"
          />
        </label>
        <div class="smart-post-estimate" aria-live="polite">
          <template v-if="smartPostEstimateLoading">正在估算{{ smartPostOperation === "format" ? "单轮排版" : "三轮 Agent" }}用量…</template>
          <template v-else-if="smartPostEstimate">
            预计约 <strong>{{ smartPostEstimate.minQuota }}–{{ smartPostEstimate.maxQuota }} 个 AI 额度</strong>
            （约 {{ formatTokenCount(smartPostEstimate.minTokens) }}–{{ formatTokenCount(smartPostEstimate.maxTokens) }} Tokens）。
            实际按本次工作流上游返回的 Token 结算；{{ smartPostOperation === "format" ? "正文越长，用量越高" : "复杂 PDF、图片或长 PPT 可能超出区间" }}；失败会退款。
          </template>
          <template v-else>暂时无法估算额度；提交后仍只会按实际 Token 结算，失败会退款。</template>
        </div>
        <p class="smart-post-privacy">
          <template v-if="smartPostOperation !== 'format'">附件只在服务端内存中处理：Responses 接口优先读取原文件；图片及 PPT/Word 内嵌图片会作为视觉材料分析，其他接口由服务端临时解析，不保存上传文件。</template>
          <template v-else>本模式只发送编辑器中的现有标题、正文和附加要求，不会发送已选择的附件。</template>
          任务会在同一账号的不同设备显示进度和失败原因。
        </p>
      </div>
      <template #footer>
        <el-button :disabled="smartPostRunning" @click="smartPostOpen = false">取消</el-button>
        <el-button type="primary" :loading="smartPostRunning" @click="runSmartPost">
          {{ smartPostRunning ? "正在上传材料" : "提交后台 Agent 任务" }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="previewOpen"
      :title="editingId ? '确认重新提交审核' : '确认发布帖子'"
      width="720px"
      class="publish-preview-dialog"
      append-to-body
    >
      <div class="publish-preview">
        <div class="preview-meta">
          <span>{{ currentBoard?.name || "未选择板块" }}</span>
          <span>{{ form.content.length }} / {{ CONTENT_MAX }}</span>
        </div>
        <el-tag v-if="form.anonymous" type="warning" effect="plain" class="preview-anon-tag">匿名发布</el-tag>
        <div v-if="isSecondHandPost" class="second-hand-preview-summary">
          <div v-for="fact in marketPreviewFacts" :key="fact.label" class="second-hand-preview-fact">
            <span>{{ fact.icon }}</span>
            <small>{{ fact.label }}</small>
            <b>{{ fact.value }}</b>
          </div>
        </div>
        <h3 v-if="publishMode === 'post'">{{ form.title || "未填写标题" }}</h3>
        <MarkdownView :content="form.content" />
      </div>
      <template #footer>
        <span v-if="submitting" class="cpu-muted publish-progress">{{ submissionProgress }}</span>
        <el-button :disabled="submitting" @click="previewOpen = false">返回修改</el-button>
        <el-button type="primary" :loading="submitting" :disabled="submitting" @click="confirmSubmit">
          {{ submitting ? submissionProgress : (editingId ? '重新提交审核' : '确认发布') }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="reviewBlockedOpen"
      title="内容暂未通过审核"
      width="520px"
      append-to-body
    >
      <div class="review-blocked">
        <p>这条内容暂时还没有发出。</p>
        <p v-if="blockedReviewInfo.reason">审核说明：{{ blockedReviewInfo.reason }}</p>
        <p class="cpu-muted">你可以修改后再试，或申请人工复核。复核期间暂时不能继续提交新内容。</p>
      </div>
      <template #footer>
        <el-button @click="reviewBlockedOpen = false">返回修改</el-button>
        <el-button type="warning" :loading="requestingManualReview" :disabled="requestingManualReview" @click="manualReviewConfirmOpen = true">申请人工复核</el-button>
      </template>
    </el-dialog>

    <ManualReviewConfirmDialog
      v-model="manualReviewConfirmOpen"
      subject="内容"
      @confirm="confirmManualReviewRequest"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import RichTextEditor from "@/components/forum/RichTextEditor.vue";
import ManualReviewConfirmDialog from "@/components/forum/ManualReviewConfirmDialog.vue";
import { boardApi, type Board } from "@/api/board";
import { topicApi, type SmartPostOperation, type SmartPostQuotaEstimate, type TopicSubmissionResponse } from "@/api/topic";
import { courseApi, type Course } from "@/api/course";
import { useAuthStore } from "@/stores/auth";
import { useSmartPostJobStore } from "@/stores/smartPostJob";
import { fmtDate } from "@/utils/format";
import { forumInternalTitle } from "@/utils/forumContent";
import {
  createForumSubmissionId,
  getForumRequestMessage,
  isAmbiguousForumSubmissionError,
  reconcileForumSubmission,
  resolveForumReviewState,
  waitForForumSubmissionResult,
} from "@/utils/forumSubmission";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const smartPost = useSmartPostJobStore();

const boards = ref<Board[]>([]);
const courses = ref<Course[]>([]);
const loading = ref(false);
const loadError = ref("");
const coursesLoading = ref(false);
const coursesLoaded = ref(false);
const courseLoadError = ref("");
const submitting = ref(false);
const submissionProgress = ref("");
const pendingSubmissionAttempt = ref<{ fingerprint: string; submissionId: string } | null>(null);
const PENDING_TOPIC_SUBMISSION_KEY = "cpu-forum-pending-topic-submission";
let pendingSubmissionMonitorSeq = 0;
const editingId = computed(() => {
  if (!route.params.id) return null;
  const id = Number(route.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
});
const CONTENT_MAX = 20000;
type PostEditorMode = "visual" | "markup";
type PublishMode = "say" | "post";
const editorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const markupTextareaRef = ref<HTMLTextAreaElement | null>(null);
const editorMode = ref<PostEditorMode>("visual");
const publishMode = ref<PublishMode>(route.query.mode === "say" ? "say" : "post");
const publishModeTouched = ref(false);
const smartPostOpen = ref(false);
const smartPostRunning = ref(false);
const smartPostOperation = ref<SmartPostOperation>("compose");
const smartPostInstruction = ref("");
const smartPostFiles = ref<File[]>([]);
const smartPostFileInputRef = ref<HTMLInputElement | null>(null);
const smartPostEstimate = ref<SmartPostQuotaEstimate | null>(null);
const smartPostEstimateLoading = ref(false);
const smartPostFilesTotalSize = computed(() => smartPostFiles.value.reduce((sum, file) => sum + file.size, 0));
const smartPostBusy = computed(() => smartPost.starting || smartPost.active || Boolean(smartPost.task && !smartPost.terminal));
let appliedSmartPostJobId = "";
let smartPostEstimateTimer = 0;
let smartPostEstimateSeq = 0;
const previewOpen = ref(false);
const pendingMetadata = ref<any>(null);
const reviewBlockedOpen = ref(false);
const requestingManualReview = ref(false);
const manualReviewConfirmOpen = ref(false);
const blockedTopicId = ref<number | null>(null);
const blockedReviewInfo = reactive<{ reason: string; riskScore: number | null }>({
  reason: "",
  riskScore: null,
});
let loadSeq = 0;
let formDraftTimer = 0;
let markupDraftTimer = 0;
const markupHeadingSnippet = "## 小标题\n\n";
const markupQuoteSnippet = "> 引用内容\n\n";
const markupListSnippet = "- 要点一\n- 要点二\n\n";
const markupTableSnippet = "| 项目 | 内容 |\n| --- | --- |\n| 示例 | 示例内容 |\n\n";
const markupCenterSnippet = "<div align='center'>居中文字</div>\n\n";

const form = reactive({
  boardSlug: (route.query.board as string) || "",
  title: "",
  content: "",
  anonymous: false,
});

function routeMarketKind(): "sell" | "wanted" | "discuss" {
  const kind = typeof route.query.kind === "string" ? route.query.kind : "";
  return kind === "wanted" || kind === "discuss" ? kind : "sell";
}

type SecondHandKind = "sell" | "wanted" | "discuss";
const SECOND_HAND_KINDS: Array<{ value: SecondHandKind; icon: string; label: string; description: string }> = [
  { value: "sell", icon: "📦", label: "出闲置", description: "发布自己想转让的物品" },
  { value: "wanted", icon: "🔎", label: "收求购", description: "说明正在寻找的物品" },
  { value: "discuss", icon: "💬", label: "聊二手", description: "询价、避坑或经验交流" },
];
const SECOND_HAND_CATEGORIES = [
  { value: "books", icon: "📚", label: "教材书籍" },
  { value: "digital", icon: "💻", label: "数码电器" },
  { value: "dorm", icon: "🛏️", label: "宿舍生活" },
  { value: "fashion", icon: "👕", label: "衣物日用" },
  { value: "sports", icon: "🏸", label: "运动户外" },
  { value: "tickets", icon: "🎫", label: "票券周边" },
  { value: "digital_goods", icon: "📁", label: "电子资料" },
  { value: "other", icon: "📦", label: "其他" },
];
const SECOND_HAND_CONDITIONS = ["全新未拆", "几乎全新", "使用良好", "明显使用痕迹"];
const SECOND_HAND_TRADE_MODES = ["校内面交", "邮寄", "均可", "线上沟通"];
const SECOND_HAND_CAMPUSES = ["江宁校区", "玄武门校区", "不限校区"];

function normalizeExistingMarketMeta(metadata: Record<string, any>) {
  const rawKind = metadata.marketKind || metadata.listingType;
  meta.marketKind = rawKind === "wanted" || metadata.condition === "求购" || metadata.condition === "wanted"
    ? "wanted"
    : rawKind === "discuss" ? "discuss" : "sell";
  const conditionMap: Record<string, string> = {
    new: "全新未拆",
    like_new: "几乎全新",
    good: "使用良好",
    fair: "明显使用痕迹",
    "全新": "全新未拆",
    "九成新": "几乎全新",
    "八成新": "使用良好",
    "七成新及以下": "明显使用痕迹",
  };
  const tradeModeMap: Record<string, string> = {
    meetup: "校内面交",
    shipping: "邮寄",
    both: "均可",
    online: "线上沟通",
    "当面": "校内面交",
    "包邮": "邮寄",
    "当面 / 包邮+5": "均可",
  };
  const categoryMap: Record<string, string> = {
    appliance: "digital",
  };
  const rawCategory = String(metadata.category || "");
  meta.category = categoryMap[rawCategory] || rawCategory || meta.category;
  meta.condition = conditionMap[String(metadata.condition || "")] || meta.condition || "几乎全新";
  meta.tradeMode = tradeModeMap[String(metadata.tradeMode || "")] || meta.tradeMode || "校内面交";
  const rawPrice = Number(metadata.price);
  meta.priceType = metadata.priceType === "fixed" || metadata.priceType === "negotiable"
    ? metadata.priceType
    : Number.isFinite(rawPrice) && rawPrice > 0 ? "fixed" : "negotiable";
  meta.price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : undefined;
  meta.negotiable = Boolean(metadata.negotiable);
  meta.campus = typeof metadata.campus === "string" ? metadata.campus : (meta.campus || "");
  meta.location = typeof metadata.location === "string" ? metadata.location : (meta.location || "");
}

function defaultPostMeta() {
  return {
    marketKind: routeMarketKind(),
    category: undefined,
    priceType: "fixed",
    price: undefined,
    negotiable: false,
    condition: "几乎全新",
    tradeMode: "校内面交",
    campus: "",
    location: "",
    bounty: 0,
    courseId: undefined,
    courseTeacherId: undefined,
    teacherName: "",
    ratings: { difficulty: 3, reward: 3, recommend: 3, givingScore: 3 },
    semester: "",
  };
}

const meta = reactive<any>(defaultPostMeta());

const currentBoard = computed(() => boards.value.find((b) => b.slug === form.boardSlug));
const boardType = computed(() => currentBoard.value?.type ?? "normal");
const isSecondHandPost = computed(() => boardType.value === "market" || form.boardSlug === "market");
const pageTitle = computed(() => {
  if (!isSecondHandPost.value) return editingId.value ? "修改内容" : publishMode.value === "say" ? "发说说" : "发表帖子";
  if (editingId.value) return "修改二手信息";
  if (meta.marketKind === "wanted") return "发布求购";
  if (meta.marketKind === "discuss") return "发起二手讨论";
  return "发布闲置";
});
const selectedMarketCategory = computed(() => SECOND_HAND_CATEGORIES.find((item) => item.value === meta.category));
const postContentLabel = computed(() => {
  if (!isSecondHandPost.value) return "正文";
  if (meta.marketKind === "wanted") return "求购要求";
  if (meta.marketKind === "discuss") return "讨论内容";
  return "物品说明";
});
const secondHandDescriptionTitle = computed(() => {
  if (meta.marketKind === "wanted") return "把需求范围写具体";
  if (meta.marketKind === "discuss") return "补充背景和你已经了解的情况";
  return "真实描述比堆参数更重要";
});
const secondHandDescriptionHint = computed(() => {
  if (meta.marketKind === "wanted") return "建议说明版本、型号、可接受成色、预算范围和希望收到的时间，也可以插入参考图片。";
  if (meta.marketKind === "discuss") return "说明具体场景、疑问和希望大家重点讨论的部分，方便获得有效回复。";
  return "建议写清品牌型号、购入时间、使用情况、已知瑕疵和配件，并插入实物图片。";
});
const marketImageCount = computed(() => {
  const htmlImages = form.content.match(/<img\b/gi)?.length ?? 0;
  const markdownImages = form.content.match(/!\[[^\]]*\]\([^\n)]+\)/g)?.length ?? 0;
  return htmlImages + markdownImages;
});
const marketPriceDisplay = computed(() => {
  if (meta.marketKind === "discuss") return "";
  if (meta.priceType === "negotiable") return meta.marketKind === "wanted" ? "预算面议" : "面议";
  const price = Number(meta.price);
  if (!Number.isFinite(price) || price <= 0) return "待填写";
  const priceText = Number.isInteger(price) ? String(price) : price.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const suffix = meta.marketKind === "sell" && meta.negotiable ? "（可小议）" : "";
  return `¥${priceText}${suffix}`;
});
const marketPreviewFacts = computed(() => {
  const kind = SECOND_HAND_KINDS.find((item) => item.value === meta.marketKind);
  const facts = [{ icon: kind?.icon || "💬", label: "发布方式", value: kind?.label || "二手交流" }];
  if (meta.marketKind === "discuss") return facts;
  if (selectedMarketCategory.value) {
    facts.push({ icon: selectedMarketCategory.value.icon, label: "物品分类", value: selectedMarketCategory.value.label });
  }
  facts.push({ icon: "¥", label: meta.marketKind === "wanted" ? "预算" : "价格", value: marketPriceDisplay.value });
  if (meta.marketKind === "sell") facts.push({ icon: "◫", label: "物品成色", value: meta.condition });
  facts.push({ icon: "🤝", label: "交接偏好", value: meta.tradeMode });
  if (meta.campus) facts.push({ icon: "🏫", label: "所在校区", value: meta.campus });
  if (meta.location?.trim()) facts.push({ icon: "📍", label: "参考地点", value: meta.location.trim() });
  return facts;
});
const submitButtonLabel = computed(() => {
  if (editingId.value) return "预览并重新提交";
  if (!isSecondHandPost.value) return "预览并发布";
  if (meta.marketKind === "wanted") return "预览求购帖";
  if (meta.marketKind === "discuss") return "预览讨论帖";
  return "预览闲置帖";
});
const LEGACY_FORM_DRAFT_KEY = "cpu-post-new-draft";
const LEGACY_CONTENT_DRAFT_KEY = `${LEGACY_FORM_DRAFT_KEY}-content`;
const formDraftKey = computed(() => {
  if (editingId.value) return "";
  return isSecondHandPost.value ? "cpu-post-new-draft-market" : "cpu-post-new-draft-general";
});
const contentDraftKey = computed(() => formDraftKey.value ? `${formDraftKey.value}-content` : "");
const anonymousEnabledForForm = computed(() => {
  const anonymousState = auth.user?.anonymousState;
  // 已有匿名帖转版后仍应允许编辑；匿名能力开关只约束新发布。
  if (editingId.value) return true;
  if (!currentBoard.value?.anonymousEnabled) return false;
  return Boolean(
    anonymousState?.eligible &&
    !anonymousState?.frozen &&
    (anonymousState?.availableCredits ?? 0) > 0
  );
});
const anonymousHint = computed(() => {
  const anonymousState = auth.user?.anonymousState;
  if (editingId.value) {
    return form.anonymous ? "这篇帖子会继续以匿名身份展示，编辑不会公开你的真实身份。" : "这篇帖子当前不是匿名帖。";
  }
  if (!currentBoard.value?.anonymousEnabled) return "当前板块暂不支持匿名发帖。";
  if (!anonymousState?.eligible) return `信誉值达到 ${anonymousState?.minReputation ?? 30} 后才能匿名发帖。`;
  if (anonymousState?.frozen) return "你的匿名积分当前已被冻结，请联系管理员处理。";
  if ((anonymousState?.availableCredits ?? 0) <= 0) return "本周匿名积分已用完，下周会自动刷新。";
  return `本周还剩 ${anonymousState?.availableCredits ?? 0} / ${anonymousState?.weeklyQuota ?? 0} 点匿名积分。`;
});

const selectedCourse = computed(() => courses.value.find((c) => c.id === meta.courseId));
const teacherOptions = computed(() => selectedCourse.value?.teachers ?? []);
const submitDisabled = computed(() =>
  submitting.value ||
  loading.value ||
  Boolean(loadError.value) ||
  auth.user?.status === "muted" ||
  Boolean(auth.user?.topicSubmissionLocked)
);

const groupedBoards = computed(() => {
  const groups: Record<string, Board[]> = { "💬 综合讨论": [], "🎒 学生共建": [], "📢 校园公告": [] };
  for (const b of boards.value) {
    if (b.type === "announce") groups["📢 校园公告"].push(b);
    else if (["market", "question", "coursereview"].includes(b.type)) groups["🎒 学生共建"].push(b);
    else groups["💬 综合讨论"].push(b);
  }
  return groups;
});
const mutedNotice = computed(() => auth.user?.mutedUntil ? `你已被禁言至 ${fmtDate(auth.user.mutedUntil)}，当前不能发帖或编辑发言内容` : "你当前已被禁言，暂时不能发帖或编辑发言内容");

watch(() => route.params.id, () => {
  void loadInitial();
}, { immediate: true });

watch(
  () => [smartPost.status, smartPost.task?.returnPath, route.fullPath, loading.value] as const,
  ([status, returnPath, currentPath, pageLoading]) => {
    if (
      !status?.result
      || status.state !== "completed"
      || pageLoading
      || returnPath !== currentPath
      || appliedSmartPostJobId === status.jobId
    ) return;
    appliedSmartPostJobId = status.jobId;
    form.title = status.result.title;
    form.content = status.result.content;
    setEditorMode("visual");
    scheduleFormDraftSave();
    smartPost.dismiss();
    const workflowName = status.operation === "format" ? "单轮排版" : "三轮 Agent";
    ElMessage.success(`${status.result.summary}；${workflowName}实际使用 ${status.result.usage.totalTokens} Tokens，扣除 ${status.result.usage.chargedQuota} 个 AI 额度`);
  },
  { deep: true, immediate: true },
);

watch(
  () => [
    smartPostOpen.value,
    smartPostOperation.value,
    form.title.length,
    form.content.length,
    smartPostInstruction.value.length,
    smartPostFiles.value.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|"),
  ] as const,
  ([open]) => {
    window.clearTimeout(smartPostEstimateTimer);
    if (!open) {
      smartPostEstimateSeq += 1;
      smartPostEstimateLoading.value = false;
      return;
    }
    smartPostEstimateLoading.value = true;
    smartPostEstimateTimer = window.setTimeout(() => void refreshSmartPostEstimate(), 450);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  pendingSubmissionMonitorSeq += 1;
  smartPostEstimateSeq += 1;
  window.clearTimeout(formDraftTimer);
  window.clearTimeout(markupDraftTimer);
  window.clearTimeout(smartPostEstimateTimer);
});

watch(boardType, async () => {
  if (boardType.value === "coursereview") await loadCoursesForReview();
});

watch(() => route.query.board, async (value) => {
  if (editingId.value) return;
  const nextBoard = typeof value === "string" ? value : "";
  if (!nextBoard || nextBoard === form.boardSlug) return;
  form.boardSlug = nextBoard;
  normalizeSelectedBoard();
  if (boardType.value === "coursereview") await loadCoursesForReview();
});

watch(() => currentBoard.value?.anonymousEnabled, (enabled) => {
  if (!enabled && !editingId.value) form.anonymous = false;
}, { immediate: true });

watch(anonymousEnabledForForm, (enabled) => {
  if (!enabled && !editingId.value) form.anonymous = false;
}, { immediate: true });

watch(() => [form.boardSlug, form.title, form.anonymous, publishMode.value, meta.marketKind, meta.category, meta.priceType, meta.price, meta.negotiable, meta.condition, meta.tradeMode, meta.campus, meta.location, meta.bounty, meta.courseId, meta.courseTeacherId, meta.teacherName, meta.semester, editorMode.value], () => {
  scheduleFormDraftSave();
}, { deep: true });

watch(() => meta.marketKind, () => {
  if (boardType.value === "market" && !publishModeTouched.value) publishMode.value = defaultPublishMode();
});

watch(() => form.content, (value) => {
  if (editorMode.value === "markup") scheduleMarkupDraftSave(value);
});

async function loadInitial() {
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  resetEditorStateForLoad();
  if (route.params.id && !editingId.value) {
    loadError.value = "编辑的帖子地址无效";
    loading.value = false;
    return;
  }
  try {
    const boardList = await boardApi.list({ suppressErrorMessage: true });
    if (seq !== loadSeq) return;
    boards.value = boardList;
    normalizeSelectedBoard();
    if (editingId.value) {
      const t = await topicApi.detail(editingId.value, { suppressErrorMessage: true });
      if (seq !== loadSeq) return;
      form.boardSlug = t.board?.slug ?? "";
      form.title = t.title;
      form.content = t.content;
      form.anonymous = Boolean(t.isAnonymous);
      if (t.metadata) Object.assign(meta, t.metadata);
      publishMode.value = t.metadata?._postMode === "say" ? "say" : "post";
      publishModeTouched.value = true;
      if (t.board?.type === "market") normalizeExistingMarketMeta(t.metadata || {});
      editorMode.value = resolveInitialEditorMode(t.content, t.metadata);
      normalizeSelectedBoard();
    } else {
      migrateLegacyDraftForCurrentScope();
      restoreFormDraft();
      restoreContentDraft();
      if (typeof route.query.kind === "string") meta.marketKind = routeMarketKind();
      if (boardType.value === "market") normalizeExistingMarketMeta(meta);
      if (!publishModeTouched.value) publishMode.value = defaultPublishMode();
      restorePendingTopicSubmission();
      if (pendingSubmissionAttempt.value) void monitorPendingTopicSubmission(pendingSubmissionAttempt.value.submissionId);
    }
    normalizeSelectedBoard();
    if (boardType.value === "coursereview") await loadCoursesForReview();
  } catch (error) {
    if (seq !== loadSeq) return;
    loadError.value = normalizePostLoadError(error);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function resetEditorStateForLoad() {
  window.clearTimeout(formDraftTimer);
  window.clearTimeout(markupDraftTimer);
  previewOpen.value = false;
  pendingMetadata.value = null;
  reviewBlockedOpen.value = false;
  manualReviewConfirmOpen.value = false;
  requestingManualReview.value = false;
  blockedTopicId.value = null;
  blockedReviewInfo.reason = "";
  blockedReviewInfo.riskScore = null;
  editorMode.value = "visual";
  publishMode.value = route.query.mode === "say" ? "say" : "post";
  publishModeTouched.value = typeof route.query.mode === "string";
  form.boardSlug = typeof route.query.board === "string" && !editingId.value ? route.query.board : "";
  form.title = "";
  form.content = "";
  form.anonymous = false;
  Object.assign(meta, defaultPostMeta());
}

async function loadCoursesForReview(force = false) {
  if (coursesLoading.value || (!force && coursesLoaded.value)) return;
  coursesLoading.value = true;
  courseLoadError.value = "";
  try {
    courses.value = await courseApi.list(undefined, false, { suppressErrorMessage: true });
    coursesLoaded.value = true;
  } catch (error) {
    courses.value = [];
    coursesLoaded.value = false;
    courseLoadError.value = normalizeCourseListError(error);
  } finally {
    coursesLoading.value = false;
  }
}

function onBoardChange() {
  publishModeTouched.value = false;
  publishMode.value = defaultPublishMode();
  if (boardType.value === "coursereview") void loadCoursesForReview();
}

function defaultPublishMode(): PublishMode {
  if (form.boardSlug === "general") return "say";
  if (boardType.value === "market" && meta.marketKind === "discuss") return "say";
  return "post";
}

function selectPublishMode(mode: PublishMode) {
  publishMode.value = mode;
  publishModeTouched.value = true;
}

function getRequestStatus(error: unknown) {
  return typeof error === "object" && error !== null
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;
}

function getRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function normalizePostLoadError(error: unknown) {
  const status = getRequestStatus(error);
  if (status === 401) return "登录状态已失效，请重新登录后再试";
  if (status === 403) return "你没有权限编辑这篇帖子";
  if (status === 404) return "帖子不存在或已被删除";
  return getRequestMessage(error) || "发帖页加载失败，请稍后重试";
}

function normalizeCourseListError(error: unknown) {
  const message = getRequestMessage(error);
  return message ? `课程列表加载失败：${message}` : "课程列表加载失败，请稍后重试";
}

function normalizeSelectedBoard() {
  if (!form.boardSlug) return;
  if (!boards.value.length) return;
  if (boards.value.some((b) => b.slug === form.boardSlug)) return;
  form.boardSlug = "";
}

function onCourseChange() {
  // 换课程时清掉老师选择，避免把上一门课的 courseTeacherId 误带过去
  meta.courseTeacherId = undefined;
  meta.teacherName = "";
}
function onPickKnownTeacher(v: number | undefined) {
  if (v) meta.teacherName = ""; // 选了已有老师 → 清掉手输
}
function onTypeNewTeacher(v: string) {
  if (v && v.trim()) meta.courseTeacherId = undefined; // 开始手输 → 清掉已选
}

function normalizeEditorMode(value: unknown): PostEditorMode | null {
  return value === "markup" || value === "visual" ? value : null;
}

function looksLikeHtmlContent(value: string) {
  return /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|img|video|table|thead|tbody|tr|th|td|a)\b/i.test(value);
}

function looksLikeMarkdownSource(value: string) {
  return /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|\|.+\|)|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)/m.test(value);
}

function resolveInitialEditorMode(content: string, metadata?: Record<string, any> | null): PostEditorMode {
  const saved = normalizeEditorMode(metadata?._editorMode);
  if (saved) return saved;
  if (!looksLikeHtmlContent(content) && looksLikeMarkdownSource(content)) return "markup";
  return "visual";
}

function isMarkupContentEmpty(value: string) {
  const raw = String(value || "");
  const hasMedia = /!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>|<video\b[\s\S]*?<\/video>|<source\b[^>]*>/i.test(raw);
  const text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<video\b[\s\S]*?<\/video>/gi, " ")
    .replace(/<source\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~\-[\]()|]/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return !text && !hasMedia;
}

function isEditorContentEmpty() {
  if (editorMode.value === "markup") return isMarkupContentEmpty(form.content);
  return editorRef.value?.isContentEmpty() ?? isMarkupContentEmpty(form.content);
}

function onContentDraftRestored(value: string) {
  form.content = value;
}

function migrateLegacyDraftForCurrentScope() {
  if (!formDraftKey.value) return;
  try {
    if (localStorage.getItem(formDraftKey.value)) return;
    const raw = localStorage.getItem(LEGACY_FORM_DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    const draftIsMarket = draft?.boardSlug === "market";
    if (draftIsMarket !== isSecondHandPost.value) return;
    localStorage.setItem(formDraftKey.value, raw);
    const legacyContent = localStorage.getItem(LEGACY_CONTENT_DRAFT_KEY);
    if (legacyContent && contentDraftKey.value) localStorage.setItem(contentDraftKey.value, legacyContent);
    localStorage.removeItem(LEGACY_FORM_DRAFT_KEY);
    localStorage.removeItem(LEGACY_CONTENT_DRAFT_KEY);
  } catch {
    /* ignore malformed legacy drafts */
  }
}

function restoreFormDraft() {
  if (!formDraftKey.value) return;
  try {
    const raw = localStorage.getItem(formDraftKey.value);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (typeof draft.title === "string" && !form.title) form.title = draft.title;
    if (typeof draft.boardSlug === "string" && !form.boardSlug) form.boardSlug = draft.boardSlug;
    if (typeof draft.anonymous === "boolean") form.anonymous = draft.anonymous;
    if (draft.publishMode === "say" || draft.publishMode === "post") {
      publishMode.value = draft.publishMode;
      publishModeTouched.value = true;
    }
    if (draft.meta && typeof draft.meta === "object") Object.assign(meta, draft.meta);
    const savedMode = normalizeEditorMode(draft.editorMode ?? draft.meta?._editorMode);
    if (savedMode) editorMode.value = savedMode;
  } catch {
    /* ignore */
  }
}

function restoreContentDraft() {
  if (!contentDraftKey.value || form.content) return;
  try {
    const raw = localStorage.getItem(contentDraftKey.value);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (typeof draft?.content === "string" && draft.content.trim()) {
      form.content = draft.content;
    }
  } catch {
    /* ignore */
  }
}

function hasSavedDraft(key: string) {
  if (!key) return false;
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}

function scheduleFormDraftSave() {
  if (!formDraftKey.value) return;
  window.clearTimeout(formDraftTimer);
  formDraftTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(formDraftKey.value, JSON.stringify({
        boardSlug: form.boardSlug,
        title: form.title,
        anonymous: form.anonymous,
        publishMode: publishMode.value,
        editorMode: editorMode.value,
        meta,
        savedAt: Date.now(),
      }));
    } catch {
      /* ignore */
    }
  }, 400);
}

function scheduleMarkupDraftSave(content: string) {
  if (!contentDraftKey.value) return;
  window.clearTimeout(markupDraftTimer);
  markupDraftTimer = window.setTimeout(() => {
    try {
      if (isMarkupContentEmpty(content)) {
        localStorage.removeItem(contentDraftKey.value);
      } else {
        localStorage.setItem(contentDraftKey.value, JSON.stringify({
          content,
          savedAt: Date.now(),
        }));
      }
    } catch {
      /* ignore */
    }
  }, 400);
}

function clearDrafts() {
  if (!formDraftKey.value) return;
  localStorage.removeItem(formDraftKey.value);
  if (contentDraftKey.value) localStorage.removeItem(contentDraftKey.value);
  editorRef.value?.clearDraft();
}

function setEditorMode(nextMode: PostEditorMode) {
  if (editorMode.value === nextMode) return;
  editorMode.value = nextMode;
  scheduleFormDraftSave();
  if (nextMode === "markup") scheduleMarkupDraftSave(form.content);
}

async function openSecondHandImagePicker() {
  if (editorMode.value !== "visual") {
    setEditorMode("visual");
    await nextTick();
  }
  editorRef.value?.pickImages();
}

async function insertMarkupSnippet(snippet: string) {
  const textarea = markupTextareaRef.value;
  if (!textarea) {
    form.content = `${form.content}${snippet}`;
    return;
  }
  const start = textarea.selectionStart ?? form.content.length;
  const end = textarea.selectionEnd ?? start;
  const nextContent = `${form.content.slice(0, start)}${snippet}${form.content.slice(end)}`;
  form.content = nextContent;
  await nextTick();
  textarea.focus();
  const cursor = start + snippet.length;
  textarea.setSelectionRange(cursor, cursor);
}

function openSmartPost() {
  if (smartPostBusy.value) {
    ElMessage.info("智慧发帖 Agent 正在后台处理，请查看页面右下角的任务进度");
    return;
  }
  smartPostOperation.value = isMarkupContentEmpty(form.content) ? "compose" : "polish";
  smartPostOpen.value = true;
}

function handleSmartPostFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = Array.from(input.files || []);
  input.value = "";
  if (!selected.length) return;
  const next = [...smartPostFiles.value];
  let totalSize = next.reduce((sum, file) => sum + file.size, 0);
  for (const file of selected) {
    if (next.length >= 8) {
      ElMessage.warning("智慧发帖最多上传 8 个附件");
      break;
    }
    if (!/\.(?:pdf|docx|pptx|txt|md|png|jpe?g|webp|gif)$/iu.test(file.name)) {
      ElMessage.warning(`${file.name}：不支持此文件类型`);
      continue;
    }
    if (file.size <= 0) {
      ElMessage.warning(`${file.name}：文件为空`);
      continue;
    }
    const image = /\.(?:png|jpe?g|webp|gif)$/iu.test(file.name);
    const maxBytes = (image ? 8 : 15) * 1024 * 1024;
    if (file.size > maxBytes) {
      ElMessage.warning(`${file.name}：${image ? "图片" : "文档"}不能超过 ${image ? 8 : 15}MB`);
      continue;
    }
    if (totalSize + file.size > 40 * 1024 * 1024) {
      ElMessage.warning("附件总大小不能超过 40MB");
      continue;
    }
    if (next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue;
    next.push(file);
    totalSize += file.size;
  }
  smartPostFiles.value = next;
}

function removeSmartPostFile(index: number) {
  smartPostFiles.value = smartPostFiles.value.filter((_file, fileIndex) => fileIndex !== index);
}

function clearSmartPostFiles() {
  smartPostFiles.value = [];
  if (smartPostFileInputRef.value) smartPostFileInputRef.value.value = "";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatTokenCount(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString("zh-CN");
}

async function refreshSmartPostEstimate() {
  const seq = ++smartPostEstimateSeq;
  smartPostEstimateLoading.value = true;
  try {
    const estimate = await topicApi.estimateSmartCompose({
      textLength: Math.min(25_000, form.title.length + form.content.length + smartPostInstruction.value.length),
      operation: smartPostOperation.value,
      files: smartPostOperation.value !== "format"
        ? smartPostFiles.value.map((file) => ({ name: file.name, size: file.size }))
        : [],
    });
    if (seq !== smartPostEstimateSeq || !smartPostOpen.value) return;
    smartPostEstimate.value = estimate;
  } catch {
    if (seq !== smartPostEstimateSeq || !smartPostOpen.value) return;
    smartPostEstimate.value = null;
  } finally {
    if (seq === smartPostEstimateSeq) smartPostEstimateLoading.value = false;
  }
}

async function runSmartPost() {
  if (smartPostRunning.value) return;
  const requestFiles = smartPostOperation.value === "format" ? [] : smartPostFiles.value;
  if (smartPostOperation.value !== "compose" && isMarkupContentEmpty(form.content)) {
    ElMessage.warning("请先在编辑器中填写需要处理的正文");
    return;
  }
  if (smartPostOperation.value === "compose" && isMarkupContentEmpty(form.content) && !requestFiles.length) {
    ElMessage.warning("请先填写文字，或选择图片、PPT、Word、PDF 等材料");
    return;
  }
  smartPostRunning.value = true;
  try {
    await smartPost.begin({
      title: form.title.trim() || undefined,
      content: isMarkupContentEmpty(form.content) ? undefined : form.content,
      instruction: smartPostInstruction.value.trim() || undefined,
      operation: smartPostOperation.value,
      boardSlug: form.boardSlug || undefined,
      files: requestFiles,
    }, route.fullPath, auth.user!.id);
    smartPostOpen.value = false;
    clearSmartPostFiles();
    ElMessage.success("任务已转入后台，可以继续浏览其他页面；完成或失败后会持续显示结果");
  } catch (error) {
    ElMessage.error(getForumRequestMessage(error) || "智慧发帖任务提交失败，请稍后重试");
  } finally {
    smartPostRunning.value = false;
  }
}

async function submit() {
  if (submitting.value) return;
  if (loading.value) { ElMessage.warning("页面还在加载，请稍后再试"); return; }
  if (loadError.value) { ElMessage.warning("页面加载失败，请重试后再发布"); return; }
  if (auth.user?.status === "muted") { ElMessage.warning(mutedNotice.value); return; }
  if (auth.user?.topicSubmissionLocked) { ElMessage.warning("你有内容正在人工复核，暂时不能继续提交新内容"); return; }
  if (!form.boardSlug) { ElMessage.warning("请选择板块"); return; }
  if (form.anonymous && !anonymousEnabledForForm.value) { ElMessage.warning(anonymousHint.value); return; }
  if (publishMode.value === "post" && form.title.trim().length < 2) { ElMessage.warning("标题至少 2 字"); return; }
  if (isEditorContentEmpty()) { ElMessage.warning("请填写正文"); return; }
  if (form.content.length > CONTENT_MAX) { ElMessage.warning("正文内容过长，请精简后再发布"); return; }
  if (publishMode.value === "say") {
    form.title = forumInternalTitle(form.content, currentBoard.value?.name ? `${currentBoard.value.name}动态` : "新动态");
  }
  const metadata = buildMetadata();
  if (!metadata) return;
  pendingMetadata.value = metadata;
  previewOpen.value = true;
}

function buildMetadata() {
  // 组织 metadata
  const metadata: any = {
    _editorMode: editorMode.value,
    _postMode: publishMode.value,
  };
  if (boardType.value === "market") {
    metadata.marketKind = meta.marketKind;
    if (meta.marketKind !== "discuss") {
      if (!SECOND_HAND_CATEGORIES.some((item) => item.value === meta.category)) {
        ElMessage.warning("请选择物品分类");
        return null;
      }
      if (meta.priceType !== "fixed" && meta.priceType !== "negotiable") {
        ElMessage.warning("请选择价格方式");
        return null;
      }
      if (meta.priceType === "fixed") {
        const price = Number(meta.price);
        if (!Number.isFinite(price) || price <= 0) {
          ElMessage.warning(meta.marketKind === "wanted" ? "请填写预算，或选择面议" : "请填写价格，或选择面议");
          return null;
        }
        metadata.price = price;
      }
      if (!SECOND_HAND_TRADE_MODES.includes(meta.tradeMode)) {
        ElMessage.warning("请选择交接偏好");
        return null;
      }
      if (meta.marketKind === "sell" && !SECOND_HAND_CONDITIONS.includes(meta.condition)) {
        ElMessage.warning("请选择物品成色");
        return null;
      }
      metadata.listingType = meta.marketKind === "wanted" ? "wanted" : "sell";
      metadata.category = meta.category;
      metadata.priceType = meta.priceType;
      metadata.negotiable = meta.priceType === "negotiable" || Boolean(meta.negotiable);
      if (meta.marketKind === "sell") metadata.condition = meta.condition;
      metadata.tradeMode = meta.tradeMode;
      if (meta.campus?.trim()) metadata.campus = meta.campus.trim();
      if (meta.location?.trim()) metadata.location = meta.location.trim();
    }
  } else if (boardType.value === "question") {
    metadata.bounty = meta.bounty;
    metadata.resolved = false;
  } else if (boardType.value === "coursereview") {
    if (!meta.courseId) { ElMessage.warning("请选择课程"); return null; }
    if (!meta.courseTeacherId && !meta.teacherName?.trim()) {
      ElMessage.warning("请选择或填写授课老师");
      return null;
    }
    metadata.courseId = meta.courseId;
    if (meta.courseTeacherId) metadata.courseTeacherId = meta.courseTeacherId;
    else metadata.teacherName = meta.teacherName.trim();
    metadata.ratings = meta.ratings;
    if (meta.semester) metadata.semester = meta.semester;
  }
  return metadata;
}

function topicSubmissionFingerprint(metadata: unknown) {
  return JSON.stringify({
    boardSlug: form.boardSlug,
    title: form.title,
    content: form.content,
    metadata,
    anonymous: form.anonymous,
  });
}

function getTopicSubmissionId(fingerprint: string) {
  if (pendingSubmissionAttempt.value?.fingerprint === fingerprint) {
    return pendingSubmissionAttempt.value.submissionId;
  }
  const submissionId = createForumSubmissionId("topic");
  pendingSubmissionAttempt.value = { fingerprint, submissionId };
  persistPendingTopicSubmission();
  return submissionId;
}

function persistPendingTopicSubmission() {
  try {
    if (pendingSubmissionAttempt.value) {
      localStorage.setItem(PENDING_TOPIC_SUBMISSION_KEY, JSON.stringify(pendingSubmissionAttempt.value));
    } else {
      localStorage.removeItem(PENDING_TOPIC_SUBMISSION_KEY);
    }
  } catch {
    // Storage may be unavailable; the server-side submission remains recoverable by notification.
  }
}

function restorePendingTopicSubmission() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_TOPIC_SUBMISSION_KEY) || "null");
    if (parsed && typeof parsed.fingerprint === "string" && typeof parsed.submissionId === "string") {
      pendingSubmissionAttempt.value = parsed;
    }
  } catch {
    pendingSubmissionAttempt.value = null;
  }
}

function clearPendingTopicSubmission() {
  pendingSubmissionAttempt.value = null;
  persistPendingTopicSubmission();
}

function pendingTopicStillMatchesCurrentDraft() {
  try {
    const parsed = JSON.parse(pendingSubmissionAttempt.value?.fingerprint || "null");
    return Boolean(
      parsed
      && parsed.boardSlug === form.boardSlug
      && parsed.title === form.title
      && parsed.content === form.content
      && Boolean(parsed.anonymous) === Boolean(form.anonymous)
    );
  } catch {
    return false;
  }
}

async function monitorPendingTopicSubmission(submissionId: string) {
  const seq = ++pendingSubmissionMonitorSeq;
  const result = await waitForForumSubmissionResult(
    () => topicApi.submissionStatus(submissionId),
    { attempts: 180, intervalMs: 1_000 },
  ).catch(() => null);
  if (seq !== pendingSubmissionMonitorSeq) return;
  if (!result) {
    ElMessage.info("审核仍在后台继续，完成后会通过站内通知告知结果");
    return;
  }
  await handleTopicSubmissionResult(result);
}

async function handleTopicSubmissionResult(r: TopicSubmissionResponse, editing = false) {
  if (form.anonymous) await auth.fetchMe();
  previewOpen.value = false;
  if (r.submissionResult?.status === "pending") {
    const shouldClearCurrentDraft = pendingTopicStillMatchesCurrentDraft();
    clearPendingTopicSubmission();
    if (shouldClearCurrentDraft) clearDrafts();
    ElMessage.success(editing ? "修改已提交审核，正在前往帖子页" : "帖子已提交审核，正在前往帖子页");
    await router.replace(`/forum/topic/${editing ? editingId.value : r.id}`);
    return;
  }
  if (r.submissionResult?.status === "failed") {
    ElMessage.error(r.submissionResult.reason || "审核服务暂时不可用，草稿已保留，请稍后重试");
    return;
  }
  if (r.submissionResult?.status === "manual_review") {
    clearPendingTopicSubmission();
    ElMessage.warning(r.submissionResult.reason || "审核服务异常，帖子已自动转入人工审核，后台仍会继续尝试 AI 审核");
    await router.replace(`/forum/topic/${editing ? editingId.value : r.id}`);
    return;
  }
  if (r.submissionResult?.status === "deleted") {
    clearPendingTopicSubmission();
    ElMessage.info("这篇帖子已经删除");
    return;
  }
  if (r.submissionResult?.status === "blocked_ai") {
    clearPendingTopicSubmission();
    blockedTopicId.value = editing ? editingId.value : r.id;
    blockedReviewInfo.reason = r.submissionResult.reason || "检测到较高风险内容";
    blockedReviewInfo.riskScore = r.submissionResult.riskScore ?? null;
    reviewBlockedOpen.value = true;
    ElMessage.warning(editing ? "修改后的内容暂未通过审核" : "内容暂未通过审核");
    return;
  }
  const shouldClearCurrentDraft = pendingTopicStillMatchesCurrentDraft();
  clearPendingTopicSubmission();
  notifyImageReviewState(r.submissionResult?.imageReview);
  notifyVideoReviewState(r.submissionResult?.videoReview);
  if (shouldClearCurrentDraft) clearDrafts();
  ElMessage.success(r.submissionResult?.replayed ? "已确认发布成功" : (editing ? "修改已发布" : "已发布"));
  if (editing || shouldClearCurrentDraft) {
    await router.replace(`/forum/topic/${editing ? editingId.value : r.id}`);
  } else {
    ElMessage.info("此前提交的帖子已发布；当前新草稿已保留在编辑器中");
  }
}

async function confirmSubmit() {
  if (submitting.value) return;
  const metadata = pendingMetadata.value;
  if (!metadata) return;
  submitting.value = true;
  submissionProgress.value = "正在提交审核…";
  try {
    if (editingId.value) {
      try {
        const r = await topicApi.update(editingId.value, {
          title: form.title,
          content: form.content,
          metadata,
        });
        await handleTopicSubmissionResult(r, true);
      } catch (error) {
        if (!isAmbiguousForumSubmissionError(error)) {
          ElMessage.error(getForumRequestMessage(error) || "保存失败，请稍后重试");
          return;
        }
        submissionProgress.value = "连接中断，正在确认审核状态…";
        const current = await topicApi.detail(editingId.value, { cacheTtlMs: 0, suppressErrorMessage: true }).catch(() => null);
        const saved = current
          && current.title === form.title
          && current.content === form.content
          && JSON.stringify(current.metadata ?? {}) === JSON.stringify(metadata ?? {});
        const reviewState = current ? resolveForumReviewState(current) : "unknown";
        if (saved && reviewState !== "unknown") {
          await handleTopicSubmissionResult({
            ...current,
            submissionResult: {
              status: reviewState,
              reason: current.aiReviewReason || undefined,
              riskLevel: current.aiRiskLevel || undefined,
              riskScore: current.aiRiskScore ?? undefined,
              replayed: true,
            },
          }, true);
          return;
        }
        ElMessage.warning("暂未确认审核状态，内容仍保留在编辑器中，请稍后重试");
      }
      return;
    }

    const fingerprint = topicSubmissionFingerprint(metadata);
    const submissionId = getTopicSubmissionId(fingerprint);
    let result: TopicSubmissionResponse | null = null;
    try {
      result = await topicApi.create({
        boardSlug: form.boardSlug,
        title: form.title,
        content: form.content,
        metadata,
        anonymous: form.anonymous,
        submissionId,
      });
    } catch (error) {
      if (!isAmbiguousForumSubmissionError(error)) {
        clearPendingTopicSubmission();
        ElMessage.error(getForumRequestMessage(error) || "发布失败，请检查内容后重试");
        return;
      }
      submissionProgress.value = "连接中断，正在确认是否已发布…";
      result = await reconcileForumSubmission(() => topicApi.submissionStatus(submissionId));
      if (!result) {
        ElMessage.warning("暂未确认发布结果，草稿已保留；再次点击发布也不会重复发帖");
        return;
      }
    }
    await handleTopicSubmissionResult(result);
  } finally {
    submitting.value = false;
    submissionProgress.value = "";
  }
}

async function confirmManualReviewRequest() {
  if (!blockedTopicId.value) return;
  requestingManualReview.value = true;
  try {
    await topicApi.requestManualReview(blockedTopicId.value);
    await auth.fetchMe();
    clearDrafts();
    reviewBlockedOpen.value = false;
    ElMessage.success("已提交人工复核申请");
    router.replace("/forum");
  } finally {
    requestingManualReview.value = false;
  }
}

function notifyImageReviewState(summary?: { enabled: boolean; totalCount: number; pendingCount: number; rejectedCount: number } | null) {
  if (!summary?.totalCount) return;
  if (!summary.enabled) {
    ElMessage.info(`本次包含 ${summary.totalCount} 张图片。当前图片审核未启用，图片会直接展示。`);
    return;
  }
  if (summary.pendingCount > 0) {
    ElMessage.info(`已提交 ${summary.pendingCount} 张图片审核，审核通过后才会显示原图。`);
  }
}

function notifyVideoReviewState(summary?: {
  enabled: boolean;
  totalCount: number;
  pendingCount: number;
  rejectedCount: number;
  manualReviewCount: number;
} | null) {
  if (!summary?.totalCount) return;
  if (!summary.enabled) {
    ElMessage.info(`本次包含 ${summary.totalCount} 个视频。当前视频审核未启用，视频会直接展示。`);
    return;
  }
  if (summary.manualReviewCount > 0) {
    ElMessage.warning(`有 ${summary.manualReviewCount} 个视频进入人工复核，当前会先隐藏。`);
    return;
  }
  if (summary.pendingCount > 0) {
    ElMessage.info(`已提交 ${summary.pendingCount} 个视频审核，审核通过后才会显示。`);
  }
}
</script>

<style scoped>
.post-page { display: flex; flex-direction: column; gap: 16px; }
.post-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.post-page-header p {
  margin: 7px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}
.post-page-header.second-hand-page-header {
  position: relative;
  overflow: hidden;
  padding: 22px 24px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 22%, var(--cpu-border-soft));
  border-radius: 16px;
  background:
    radial-gradient(circle at 92% -20%, color-mix(in srgb, var(--cpu-primary) 19%, transparent) 0, transparent 45%),
    linear-gradient(135deg, color-mix(in srgb, var(--cpu-card) 90%, #7c3aed) 0%, var(--cpu-card) 72%);
}
.page-eyebrow {
  display: block;
  margin-bottom: 5px;
  color: var(--cpu-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
}
.page-title { margin: 0; font-size: 22px; }
.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--cpu-shadow-sm);
}
.post-load-state { min-height: 280px; display: grid; place-items: center; }

.option-icon {
  margin-right: 6px;
}

.option-note {
  float: right;
  color: var(--cpu-text-muted);
  font-size: 12px;
}

.post-editor-shell {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.post-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.editor-mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: var(--cpu-surface-subtle);
  border: 1px solid var(--cpu-border-soft);
}

.editor-mode-btn {
  border: 0;
  background: transparent;
  color: var(--cpu-text-secondary);
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.editor-mode-btn.active {
  background: var(--cpu-card);
  color: var(--cpu-text);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}

.editor-mode-hint {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.smart-post-dialog {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.smart-post-field {
  display: flex;
  flex-direction: column;
  gap: 9px;
  color: var(--cpu-text);
  font-size: 14px;
  font-weight: 600;
}

.smart-post-file-input {
  display: none;
}

.smart-post-mode-note {
  padding: 11px 13px;
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.smart-post-file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px dashed var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
}

.smart-post-file-row > span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-post-file-list {
  display: grid;
  gap: 7px;
  max-height: 180px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.smart-post-file-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 9px;
  background: var(--cpu-card);
  font-size: 12px;
  font-weight: 400;
}

.smart-post-file-list li > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-post-file-list small {
  color: var(--cpu-text-muted);
}

.smart-post-estimate {
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 24%, var(--cpu-border-soft));
  border-radius: 10px;
  background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-card));
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.smart-post-estimate strong {
  color: var(--cpu-primary);
}

.smart-post-privacy {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: 12px;
  line-height: 1.7;
}

.markup-editor-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 16px;
  padding: 14px;
  background: linear-gradient(180deg, var(--cpu-surface-subtle) 0%, var(--cpu-card) 100%);
}

.markup-helper-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.markup-helper-btn {
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.markup-editor {
  width: 100%;
  min-height: 320px;
  resize: vertical;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  padding: 14px 16px;
  background: #0f172a;
  color: #e2e8f0;
  font: 13px/1.75 var(--cpu-font-mono);
  outline: none;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.18);
}

.markup-editor::placeholder {
  color: #94a3b8;
}

.markup-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.markup-meta .warn {
  color: #dc2626;
  font-weight: 600;
}

.markup-preview {
  border-radius: 14px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
  padding: 14px;
}

.markup-preview__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.markup-preview__head strong {
  color: var(--cpu-text);
  font-size: 14px;
}

.markup-preview__empty {
  border-radius: 12px;
  padding: 20px 16px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-muted);
  font-size: 13px;
  text-align: center;
}

.markup-preview :deep(.md) {
  padding: 0;
}

.board-hint { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 6px; }
.publish-mode-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: -2px 0 22px;
}
.publish-mode-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
  color: var(--cpu-text);
  text-align: left;
  cursor: pointer;
}
.publish-mode-option span { color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.5; }
.publish-mode-option.active {
  border-color: color-mix(in srgb, var(--cpu-primary) 58%, var(--cpu-border));
  background: color-mix(in srgb, var(--cpu-primary) 8%, var(--cpu-card));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--cpu-primary) 10%, transparent);
}
.field-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: #dc2626;
  font-size: 12px;
  line-height: 1.5;
}

.text-retry-btn {
  border: 0;
  background: transparent;
  color: #2563eb;
  padding: 0;
  font-size: 12px;
  cursor: pointer;
}

.text-retry-btn:disabled {
  color: var(--cpu-text-muted);
  cursor: not-allowed;
}

.text-retry-btn:focus-visible {
  outline: 2px solid rgba(37, 99, 235, 0.32);
  outline-offset: 2px;
  border-radius: 4px;
}

.anonymous-box {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--cpu-border-soft);
  background: linear-gradient(180deg, color-mix(in srgb, var(--cpu-card) 94%, #7c3aed), var(--cpu-card) 100%);
}

.anonymous-box.disabled {
  opacity: 0.78;
}

.anonymous-copy b {
  display: block;
  font-size: 14px;
  color: var(--cpu-primary);
  margin-bottom: 4px;
}

.anonymous-copy p {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.second-hand-form {
  margin: 0 0 24px;
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 18px;
  background: color-mix(in srgb, var(--cpu-surface-subtle) 56%, var(--cpu-card));
}

.market-image-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
  padding: 13px 14px;
  border: 1px dashed color-mix(in srgb, var(--cpu-primary) 34%, var(--cpu-border));
  border-radius: 12px;
  background: var(--cpu-card);
}
.market-image-copy { display: flex; align-items: center; gap: 11px; min-width: 0; }
.market-image-icon {
  display: grid;
  flex: 0 0 42px;
  height: 42px;
  place-items: center;
  border-radius: 11px;
  background: color-mix(in srgb, var(--cpu-primary) 11%, var(--cpu-card));
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
}
.market-image-copy b { color: var(--cpu-text); font-size: 13px; }
.market-image-copy small { color: var(--cpu-text-muted); font-weight: 500; }
.market-image-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.market-image-actions > span { color: var(--cpu-primary); font-size: 12px; white-space: nowrap; }

.second-hand-form-head,
.second-hand-section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.second-hand-form-head {
  padding: 20px 20px 12px;
}

.second-hand-form-head > div,
.second-hand-section-title {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}

.second-hand-form h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 15px;
  line-height: 1.45;
}

.second-hand-form p {
  margin: 3px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.section-step {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: 10px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--cpu-primary) 12%, var(--cpu-card));
  color: var(--cpu-primary);
  font-size: 10px;
  font-weight: 800;
}

.forum-only-badge {
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 24%, var(--cpu-border-soft));
  border-radius: 999px;
  background: var(--cpu-card);
  color: var(--cpu-primary);
  font-size: 11px;
  font-weight: 700;
}

.second-hand-kind-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 0 20px 20px;
}

.second-hand-kind {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 13px;
  background: var(--cpu-card);
  color: var(--cpu-text);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.second-hand-kind:hover {
  border-color: color-mix(in srgb, var(--cpu-primary) 42%, var(--cpu-border-soft));
  transform: translateY(-1px);
}

.second-hand-kind.active {
  border-color: color-mix(in srgb, var(--cpu-primary) 72%, var(--cpu-border-soft));
  background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-card));
  box-shadow: 0 7px 18px color-mix(in srgb, var(--cpu-primary) 12%, transparent);
}

.second-hand-kind:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--cpu-primary) 25%, transparent);
  outline-offset: 2px;
}

.second-hand-kind__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--cpu-surface-subtle);
  font-size: 19px;
}

.second-hand-kind b,
.second-hand-kind small {
  display: block;
}

.second-hand-kind b {
  margin-bottom: 3px;
  font-size: 14px;
}

.second-hand-kind small {
  overflow: hidden;
  color: var(--cpu-text-secondary);
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.second-hand-kind__check {
  position: absolute;
  top: 8px;
  right: 9px;
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--cpu-primary);
  color: #fff;
  font-size: 10px;
  opacity: 0;
  transform: scale(0.72);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.second-hand-kind.active .second-hand-kind__check {
  opacity: 1;
  transform: scale(1);
}

.second-hand-section {
  padding: 20px;
  border-top: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
}

.second-hand-section-title {
  margin-bottom: 17px;
}

.market-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
  padding-left: 38px;
}

.market-form-grid :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 17px;
}

.market-form-grid :deep(.el-form-item__content) {
  min-width: 0;
}

.market-field-control,
.market-field-control:deep(.el-input-number) {
  width: 100%;
}

.market-price-type {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  width: 100%;
}

.market-price-type :deep(.el-radio-button),
.market-price-type :deep(.el-radio-button__inner) {
  width: 100%;
}

.market-negotiable {
  flex: 0 0 auto;
  margin-left: 12px;
}

.market-location-field {
  grid-column: 1 / -1;
}

.second-hand-discuss-prompt {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 0 20px 20px;
  padding: 15px 16px;
  border: 1px dashed color-mix(in srgb, var(--cpu-primary) 30%, var(--cpu-border-soft));
  border-radius: 13px;
  background: var(--cpu-card);
}

.second-hand-discuss-prompt > span {
  font-size: 22px;
}

.second-hand-discuss-prompt b {
  color: var(--cpu-text);
  font-size: 13px;
}

.second-hand-safety {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid color-mix(in srgb, #d97706 22%, var(--cpu-border-soft));
  background: color-mix(in srgb, #f59e0b 7%, var(--cpu-card));
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.second-hand-safety b {
  flex: 0 0 auto;
  color: color-mix(in srgb, #b45309 72%, var(--cpu-text));
}

.second-hand-description-guide {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 18%, var(--cpu-border-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--cpu-primary) 5%, var(--cpu-card));
}

.second-hand-description-guide > span {
  color: var(--cpu-primary);
  font-size: 17px;
}

.second-hand-description-guide b {
  display: block;
  color: var(--cpu-text);
  font-size: 13px;
}

.second-hand-description-guide p {
  margin: 3px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.rate-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 700px) { .rate-row { grid-template-columns: 1fr 1fr; } }

.teacher-pick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}
.or-text { color: var(--cpu-text-muted); font-size: 12px; }

.publish-preview {
  color: var(--cpu-text);
}

.preview-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  margin-bottom: 8px;
}

.publish-preview h3 {
  margin: 0 0 12px;
  color: var(--cpu-text);
  font-size: 20px;
  line-height: 1.35;
}

.preview-anon-tag {
  margin-bottom: 10px;
}

.second-hand-preview-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 2px 0 16px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
}

.second-hand-preview-fact {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 7px;
  min-width: 0;
}

.second-hand-preview-fact > span {
  grid-row: 1 / span 2;
  align-self: center;
}

.second-hand-preview-fact small {
  color: var(--cpu-text-muted);
  font-size: 10px;
}

.second-hand-preview-fact b {
  overflow: hidden;
  color: var(--cpu-text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-preview :deep(.md) {
  max-height: min(58dvh, 520px);
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-card);
}

.cpu-muted { font-size: 12px; color: var(--cpu-text-muted); }
.review-blocked p { margin: 0 0 10px; line-height: 1.7; color: var(--cpu-text-secondary); }
.review-blocked p:last-child { margin-bottom: 0; }

@media (max-width: 700px) {
  .page-title {
    font-size: 20px;
  }

  .post-page-header,
  .post-page-header.second-hand-page-header {
    align-items: stretch;
    flex-direction: column;
  }

  .post-page-header.second-hand-page-header {
    padding: 17px;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 14px;
  }

  .second-hand-form-head {
    padding: 16px 14px 11px;
  }

  .publish-mode-picker { gap: 7px; margin-bottom: 18px; }
  .publish-mode-option { padding: 11px; }
  .publish-mode-option span { font-size: 11px; }

  .second-hand-kind-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 7px;
    padding: 0 14px 16px;
  }

  .second-hand-kind {
    align-items: center;
    flex-direction: column;
    gap: 6px;
    padding: 11px 6px;
    text-align: center;
  }

  .second-hand-kind__icon {
    width: 34px;
    height: 34px;
    font-size: 17px;
  }

  .second-hand-kind b {
    margin-bottom: 0;
    font-size: 13px;
  }

  .second-hand-kind small {
    display: none;
  }

  .second-hand-section {
    padding: 17px 14px;
  }

  .market-form-grid {
    grid-template-columns: 1fr;
    padding-left: 0;
  }

  .market-location-field {
    grid-column: auto;
  }

  .market-image-option { align-items: stretch; flex-direction: column; }
  .market-image-actions { justify-content: space-between; }

  .second-hand-discuss-prompt {
    margin: 0 14px 16px;
  }

  .second-hand-safety {
    flex-direction: column;
    gap: 2px;
    padding: 11px 14px;
  }

  .second-hand-preview-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .post-editor-toolbar,
  .markup-meta,
  .markup-preview__head {
    align-items: stretch;
    flex-direction: column;
  }

  .editor-mode-switch {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .editor-mode-btn {
    width: 100%;
    text-align: center;
  }

  .markup-editor-shell {
    padding: 12px;
  }

  .markup-helper-row {
    gap: 6px;
  }

  .markup-helper-btn {
    flex: 1 1 calc(50% - 6px);
    text-align: center;
  }

  .markup-editor {
    min-height: 260px;
    padding: 12px;
  }

  .anonymous-box {
    padding: 12px;
  }

  .rate-row {
    grid-template-columns: 1fr;
  }

  .teacher-pick-row {
    flex-direction: column;
    align-items: stretch;
  }

  .or-text {
    align-self: center;
  }

  .field-error {
    align-items: flex-start;
    flex-direction: column;
  }

  .form-actions :deep(.el-form-item__content) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .form-actions :deep(.el-button) {
    margin-left: 0;
  }

  :global(.publish-preview-dialog) {
    width: 100% !important;
    max-width: 100% !important;
  }
}
</style>
