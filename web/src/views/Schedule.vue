<template>
<main
  class="schedule-page"
  :class="{
    'theme-color-glass': scheduleTheme === 'color-glass',
    'is-native-app': isNativeScheduleApp,
    'is-static-week-swipe': useStaticWeekSwipe,
    'view-day': viewMode === 'day',
    'view-week': viewMode === 'week',
  }"
  :style="pageStyle"
>
    <header class="top">
      <el-select
        v-if="parsed"
        v-model="semester"
        size="small"
        class="sem-select"
        @change="loadSchedule(false)"
      >
        <el-option v-for="s in semesters" :key="s.value" :value="s.value" :label="s.label" />
      </el-select>
      <div class="top-actions">
        <div v-if="parsed" class="view-switch" aria-label="切换课表视图">
          <button type="button" :class="{ active: viewMode === 'day' }" @click="setViewMode('day')">日</button>
          <button type="button" :class="{ active: viewMode === 'week' }" @click="setViewMode('week')">周</button>
        </div>
        <button
          v-if="parsed"
          type="button"
          class="icon-btn"
          :class="{ active: isViewingToday }"
          :aria-label="viewMode === 'week' ? '回到本周' : '跳转到当日'"
          :title="viewMode === 'week' ? '回到本周' : '跳转到当日'"
          @click="jumpToToday"
        >
          <el-icon><Aim /></el-icon>
        </button>
        <button
          v-if="installPromptRef && (installPromptRef as any).canShow"
          type="button"
          class="icon-btn install-btn"
          aria-label="把课表添加到桌面"
          title="添加到桌面"
          @click="openInstallPrompt"
        >
          <el-icon><Download /></el-icon>
        </button>
        <el-popover
          v-if="parsed"
          v-model:visible="moreMenuOpen"
          trigger="click"
          placement="bottom-end"
          :width="296"
          :teleported="true"
          popper-class="schedule-more-popover"
          @show="moreMenuView = 'menu'"
          @hide="moreMenuView = 'menu'"
        >
          <template #reference>
            <button
              type="button"
              class="icon-btn"
              aria-label="更多"
              title="更多"
              @click="openMoreMenu"
            >
              <el-icon><MoreFilled /></el-icon>
            </button>
          </template>
          <div class="more-panel" :style="pageStyle">
            <template v-if="moreMenuView === 'menu'">
              <button type="button" class="more-action" @click="moreMenuView = 'theme'">
                <span class="more-theme-swatch current" :style="{ background: currentThemePreview }" />
                <span>主题选择</span>
                <el-icon class="more-chevron"><ArrowRight /></el-icon>
              </button>
              <button type="button" class="more-action" @click="moreMenuView = 'background'">
                <el-icon><Picture /></el-icon>
                <span>{{ hasScheduleBackground ? "背景自定义（已启用）" : "背景自定义" }}</span>
                <el-icon class="more-chevron"><ArrowRight /></el-icon>
              </button>
              <button
                v-if="widgetMenuPlatform"
                type="button"
                class="more-action"
                :disabled="androidWidgetInstalling"
                @click="handleWidgetMenuAction"
              >
                <el-icon><Iphone /></el-icon>
                <span>{{ widgetMenuLabel }}</span>
                <el-icon class="more-chevron"><ArrowRight /></el-icon>
              </button>
              <button
                v-if="isAndroidNativeApp()"
                type="button"
                class="more-action"
                @click="checkAndroidAppUpdate"
              >
                <el-icon><Download /></el-icon>
                <span>{{ androidUpdateMenuLabel }}</span>
                <el-icon class="more-chevron"><ArrowRight /></el-icon>
              </button>
            </template>

            <template v-else-if="moreMenuView === 'theme'">
              <button type="button" class="more-back" @click="moreMenuView = 'menu'">
                <el-icon><ArrowLeft /></el-icon>
                <span>主题选择</span>
              </button>
              <div class="more-theme-grid" role="radiogroup" aria-label="选择课表主题">
                <button
                  v-for="themeOption in scheduleThemeOptions"
                  :key="themeOption.key"
                  type="button"
                  class="more-theme-choice"
                  :class="{ active: themeOption.key === scheduleTheme }"
                  role="radio"
                  :aria-checked="themeOption.key === scheduleTheme"
                  @click="selectScheduleTheme(themeOption.key)"
                >
                  <span class="more-theme-swatch" :style="{ background: themeOption.preview }" />
                  <span>{{ themeOption.label }}</span>
                </button>
              </div>
            </template>

            <template v-else>
              <button type="button" class="more-back" @click="moreMenuView = 'menu'">
                <el-icon><ArrowLeft /></el-icon>
                <span>背景自定义</span>
              </button>
              <div class="background-panel">
                <div
                  class="background-preview"
                  :class="{ empty: !hasScheduleBackground }"
                  :style="backgroundPreviewStyle"
                >
                  <span v-if="!hasScheduleBackground">还没有设置背景图</span>
                </div>
                <p class="background-note">
                  背景仅保存在当前设备，不会上传到服务器。建议使用浅色插画或照片，效果更像你发的参考图。
                </p>
                <div class="background-actions">
                  <button
                    type="button"
                    class="more-subaction primary"
                    :disabled="backgroundSaving"
                    @click="pickScheduleBackground"
                  >
                    {{ backgroundSaving ? "处理中..." : hasScheduleBackground ? "更换图片" : "选择图片" }}
                  </button>
                  <button
                    type="button"
                    class="more-subaction"
                    :disabled="!hasScheduleBackground || backgroundSaving"
                    @click="clearScheduleBackground"
                  >
                    清除
                  </button>
                </div>
                <label class="background-control">
                  <span class="background-control-head">
                    <b>背景显现</b>
                    <em>{{ backgroundVisibility }}%</em>
                  </span>
                  <input
                    type="range"
                    min="22"
                    max="88"
                    :value="backgroundVisibility"
                    :disabled="!hasScheduleBackground"
                    @input="onBackgroundVisibilityInput"
                  />
                </label>
                <label class="background-control">
                  <span class="background-control-head">
                    <b>柔化程度</b>
                    <em>{{ scheduleBackground.blur }}px</em>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="18"
                    :value="scheduleBackground.blur"
                    :disabled="!hasScheduleBackground"
                    @input="onBackgroundBlurInput"
                  />
                </label>
              </div>
            </template>
          </div>
        </el-popover>
        <button
          type="button"
          class="icon-btn"
          :class="{ spinning: loading }"
          aria-label="刷新课表"
          @click="loadSchedule(true)"
        >
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
    </header>

    <!-- 内置浏览器打开引导 / PWA 添加到桌面引导 -->
    <OpenBrowserPromptDialog ref="openBrowserPromptRef" />
    <InstallPromptDialog ref="installPromptRef" />
    <input
      ref="backgroundImageInputRef"
      type="file"
      accept="image/*"
      class="hidden-file-input"
      @change="onScheduleBackgroundPicked"
    />

    <section v-if="parsed" class="week-switcher">
      <button type="button" class="week-btn" :disabled="!canChangeWeek(-1)" @click="changeWeek(-1)">
        <el-icon><ArrowLeft /></el-icon>
        上一周
      </button>
      <button
        type="button"
        class="week-title clickable"
        @click="weekDialogOpen = true"
      >
        <b>第 {{ week || parsed?.currentWeek || "--" }} 周</b>
        <span v-if="currentWeekRange">{{ currentWeekRange }}</span>
      </button>
      <button type="button" class="week-btn" :disabled="!canChangeWeek(1)" @click="changeWeek(1)">
        下一周
        <el-icon><ArrowRight /></el-icon>
      </button>
    </section>

    <section v-if="parsed && viewMode === 'day'" class="week-strip">
      <button
        v-for="d in dayTabs"
        :key="d.day"
        type="button"
        class="day-pill"
        :class="{ active: activeDay === d.day, today: d.isToday }"
        @click="onDayClick(d.day)"
      >
        <span>{{ d.label }}</span>
        <b>{{ d.date || "--" }}</b>
      </button>
    </section>

    <section v-if="autoLoading && !parsed" class="state-card">
      <el-icon class="big is-loading"><Loading /></el-icon>
      <h2>正在自动授权</h2>
      <p>使用本机保存的学校账号读取课表。</p>
    </section>

    <section v-else-if="jwxt.needCaptcha && hasCreds && !parsed" class="state-card">
      <el-icon class="big"><Picture /></el-icon>
      <h2>输入验证码</h2>
      <p>本机已保存学校账号，补充验证码后即可查看课表。</p>
      <div class="captcha-row">
        <el-input v-model="captchaInput" size="large" placeholder="验证码" maxlength="8" @keyup.enter="submitCaptcha" />
        <img v-if="jwxt.captchaImage" :src="jwxt.captchaImage" alt="验证码" @click="reloadCaptcha" />
      </div>
      <p v-if="captchaError" class="error-text">{{ captchaError }}</p>
      <el-button type="primary" size="large" :loading="captchaSubmitting" @click="submitCaptcha">完成授权</el-button>
    </section>

    <section v-else-if="!jwxt.isLoggedIn && !parsed" class="state-card">
      <el-icon class="big"><Lock /></el-icon>
      <h2>需要先授权教务数据</h2>
      <p>授权后可把这个页面添加到桌面书签，之后快速打开查看课表。本站不保存学校密码和验证码。</p>
      <p class="scope-note">目前教务 / 课表数据暂仅支持<b>本科生</b>，研究生 / 教职工 / 留学生授权后可能拿不到课表。</p>
      <el-button type="primary" size="large" @click="$router.push({ name: 'jwxt', query: { redirect: '/schedule' } })">
        前往授权
      </el-button>
    </section>

    <section
      v-else
      ref="contentRef"
      class="content"
      v-loading="loading && !parsed"
      @pointerdown="onSchedulePointerDown"
      @pointermove="onSchedulePointerMove"
      @pointerup="onSchedulePointerEnd"
      @pointercancel="onSchedulePointerCancel"
    >
      <div class="carousel-viewport">
        <div ref="carouselTrackRef" class="carousel-track" @transitionend="onCarouselTrackTransitionEnd">
          <article
            v-for="page in carouselPages"
            :key="page.key"
            class="schedule-panel"
            :class="[
              { active: page.delta === 0 },
              page.delta === 0 && useStaticWeekSwipe ? staticWeekAnimationClass : '',
            ]"
            :aria-hidden="page.delta !== 0"
          >
            <div class="summary">
              <div>
                <span>第 {{ page.weekValue || parsed?.currentWeek || "--" }} 周</span>
                <b>{{ page.title }}</b>
                <small v-if="cacheText">{{ cacheText }}</small>
              </div>
              <em>{{ page.courseCount }} 节课</em>
            </div>

            <div class="schedule-body-scroll">
              <section v-if="viewMode === 'week'" class="week-overview" aria-label="整周课表">
                <div class="week-grid-head">
                  <div class="time-head">节次</div>
                  <div
                    v-for="d in page.dayTabs"
                    :key="d.day"
                    class="week-day-head"
                    :class="{ today: d.isToday }"
                    @click="page.delta === 0 && onDayClick(d.day)"
                  >
                    <span>{{ d.label.replace("周", "") }}</span>
                    <b>{{ d.date || "--" }}</b>
                  </div>
                </div>
                <div class="week-grid-body">
                  <template v-for="slot in smallSlots" :key="`axis-${page.key}-${slot.no}`">
                    <div class="slot-axis" :style="{ gridRow: `${slot.no} / ${slot.no + 1}` }">
                      <b>{{ slot.no }}</b>
                      <span>{{ slot.start }}</span>
                      <span>{{ slot.end }}</span>
                    </div>
                    <div
                      v-for="day in 7"
                      :key="`bg-${page.key}-${slot.no}-${day}`"
                      class="week-slot-cell"
                      :style="{ gridColumn: `${day + 1} / ${day + 2}`, gridRow: `${slot.no} / ${slot.no + 1}` }"
                      :class="{ today: page.dayTabs[day - 1]?.isToday }"
                      @click="onWeekSlotClick($event, day, slot.no, page.weekValue)"
                    />
                  </template>
                  <article
                    v-for="block in page.weekCourseBlocks"
                    :key="`${page.weekValue}-${block.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
                    class="week-course"
                    :style="courseBlockStyle(block)"
                    :title="courseTitle(block.course)"
                    @click.stop="onCourseBlockClick($event, block, page.weekValue)"
                  >
                    <strong>{{ block.course.name }}</strong>
                    <span v-if="block.course.location">@{{ block.course.location }}</span>
                    <em>{{ block.course.slotNote || block.course.weeks }}</em>
                  </article>
                </div>
              </section>

              <div v-else class="day-pane">
                <section v-if="page.dayCourseBlocks.length" class="day-timeline" aria-label="当日课表">
                  <div class="day-grid-body">
                    <template v-for="slot in smallSlots" :key="`day-axis-${page.key}-${slot.no}`">
                      <div class="slot-axis day-axis" :style="{ gridRow: `${slot.no} / ${slot.no + 1}` }">
                        <b>{{ slot.no }}</b>
                        <span>{{ slot.start }}</span>
                        <span>{{ slot.end }}</span>
                      </div>
                      <div
                        class="day-slot-cell"
                        :style="{ gridColumn: '2 / 3', gridRow: `${slot.no} / ${slot.no + 1}` }"
                        @click="onDaySlotClick($event, page.day, slot.no, page.weekValue)"
                      />
                    </template>
                    <article
                      v-for="block in page.dayCourseBlocks"
                      :key="`${page.weekValue}-${page.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
                      class="day-course-block"
                      :style="dayCourseBlockStyle(block)"
                      :title="courseTitle(block.course)"
                      @click.stop="onCourseBlockClick($event, block, page.weekValue)"
                    >
                      <div class="day-course-name">{{ block.course.name }}</div>
                      <div class="day-course-meta">
                        <span v-if="block.course.location">@{{ block.course.location }}</span>
                        <span v-if="block.course.teacher">{{ block.course.teacher }}</span>
                      </div>
                      <div class="day-course-note">{{ block.course.slotNote || block.course.weeks }}</div>
                    </article>
                  </div>
                </section>

                <div v-else class="empty-day">
                  <el-icon><Moon /></el-icon>
                  <p>这一天没有课程</p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- 周次选择弹窗 -->
    <el-dialog
      v-model="weekDialogOpen"
      title="选择周次"
      :width="320"
      align-center
      :show-close="true"
      append-to-body
    >
      <div class="week-grid-pick">
        <button
          v-for="w in weeks"
          :key="w.value"
          type="button"
          class="week-cell"
          :class="{ active: String(w.value) === week, current: Number(w.value) === calendar?.currentWeek }"
          @click="selectWeek(w.value)"
        >
          {{ w.value }}
        </button>
      </div>
      <template #footer>
        <el-button v-if="canJumpToCurrentWeek" type="primary" @click="onJumpAndClose">回到本周</el-button>
        <el-button @click="weekDialogOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="widgetDialogOpen"
      :width="420"
      align-center
      :show-close="true"
      append-to-body
    >
      <template #header>
        <div class="widget-dialog-title">
          <span>导入 iOS 课表小组件</span>
          <el-popover trigger="click" placement="bottom" :width="286" popper-class="widget-help-popover">
            <p class="widget-help-text">
              会生成一个只读 token，小组件仅能读取你的课表；如果教务会话失效，会先显示上次成功缓存。回到本站完成授权后会自动续上，不需要重新添加小组件。
            </p>
            <template #reference>
              <button type="button" class="widget-help-btn" aria-label="查看小组件安全说明">
                <el-icon><QuestionFilled /></el-icon>
              </button>
            </template>
          </el-popover>
        </div>
      </template>
      <div class="widget-guide">
        <a class="widget-step" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noreferrer">
          <b>1</b>
          <span>安装 Scriptable</span>
          <el-icon class="widget-step-arrow"><ArrowRight /></el-icon>
        </a>
        <button type="button" class="widget-step" :disabled="widgetConfigCopying" @click="copyScriptableWidgetScript">
          <b>2</b>
          <span>{{ widgetConfigCopied ? "已复制，继续第 3 步" : "复制配置" }}</span>
          <el-icon class="widget-step-arrow"><ArrowRight /></el-icon>
        </button>
        <button type="button" class="widget-step" @click="openScriptableInstruction">
          <b>3</b>
          <span>打开 Scriptable 导入</span>
          <el-icon class="widget-step-arrow"><ArrowRight /></el-icon>
        </button>
      </div>
      <p v-if="widgetCopyMessage" class="widget-copy-message" :class="{ warn: !widgetConfigCopied }">
        {{ widgetCopyMessage }}
      </p>
      <p class="support-note">
        仍有疑问，建议
        <button type="button" @click="openUserGroup">加入用户 QQ 群 {{ USER_QQ_GROUP }}</button>
        咨询。
      </p>
      <template #footer>
        <el-button @click="widgetDialogOpen = false">关闭</el-button>
        <el-button type="primary" :loading="widgetConfigCopying" @click="copyScriptableWidgetScript">
          {{ scriptableWidgetScript ? "复制配置" : "生成并复制" }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="widgetInstructionOpen"
      title="导入后请先完成测试"
      :width="420"
      align-center
      :show-close="true"
      append-to-body
      @open="startWidgetInstructionCountdown"
      @closed="stopWidgetInstructionCountdown"
    >
      <ol class="widget-instruction-list">
        <li>打开 Scriptable 后，先按提示授予软件权限，再把刚才复制的内容粘贴到打开的文本框里。</li>
        <li>粘贴完成后，点击右下角三角形运行测试，确认能看到课表预览。</li>
        <li>测试完成后回到桌面，长按空白处，进入编辑模式并选择添加小组件。</li>
        <li>找到 Scriptable 小组件并添加到桌面。</li>
        <li>添加后长按小组件，选择编辑小组件，把 Script 设为刚才导入的课表脚本。</li>
      </ol>
      <p class="widget-countdown">
        {{ widgetInstructionCountdown > 0 ? `请先阅读说明，${widgetInstructionCountdown} 秒后可继续。` : "已可继续打开 Scriptable。" }}
      </p>
      <p class="support-note">
        仍有疑问，建议
        <button type="button" @click="openUserGroup">加入用户 QQ 群 {{ USER_QQ_GROUP }}</button>
        咨询。
      </p>
      <template #footer>
        <el-button @click="widgetInstructionOpen = false">再看看</el-button>
        <el-button type="primary" :disabled="widgetInstructionCountdown > 0" @click="continueToScriptable">
          {{ widgetInstructionCountdown > 0 ? `${widgetInstructionCountdown}s` : "继续打开 Scriptable" }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="androidUpdateOpen"
      title="更新安卓客户端"
      :width="420"
      align-center
      :show-close="true"
      append-to-body
      @open="startAndroidUpdateCountdown"
      @closed="stopAndroidUpdateCountdown"
    >
      <div class="android-update-panel">
        <p v-if="androidUpdateKind === 'app'">
          当前客户端版本为 {{ androidCurrentVersionLabel }}，最新版本为 {{ androidLatestVersionLabel }}。
          请复制下载链接，到系统浏览器粘贴打开并安装更新。
        </p>
        <p v-else>
          当前安卓客户端版本过低，桌面小组件不可用。
          请先复制下载链接，到系统浏览器粘贴打开并安装最新版 {{ androidLatestVersionLabel }}。
        </p>
        <p class="widget-countdown">
          {{ androidUpdateCountdown > 0 ? `请先阅读说明，${androidUpdateCountdown} 秒后可继续。` : "已可复制下载链接。" }}
        </p>
        <p class="support-note">
          仍有疑问，建议
          <button type="button" @click="openUserGroup">加入用户 QQ 群 {{ USER_QQ_GROUP }}</button>
          咨询。
        </p>
      </div>
      <template #footer>
        <el-button @click="androidUpdateOpen = false">稍后</el-button>
        <el-button type="primary" :disabled="androidUpdateCountdown > 0" @click="openAndroidDownload">
          {{ androidUpdateCountdown > 0 ? `${androidUpdateCountdown}s` : "复制下载链接" }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="androidWidgetGuideOpen"
      title="添加安卓小组件"
      :width="420"
      align-center
      :show-close="true"
      append-to-body
    >
      <ol class="widget-instruction-list">
        <li>如果系统弹出添加小组件或卡片确认，请直接确认添加。</li>
        <li>如果没有弹出，请回到桌面，长按空白处，选择“小组件”“卡片”或类似入口。</li>
        <li>不同厂商叫法不同，部分系统会把入口放在“卡片”“插件”“服务卡片”等二级菜单里；一级菜单没有找到时，请进入这些二级菜单查找。</li>
        <li>找到本软件对应的“药大课表小组件 / 卡片”，可选择 2x2、4x2 或 4x4 尺寸添加到桌面。</li>
        <li>刚才的课表配置已保存，添加后会自动读取课程。</li>
      </ol>
      <p class="widget-countdown">
        部分国内系统会拦截 App 主动拉起小组件或卡片添加面板，手动添加是更稳定的方式。
      </p>
      <p class="support-note">
        仍有疑问，建议
        <button type="button" @click="openUserGroup">加入用户 QQ 群 {{ USER_QQ_GROUP }}</button>
        咨询。
      </p>
      <template #footer>
        <el-button type="primary" @click="androidWidgetGuideOpen = false">我知道了</el-button>
      </template>
    </el-dialog>

    <Teleport to="body">
      <Transition name="course-editor">
        <div v-if="editDialogOpen" class="course-editor-overlay" @click.self="editDialogOpen = false">
          <section class="course-editor-panel" role="dialog" aria-modal="true">
            <header class="course-editor-nav">
              <button type="button" @click="editDialogOpen = false">取消</button>
              <h2>{{ editingCourseBlock ? "修改课程" : "添加课程" }}</h2>
              <button type="button" class="primary" @click="saveCourseEdit">保存</button>
            </header>

            <div class="course-editor-scroll">
              <section class="editor-card">
                <label class="editor-row">
                  <span>课程</span>
                  <input v-model="customCourseForm.name" maxlength="40" placeholder="课程名称" />
                </label>
                <label class="editor-row">
                  <span>老师</span>
                  <input v-model="customCourseForm.teacher" maxlength="40" placeholder="选填" />
                </label>
                <label class="editor-row">
                  <span>地点</span>
                  <input v-model="customCourseForm.location" maxlength="40" placeholder="选填" />
                </label>
                <label class="editor-row">
                  <span>备注</span>
                  <input v-model="customCourseForm.note" maxlength="60" placeholder="选填" />
                </label>
              </section>

              <div class="editor-section-title">
                <span>时间段</span>
                <div class="editor-actions">
                  <button v-if="canRestoreOriginalCourse" type="button" @click="restoreOriginalCourse">恢复原始</button>
                  <button v-if="editingCourseBlock" type="button" class="danger" @click="deleteEditingCourse">删除</button>
                </div>
              </div>

              <section class="editor-card">
                <label class="editor-row">
                  <span>周数</span>
                  <select v-model="customCourseForm.weekMode">
                    <option value="current">本周</option>
                    <option value="all">全部周</option>
                    <option value="custom">指定周次</option>
                  </select>
                </label>
                <div v-if="customCourseForm.weekMode === 'custom'" class="editor-week-picker">
                  <span>指定周</span>
                  <div class="week-chip-grid">
                    <button
                      v-for="w in weekNumberOptions"
                      :key="w"
                      type="button"
                      :class="{ active: customCourseForm.weekList.includes(w) }"
                      @click="toggleCustomWeek(w)"
                    >
                      {{ w }}
                    </button>
                  </div>
                </div>
                <label class="editor-row">
                  <span>星期</span>
                  <select v-model.number="customCourseForm.day">
                    <option v-for="d in 7" :key="d" :value="d">{{ dayLabel(d) }}</option>
                  </select>
                </label>
                <div class="editor-row">
                  <span>时间</span>
                  <div class="slot-range-input">
                    <input v-model.number="customCourseForm.startSlot" type="number" min="1" :max="MAX_SMALL_SLOT" />
                    <em>-</em>
                    <input v-model.number="customCourseForm.endSlot" type="number" :min="customCourseForm.startSlot" :max="MAX_SMALL_SLOT" />
                    <b>节</b>
                  </div>
                </div>
              </section>

              <section v-if="hiddenCourseItems.length" class="editor-card hidden-restore-card">
                <div class="editor-card-title">已编辑课程</div>
                <div class="hidden-list">
                  <button v-for="item in hiddenCourseItems" :key="item.key" type="button" @click="restoreHiddenCourse(item.key)">
                    {{ item.label }}
                  </button>
                </div>
              </section>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Aim, ArrowLeft, ArrowRight, Download, Iphone, Loading, Lock, Moon, MoreFilled, Picture, QuestionFilled, Refresh } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { useJwxtStore } from "@/stores/jwxt";
import { hasCreds as hasSavedCreds, loadCreds } from "@/utils/credCrypto";
import { compressImageFile } from "@/utils/imageUpload";
import { jwxtScopedStorageKey } from "@/utils/jwxtCache";
import { detectInAppBrowser } from "@/utils/inAppBrowser";
import {
  ANDROID_APP_DOWNLOAD_URL,
  ANDROID_APP_LATEST_VERSION_CODE,
  ANDROID_APP_LATEST_VERSION_NAME,
  ANDROID_WIDGET_MIN_VERSION_CODE,
  detectClientPlatform,
  getAndroidNativeVersionCode,
  getAndroidNativeVersionName,
  isAndroidAppUpdateAvailable,
  isAndroidNativeApp,
  isIosStandalone,
  supportsAndroidScheduleWidget,
} from "@/utils/clientInfo";
import { USER_QQ_GROUP, openUserGroup } from "@/utils/userGroup";
import InstallPromptDialog from "@/components/install/InstallPromptDialog.vue";
import OpenBrowserPromptDialog from "@/components/install/OpenBrowserPromptDialog.vue";
import {
  getColorGlassCourseTone,
  getScheduleThemePalette,
  normalizeScheduleTheme,
  scheduleThemeOptions,
  scheduleThemeCssVars,
  type CourseTone,
  type ScheduleThemeKey,
} from "@/components/jwxt/scheduleTheme";
import {
  applyScheduleEditsToCells,
  courseEditKey,
  createCustomCourseId,
  emptyScheduleEdits,
  type CustomScheduleItem,
  type ScheduleEditState,
} from "@/utils/scheduleEdits";
import { courseMatchesWeek, normalizedCourseWeekList } from "@/utils/scheduleWeeks";

interface ScheduleCourse {
  name: string;
  teacher?: string;
  weeks: string;
  weekList: number[];
  location?: string;
  slotNote?: string;
  startSlot?: number;
  endSlot?: number;
  sourceKey?: string;
  customId?: string;
  custom?: boolean;
}
interface ScheduleCell { day: number; bigSlot: number; courses: ScheduleCourse[] }
interface ScheduleResult {
  semesters: { value: string; label: string; current: boolean }[];
  weeks: { value: string; label: string; current: boolean }[];
  currentSemester: string;
  currentWeek: string;
  cells: ScheduleCell[];
}
interface CalendarWeek { week: number; days: string[]; monday: string; sunday: string }
interface CalendarResult { currentWeek: number; semesterStart: string; semesterEnd: string; weeks: CalendarWeek[] }
interface FlatCourse { bigSlot: number; index: number; course: ScheduleCourse }
interface CacheEnvelope<T> { savedAt: number; data: T }
type ViewMode = "day" | "week";
interface LastState { semester: string; week: string; activeDay: number; viewMode?: ViewMode }
interface WeekCourseBlock { day: number; bigSlot: number; startSlot: number; endSlot: number; index: number; course: ScheduleCourse }
interface ScheduleBackgroundSettings {
  imageDataUrl: string;
  overlayOpacity: number;
  blur: number;
}
interface SchedulePageModel {
  delta: number;
  key: string;
  weekValue: string;
  day: number;
  title: string;
  dayTabs: Array<{ day: number; label: string; date: string; isToday: boolean }>;
  courseCount: number;
  dayCourseBlocks: WeekCourseBlock[];
  weekCourseBlocks: WeekCourseBlock[];
}

const jwxt = useJwxtStore();
const parsed = ref<ScheduleResult | null>(null);
const calendar = ref<CalendarResult | null>(null);
const semester = ref("");
const week = ref("");
const activeDay = ref(dayOfWeek());
const viewMode = ref<ViewMode>("day");
const scheduleTheme = ref<ScheduleThemeKey>("green");
const loading = ref(false);
const autoLoading = ref(false);
const hasCreds = ref(false);
const captchaInput = ref("");
const captchaSubmitting = ref(false);
const captchaError = ref("");
const scheduleSavedAt = ref(0);
const scheduleEdits = ref<ScheduleEditState>(emptyScheduleEdits());
const viewportHeight = ref(0);
const compactViewport = ref(false);
const CACHE_TTL = 12 * 60 * 60 * 1000;
const CALENDAR_CACHE_BASE = "cpu-schedule-calendar-v1";
const LAST_STATE_BASE = "cpu-schedule-last-state-v1";
const LAST_CACHE_BASE = "cpu-schedule-last-cache-key-v1";
const THEME_KEY = "cpu-schedule-theme-v1";
const BACKGROUND_KEY = "cpu-schedule-background-v1";
const scheduleCacheStore = new Map<string, CacheEnvelope<ScheduleResult>>();
const prewarmingScheduleKeys = new Set<string>();
const isNativeScheduleApp = /cpuwebscheduleapp/i.test(navigator.userAgent);
let scheduleEditsSaveTimer = 0;
let scheduleEditsLoadPromise: Promise<void> | null = null;
const smallSlots = [
  { no: 1, start: "08:00", end: "08:45" },
  { no: 2, start: "08:55", end: "09:40" },
  { no: 3, start: "09:55", end: "10:40" },
  { no: 4, start: "10:50", end: "11:35" },
  { no: 5, start: "13:30", end: "14:15" },
  { no: 6, start: "14:25", end: "15:10" },
  { no: 7, start: "15:25", end: "16:10" },
  { no: 8, start: "16:20", end: "17:05" },
  { no: 9, start: "18:30", end: "19:15" },
  { no: 10, start: "19:25", end: "20:10" },
  { no: 11, start: "20:20", end: "21:05" },
];
const MAX_SMALL_SLOT = smallSlots[smallSlots.length - 1]?.no ?? 10;
const editDialogOpen = ref(false);
const customCourseForm = reactive({
  name: "",
  day: dayOfWeek(),
  startSlot: 1,
  endSlot: 2,
  weekMode: "current" as "current" | "all" | "custom",
  weekList: [] as number[],
  weekText: "",
  location: "",
  teacher: "",
  note: "",
});
const editingCourseBlock = ref<WeekCourseBlock | null>(null);
const editingCourseKey = ref("");
const editingWeekValue = ref("");

// 周次选择弹窗
const weekDialogOpen = ref(false);
function selectWeek(v: string | number) {
  const next = String(v);
  if (next === week.value) {
    weekDialogOpen.value = false;
    return;
  }
  slideDirection.value = Number(next) > Number(week.value || 0) ? "next" : "prev";
  week.value = next;
  saveLastState();
  weekDialogOpen.value = false;
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    if (isStale(cached.savedAt)) void loadSchedule(false, true);
    return;
  }
  void loadSchedule(false);
}
async function onJumpAndClose() {
  weekDialogOpen.value = false;
  await jumpToCurrentWeek();
}

// 添加到主屏幕引导
const installPromptRef = ref<InstanceType<typeof InstallPromptDialog> | null>(null);
const openBrowserPromptRef = ref<InstanceType<typeof OpenBrowserPromptDialog> | null>(null);
const widgetDialogOpen = ref(false);
const widgetInstructionOpen = ref(false);
const widgetInstructionCountdown = ref(6);
const androidUpdateOpen = ref(false);
const androidWidgetGuideOpen = ref(false);
const androidUpdateCountdown = ref(3);
const moreMenuOpen = ref(false);
const moreMenuView = ref<"menu" | "theme" | "background">("menu");
const widgetConfigCopying = ref(false);
const widgetConfigCopied = ref(false);
const androidWidgetInstalling = ref(false);
const backgroundImageInputRef = ref<HTMLInputElement | null>(null);
const backgroundSaving = ref(false);
const scheduleBackground = reactive<ScheduleBackgroundSettings>(createDefaultScheduleBackground());
const androidUpdateKind = ref<"app" | "widget">("widget");
const scriptableWidgetScript = ref("");
const widgetCopyMessage = ref("");
const APK_DOWNLOAD_URL = ANDROID_APP_DOWNLOAD_URL;
const SCRIPTABLE_ADD_URL = "https://open.scriptable.app/add";
const ANDROID_APP_UPDATE_PROMPT_KEY = "cpu-android-app-update-prompt-v1";
let widgetInstructionTimer = 0;
let androidUpdateTimer = 0;
let androidAppUpdatePromptTimer = 0;
type WidgetMenuPlatform = "ios" | "android" | "android-old";
interface AndroidWidgetBridge {
  getVersionCode?: () => number;
  getVersionName?: () => string;
  copyText?: (text: string) => boolean;
  supportsScheduleWidget?: () => boolean;
  installScheduleWidget?: (payload: string) => void;
  openExternalUrl?: (url: string) => void;
}
async function openInstallPrompt() {
  const inApp = detectInAppBrowser();
  if (inApp.isInApp) {
    openBrowserPromptRef.value?.openDialog();
    return;
  }
  await installPromptRef.value?.requestInstall();
}

function selectScheduleTheme(value: ScheduleThemeKey) {
  persistScheduleTheme(value);
  moreMenuView.value = "menu";
  moreMenuOpen.value = false;
}

function openMoreMenu() {
  moreMenuView.value = "menu";
}

function getAndroidWidgetBridge(): AndroidWidgetBridge | null {
  return ((window as any).CPUAndroid ?? null) as AndroidWidgetBridge | null;
}

const widgetMenuPlatform = computed<WidgetMenuPlatform | null>(() => {
  if (isIosStandalone()) return "ios";
  if (!isAndroidNativeApp()) return null;
  return supportsAndroidScheduleWidget() ? "android" : "android-old";
});

const widgetMenuLabel = computed(() => {
  if (widgetMenuPlatform.value === "android") return "添加安卓小组件";
  if (widgetMenuPlatform.value === "android-old") return "更新安卓客户端";
  return "导入 iOS 小组件";
});
const androidCurrentVersionCode = computed(() => getAndroidNativeVersionCode());
const androidCurrentVersionName = computed(() => getAndroidNativeVersionName());
const androidCurrentVersionLabel = computed(() => {
  const code = androidCurrentVersionCode.value;
  const name = androidCurrentVersionName.value;
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  if (code) return `版本 ${code}`;
  return "未知版本";
});
const androidLatestVersionLabel = computed(() => `${ANDROID_APP_LATEST_VERSION_NAME} (${ANDROID_APP_LATEST_VERSION_CODE})`);
const androidAppUpdateAvailable = computed(() => isAndroidAppUpdateAvailable());
const androidUpdateMenuLabel = computed(() => (
  androidAppUpdateAvailable.value ? "更新安卓客户端" : "检查客户端更新"
));

function handleWidgetMenuAction() {
  if (widgetMenuPlatform.value === "ios") {
    openWidgetDialog();
    return;
  }
  if (widgetMenuPlatform.value === "android") {
    void installAndroidWidget();
    return;
  }
  showAndroidUpdateRequired("widget");
}

function openWidgetDialog() {
  moreMenuOpen.value = false;
  widgetDialogOpen.value = true;
}

async function installAndroidWidget() {
  moreMenuOpen.value = false;
  const bridge = getAndroidWidgetBridge();
  if (!supportsAndroidScheduleWidget() || !bridge?.installScheduleWidget) {
    showAndroidUpdateRequired("widget");
    return;
  }
  if (!jwxt.isLoggedIn) {
    ElMessage.warning("请先完成教务授权，再添加安卓小组件");
    return;
  }

  androidWidgetInstalling.value = true;
  try {
    const token = await jwxtApi.createScheduleWidgetToken({ name: "Android 小组件" });
    bridge.installScheduleWidget(JSON.stringify({
      endpoint: token.endpoint,
      title: "药大课表",
    }));
    androidWidgetGuideOpen.value = true;
    ElMessage.success("小组件配置已保存");
  } finally {
    androidWidgetInstalling.value = false;
  }
}

function showAndroidUpdateRequired(kind: "app" | "widget" = "widget") {
  moreMenuOpen.value = false;
  androidUpdateKind.value = kind;
  androidUpdateOpen.value = true;
}

async function openAndroidDownload() {
  const absoluteUrl = new URL(APK_DOWNLOAD_URL, window.location.origin).toString();
  let copied = false;
  const bridge = getAndroidWidgetBridge();
  try {
    if (typeof bridge?.copyText === "function") {
      copied = bridge.copyText(absoluteUrl) !== false;
    }
  } catch {
    copied = false;
  }
  if (!copied) {
    copied = await writeClipboard(absoluteUrl);
  }
  if (copied) {
    androidUpdateOpen.value = false;
    ElMessage.success("下载链接已复制，请到系统浏览器粘贴打开");
    return;
  }
  ElMessage.warning("复制失败，请再点击一次复制下载链接");
}

function checkAndroidAppUpdate() {
  moreMenuOpen.value = false;
  if (!isAndroidNativeApp()) return;
  if (androidAppUpdateAvailable.value) {
    showAndroidUpdateRequired("app");
    return;
  }
  ElMessage.success(`当前已是最新版 ${androidCurrentVersionLabel.value}`);
}

function autoPromptAndroidAppUpdate() {
  if (!androidAppUpdateAvailable.value) return;
  const latestVersion = String(ANDROID_APP_LATEST_VERSION_CODE);
  try {
    if (localStorage.getItem(ANDROID_APP_UPDATE_PROMPT_KEY) === latestVersion) return;
    localStorage.setItem(ANDROID_APP_UPDATE_PROMPT_KEY, latestVersion);
  } catch {
    /* localStorage may be blocked in some WebViews */
  }
  androidAppUpdatePromptTimer = window.setTimeout(() => {
    if (!androidUpdateOpen.value && androidAppUpdateAvailable.value) {
      showAndroidUpdateRequired("app");
    }
  }, 1600);
}

function startAndroidUpdateCountdown() {
  stopAndroidUpdateCountdown();
  androidUpdateCountdown.value = 3;
  androidUpdateTimer = window.setInterval(() => {
    androidUpdateCountdown.value = Math.max(0, androidUpdateCountdown.value - 1);
    if (androidUpdateCountdown.value <= 0) stopAndroidUpdateCountdown();
  }, 1000);
}

function stopAndroidUpdateCountdown() {
  if (!androidUpdateTimer) return;
  window.clearInterval(androidUpdateTimer);
  androidUpdateTimer = 0;
}

async function copyScriptableWidgetScript() {
  if (!jwxt.isLoggedIn && !scriptableWidgetScript.value) {
    ElMessage.warning("请先完成教务授权，再生成小组件配置");
    return;
  }
  widgetConfigCopying.value = true;
  try {
    if (!scriptableWidgetScript.value) {
      const token = await jwxtApi.createScheduleWidgetToken({ name: "iOS 小组件" });
      scriptableWidgetScript.value = buildScriptableWidgetScript(token.endpoint);
      await nextTick();
    }
    const copied = await writeClipboard(scriptableWidgetScript.value);
    widgetConfigCopied.value = copied;
    widgetCopyMessage.value = copied
      ? "配置已复制到剪切板，可以继续第 3 步。"
      : "系统暂时拦截了剪切板写入。请保持弹窗打开，再点一次“复制配置”。";
    if (copied) ElMessage.success("已复制 Scriptable 配置");
    else ElMessage.warning("已生成配置，请再点一次复制配置");
  } finally {
    widgetConfigCopying.value = false;
  }
}

async function openScriptableInstruction() {
  if (!widgetConfigCopied.value) {
    await copyScriptableWidgetScript();
  }
  if (!widgetConfigCopied.value) return;
  widgetInstructionOpen.value = true;
}

function startWidgetInstructionCountdown() {
  stopWidgetInstructionCountdown();
  widgetInstructionCountdown.value = 6;
  widgetInstructionTimer = window.setInterval(() => {
    widgetInstructionCountdown.value = Math.max(0, widgetInstructionCountdown.value - 1);
    if (widgetInstructionCountdown.value <= 0) stopWidgetInstructionCountdown();
  }, 1000);
}

function stopWidgetInstructionCountdown() {
  if (!widgetInstructionTimer) return;
  window.clearInterval(widgetInstructionTimer);
  widgetInstructionTimer = 0;
}

function continueToScriptable() {
  if (widgetInstructionCountdown.value > 0) return;
  widgetInstructionOpen.value = false;
  window.location.href = SCRIPTABLE_ADD_URL;
}

async function writeClipboard(text: string): Promise<boolean> {
  const legacyCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "0";
    textarea.style.top = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  };

  try {
    if (legacyCopy()) return true;
  } catch {
    /* continue to async clipboard */
  }

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function buildScriptableWidgetScript(endpoint: string) {
  return `// 药大课表小组件
// 复制到 Scriptable 后，添加桌面小组件并选择本脚本。
const API_ENDPOINT = ${JSON.stringify(endpoint)};
const MINUTES_22_00 = 22 * 60;

async function loadSchedule() {
  const req = new Request(API_ENDPOINT);
  req.timeoutInterval = 20;
  const body = await req.loadJSON();
  if (!body || body.code !== 0) {
    throw new Error(body?.message || "课表读取失败");
  }
  return body.data;
}

function color(light, dark) {
  return Color.dynamic(new Color(light), new Color(dark));
}

function addLine(stack, text, font, colorValue) {
  const line = stack.addText(String(text || ""));
  line.font = font;
  line.textColor = colorValue;
  line.lineLimit = 1;
  return line;
}

function coursePrimaryText(course, withEnd) {
  const end = withEnd && course.endTime ? "-" + course.endTime : "";
  const time = course.startTime ? course.startTime + end + " " : "";
  return time + (course.name || "课程");
}

function courseMetaText(course) {
  const parts = [];
  if (course.location) parts.push("@" + course.location);
  if (course.teacher) parts.push(course.teacher);
  if (course.note) parts.push(course.note);
  return parts.join(" · ");
}

function shortDate(value) {
  const match = String(value || "").match(/-(\\d{2})-(\\d{2})$/);
  return match ? match[1] + "/" + match[2] : "";
}

function deviceDate(offset) {
  const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  const formatter = new DateFormatter();
  formatter.locale = "zh-CN";
  formatter.dateFormat = "yyyy-MM-dd";
  return formatter.string(date);
}

function deviceMinutes() {
  const date = new Date();
  return date.getHours() * 60 + date.getMinutes();
}

function deviceDayOfWeek(offset) {
  const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function parseMinutes(value) {
  const match = String(value || "").match(/^(\\d{2}):(\\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function courseEndMinutes(course) {
  const end = parseMinutes(course?.endTime);
  if (end >= 0) return end;
  const start = parseMinutes(course?.startTime);
  return start >= 0 ? start + 45 : 0;
}

function resolveDay(data, offset) {
  const target = deviceDate(offset);
  const days = data.days || [];
  const byDate = days.find((day) => String(day.date || "") === target);
  if (byDate) return byDate;
  const targetDay = deviceDayOfWeek(offset);
  return days.find((day) => Number(day.day) === targetDay) || (offset === 0 ? data.today : null);
}

function shouldPreferTomorrow(data) {
  const now = deviceMinutes();
  if (now >= MINUTES_22_00) return true;
  const courses = resolveDay(data, 0)?.courses || [];
  if (!courses.length) return false;
  return courses.every((course) => courseEndMinutes(course) < now);
}

function firstCourses(day, limit) {
  return (day?.courses || []).slice(0, limit);
}

function nextCourses(day, limit) {
  const now = deviceMinutes();
  return (day?.courses || []).filter((course) => {
    const start = parseMinutes(course?.startTime);
    return start >= now || (start < 0 && courseEndMinutes(course) >= now);
  }).slice(0, limit);
}

function dayTitle(day, fallback) {
  const date = shortDate(day?.date);
  return (day?.label || fallback) + (date ? " " + date : "");
}

function header(widget, data, day, modeText) {
  addLine(widget, "药大课表", Font.boldSystemFont(15), color("#172033", "#f8fafc"));
  const dateText = shortDate(day?.date);
  const sub = "第 " + (data.week || "--") + " 周 · " + modeText + (dateText ? " " + dateText : "");
  addLine(widget, sub, Font.systemFont(11), color("#64748b", "#cbd5e1"));
  widget.addSpacer(8);
}

function footer(widget, data) {
  widget.addSpacer();
  const updated = new Date(data.cachedAt || data.generatedAt || Date.now());
  const updatePrefix = data.stale ? "缓存 " : "更新 ";
  addLine(widget, updatePrefix + updated.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), Font.systemFont(9), color("#98a2b3", "#94a3b8"));
}

function renderSmall(widget, data) {
  let preferTomorrow = shouldPreferTomorrow(data);
  let day = resolveDay(data, preferTomorrow ? 1 : 0);
  let courses = preferTomorrow ? firstCourses(day, 1) : nextCourses(day, 1);
  if (!courses.length && !preferTomorrow) {
    preferTomorrow = true;
    day = resolveDay(data, 1);
    courses = firstCourses(day, 1);
  }
  header(widget, data, day, preferTomorrow ? "明日课程" : "今日课程");
  if (!courses.length) {
    addLine(widget, preferTomorrow ? "明天没有课程" : "今日暂无课程", Font.mediumSystemFont(13), color("#475467", "#e2e8f0"));
  } else {
    const next = courses[0];
    const time = (next.startTime || "") + (next.endTime ? "-" + next.endTime : "");
    addLine(widget, (preferTomorrow ? "明日下节 " : "下节 ") + time, Font.systemFont(10), color("#168776", "#5eead4"));
    addLine(widget, next.name || "课程", Font.boldSystemFont(13), color("#172033", "#f8fafc"));
    addLine(widget, courseMetaText(next) || "地点待确认", Font.systemFont(10), color("#667085", "#cbd5e1"));
  }
  footer(widget, data);
}

function renderCourseList(stack, title, courses, emptyText) {
  addLine(stack, title, Font.boldSystemFont(12), color("#168776", "#5eead4"));
  stack.addSpacer(4);
  if (!courses.length) {
    addLine(stack, emptyText || "没有课程", Font.mediumSystemFont(11), color("#475467", "#e2e8f0"));
    return;
  }
  for (const course of courses) {
    addLine(stack, coursePrimaryText(course, true), Font.mediumSystemFont(11), color("#1f2937", "#f8fafc"));
    const meta = courseMetaText(course);
    if (meta) {
      addLine(stack, meta, Font.systemFont(8), color("#7a8496", "#94a3b8"));
    }
    stack.addSpacer(4);
  }
}

function renderSingleDay(widget, data, day, title, limit) {
  header(widget, data, day, title);
  renderCourseList(widget, dayTitle(day, title), firstCourses(day, limit), "没有课程");
  footer(widget, data);
}

function renderHorizontalSplit(widget, data, topDay, bottomDay, topTitle, bottomTitle) {
  header(widget, data, topDay, topTitle);
  renderCourseList(widget, dayTitle(topDay, topTitle), firstCourses(topDay, 6), "没有课程");
  widget.addSpacer(6);
  const divider = widget.addStack();
  divider.backgroundColor = color("#e2eaf4", "#334155");
  divider.size = new Size(320, 1);
  widget.addSpacer(6);
  renderCourseList(widget, dayTitle(bottomDay, bottomTitle), firstCourses(bottomDay, 5), "没有课程");
  footer(widget, data);
}

async function render() {
  const data = await loadSchedule();
  const widget = new ListWidget();
  widget.backgroundColor = color("#f8fbff", "#111827");
  widget.setPadding(12, 12, 12, 12);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const preferTomorrow = shouldPreferTomorrow(data);
  const leftDay = resolveDay(data, preferTomorrow ? 1 : 0);
  const rightDay = resolveDay(data, preferTomorrow ? 2 : 1);

  if (config.widgetFamily === "small") {
    renderSmall(widget, data);
  } else if (config.widgetFamily === "large") {
    renderHorizontalSplit(widget, data, leftDay, rightDay, preferTomorrow ? "明日时间线" : "今日时间线", preferTomorrow ? "后天预览" : "明日预览");
  } else {
    renderSingleDay(widget, data, leftDay, preferTomorrow ? "明日课程" : "今日课程", 6);
  }
  return widget;
}

try {
  const widget = await render();
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }
} catch (error) {
  const widget = new ListWidget();
  widget.backgroundColor = color("#fff7ed", "#1f2937");
  widget.setPadding(12, 12, 12, 12);
  addLine(widget, "课表读取失败", Font.boldSystemFont(14), color("#9a3412", "#fed7aa"));
  widget.addSpacer(6);
  addLine(widget, String(error.message || error), Font.systemFont(11), color("#7c2d12", "#fdba74"));
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

Script.complete();
`;
}

onMounted(async () => {
  document.documentElement.classList.add("schedule-scroll-lock");
  document.body.classList.add("schedule-scroll-lock");
  jwxt.hydrate();
  hasCreds.value = hasSavedCreds();
  restoreScheduleTheme();
  restoreScheduleBackground();
  updateViewportHeight();
  window.addEventListener("resize", updateViewportHeight);
  window.visualViewport?.addEventListener("resize", updateViewportHeight);
  window.visualViewport?.addEventListener("scroll", updateViewportHeight);

  // 第一时间从 localStorage 还原缓存，让画面"秒开"——不等任何网络请求
  restoreLastState();
  restoreCachedCalendar();
  restoreLastScheduleCache();
  loadScheduleEdits();

  // 内置浏览器先提示跳外部浏览器；普通移动浏览器再提示安装 / 添加桌面。
  openBrowserPromptRef.value?.autoPromptIfEligible();
  installPromptRef.value?.autoPromptIfEligible();
  autoPromptAndroidAppUpdate();

  // 后台静默：刷新会话状态 + 自动登录 + 重新拉数据。失败也不影响已显示的缓存。
  void (async () => {
    try { await jwxt.refreshStatus(); } catch { /* ignore */ }
    if (!jwxt.isLoggedIn && hasCreds.value) {
      autoLoading.value = true;
      try { await jwxt.tryAutoLogin({ force: true }); }
      finally { autoLoading.value = false; }
    }
    if (jwxt.isLoggedIn) {
      await loadCalendar();
      await loadSchedule();
    }
  })();
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove("schedule-scroll-lock");
  document.body.classList.remove("schedule-scroll-lock");
  window.removeEventListener("resize", updateViewportHeight);
  window.visualViewport?.removeEventListener("resize", updateViewportHeight);
  window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
  clearStaticWeekAnimation();
  stopWidgetInstructionCountdown();
  stopAndroidUpdateCountdown();
  if (androidAppUpdatePromptTimer) {
    window.clearTimeout(androidAppUpdatePromptTimer);
    androidAppUpdatePromptTimer = 0;
  }
  if (scheduleEditsSaveTimer) {
    window.clearTimeout(scheduleEditsSaveTimer);
    scheduleEditsSaveTimer = 0;
  }
});

const semesters = computed(() => parsed.value?.semesters ?? []);
const weeks = computed(() => parsed.value?.weeks ?? []);
const currentWeekInfo = computed(() => weekInfoFor(week.value));
const currentWeekRange = computed(() => weekRangeFor(week.value));
const dayTabs = computed(() => dayTabsForWeek(week.value));
const activeDayLabel = computed(() => dayTabs.value.find((d) => d.day === activeDay.value)?.label ?? "今日");
const cacheText = computed(() => scheduleSavedAt.value ? `本地缓存 ${formatCacheTime(scheduleSavedAt.value)}` : "");
const activeWeekNumber = computed(() => {
  const value = Number(week.value || parsed.value?.currentWeek || calendar.value?.currentWeek || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
});
const currentThemePreview = computed(() => (
  scheduleThemeOptions.find((item) => item.key === scheduleTheme.value)?.preview ?? scheduleThemeOptions[0]?.preview ?? "#22c55e"
));
const hasScheduleBackground = computed(() => Boolean(scheduleBackground.imageDataUrl));
const backgroundVisibility = computed(() => Math.round((1 - scheduleBackground.overlayOpacity) * 100));
const backgroundPreviewStyle = computed(() => (
  hasScheduleBackground.value
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(248, 251, 255, ${scheduleBackground.overlayOpacity}) 0%, rgba(248, 251, 255, ${Math.min(0.92, scheduleBackground.overlayOpacity + 0.1)}) 100%), url("${scheduleBackground.imageDataUrl}")`,
      }
    : {}
));
const isViewingToday = computed(() => {
  const cur = calendar.value?.currentWeek;
  if (!cur || String(cur) !== currentWeekValue()) return false;
  return viewMode.value === "week" || activeDay.value === dayOfWeek();
});
const pageStyle = computed(() => ({
  ...scheduleThemeCssVars(scheduleTheme.value),
  "--schedule-bg-image": hasScheduleBackground.value ? `url("${scheduleBackground.imageDataUrl}")` : "none",
  "--schedule-bg-overlay": `rgba(248, 251, 255, ${hasScheduleBackground.value ? scheduleBackground.overlayOpacity : 0.84})`,
  "--schedule-bg-blur": `${scheduleBackground.blur}px`,
  "--schedule-surface-bg": hasScheduleBackground.value ? "rgba(255, 255, 255, 0.72)" : "#ffffff",
  "--schedule-surface-bg-soft": hasScheduleBackground.value ? "rgba(255, 255, 255, 0.84)" : "#f9fafb",
  ...(viewportHeight.value ? { "--schedule-vh": `${viewportHeight.value / 100}px` } : {}),
}));
const useStaticWeekSwipe = computed(() => false);
const currentCells = computed<ScheduleCell[]>(() => cellsForWeek(activeWeekNumber.value, parsed.value));
const dayCourses = computed<FlatCourse[]>(() => dayCoursesFor(activeWeekNumber.value, activeDay.value, parsed.value));
const dayCourseBlocks = computed<WeekCourseBlock[]>(() => (
  dayCourseBlocksFor(activeWeekNumber.value, activeDay.value, parsed.value)
));
const weekCourseBlocks = computed<WeekCourseBlock[]>(() => weekCourseBlocksFor(activeWeekNumber.value, parsed.value));
const editDialogWidth = computed(() => compactViewport.value ? "92vw" : "560px");
const maxWeekNumber = computed(() => {
  const values = weeks.value.map((w) => Number(w.value)).filter((v) => Number.isFinite(v) && v > 0);
  return values.length ? Math.max(...values) : 20;
});
const weekNumberOptions = computed(() => {
  const values = weeks.value.map((w) => Number(w.value)).filter((v) => Number.isFinite(v) && v > 0);
  if (values.length) return values;
  return Array.from({ length: maxWeekNumber.value }, (_, i) => i + 1);
});
const canRestoreOriginalCourse = computed(() => Boolean(editingCourseBlock.value?.course.sourceKey));
const hiddenCourseItems = computed(() => {
  const hidden = new Set(scheduleEdits.value.hidden);
  const items: Array<{ key: string; label: string }> = [];
  const seenFamilies = new Set<string>();
  for (const source of allKnownScheduleSources()) {
    for (const cell of source.cells ?? []) {
      for (const course of cell.courses ?? []) {
        const key = courseEditKey(cell.day, cell.bigSlot, course);
        if (!hidden.has(key)) continue;
        const familyKey = courseFamilyKey(cell.day, cell.bigSlot, course);
        if (seenFamilies.has(familyKey)) continue;
        seenFamilies.add(familyKey);
        items.push({ key: familyKey, label: `${course.name} · ${dayLabel(cell.day)}` });
      }
    }
  }
  return items;
});

// 横向轨道始终渲染：上一页 / 当前页 / 下一页，拖动时只移动轨道。
const slideDirection = ref<"next" | "prev">("next");
const contentRef = ref<HTMLElement | null>(null);
const carouselTrackRef = ref<HTMLElement | null>(null);
const dragState = reactive({
  tracking: false,
  dragging: false,
  settling: false,
  pointerId: -1,
  startX: 0,
  startY: 0,
  offsetX: 0,
  width: 0,
  suppressClick: false,
});
let dragOffsetX = 0;
let dragLastX = 0;
let dragLastTime = 0;
let dragVelocityX = 0;
let dragFrame = 0;
let pendingTrackOffset = 0;
let dragCommitDelta = 0;
let dragCommitTimer = 0;
let dragCaptureTarget: HTMLElement | null = null;
const staticWeekAnimationClass = ref<"" | "week-slide-in-next" | "week-slide-in-prev">("");
let staticWeekAnimationTimer = 0;
const carouselPages = computed<SchedulePageModel[]>(() => {
  const deltas = useStaticWeekSwipe.value ? [0] : [-1, 0, 1];
  return deltas.map((delta) => (viewMode.value === "week" ? weekPageModel(delta) : dayPageModel(delta)));
});

async function loadCalendar() {
  restoreCachedCalendar();
  try {
    const r: any = await jwxtApi.calendar();
    calendar.value = r.parsed;
    writeCache(jwxtScopedStorageKey(CALENDAR_CACHE_BASE), calendar.value);
    if (calendar.value?.currentWeek && !week.value) week.value = String(calendar.value.currentWeek);
  } catch { /* calendar is best effort */ }
}

async function loadSchedule(force = false, background = false) {
  if (!jwxt.isLoggedIn || (loading.value && !force && !background)) return;
  const hadCache = !force && restoreScheduleCache();
  if (hadCache) {
    saveLastState();
    if (!isStale(scheduleSavedAt.value)) return;
  }
  if (!background) loading.value = !parsed.value || force || !hadCache;
  try {
    const r: any = await jwxtApi.schedule({ semester: semester.value, week: week.value });
    parsed.value = r.parsed;
    if (!semester.value) semester.value = parsed.value?.currentSemester ?? "";
    if (!week.value) week.value = String(calendar.value?.currentWeek || parsed.value?.currentWeek || "");
    loadScheduleEdits();
    scheduleSavedAt.value = Date.now();
    saveScheduleCache();
    saveLastState();
    prewarmAdjacentWeekCaches();
  } finally {
    if (!background) loading.value = false;
  }
}

function canChangeWeek(delta: number) {
  const next = nextWeekValue(delta);
  return Boolean(next && next !== week.value);
}

async function changeWeek(delta: number) {
  const next = nextWeekValue(delta);
  if (!next) return;
  week.value = next;
  saveLastState();
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    if (isStale(cached.savedAt)) void loadSchedule(false, true);
    return;
  }
  await loadSchedule(false);
  prewarmAdjacentWeekCaches();
}

const canJumpToCurrentWeek = computed(() => {
  const cur = calendar.value?.currentWeek;
  return Boolean(cur && String(cur) !== week.value);
});

async function jumpToToday() {
  if (viewMode.value === "week") {
    await jumpToCurrentWeek();
    return;
  }
  viewMode.value = "day";
  if (!calendar.value?.currentWeek) {
    slideDirection.value = dayOfWeek() >= activeDay.value ? "next" : "prev";
    activeDay.value = dayOfWeek();
    saveLastState();
    return;
  }
  await jumpToCurrentWeek();
}

async function jumpToCurrentWeek() {
  const cur = calendar.value?.currentWeek;
  if (!cur) return;
  const today = dayOfWeek();
  if (String(cur) === week.value) {
    slideDirection.value = today >= activeDay.value ? "next" : "prev";
    activeDay.value = today;
    saveLastState();
    return;
  }
  slideDirection.value = Number(week.value || cur) > cur ? "prev" : "next";
  week.value = String(cur);
  activeDay.value = today;
  saveLastState();
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, week.value);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    if (isStale(cached.savedAt)) void loadSchedule(false, true);
    return;
  }
  await loadSchedule(false);
}

async function prevDay() {
  slideDirection.value = "prev";
  if (activeDay.value > 1) {
    activeDay.value -= 1;
    saveLastState();
    return;
  }
  if (!canChangeWeek(-1)) return;
  activeDay.value = 7;
  await changeWeek(-1);
}

async function nextDay() {
  slideDirection.value = "next";
  if (activeDay.value < 7) {
    activeDay.value += 1;
    saveLastState();
    return;
  }
  if (!canChangeWeek(1)) return;
  activeDay.value = 1;
  await changeWeek(1);
}

function onDayClick(day: number) {
  slideDirection.value = day > activeDay.value ? "next" : "prev";
  activeDay.value = day;
  saveLastState();
}

function setViewMode(mode: ViewMode) {
  viewMode.value = mode;
  saveLastState();
}

function onCourseBlockClick(event: MouseEvent, block: WeekCourseBlock, targetWeek = week.value) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  event.stopPropagation();
  if (targetWeek && targetWeek !== week.value) {
    week.value = targetWeek;
    saveLastState();
  }
  if (!ensureScheduleEditEnabled()) return;
  openCourseEditor(block, targetWeek);
}

function onWeekSlotClick(event: MouseEvent, day: number, slot: number, targetWeek = week.value) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) {
    event.preventDefault();
    return;
  }
  if (targetWeek && targetWeek !== week.value) {
    week.value = targetWeek;
    saveLastState();
  }
  if (!ensureScheduleEditEnabled()) return;
  openAddCourse(day, slot, targetWeek);
}

function onDaySlotClick(event: MouseEvent, day: number, slot: number, targetWeek = week.value) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) {
    event.preventDefault();
    return;
  }
  if (!ensureScheduleEditEnabled()) return;
  openAddCourse(day, slot, targetWeek);
}

function onSchedulePointerDown(event: PointerEvent) {
  if ((viewMode.value !== "day" && viewMode.value !== "week") || loading.value) return;
  if (dragState.settling) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  dragState.tracking = true;
  dragState.dragging = false;
  dragState.settling = false;
  dragState.pointerId = event.pointerId;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.offsetX = 0;
  dragState.width = (event.currentTarget as HTMLElement | null)?.clientWidth || window.innerWidth || 1;
  dragOffsetX = 0;
  dragVelocityX = 0;
  dragLastX = event.clientX;
  dragLastTime = performance.now();
  setDragClasses(false, false);
  clearTrackOffset();
}

function onSchedulePointerMove(event: PointerEvent) {
  if (!dragState.tracking || event.pointerId !== dragState.pointerId) return;
  const now = performance.now();
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const likelyHorizontal = absDx >= 4 && absDx >= absDy * 0.55;
  const dt = Math.max(1, now - dragLastTime);
  dragVelocityX = (event.clientX - dragLastX) / dt;
  dragLastX = event.clientX;
  dragLastTime = now;
  if (likelyHorizontal && event.cancelable) event.preventDefault();
  if (!dragState.dragging) {
    if (absDy > 18 && absDy > absDx * 1.8) {
      resetDrag();
      return;
    }
    if (absDx < 5 || !likelyHorizontal) return;
    dragState.dragging = true;
    dragState.suppressClick = true;
    captureDragPointer(event);
    setDragClasses(true, false);
  }
  if (event.cancelable) event.preventDefault();
  const canMove = dx > 0 ? canChangeByDrag(-1) : canChangeByDrag(1);
  dragOffsetX = canMove ? dx : dx * 0.28;
  scheduleTrackOffset(dragOffsetX);
}

async function onSchedulePointerEnd(event: PointerEvent) {
  if (!dragState.tracking || event.pointerId !== dragState.pointerId) return;
  releaseDragPointer(event.pointerId);
  if (!dragState.dragging) {
    resetDrag();
    return;
  }
  const offset = dragOffsetX;
  const threshold = Math.min(72, Math.max(34, dragState.width * 0.14));
  const direction = offset > 0 ? -1 : 1;
  const fastSwipe = Math.abs(dragVelocityX) >= 0.42 && Math.abs(offset) >= 22;
  const shouldChange = (Math.abs(offset) >= threshold || fastSwipe) && canChangeByDrag(direction);
  if (!shouldChange) {
    animateDragTo(0);
    window.setTimeout(resetDrag, 180);
    return;
  }
  if (useStaticWeekSwipe.value) {
    await applyStaticWeekSwipe(direction);
    return;
  }
  dragCommitDelta = direction;
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  dragCommitTimer = window.setTimeout(() => {
    void flushDragCommit();
  }, 260);
  animateDragTo(direction > 0 ? -dragState.width : dragState.width);
}

function onSchedulePointerCancel() {
  if (!dragState.tracking) return;
  releaseDragPointer();
  animateDragTo(0);
  window.setTimeout(resetDrag, 180);
}

function canChangeDay(delta: number) {
  if (delta < 0) return activeDay.value > 1 || canChangeWeek(-1);
  return activeDay.value < 7 || canChangeWeek(1);
}

function canChangeByDrag(delta: number) {
  return viewMode.value === "week" ? canChangeWeek(delta) : canChangeDay(delta);
}

async function applyDragChange(delta: number) {
  if (viewMode.value === "week") {
    slideDirection.value = delta > 0 ? "next" : "prev";
    await changeWeek(delta);
    return;
  }
  await (delta > 0 ? nextDay() : prevDay());
}

async function flushDragCommit() {
  if (!dragCommitDelta) return;
  const delta = dragCommitDelta;
  dragCommitDelta = 0;
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  try {
    await applyDragChange(delta);
    await nextTick();
  } finally {
    resetDrag();
  }
}

async function applyStaticWeekSwipe(delta: number) {
  dragCommitDelta = 0;
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  clearStaticWeekAnimation();
  dragState.tracking = false;
  dragState.dragging = false;
  dragState.settling = true;
  setDragClasses(false, true);
  setStaticWeekOffset(0);
  try {
    await applyDragChange(delta);
    await nextTick();
    setStaticWeekOffset(0);
    staticWeekAnimationClass.value = delta > 0 ? "week-slide-in-next" : "week-slide-in-prev";
    staticWeekAnimationTimer = window.setTimeout(() => {
      staticWeekAnimationTimer = 0;
      staticWeekAnimationClass.value = "";
      resetDrag();
    }, 220);
  } catch (error) {
    resetDrag();
    throw error;
  }
}

function onCarouselTrackTransitionEnd(event: TransitionEvent) {
  if (event.propertyName !== "transform" || !dragState.settling || !dragCommitDelta) return;
  void flushDragCommit();
}

function animateDragTo(targetX: number) {
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  dragState.tracking = false;
  dragState.dragging = false;
  dragState.settling = true;
  dragOffsetX = targetX;
  setDragClasses(false, true);
  window.requestAnimationFrame(() => setTrackOffset(targetX));
}

function resetDrag() {
  releaseDragPointer();
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  clearStaticWeekAnimation();
  dragCommitDelta = 0;
  dragState.tracking = false;
  dragState.dragging = false;
  dragState.settling = false;
  dragState.pointerId = -1;
  dragState.offsetX = 0;
  dragOffsetX = 0;
  dragVelocityX = 0;
  setDragClasses(false, false);
  clearTrackOffset();
  window.setTimeout(() => {
    dragState.suppressClick = false;
  }, 220);
}

function captureDragPointer(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target || dragCaptureTarget === target) return;
  try {
    target.setPointerCapture?.(event.pointerId);
    dragCaptureTarget = target;
  } catch {
    dragCaptureTarget = null;
  }
}

function releaseDragPointer(pointerId = dragState.pointerId) {
  if (!dragCaptureTarget || pointerId < 0) {
    dragCaptureTarget = null;
    return;
  }
  try {
    if (!dragCaptureTarget.hasPointerCapture || dragCaptureTarget.hasPointerCapture(pointerId)) {
      dragCaptureTarget.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Safari can drop pointer capture before pointercancel reaches Vue.
  }
  dragCaptureTarget = null;
}

function setDragClasses(dragging: boolean, settling: boolean) {
  const content = contentRef.value;
  if (!content) return;
  content.classList.toggle("dragging", dragging);
  content.classList.toggle("settling", settling);
}

function scheduleTrackOffset(offsetX: number) {
  pendingTrackOffset = offsetX;
  if (dragFrame) return;
  dragFrame = window.requestAnimationFrame(() => {
    dragFrame = 0;
    setTrackOffset(pendingTrackOffset);
  });
}

function setTrackOffset(offsetX: number) {
  if (useStaticWeekSwipe.value) {
    setStaticWeekOffset(easeStaticWeekOffset(offsetX));
    return;
  }
  const track = carouselTrackRef.value;
  if (!track) return;
  track.style.transform = `translate3d(calc(-33.333333% + ${offsetX}px), 0, 0)`;
}

function clearTrackOffset() {
  if (useStaticWeekSwipe.value) {
    clearStaticWeekOffset();
    return;
  }
  const track = carouselTrackRef.value;
  if (!track) return;
  track.style.transform = "";
}

function easeStaticWeekOffset(offsetX: number) {
  const maxOffset = Math.min(58, Math.max(30, dragState.width * 0.16));
  const eased = offsetX * 0.36;
  return Math.max(-maxOffset, Math.min(maxOffset, eased));
}

function setStaticWeekOffset(offsetX: number) {
  contentRef.value?.style.setProperty("--static-week-offset", `${offsetX}px`);
}

function clearStaticWeekOffset() {
  contentRef.value?.style.removeProperty("--static-week-offset");
}

function clearStaticWeekAnimation() {
  if (staticWeekAnimationTimer) {
    window.clearTimeout(staticWeekAnimationTimer);
    staticWeekAnimationTimer = 0;
  }
  staticWeekAnimationClass.value = "";
}

async function reloadCaptcha() {
  captchaInput.value = "";
  captchaError.value = "";
  await jwxt.beginLogin().catch(() => undefined);
}

async function submitCaptcha() {
  if (!captchaInput.value.trim()) {
    captchaError.value = "请输入验证码";
    return;
  }
  const creds = await loadCreds().catch(() => null);
  if (!creds) {
    ElMessage.warning("未找到保存的账号，请先完成教务授权");
    return;
  }
  captchaSubmitting.value = true;
  captchaError.value = "";
  try {
    const ok = await jwxt.submitLogin(creds.username, creds.password, captchaInput.value.trim(), true);
    if (!ok) {
      captchaError.value = jwxt.error || "验证码错误，请重试";
      captchaInput.value = "";
      return;
    }
    ElMessage.success("授权成功");
    restoreLastState();
    restoreCachedCalendar();
    restoreLastScheduleCache();
    await loadCalendar();
    await loadSchedule(true);
  } finally {
    captchaSubmitting.value = false;
  }
}

function dayOfWeek() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

function updateViewportHeight() {
  const visualHeight = window.visualViewport?.height ?? window.innerHeight;
  const height = Math.min(visualHeight, window.innerHeight);
  viewportHeight.value = Math.max(0, Math.round(height || 0));
  compactViewport.value = window.matchMedia?.("(max-width: 760px)").matches ?? window.innerWidth <= 760;
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shortDate(value: string) {
  const m = value.match(/-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : "";
}

/** 给 "YYYY-MM-DD" 加一天 */
function plusOneDay(ymd: string): string {
  if (!ymd) return "";
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatCacheTime(ts: number) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function weekInfoFor(value: string | number) {
  return calendar.value?.weeks.find((w) => w.week === Number(value)) ?? null;
}

function weekRangeFor(value: string | number) {
  const w = weekInfoFor(value);
  if (!w || w.days.length < 7) return "";
  const monday = w.days[1];
  const sunday = plusOneDay(w.days[6]);
  return `${shortDate(monday)} - ${shortDate(sunday)}`;
}

function dayTabsForWeek(value: string | number) {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const raw = weekInfoFor(value)?.days ?? [];
  const dates = raw.length >= 7 ? [...raw.slice(1, 7), plusOneDay(raw[6])] : [];
  const today = todayKey();
  return labels.map((label, i) => ({
    day: i + 1,
    label,
    date: shortDate(dates[i] ?? ""),
    isToday: dates[i] === today,
  }));
}

function scheduleForWeek(weekValue: string | number) {
  const requested = String(weekValue || "");
  if (requested && requested === currentWeekValue() && parsed.value) return parsed.value;
  const cached = cachedScheduleEnvelopeForWeek(requested);
  return cached?.data ?? (requested === currentWeekValue() ? parsed.value : null);
}

function cachedScheduleEnvelopeForWeek(weekValue: string | number) {
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, String(weekValue || ""));
  return scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
}

function cellsForWeek(wk: number, source: ScheduleResult | null = parsed.value) {
  return applyScheduleEditsToCells((source?.cells ?? []), scheduleEdits.value)
    .map((cell) => ({
      ...cell,
      courses: wk ? cell.courses.filter((course) => courseMatchesWeek(course, wk)) : cell.courses,
    }))
    .filter((cell) => cell.courses.length);
}

function dayCoursesFor(wk: number, day: number, source: ScheduleResult | null = parsed.value) {
  const list: FlatCourse[] = [];
  for (const cell of cellsForWeek(wk, source)) {
    if (cell.day !== day) continue;
    cell.courses.forEach((course, index) => list.push({ bigSlot: cell.bigSlot, index, course }));
  }
  return list.sort((a, b) => a.bigSlot - b.bigSlot);
}

function weekCourseBlocksFor(wk: number, source: ScheduleResult | null = parsed.value) {
  const byCourse = new Map<string, WeekCourseBlock[]>();
  for (const cell of cellsForWeek(wk, source)) {
    cell.courses.forEach((course, index) => {
      const range = normalizeSlotRangeForTablePosition(cell.bigSlot, course);
      const key = [
        cell.day,
        normalizeKeyPart(course.name),
        normalizeKeyPart(course.teacher),
        normalizeKeyPart(course.location),
        normalizeKeyPart(course.weeks),
      ].join("|");
      const list = byCourse.get(key) ?? [];
      list.push({ day: cell.day, bigSlot: cell.bigSlot, startSlot: range.start, endSlot: range.end, index, course });
      byCourse.set(key, list);
    });
  }
  const blocks: WeekCourseBlock[] = [];
  for (const list of byCourse.values()) {
    for (const block of mergeContinuousCourseBlocks(list)) blocks.push(block);
  }
  return blocks.sort((a, b) => a.startSlot - b.startSlot || a.day - b.day || a.index - b.index);
}

function dayCourseBlocksFor(wk: number, day: number, source: ScheduleResult | null = parsed.value) {
  return weekCourseBlocksFor(wk, source).filter((block) => block.day === day);
}

function weekPageModel(delta: number): SchedulePageModel {
  const weekValue = delta === 0 ? currentWeekValue() : nextWeekValueFrom(currentWeekValue(), delta) || currentWeekValue();
  const weekNo = Number(weekValue || 0);
  const source = scheduleForWeek(weekValue);
  const blocks = weekCourseBlocksFor(weekNo, source);
  return {
    delta,
    key: `week-${delta}`,
    weekValue,
    day: activeDay.value,
    title: "整周",
    dayTabs: dayTabsForWeek(weekValue),
    courseCount: blocks.length,
    dayCourseBlocks: dayCourseBlocksFor(weekNo, activeDay.value, source),
    weekCourseBlocks: blocks,
  };
}

function dayPageModel(delta: number): SchedulePageModel {
  const target = dayTarget(delta);
  const weekNo = Number(target.weekValue || 0);
  const source = scheduleForWeek(target.weekValue);
  const blocks = dayCourseBlocksFor(weekNo, target.day, source);
  const tabs = dayTabsForWeek(target.weekValue);
  return {
    delta,
    key: `day-${delta}`,
    weekValue: target.weekValue,
    day: target.day,
    title: tabs.find((d) => d.day === target.day)?.label ?? "今日",
    dayTabs: tabs,
    courseCount: blocks.length,
    dayCourseBlocks: blocks,
    weekCourseBlocks: weekCourseBlocksFor(weekNo, source),
  };
}

function dayTarget(delta: number) {
  if (delta === 0) return { weekValue: currentWeekValue(), day: activeDay.value };
  if (delta < 0) {
    if (activeDay.value > 1) return { weekValue: currentWeekValue(), day: activeDay.value - 1 };
    return { weekValue: nextWeekValueFrom(currentWeekValue(), -1) || currentWeekValue(), day: 7 };
  }
  if (activeDay.value < 7) return { weekValue: currentWeekValue(), day: activeDay.value + 1 };
  return { weekValue: nextWeekValueFrom(currentWeekValue(), 1) || currentWeekValue(), day: 1 };
}

function currentWeekValue() {
  return week.value || String(calendar.value?.currentWeek || parsed.value?.currentWeek || "");
}

function nextWeekValue(delta: number) {
  return nextWeekValueFrom(currentWeekValue(), delta);
}

function nextWeekValueFrom(current: string, delta: number) {
  const values = weeks.value.map((w) => String(w.value)).filter(Boolean);
  const index = values.indexOf(current);
  if (index >= 0) return values[index + delta] || "";
  const next = Number(current) + delta;
  if (!Number.isFinite(next) || next < 1) return "";
  if (calendar.value?.weeks.length && next > calendar.value.weeks.length) return "";
  return String(next);
}

function courseTitle(course: ScheduleCourse) {
  return [
    course.name,
    course.teacher ? `教师：${course.teacher}` : "",
    course.location ? `地点：${course.location}` : "",
    course.weeks,
    course.slotNote,
  ].filter(Boolean).join("\n");
}

function courseFamilyKey(day: number, bigSlot: number, course: ScheduleCourse) {
  const range = normalizeSlotRange(bigSlot, course);
  return [
    "jwxt-family",
    day,
    range.start,
    range.end,
    normalizeKeyPart(course.name),
    normalizeKeyPart(course.teacher),
    normalizeKeyPart(course.location),
  ].join("|");
}

function courseFamilySourceKeys(day: number, bigSlot: number, course: ScheduleCourse) {
  const targetFamilyKey = courseFamilyKey(day, bigSlot, course);
  const keys = new Set<string>();
  for (const source of allKnownScheduleSources()) {
    for (const cell of source.cells ?? []) {
      for (const sourceCourse of cell.courses ?? []) {
        if (courseFamilyKey(cell.day, cell.bigSlot, sourceCourse) !== targetFamilyKey) continue;
        keys.add(courseEditKey(cell.day, cell.bigSlot, sourceCourse));
      }
    }
  }
  return keys;
}

function toneFor(name: string): CourseTone {
  if (scheduleTheme.value === "color-glass") return getColorGlassCourseTone(name);
  const theme = getScheduleThemePalette(scheduleTheme.value);
  return { bg: theme.courseBg, border: theme.courseBorder, text: theme.courseText };
}

function dayLabel(day: number) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] ?? `周${day}`;
}

function hasScheduleEditAuth() {
  try {
    return Boolean(localStorage.getItem("cpu-web-token"));
  } catch {
    return false;
  }
}

function canUseScheduleEdit() {
  const client = detectClientPlatform();
  return (client === "android" || client === "ios") && hasScheduleEditAuth();
}

function ensureScheduleEditEnabled() {
  return canUseScheduleEdit();
}

function showEditorMessage(type: "success" | "warning", message: string) {
  ElMessage({ type, message, offset: 96 });
}

async function restoreHiddenCourse(key: string) {
  await loadScheduleEdits();
  try {
    await ElMessageBox.confirm("确定恢复这门已编辑课程吗？恢复后会重新出现在课表里。", "恢复已编辑课程", {
      confirmButtonText: "恢复",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  const keysToRestore = new Set<string>();
  for (const source of allKnownScheduleSources()) {
    for (const cell of source.cells ?? []) {
      for (const course of cell.courses ?? []) {
        const sourceKey = courseEditKey(cell.day, cell.bigSlot, course);
        if (sourceKey === key || courseFamilyKey(cell.day, cell.bigSlot, course) === key) {
          keysToRestore.add(sourceKey);
        }
      }
    }
  }
  keysToRestore.add(key);
  scheduleEdits.value = {
    ...scheduleEdits.value,
    hidden: scheduleEdits.value.hidden.filter((item) => !keysToRestore.has(item)),
  };
  persistScheduleEdits();
}

async function openAddCourse(day = activeDay.value, slot = 1, targetWeek = currentWeekValue()) {
  if (!ensureScheduleEditEnabled()) return;
  await loadScheduleEdits();
  editingCourseBlock.value = null;
  editingCourseKey.value = "";
  editingWeekValue.value = String(targetWeek || currentWeekValue());
  customCourseForm.name = "";
  customCourseForm.day = day;
  customCourseForm.startSlot = clampSlot(slot);
  customCourseForm.endSlot = Math.min(MAX_SMALL_SLOT, customCourseForm.startSlot + 1);
  customCourseForm.weekMode = "current";
  customCourseForm.weekList = [Number(editingWeekValue.value || activeWeekNumber.value || week.value || 1)].filter(Boolean);
  customCourseForm.weekText = customCourseWeeksText(customCourseForm.weekList);
  customCourseForm.location = "";
  customCourseForm.teacher = "";
  customCourseForm.note = "";
  editDialogOpen.value = true;
}

async function openCourseEditor(block: WeekCourseBlock, targetWeek = currentWeekValue()) {
  if (!ensureScheduleEditEnabled()) return;
  await loadScheduleEdits();
  editingCourseBlock.value = block;
  editingCourseKey.value = courseEditKey(block.day, block.bigSlot, block.course);
  editingWeekValue.value = String(targetWeek || currentWeekValue());
  customCourseForm.name = block.course.name;
  customCourseForm.day = block.day;
  customCourseForm.startSlot = block.startSlot;
  customCourseForm.endSlot = block.endSlot;
  customCourseForm.location = block.course.location || "";
  customCourseForm.teacher = block.course.teacher || "";
  customCourseForm.note = noteFromCourse(block.course);
  setFormWeeksFromCourse(block.course);
  editDialogOpen.value = true;
}

function saveCourseEdit() {
  const name = customCourseForm.name.trim();
  if (!name) {
    showEditorMessage("warning", "请填写课程名称");
    return;
  }
  const startSlot = clampSlot(customCourseForm.startSlot);
  const endSlot = Math.max(startSlot, clampSlot(customCourseForm.endSlot));
  const weekList = customCourseWeekList();
  if (customCourseForm.weekMode === "custom" && !weekList.length) {
    showEditorMessage("warning", "请选择周次");
    return;
  }
  const existing = editingCourseBlock.value?.course.customId
    ? scheduleEdits.value.custom.find((item) => item.id === editingCourseBlock.value?.course.customId)
    : null;
  const item: CustomScheduleItem = {
    id: existing?.id || createCustomCourseId(),
    sourceKey: existing?.sourceKey || editingCourseKey.value || undefined,
    day: customCourseForm.day,
    bigSlot: Math.ceil(startSlot / 2),
    course: {
      name,
      teacher: customCourseForm.teacher.trim() || undefined,
      location: customCourseForm.location.trim() || undefined,
      weeks: customCourseWeeksLabel(weekList),
      weekList,
      startSlot,
      endSlot,
      slotNote: customCourseForm.note.trim() || `第 ${startSlot}-${endSlot} 节`,
    },
  };
  const editingBlock = editingCourseBlock.value;
  const editingFamilyKey = editingBlock ? courseFamilyKey(editingBlock.day, editingBlock.bigSlot, editingBlock.course) : "";
  const hiddenSourceKeys = new Set<string>();
  if (editingBlock && !editingBlock.course.customId) {
    for (const key of courseFamilySourceKeys(editingBlock.day, editingBlock.bigSlot, editingBlock.course)) {
      hiddenSourceKeys.add(key);
    }
    if (item.sourceKey) hiddenSourceKeys.add(item.sourceKey);
    if (editingCourseKey.value) hiddenSourceKeys.add(editingCourseKey.value);
  }
  const custom = scheduleEdits.value.custom.filter((entry) => {
    if (entry.id === item.id) return false;
    if (Boolean(item.sourceKey) && entry.sourceKey === item.sourceKey) return false;
    if (editingFamilyKey && courseFamilyKey(entry.day, entry.bigSlot, entry.course) === editingFamilyKey) return false;
    return true;
  });
  const hidden = [...new Set([...scheduleEdits.value.hidden, ...hiddenSourceKeys])];
  scheduleEdits.value = { hidden, custom: [...custom, item] };
  persistScheduleEdits();
  editDialogOpen.value = false;
  showEditorMessage("success", editingCourseBlock.value ? "已保存课程" : "已添加到课表");
}

async function deleteEditingCourse() {
  await loadScheduleEdits();
  const block = editingCourseBlock.value;
  if (!block) return;
  let next = { ...scheduleEdits.value };
  const targetFamilyKey = courseFamilyKey(block.day, block.bigSlot, block.course);
  const hiddenKeysToRemove = courseFamilySourceKeys(block.day, block.bigSlot, block.course);
  hiddenKeysToRemove.add(editingCourseKey.value || courseEditKey(block.day, block.bigSlot, block.course));
  if (block.course.customId) {
    next = {
      ...next,
      custom: next.custom.filter((item) => courseFamilyKey(item.day, item.bigSlot, item.course) !== targetFamilyKey),
    };
  } else {
    next = {
      hidden: [...new Set([...next.hidden, ...hiddenKeysToRemove])],
      custom: next.custom.filter((item) => courseFamilyKey(item.day, item.bigSlot, item.course) !== targetFamilyKey),
    };
  }
  scheduleEdits.value = next;
  persistScheduleEdits();
  editDialogOpen.value = false;
  showEditorMessage("success", "已从课表隐藏");
}

async function restoreOriginalCourse() {
  await loadScheduleEdits();
  const block = editingCourseBlock.value;
  const sourceKey = block?.course.sourceKey;
  const customId = block?.course.customId;
  if (!sourceKey) return;
  const keysToRestore = block ? courseFamilySourceKeys(block.day, block.bigSlot, block.course) : new Set<string>();
  keysToRestore.add(sourceKey);
  const familyKey = block ? courseFamilyKey(block.day, block.bigSlot, block.course) : "";
  scheduleEdits.value = {
    hidden: scheduleEdits.value.hidden.filter((key) => !keysToRestore.has(key)),
    custom: scheduleEdits.value.custom.filter((item) => (
      item.id !== customId &&
      item.sourceKey !== sourceKey &&
      (!familyKey || courseFamilyKey(item.day, item.bigSlot, item.course) !== familyKey)
    )),
  };
  persistScheduleEdits();
  editDialogOpen.value = false;
  showEditorMessage("success", "已恢复原始课程");
}

function setFormWeeksFromCourse(course: ScheduleCourse) {
  const list = normalizedCourseWeekList(course);
  const all = weekNumberOptions.value;
  const current = Number(editingWeekValue.value || activeWeekNumber.value || week.value || 1);
  if (!list.length || (all.length > 0 && list.length === all.length && all.every((w) => list.includes(w)))) {
    customCourseForm.weekMode = "all";
    customCourseForm.weekList = [...all];
    customCourseForm.weekText = customCourseWeeksText(customCourseForm.weekList);
    return;
  }
  if (list.length === 1 && list[0] === current) {
    customCourseForm.weekMode = "current";
    customCourseForm.weekList = list;
    customCourseForm.weekText = customCourseWeeksText(list);
    return;
  }
  customCourseForm.weekMode = "custom";
  customCourseForm.weekList = list;
  customCourseForm.weekText = customCourseWeeksText(list);
}

function customCourseWeekList() {
  if (customCourseForm.weekMode === "all") return weekNumberOptions.value;
  if (customCourseForm.weekMode === "custom") {
    return [...new Set(customCourseForm.weekList.map(Number).filter(Boolean))].sort((a, b) => a - b);
  }
  return [Number(editingWeekValue.value || activeWeekNumber.value || week.value) || 1];
}

function toggleCustomWeek(weekNo: number) {
  const set = new Set(customCourseForm.weekList);
  if (set.has(weekNo)) set.delete(weekNo);
  else set.add(weekNo);
  customCourseForm.weekList = [...set].sort((a, b) => a - b);
  customCourseForm.weekText = customCourseWeeksText(customCourseForm.weekList);
}

function customCourseWeeksLabel(weekList: number[]) {
  if (!weekList.length) return "全部周";
  if (weekList.length === 1) return `第 ${weekList[0]} 周`;
  const sorted = [...weekList].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const value of sorted.slice(1)) {
    if (value === prev + 1) {
      prev = value;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = value;
    prev = value;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return `第 ${ranges.join("、")} 周`;
}

function customCourseWeeksText(weekList: number[]) {
  return [...new Set(weekList.map(Number).filter(Boolean))].sort((a, b) => a - b).join(",");
}

function noteFromCourse(course: ScheduleCourse) {
  const note = course.slotNote?.trim() || "";
  return /^第\s*\d+\s*-\s*\d+\s*节$/.test(note) ? "" : note;
}

function clampSlot(value: number) {
  return Math.max(1, Math.min(MAX_SMALL_SLOT, Number(value) || 1));
}

function loadScheduleEdits() {
  if (scheduleEditsLoadPromise) return scheduleEditsLoadPromise;
  const sem = semester.value || parsed.value?.currentSemester || "current";
  scheduleEditsLoadPromise = (async () => {
    try {
      const r = await jwxtApi.getScheduleEdits(sem, { silent: true });
      scheduleEdits.value = normalizeScheduleEditsState(r.edits);
    } catch {
      scheduleEdits.value = emptyScheduleEdits();
    } finally {
      scheduleEditsLoadPromise = null;
    }
  })();
  return scheduleEditsLoadPromise;
}

function persistScheduleEdits() {
  if (!canUseScheduleEdit()) return;
  const sem = semester.value || parsed.value?.currentSemester || "current";
  scheduleEdits.value = normalizeScheduleEditsState(scheduleEdits.value);
  if (scheduleEditsSaveTimer) window.clearTimeout(scheduleEditsSaveTimer);
  scheduleEditsSaveTimer = window.setTimeout(() => {
    scheduleEditsSaveTimer = 0;
    const payload = normalizeScheduleEditsState(scheduleEdits.value);
    void jwxtApi.saveScheduleEdits({ semester: sem, edits: payload }, { silent: true });
  }, 160);
}

function normalizeScheduleEditsState(input: ScheduleEditState | null | undefined): ScheduleEditState {
  const hidden = Array.isArray(input?.hidden)
    ? [...new Set(input.hidden.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
    : [];
  const custom = Array.isArray(input?.custom)
    ? input.custom
      .filter((item) => Boolean(
        item &&
        typeof item.id === "string" &&
        Number.isFinite(item.day) &&
        Number.isFinite(item.bigSlot) &&
        item.course &&
        typeof item.course.name === "string" &&
        Array.isArray(item.course.weekList)
      ))
      .map((item) => ({
        ...item,
        id: String(item.id).trim(),
        sourceKey: item.sourceKey?.trim() || undefined,
        course: {
          ...item.course,
          name: String(item.course.name || "").trim(),
          teacher: item.course.teacher?.trim() || undefined,
          location: item.course.location?.trim() || undefined,
          weeks: String(item.course.weeks || "").trim() || "全部周",
          weekList: [...new Set(item.course.weekList.map((w) => Number(w)).filter((w) => Number.isFinite(w) && w > 0))].sort((a, b) => a - b),
          slotNote: item.course.slotNote?.trim() || undefined,
          startSlot: Number.isFinite(item.course.startSlot) ? Number(item.course.startSlot) : undefined,
          endSlot: Number.isFinite(item.course.endSlot) ? Number(item.course.endSlot) : undefined,
        },
      }))
    : [];
  return { hidden, custom };
}

function allKnownScheduleSources() {
  const sources: ScheduleResult[] = [];
  if (parsed.value) sources.push(parsed.value);
  for (const envelope of scheduleCacheStore.values()) {
    if (envelope.data && !sources.includes(envelope.data)) sources.push(envelope.data);
  }
  return sources;
}

function createDefaultScheduleBackground(): ScheduleBackgroundSettings {
  return {
    imageDataUrl: "",
    overlayOpacity: 0.34,
    blur: 0,
  };
}

function normalizeScheduleBackground(input: unknown): ScheduleBackgroundSettings {
  const data = (input && typeof input === "object") ? input as Partial<ScheduleBackgroundSettings> : {};
  return {
    imageDataUrl: typeof data.imageDataUrl === "string" ? data.imageDataUrl : "",
    overlayOpacity: clampNumber(data.overlayOpacity, 0.34, 0.12, 0.78),
    blur: Math.round(clampNumber(data.blur, 0, 0, 18)),
  };
}

function applyScheduleBackground(next: ScheduleBackgroundSettings) {
  scheduleBackground.imageDataUrl = next.imageDataUrl;
  scheduleBackground.overlayOpacity = next.overlayOpacity;
  scheduleBackground.blur = next.blur;
}

function snapshotScheduleBackground(): ScheduleBackgroundSettings {
  return {
    imageDataUrl: scheduleBackground.imageDataUrl,
    overlayOpacity: scheduleBackground.overlayOpacity,
    blur: scheduleBackground.blur,
  };
}

function restoreScheduleTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    scheduleTheme.value = normalizeScheduleTheme(saved);
  } catch {
    /* ignore */
  }
}

function persistScheduleTheme(value = scheduleTheme.value) {
  scheduleTheme.value = normalizeScheduleTheme(value);
  try {
    localStorage.setItem(THEME_KEY, scheduleTheme.value);
  } catch {
    /* ignore */
  }
}

function restoreScheduleBackground() {
  try {
    const raw = localStorage.getItem(BACKGROUND_KEY);
    if (!raw) return;
    applyScheduleBackground(normalizeScheduleBackground(JSON.parse(raw)));
  } catch {
    applyScheduleBackground(createDefaultScheduleBackground());
  }
}

function persistScheduleBackground() {
  const payload = JSON.stringify(snapshotScheduleBackground());
  if (!scheduleBackground.imageDataUrl) {
    localStorage.removeItem(BACKGROUND_KEY);
    return;
  }
  localStorage.setItem(BACKGROUND_KEY, payload);
}

function persistScheduleBackgroundSafe(message = "背景保存失败，请换一张更小的图片后重试") {
  try {
    persistScheduleBackground();
    return true;
  } catch {
    ElMessage.warning(message);
    return false;
  }
}

function pickScheduleBackground() {
  backgroundImageInputRef.value?.click();
}

async function onScheduleBackgroundPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  backgroundSaving.value = true;
  const previous = snapshotScheduleBackground();
  try {
    const dataUrl = await compressImageFile(file, {
      maxWidth: 1440,
      maxHeight: 2400,
      quality: 0.76,
      mimeType: "image/webp",
      maxBytes: 420 * 1024,
    });
    scheduleBackground.imageDataUrl = dataUrl;
    if (!persistScheduleBackgroundSafe()) {
      applyScheduleBackground(previous);
      return;
    }
    ElMessage.success("已设置课表背景");
  } catch (error: any) {
    applyScheduleBackground(previous);
    ElMessage.warning(String(error?.message || "背景图片处理失败"));
  } finally {
    backgroundSaving.value = false;
  }
}

function clearScheduleBackground() {
  applyScheduleBackground(createDefaultScheduleBackground());
  persistScheduleBackgroundSafe("清除背景失败，请稍后重试");
}

function onBackgroundVisibilityInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const next = Math.max(22, Math.min(88, Number(target.value) || 0));
  scheduleBackground.overlayOpacity = clampNumber(1 - next / 100, 0.34, 0.12, 0.78);
  persistScheduleBackgroundSafe("背景设置保存失败");
}

function onBackgroundBlurInput(event: Event) {
  const target = event.target as HTMLInputElement;
  scheduleBackground.blur = Math.round(clampNumber(target.value, scheduleBackground.blur, 0, 18));
  persistScheduleBackgroundSafe("背景设置保存失败");
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function normalizeSlotRange(bigSlot: number, course: ScheduleCourse) {
  const fallbackStart = Math.max(1, Math.min(MAX_SMALL_SLOT, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(MAX_SMALL_SLOT, bigSlot * 2));
  const start = Number.isFinite(course.startSlot) ? Number(course.startSlot) : fallbackStart;
  const end = Number.isFinite(course.endSlot) ? Number(course.endSlot) : fallbackEnd;
  const safeStart = Math.max(1, Math.min(MAX_SMALL_SLOT, start));
  const safeEnd = Math.max(safeStart, Math.min(MAX_SMALL_SLOT, end));
  return { start: safeStart, end: safeEnd };
}

function normalizeSlotRangeForTablePosition(bigSlot: number, course: ScheduleCourse) {
  const range = normalizeSlotRange(bigSlot, course);
  const fallbackStart = Math.max(1, Math.min(MAX_SMALL_SLOT, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(MAX_SMALL_SLOT, bigSlot * 2));
  const overlapsCurrentBigSlot = range.end >= fallbackStart && range.start <= fallbackEnd;
  return overlapsCurrentBigSlot ? range : { start: fallbackStart, end: fallbackEnd };
}

function mergeContinuousCourseBlocks(list: WeekCourseBlock[]) {
  const sorted = [...list].sort((a, b) => a.day - b.day || a.startSlot - b.startSlot || a.endSlot - b.endSlot);
  const merged: WeekCourseBlock[] = [];
  for (const block of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && block.startSlot <= prev.endSlot + 1) {
      prev.startSlot = Math.min(prev.startSlot, block.startSlot);
      prev.endSlot = Math.max(prev.endSlot, block.endSlot);
      prev.bigSlot = Math.max(1, Math.ceil(prev.startSlot / 2));
      prev.course = {
        ...prev.course,
        startSlot: prev.startSlot,
        endSlot: prev.endSlot,
        slotNote: formatSlotNote(prev.startSlot, prev.endSlot),
      };
    } else {
      merged.push({
        ...block,
        bigSlot: Math.max(1, Math.ceil(block.startSlot / 2)),
        course: {
          ...block.course,
          startSlot: block.startSlot,
          endSlot: block.endSlot,
          slotNote: formatSlotNote(block.startSlot, block.endSlot),
        },
      });
    }
  }
  return merged;
}

function formatSlotNote(start: number, end: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return start === end ? `${pad(start)}节` : `${pad(start)}-${pad(end)}节`;
}

function normalizeKeyPart(value?: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function courseBlockStyle(block: WeekCourseBlock) {
  const tone = toneFor(block.course.name);
  return {
    gridColumn: `${block.day + 1} / ${block.day + 2}`,
    gridRow: `${block.startSlot} / ${block.endSlot + 1}`,
    "--course-bg": tone.bg,
    "--course-border": tone.border,
    "--course-text": tone.text,
  };
}

function dayCourseBlockStyle(block: WeekCourseBlock) {
  const tone = toneFor(block.course.name);
  return {
    gridColumn: "2 / 3",
    gridRow: `${block.startSlot} / ${block.endSlot + 1}`,
    "--course-bg": tone.bg,
    "--course-border": tone.border,
    "--course-text": tone.text,
  };
}

function scheduleCacheKey(sem = semester.value, wk = week.value) {
  const s = sem || parsed.value?.currentSemester || "current";
  const w = wk || calendar.value?.currentWeek || parsed.value?.currentWeek || "current";
  return jwxtScopedStorageKey("cpu-schedule-cache-v3", s, w);
}

function readCache<T>(key: string): CacheEnvelope<T> | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsedValue = JSON.parse(raw);
    if (!parsedValue || typeof parsedValue.savedAt !== "number") return null;
    return parsedValue as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    /* ignore */
  }
}

function writeScheduleCache(key: string, data: ScheduleResult) {
  if (!key) return;
  const envelope = { savedAt: Date.now(), data };
  rememberScheduleCache(key, envelope);
  try {
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    /* ignore */
  }
}

function rememberScheduleCache(key: string, envelope: CacheEnvelope<ScheduleResult>) {
  scheduleCacheStore.set(key, envelope);
}

function isStale(savedAt: number) {
  return !savedAt || Date.now() - savedAt > CACHE_TTL;
}

function restoreCachedCalendar() {
  const cached = readCache<CalendarResult>(jwxtScopedStorageKey(CALENDAR_CACHE_BASE));
  if (cached?.data) calendar.value = cached.data;
}

function restoreLastState() {
  try {
    const key = jwxtScopedStorageKey(LAST_STATE_BASE);
    if (!key) return;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const state = JSON.parse(raw) as LastState;
    if (state.semester) semester.value = state.semester;
    if (state.week) week.value = state.week;
    if (state.activeDay >= 1 && state.activeDay <= 7) activeDay.value = state.activeDay;
    if (state.viewMode === "day" || state.viewMode === "week") viewMode.value = state.viewMode;
  } catch {
    /* ignore */
  }
}

function saveLastState() {
  try {
    const key = jwxtScopedStorageKey(LAST_STATE_BASE);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify({
      semester: semester.value,
      week: week.value,
      activeDay: activeDay.value,
      viewMode: viewMode.value,
    }));
  } catch {
    /* ignore */
  }
}

function restoreLastScheduleCache() {
  try {
    const lastKey = jwxtScopedStorageKey(LAST_CACHE_BASE);
    if (!lastKey) return false;
    const key = localStorage.getItem(lastKey);
    if (!key) return false;
    return applyScheduleCache(key);
  } catch {
    return false;
  }
}

function restoreScheduleCache() {
  const key = scheduleCacheKey();
  return applyScheduleCache(key) || (!parsed.value && restoreLastScheduleCache());
}

function applyScheduleCache(key: string) {
  if (!key) return false;
  const cached = readCache<ScheduleResult>(key);
  if (!cached?.data) return false;
  rememberScheduleCache(key, cached);
  parsed.value = cached.data;
  scheduleSavedAt.value = cached.savedAt;
  if (!semester.value) semester.value = cached.data.currentSemester || "";
  if (!week.value) week.value = String(cached.data.currentWeek || "");
  loadScheduleEdits();
  prewarmAdjacentWeekCaches();
  return true;
}

function saveScheduleCache() {
  if (!parsed.value) return;
  const key = scheduleCacheKey(parsed.value.currentSemester || semester.value, week.value || parsed.value.currentWeek);
  writeScheduleCache(key, parsed.value);
  const lastKey = jwxtScopedStorageKey(LAST_CACHE_BASE);
  try { if (lastKey && key) localStorage.setItem(lastKey, key); } catch { /* ignore */ }
}

function prewarmAdjacentWeekCaches() {
  if (!parsed.value || !semester.value) return;
  const current = currentWeekValue();
  [nextWeekValueFrom(current, -1), nextWeekValueFrom(current, 1)]
    .filter(Boolean)
    .forEach((wk) => prewarmScheduleCacheForWeek(wk));
}

function prewarmScheduleCacheForWeek(wk: string) {
  if (!jwxt.isLoggedIn) return;
  const key = scheduleCacheKey(parsed.value?.currentSemester || semester.value, wk);
  if (!key) return;
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data && !isStale(cached.savedAt)) {
    if (!scheduleCacheStore.has(key)) rememberScheduleCache(key, cached);
    return;
  }
  if (prewarmingScheduleKeys.has(key)) return;
  prewarmingScheduleKeys.add(key);
  void jwxtApi.schedule({ semester: semester.value, week: wk })
    .then((r: any) => {
      if (r?.parsed) writeScheduleCache(key, r.parsed);
    })
    .finally(() => {
      prewarmingScheduleKeys.delete(key);
    });
}
</script>

<style scoped lang="scss">
:global(html.schedule-scroll-lock),
:global(body.schedule-scroll-lock) {
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}

:global(body.schedule-scroll-lock #app) {
  height: 100%;
  overflow: hidden;
}

:global(body.schedule-scroll-lock .layout-root),
:global(body.schedule-scroll-lock .main--bare) {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

:global(body.schedule-scroll-lock .main--bare) {
  padding: 0 !important;
}

.schedule-page {
  --schedule-bg-image: none;
  --schedule-bg-overlay: rgba(248, 251, 255, 0.84);
  --schedule-bg-blur: 0px;
  --schedule-surface-bg: #ffffff;
  --schedule-surface-bg-soft: #f9fafb;
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  height: calc(var(--schedule-vh, 1vh) * 100);
  min-height: calc(var(--schedule-vh, 1vh) * 100);
  box-sizing: border-box;
  overflow: hidden;
  padding: calc(env(safe-area-inset-top) + 14px) 14px calc(env(safe-area-inset-bottom) + 18px);
  background:
    radial-gradient(circle at 18% 0%, rgba(174, 211, 255, 0.36), transparent 32%),
    radial-gradient(circle at 88% 14%, rgba(183, 232, 219, 0.32), transparent 30%),
    var(--schedule-page-bg);
  color: #172033;
}
.schedule-page > * {
  position: relative;
  z-index: 1;
}
.schedule-page::before,
.schedule-page::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.schedule-page::before {
  z-index: 0;
  background-image: var(--schedule-bg-image);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: blur(var(--schedule-bg-blur));
  transform: scale(1.04);
  transform-origin: center;
}
.schedule-page::after {
  background:
    linear-gradient(180deg, var(--schedule-bg-overlay) 0%, var(--schedule-bg-overlay) 100%),
    radial-gradient(circle at 18% 0%, rgba(174, 211, 255, 0.36), transparent 32%),
    radial-gradient(circle at 88% 14%, rgba(183, 232, 219, 0.32), transparent 30%),
    linear-gradient(180deg, rgba(245, 249, 253, 0.82) 0%, rgba(248, 251, 255, 0.84) 44%, rgba(250, 252, 255, 0.94) 100%);
}
.top {
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 auto 14px;
  max-width: 720px;
}
.sem-select {
  flex: 1;
  min-width: 0;
  max-width: 260px;
}
/* 把 el-select 撑成 38px 高（默认 size=small 是 28-32px，太矮），跟 icon-btn 对齐 */
.sem-select :deep(.el-select__wrapper) {
  min-height: 38px;
  border-radius: 10px;
  border: 1px solid #dde4ee;
  box-shadow: none;
  background: var(--schedule-surface-bg-soft);
  padding: 4px 10px;
}
.sem-select :deep(.el-select__wrapper:hover) {
  border-color: #c2cdda;
}
.sem-select :deep(.el-select__wrapper.is-focused) {
  border-color: var(--schedule-accent);
  box-shadow: none;
}
.sem-select :deep(.el-select__placeholder),
.sem-select :deep(.el-select__selected-item) {
  font-size: 13px;
  color: #172033;
}
.top-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.view-switch {
  height: 38px;
  padding: 3px;
  border: 1px solid #dde4ee;
  border-radius: 10px;
  background: var(--schedule-surface-bg-soft);
  display: inline-grid;
  grid-template-columns: repeat(2, 34px);
  gap: 2px;
}
.view-switch button {
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #5c6677;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
}
.view-switch button.active {
  background: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}
.icon-btn {
  width: 38px;
  height: 38px;
  border: 1px solid #dde4ee;
  border-radius: 10px;
  background: var(--schedule-surface-bg-soft);
  color: #172033;
  display: grid;
  place-items: center;
  touch-action: manipulation;
  cursor: pointer;
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.icon-btn:active { background: #f3f4f6; }
.icon-btn.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}
.theme-color-glass {
  --schedule-colorful-control-ring: linear-gradient(135deg, rgba(244, 63, 94, 0.58) 0%, rgba(249, 115, 22, 0.50) 22%, rgba(34, 197, 94, 0.45) 48%, rgba(59, 130, 246, 0.54) 74%, rgba(139, 92, 246, 0.52) 100%);
  --schedule-colorful-control-soft: linear-gradient(135deg, rgba(244, 63, 94, 0.09), rgba(249, 115, 22, 0.07) 24%, rgba(34, 197, 94, 0.07) 48%, rgba(59, 130, 246, 0.10) 74%, rgba(139, 92, 246, 0.09));
  --schedule-colorful-control-border: rgba(118, 105, 255, 0.22);
  --schedule-colorful-control-text: #334155;
}
.theme-color-glass .view-switch button.active,
.theme-color-glass .day-pill.active,
.theme-color-glass .icon-btn.active,
.theme-color-glass .week-cell.active {
  border: 1px solid transparent;
  background:
    linear-gradient(rgba(255, 255, 255, 0.84), rgba(255, 255, 255, 0.84)) padding-box,
    var(--schedule-colorful-control-ring) border-box;
  color: var(--schedule-colorful-control-text);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.56),
    0 3px 10px rgba(78, 99, 188, 0.07);
}
.theme-color-glass .week-title,
.theme-color-glass .week-day-head.today {
  border: 0;
  background: var(--schedule-colorful-control-soft);
  color: #3b2f9a;
  box-shadow: inset 0 0 0 1px var(--schedule-colorful-control-border);
}
.theme-color-glass .week-title.clickable:hover,
.theme-color-glass .week-title.clickable:active {
  background: linear-gradient(135deg, rgba(244, 63, 94, 0.12), rgba(249, 115, 22, 0.09) 24%, rgba(34, 197, 94, 0.09) 48%, rgba(59, 130, 246, 0.13) 74%, rgba(139, 92, 246, 0.12));
}
.theme-color-glass .day-pill.today,
.theme-color-glass .week-cell.current {
  border-color: var(--schedule-colorful-control-border);
  color: #3b2f9a;
}
.icon-btn.spinning .el-icon {
  animation: spin 0.9s linear infinite;
}
.icon-btn .el-icon {
  font-size: 18px;
}
.more-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.background-panel {
  display: grid;
  gap: 10px;
}
.background-preview {
  min-height: 118px;
  border: 1px solid #dbe4ee;
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(248, 251, 255, 0.86) 0%, rgba(248, 251, 255, 0.92) 100%),
    var(--schedule-page-bg);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  display: grid;
  place-items: center;
  color: #667085;
  font-size: 12px;
  text-align: center;
  padding: 12px;
  overflow: hidden;
}
.background-preview.empty {
  border-style: dashed;
}
.background-note {
  margin: 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.6;
}
.background-actions {
  display: flex;
  gap: 8px;
}
.more-subaction {
  flex: 1;
  min-height: 38px;
  border: 1px solid #dde4ee;
  border-radius: 10px;
  background: var(--schedule-surface-bg-soft);
  color: #172033;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.more-subaction:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.more-subaction:active {
  background: #f3f4f6;
}
.more-subaction.primary {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}
.background-control {
  display: grid;
  gap: 6px;
}
.background-control-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.background-control-head b,
.background-control-head em {
  font-size: 12px;
  line-height: 1.3;
  font-style: normal;
}
.background-control-head b {
  color: #172033;
}
.background-control-head em {
  color: #667085;
}
.background-control input[type="range"] {
  width: 100%;
  accent-color: var(--schedule-accent);
}
.more-theme-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.more-theme-choice {
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: #374151;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  padding: 8px 5px;
  display: grid;
  justify-items: center;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
.more-theme-choice:active {
  background: #f3f4f6;
}
.more-theme-choice.active {
  border-color: var(--schedule-accent-border);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}
.theme-color-glass .more-theme-choice.active {
  border-color: transparent;
  background:
    linear-gradient(rgba(255, 255, 255, 0.84), rgba(255, 255, 255, 0.84)) padding-box,
    var(--schedule-colorful-control-ring) border-box;
  color: var(--schedule-colorful-control-text);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.52);
}
.more-theme-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.82);
  box-shadow: inset 0 0 0 1px rgba(24, 34, 51, 0.08);
}
.more-action {
  width: 100%;
  min-height: 42px;
  border: 1px solid #e5eaf2;
  border-radius: 10px;
  background: #fff;
  color: #172033;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.more-action:active {
  background: #f3f4f6;
}
.more-action .el-icon {
  color: var(--schedule-accent);
}
.more-action span:not(.more-theme-swatch) {
  min-width: 0;
  text-align: left;
}
.more-chevron {
  color: #98a2b3 !important;
  font-size: 14px;
}
.more-back {
  min-height: 34px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #172033;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  font: inherit;
  font-size: 13px;
  font-weight: 750;
  cursor: pointer;
}
.more-back:active {
  background: #f3f4f6;
}
.more-theme-swatch.current {
  justify-self: center;
}
:global(.schedule-more-popover.el-popper) {
  z-index: 4200 !important;
  padding: 8px;
  border-radius: 13px;
  border-color: rgba(222, 229, 239, 0.92);
  box-shadow: 0 18px 44px rgba(24, 34, 51, 0.18);
}
.hidden-file-input {
  display: none;
}
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
  gap: 10px;
  max-width: 720px;
  margin: 0 auto 12px;
}
.week-switcher {
  flex: 0 0 auto;
  width: 100%;
  max-width: 720px;
  margin: 0 auto 12px;
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) 96px;
  align-items: center;
  gap: 8px;
}
.week-btn {
  height: 42px;
  border: 1px solid #dde4ee;
  border-radius: 13px;
  background: var(--schedule-surface-bg);
  color: #172033;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 13px;
  touch-action: manipulation;
}
.week-btn:disabled {
  color: #b7bfcc;
  background: var(--schedule-surface-bg-soft);
}
.week-title {
  min-width: 0;
  height: 42px;
  border: none;
  border-radius: 13px;
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 0 10px;
  font: inherit;
  cursor: default;
}
.week-title.clickable {
  cursor: pointer;
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
  transition: background 0.15s;
}
.week-title.clickable:hover,
.week-title.clickable:active {
  background: var(--schedule-accent-pale-hover);
}
.week-title:disabled {
  cursor: default;
}
.week-title b {
  font-size: 15px;
}
.week-title span {
  font-size: 11px;
}
.week-strip {
  flex: 0 0 auto;
  width: 100%;
  max-width: 720px;
  margin: 0 auto 14px;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  overflow: hidden;
}
.day-pill {
  min-width: 0;
  border: 1px solid #dde4ee;
  border-radius: 13px;
  background: var(--schedule-surface-bg);
  padding: 8px 3px;
  color: #5c6677;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  touch-action: manipulation;
}
.day-pill span {
  font-size: 12px;
  line-height: 1.15;
  white-space: nowrap;
}
.day-pill b {
  font-size: 13px;
  line-height: 1.15;
  white-space: nowrap;
}
.day-pill.today {
  border-color: var(--schedule-accent-border);
}
.day-pill.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}
.content,
.state-card {
  max-width: 720px;
  margin: 0 auto;
}
.content {
  flex: 1 1 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  min-height: 0;
  overflow: hidden;
}
.content.dragging {
  cursor: grabbing;
  user-select: none;
}
.state-card {
  min-height: calc(var(--schedule-vh, 1vh) * 100 - 180px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 20px;
  border: 1px solid rgba(221, 228, 238, 0.72);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.66);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.state-card .big {
  font-size: 44px;
  color: var(--schedule-accent);
}
.state-card h2 {
  margin: 0;
  font-size: 20px;
}
.state-card p {
  margin: 0;
  color: #667085;
  line-height: 1.7;
}
.state-card .scope-note {
  font-size: 12px;
  color: #b45309;
  background: #fef3c7;
  padding: 8px 12px;
  border-radius: 8px;
  line-height: 1.6;
  max-width: 320px;
}
.state-card .scope-note b { color: #92400e; }
.captcha-row {
  display: flex;
  gap: 10px;
  align-items: center;
  width: min(100%, 360px);
}
.captcha-row img {
  width: 112px;
  height: 42px;
  object-fit: contain;
  border: 1px solid #dde4ee;
  border-radius: 9px;
  background: var(--schedule-surface-bg-soft);
}
.error-text {
  color: #dc2626 !important;
  font-size: 13px;
}
.summary {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  color: #667085;
}
.summary div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.summary b {
  color: #172033;
  font-size: 20px;
}
.summary small {
  color: #98a2b3;
  font-size: 11px;
}
.summary em {
  font-style: normal;
  color: var(--schedule-accent);
  font-weight: 700;
}
.carousel-viewport {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  contain: layout paint;
}
.carousel-track {
  display: grid;
  min-height: 0;
  max-height: 100%;
  height: 100%;
  width: 300%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  align-items: stretch;
  transform: translate3d(-33.333333%, 0, 0);
  will-change: transform;
  backface-visibility: hidden;
  transform-style: preserve-3d;
}
.content.dragging .carousel-track {
  transition: none;
}
.content.settling .carousel-track {
  transition: transform 0.18s cubic-bezier(0.2, 0, 0.2, 1);
}
.schedule-page.is-static-week-swipe.view-week .content.settling .schedule-panel.active {
  transition: transform 0.18s cubic-bezier(0.2, 0, 0.2, 1);
}
.schedule-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  contain: layout paint;
  transform: translateZ(0);
}
.schedule-panel:not(.active) {
  pointer-events: none;
}
.schedule-page.is-static-week-swipe.view-week .carousel-viewport {
  overflow: visible;
  contain: none;
}
.schedule-page.is-static-week-swipe.view-week .carousel-track {
  display: block;
  width: 100%;
  transform: none !important;
  transition: none !important;
  will-change: auto;
  backface-visibility: visible;
  transform-style: flat;
}
.schedule-page.is-static-week-swipe.view-week .schedule-panel {
  min-height: 0;
  height: 100%;
  contain: none;
  transform: none;
}
.schedule-page.is-static-week-swipe.view-week .schedule-panel.active {
  pointer-events: auto;
}
.schedule-page.is-static-week-swipe.view-week .schedule-panel.week-slide-in-next,
.schedule-page.is-static-week-swipe.view-week .schedule-panel.week-slide-in-prev {
  animation-duration: 220ms;
  animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1);
  animation-fill-mode: both;
}
.schedule-page.is-static-week-swipe.view-week .schedule-panel.week-slide-in-next {
  animation-name: weekSlideInNext;
}
.schedule-page.is-static-week-swipe.view-week .schedule-panel.week-slide-in-prev {
  animation-name: weekSlideInPrev;
}
.schedule-page.is-static-week-swipe.view-week .schedule-panel.active {
  transform: translate3d(var(--static-week-offset, 0), 0, 0);
}

@keyframes weekSlideInNext {
  from {
    opacity: 0.9;
    transform: translate3d(22px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes weekSlideInPrev {
  from {
    opacity: 0.9;
    transform: translate3d(-22px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .schedule-page.is-static-week-swipe.view-week .schedule-panel.week-slide-in-next,
  .schedule-page.is-static-week-swipe.view-week .schedule-panel.week-slide-in-prev {
    animation: none;
  }
}
.day-timeline {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  touch-action: pan-y;
}
.schedule-body-scroll {
  flex: 1 1 auto;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  padding-bottom: calc(14px + env(safe-area-inset-bottom));
}
.day-grid-body {
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr);
  grid-template-rows: repeat(11, minmax(58px, calc(var(--schedule-vh, 1vh) * 6.2)));
  gap: 5px;
  position: relative;
}
.day-axis {
  padding-top: 0;
}
.day-slot-cell {
  min-width: 0;
  min-height: 0;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.36);
  border: 1px solid rgba(218, 227, 239, 0.82);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.46);
  cursor: pointer;
  touch-action: pan-y;
}
.day-course-block {
  z-index: 2;
  margin: 1px;
  border-radius: 16px;
  border: 1.5px solid var(--course-border);
  background: var(--course-bg);
  color: var(--course-text);
  padding: 12px 14px;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.58),
    inset 0 -1px 0 rgba(255, 255, 255, 0.22),
    0 10px 24px rgba(24, 34, 51, 0.08);
  backdrop-filter: blur(14px) saturate(145%);
  -webkit-backdrop-filter: blur(14px) saturate(145%);
  touch-action: pan-y;
}
.day-course-name {
  font-size: 18px;
  line-height: 1.25;
  font-weight: 800;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.day-course-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 13px;
  line-height: 1.3;
  font-weight: 700;
  opacity: 0.94;
}
.day-course-note {
  font-size: 12px;
  line-height: 1.25;
  opacity: 0.86;
}
.week-overview {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  touch-action: pan-y;
}
.week-grid-head,
.week-grid-body {
  display: grid;
  grid-template-columns: 44px repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.week-grid-head {
  position: sticky;
  top: 0;
  z-index: 3;
  margin-bottom: 6px;
  padding: 3px 0;
  background: rgba(247, 251, 255, 0.86);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
:global(body[data-cpu-native-app="1"]) .schedule-page .week-grid-head {
  position: static;
  top: auto;
  z-index: auto;
  background: #f7fbff;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.schedule-page.is-native-app.view-week .week-grid-head {
  position: static;
  top: auto;
  z-index: auto;
  background: #f7fbff;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.time-head,
.week-day-head {
  min-width: 0;
  height: 38px;
  border-radius: 10px;
  color: #667085;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
}
.time-head {
  font-size: 11px;
}
.week-day-head {
  background: rgba(255, 255, 255, 0.56);
  border: 1px solid rgba(218, 227, 239, 0.88);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.52);
  cursor: pointer;
  touch-action: manipulation;
}
.week-day-head span {
  font-size: 12px;
  font-weight: 700;
}
.week-day-head b {
  margin-top: 3px;
  font-size: 10px;
  font-weight: 600;
}
.week-day-head.today {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}
.week-grid-body {
  position: relative;
  grid-template-rows: repeat(11, minmax(48px, calc(var(--schedule-vh, 1vh) * 5.8)));
  align-items: stretch;
}
.slot-axis {
  min-width: 0;
  min-height: 0;
  padding-top: 4px;
  color: #667085;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.slot-axis b {
  color: #172033;
  font-size: 13px;
}
.slot-axis span {
  text-align: center;
  font-size: 9px;
  line-height: 1.12;
}
.week-slot-cell {
  min-width: 0;
  min-height: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.30);
  border: 1px solid rgba(226, 234, 244, 0.78);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.38);
  cursor: pointer;
  touch-action: pan-y;
}
.week-slot-cell.today {
  background: rgba(232, 246, 243, 0.48);
}
.week-course {
  min-width: 0;
  min-height: 0;
  z-index: 2;
  margin: 1px;
  border-radius: 9px;
  border: 1.5px solid var(--course-border);
  background: var(--course-bg);
  color: var(--course-text);
  padding: 5px 3px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.58),
    0 6px 14px rgba(24, 34, 51, 0.08);
  backdrop-filter: blur(12px) saturate(145%);
  -webkit-backdrop-filter: blur(12px) saturate(145%);
  cursor: pointer;
  touch-action: pan-y;
}

.theme-color-glass .day-course-block,
.theme-color-glass .week-course {
  border-width: 1px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.58),
    inset 0 -1px 0 rgba(255, 255, 255, 0.16),
    0 3px 10px rgba(44, 62, 94, 0.05);
  backdrop-filter: blur(10px) saturate(130%);
  -webkit-backdrop-filter: blur(10px) saturate(130%);
}

@supports (-webkit-touch-callout: none) {
  @media (max-width: 760px) {
    .carousel-viewport,
    .schedule-panel {
      contain: layout;
    }

    .week-grid-head {
      position: static;
      background: #f7fbff;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .day-slot-cell,
    .week-slot-cell,
    .week-day-head {
      box-shadow: none;
    }

    .day-course-block,
    .week-course {
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      box-shadow: 0 2px 7px rgba(24, 34, 51, 0.06);
    }

    .content.dragging .day-course-block,
    .content.dragging .week-course {
      box-shadow: none;
    }
  }
}
.week-course strong,
.week-course span,
.week-course em {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
  text-align: center;
}
.week-course strong {
  -webkit-line-clamp: 4;
  font-size: 10px;
  line-height: 1.2;
  font-weight: 800;
}
.week-course span {
  -webkit-line-clamp: 2;
  font-size: 9px;
  line-height: 1.12;
  font-weight: 700;
  opacity: 0.94;
}
.week-course em {
  -webkit-line-clamp: 1;
  font-size: 8px;
  line-height: 1.1;
  font-style: normal;
  opacity: 0.86;
}
.empty-day {
  min-height: 240px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: #8a94a6;
}
.empty-day .el-icon {
  font-size: 36px;
}

.day-pane {
  will-change: transform, opacity;
}
.next-card,
.next-card span,
.next-card em,
.next-card b {
  display: none;
}

/* ===== 周次选择 dialog 里的网格 ===== */
.week-grid-pick {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.widget-guide {
  display: grid;
  gap: 10px;
}

.widget-dialog-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #172033;
  font-size: 16px;
  font-weight: 700;
}

.widget-help-btn {
  width: 24px;
  height: 24px;
  border: 1px solid #dde4ee;
  border-radius: 50%;
  background: #fff;
  color: var(--schedule-accent-strong);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}

:global(.widget-help-popover) {
  line-height: 1.65;
}

.widget-help-text {
  margin: 0;
  color: #475467;
  font-size: 12px;
}

.widget-step {
  width: 100%;
  min-height: 48px;
  border: 1px solid #dde4ee;
  border-radius: 10px;
  background: #fff;
  color: #172033;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.15s;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.widget-step:hover {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent-pale);
  box-shadow: 0 6px 16px rgba(24, 34, 51, 0.08);
}

.widget-step:active {
  transform: translateY(1px);
}

.widget-step:disabled {
  cursor: wait;
  opacity: 0.72;
}

.widget-step b {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
  display: grid;
  place-items: center;
  font-size: 13px;
}

.widget-step span {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 650;
  text-align: center;
}

.widget-step-arrow {
  color: #98a2b3;
  font-size: 14px;
}

.widget-note {
  margin: 12px 0 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.65;
}

.support-note {
  margin: 12px 0 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.65;
}

.support-note button {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--schedule-accent-strong);
  font: inherit;
  font-weight: 650;
  padding: 0;
  cursor: pointer;
}

.widget-copy-message {
  margin: 8px 0 0;
  color: var(--schedule-accent-strong);
  font-size: 12px;
  line-height: 1.6;
}

.widget-copy-message.warn {
  color: #b45309;
}

.widget-instruction-list {
  margin: 0;
  padding-left: 18px;
  color: #1f2937;
  font-size: 14px;
  line-height: 1.75;
}

.widget-instruction-list li + li {
  margin-top: 8px;
}

.widget-countdown {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
  color: #667085;
  font-size: 12px;
  line-height: 1.5;
}

.android-update-panel {
  color: #1f2937;
  font-size: 14px;
  line-height: 1.75;
}

.android-update-panel p {
  margin: 0;
}

.android-update-panel p + p {
  margin-top: 10px;
}
.week-cell {
  border: 1px solid #dde4ee;
  background: #fff;
  border-radius: 10px;
  padding: 10px 4px;
  font: inherit;
  font-size: 14px;
  color: #374151;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
}
.week-cell:active { background: #f3f4f6; }
.week-cell.current { border-color: var(--schedule-accent); color: var(--schedule-accent); }
.week-cell.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}

.course-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(16, 24, 40, 0.08);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 8px 8px;
}

.course-editor-panel {
  width: 100%;
  height: auto;
  max-height: min(92svh, 760px);
  max-height: min(92dvh, 760px);
  max-width: 720px;
  background: #f6f7fb;
  color: #0f172a;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.16);
}

.course-editor-enter-active,
.course-editor-leave-active {
  transition: background-color 0.22s ease;
}

.course-editor-enter-active .course-editor-panel,
.course-editor-leave-active .course-editor-panel {
  transition: transform 0.24s cubic-bezier(0.2, 0, 0.2, 1), opacity 0.2s ease;
}

.course-editor-enter-from,
.course-editor-leave-to {
  background: rgba(16, 24, 40, 0);
}

.course-editor-enter-from .course-editor-panel,
.course-editor-leave-to .course-editor-panel {
  opacity: 0.98;
  transform: translateY(100%);
}

.course-editor-nav {
  flex: none;
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) 68px;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 8px;
}

.course-editor-nav h2 {
  margin: 0;
  text-align: center;
  font-size: 17px;
  line-height: 1.2;
  font-weight: 650;
  color: #0b1220;
}

.course-editor-nav button {
  border: 0;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.76);
  color: #111827;
  min-height: 36px;
  padding: 0 10px;
  font: inherit;
  font-size: 14px;
  font-weight: 560;
  box-shadow: none;
}

.course-editor-nav button.primary {
  color: #0f766e;
}

.course-editor-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  max-height: none;
  padding: 0 12px calc(12px + env(safe-area-inset-bottom));
}

.editor-card {
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.02);
}

.editor-row {
  min-height: 52px;
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin: 0 14px;
  border-bottom: 1px solid #e7e9ee;
}

.editor-row:last-child {
  border-bottom: 0;
}

.editor-row span,
.editor-card-title,
.editor-section-title span {
  font-size: 17px;
  font-weight: 560;
  color: #0b1220;
}

.editor-row input,
.editor-row select {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #0b1220;
  font: inherit;
  font-size: 17px;
  font-weight: 500;
  text-align: right;
}

.editor-row input::placeholder {
  color: #b9bec8;
}

.editor-row select {
  appearance: none;
  -webkit-appearance: none;
  direction: rtl;
}

.slot-range-input {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.slot-range-input input {
  width: 46px;
  text-align: center;
}

.slot-range-input em,
.slot-range-input b {
  font-style: normal;
  color: #0b1220;
  font-size: 17px;
  font-weight: 500;
}

.editor-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 14px 8px;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.editor-section-title button {
  border: 0;
  background: transparent;
  color: #0f766e;
  font: inherit;
  font-size: 15px;
  font-weight: 650;
}

.editor-section-title button.danger {
  color: #f04455;
}

.editor-week-picker {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  margin: 0 18px;
  padding: 15px 0;
  border-bottom: 1px solid #e7e9ee;
}

.editor-week-picker > span {
  font-size: 16px;
  font-weight: 650;
  color: #0b1220;
  padding-top: 5px;
}

.week-chip-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  max-height: 130px;
  overflow-y: auto;
  padding-right: 2px;
}

.week-chip-grid button {
  min-width: 0;
  min-height: 30px;
  border: 1px solid #d8dee8;
  border-radius: 9px;
  background: #fff;
  color: #475467;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
}

.week-chip-grid button.active {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}

.hidden-restore-card {
  margin-top: 18px;
  padding: 16px 18px;
}

.hidden-restore-card .hidden-list {
  margin-top: 12px;
}

.hidden-restore-card .hidden-list button {
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #fff;
  color: #475467;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
}

@media (min-width: 761px) {
  .course-editor-overlay {
    align-items: center;
    padding: 24px;
  }

  .course-editor-panel {
    height: auto;
    max-height: min(760px, 90vh);
    border-radius: 24px;
  }
}

@media (max-width: 380px) {
  .editor-week-picker {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .editor-week-picker > span {
    padding-top: 0;
  }
}

.edit-section {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

:global(.schedule-edit-dialog.el-dialog),
:global(.schedule-edit-dialog .el-dialog) {
  max-height: min(86vh, 680px);
  display: flex;
  flex-direction: column;
}

:global(.schedule-edit-dialog.el-dialog .el-dialog__body),
:global(.schedule-edit-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow: auto;
}

:global(.schedule-edit-dialog.el-dialog .el-dialog__footer),
:global(.schedule-edit-dialog .el-dialog__footer) {
  flex: none;
}

.edit-section:last-child {
  margin-bottom: 0;
}

.edit-section.compact {
  padding-top: 4px;
  border-top: 1px solid #eef0f4;
}

.edit-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.edit-section-head b {
  font-size: 14px;
  color: #172033;
}

.edit-section-head span {
  font-size: 12px;
  color: #8a94a6;
}

.edit-course-list {
  display: grid;
  gap: 8px;
  max-height: 240px;
  overflow: auto;
}

.edit-course-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fff;
}

.edit-course-row div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.edit-course-row b {
  color: #172033;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-course-row span,
.edit-course-row em {
  color: #667085;
  font-size: 12px;
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.custom-course-form {
  display: grid;
  gap: 2px;
}

.custom-course-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.custom-course-form :deep(.el-form-item__label) {
  margin-bottom: 4px;
  line-height: 1.25;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.form-grid :deep(.el-select),
.form-grid :deep(.el-input-number) {
  width: 100%;
}

.week-list-form-item {
  grid-column: span 2;
}

/* ===== 移动端：恢复显示 top（紧凑学期+刷新+视图切换） + 仍隐藏旧 toolbar/summary ===== */
@media (max-width: 760px) {
  /* toolbar 旧的双选择器已经从模板移除，但保险起见仍 hide 类 */
  .toolbar { display: none; }
  .summary { display: none; }
  .schedule-page {
    padding-top: calc(env(safe-area-inset-top) + 8px);
    padding-left: 8px;
    padding-right: 8px;
  }

  .top {
    gap: 6px;
  }

  .sem-select {
    max-width: none;
  }

  .view-switch {
    grid-template-columns: repeat(2, 30px);
  }

  .form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  :global(.schedule-edit-dialog.el-dialog),
  :global(.schedule-edit-dialog .el-dialog) {
    position: fixed;
    inset: auto 0 0 0;
    width: 100vw !important;
    max-width: 100vw;
    height: min(82dvh, calc(100vh - env(safe-area-inset-top) - 18px));
    max-height: min(82dvh, calc(100vh - env(safe-area-inset-top) - 18px));
    margin: 0 !important;
    border-radius: 18px 18px 0 0;
    overflow: hidden;
  }

  :global(.schedule-edit-dialog.el-dialog .el-dialog__header),
  :global(.schedule-edit-dialog .el-dialog__header) {
    flex: none;
    padding: 14px 16px 8px;
    margin-right: 0;
  }

  :global(.schedule-edit-dialog.el-dialog .el-dialog__body),
  :global(.schedule-edit-dialog .el-dialog__body) {
    flex: 1;
    min-height: 0;
    padding: 6px 14px 10px;
    overflow: auto;
  }

  :global(.schedule-edit-dialog.el-dialog .el-dialog__footer),
  :global(.schedule-edit-dialog .el-dialog__footer) {
    position: sticky;
    bottom: 0;
    z-index: 4;
    flex: none;
    padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid #eef0f4;
    background: #fff;
    box-shadow: 0 -8px 18px rgba(24, 34, 51, 0.06);
  }

  :global(.schedule-edit-dialog.el-dialog .el-dialog__footer .el-button),
  :global(.schedule-edit-dialog .el-dialog__footer .el-button) {
    min-width: 72px;
    margin-left: 6px;
  }

  .edit-section {
    gap: 8px;
    margin-bottom: 10px;
  }

  .custom-course-form :deep(.el-form-item) {
    margin-bottom: 8px;
  }

  .week-list-form-item {
    grid-column: auto;
  }

  .day-grid-body {
    grid-template-columns: 42px minmax(0, 1fr);
    grid-template-rows: repeat(11, minmax(52px, calc(var(--schedule-vh, 1vh) * 6)));
    gap: 4px;
  }

  .day-slot-cell {
    border-radius: 10px;
  }

  .day-course-block {
    border-radius: 12px;
    padding: 10px 12px;
    gap: 5px;
  }

  .day-course-name {
    font-size: 16px;
    -webkit-line-clamp: 3;
  }

  .day-course-meta {
    font-size: 12px;
  }

  .day-course-note {
    font-size: 11px;
  }

  .week-grid-head,
  .week-grid-body {
    grid-template-columns: 38px repeat(7, minmax(0, 1fr));
    gap: 3px;
  }

  .week-grid-head {
    top: 0;
  }

  .week-day-head {
    height: 34px;
    border-radius: 8px;
  }

  .week-day-head span {
    font-size: 11px;
  }

  .week-day-head b {
    font-size: 9px;
  }

  .week-grid-body {
    grid-template-rows: repeat(11, minmax(44px, calc(var(--schedule-vh, 1vh) * 5.5)));
  }

  .slot-axis b {
    font-size: 12px;
  }

  .slot-axis span {
    font-size: 8px;
  }

  .week-slot-cell {
    border-radius: 8px;
  }

  .week-course {
    border-radius: 7px;
    padding: 4px 2px;
  }

  .week-course strong {
    font-size: 9px;
  }

  .week-course span {
    font-size: 8px;
  }

  .week-course em {
    display: none;
  }
}

@media (min-width: 760px) {
  .schedule-page {
    padding-top: 28px;
  }
}

@media (max-width: 390px) {
  .schedule-page {
    padding-left: 6px;
    padding-right: 6px;
  }
  .week-strip {
    gap: 3px;
  }
  .day-pill {
    border-radius: 10px;
    padding: 7px 1px;
    gap: 1px;
  }
  .day-pill span {
    font-size: 11px;
  }
  .day-pill b {
    font-size: 11px;
  }
  .week-switcher {
    grid-template-columns: 82px minmax(0, 1fr) 82px;
    gap: 6px;
  }
  .week-btn {
    font-size: 12px;
  }
  .view-switch {
    grid-template-columns: repeat(2, 28px);
    height: 36px;
  }
  .view-switch button {
    font-size: 12px;
  }
  .icon-btn {
    width: 36px;
    height: 36px;
  }
  .week-grid-head,
  .week-grid-body {
    grid-template-columns: 34px repeat(7, minmax(0, 1fr));
    gap: 2px;
  }
  .day-grid-body {
    grid-template-columns: 36px minmax(0, 1fr);
    grid-template-rows: repeat(11, minmax(48px, calc(var(--schedule-vh, 1vh) * 5.6)));
    gap: 3px;
  }
  .day-course-block {
    padding: 9px 10px;
  }
  .day-course-name {
    font-size: 15px;
  }
  .day-course-meta {
    font-size: 11px;
  }
  .day-course-note {
    font-size: 10px;
  }
  .week-grid-body {
    grid-template-rows: repeat(11, minmax(40px, calc(var(--schedule-vh, 1vh) * 5.2)));
  }
  .slot-axis b {
    font-size: 11px;
  }
  .slot-axis span {
    font-size: 7px;
  }
  .week-course strong {
    font-size: 8px;
  }
  .week-course span {
    font-size: 7px;
  }
}
</style>
