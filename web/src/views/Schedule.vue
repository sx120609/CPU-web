<template>
<main
  class="schedule-page"
  :class="{
    'theme-color-glass': scheduleTheme === 'color-glass',
    'has-custom-background': hasScheduleBackground,
    'is-dark': appearance.isDark,
    'is-native-app': isNativeScheduleApp,
    'is-android-native-app': isAndroidScheduleApp,
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
        :disabled="loading"
        @change="onScheduleSemesterChange"
      >
        <el-option v-for="s in semesters" :key="s.value" :value="s.value" :label="s.label" />
      </el-select>
      <div class="top-actions">
        <AcademicDataSourceBadge v-if="scheduleSource === 'jwxt'" :source="parsed?.source" />
        <button
          v-if="showScheduleExitButton"
          type="button"
          class="icon-btn schedule-exit-btn"
          aria-label="退出课表"
          title="退出课表"
          @click="$router.push('/home')"
        >
          <el-icon><ArrowLeft /></el-icon>
          <span>退出</span>
        </button>
        <div v-if="parsed" class="view-switch" aria-label="切换课表视图">
          <button type="button" :class="{ active: viewMode === 'day' }" :disabled="loading" @click="setViewMode('day')">日</button>
          <button type="button" :class="{ active: viewMode === 'week' }" :disabled="loading" @click="setViewMode('week')">周</button>
        </div>
        <button
          v-if="parsed"
          type="button"
          class="icon-btn"
          :class="{ active: isViewingToday }"
          :disabled="loading"
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
        <button
          v-if="isDev"
          type="button"
          class="icon-btn"
          aria-label="研究生课表调试"
          title="研究生课表调试"
          @click="gradDebugDialogOpen = true"
        >
          <el-icon><Tools /></el-icon>
        </button>
        <el-popover
          v-if="parsed || canShowAndroidClientDownload"
          v-model:visible="moreMenuOpen"
          trigger="click"
          placement="bottom-end"
          :width="296"
          :teleported="true"
          popper-class="schedule-more-popover"
          :popper-style="pageStyle"
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
                v-if="canShowAndroidClientDownload"
                type="button"
                class="more-action"
                @click="openAndroidClientDownload"
              >
                <el-icon><Download /></el-icon>
                <span>下载 Android 客户端</span>
                <el-icon class="more-chevron"><ArrowRight /></el-icon>
              </button>
              <button
                v-if="widgetMenuPlatform"
                type="button"
                class="more-action"
                :disabled="widgetInstalling"
                @click="handleWidgetMenuAction"
              >
                <el-icon><Iphone /></el-icon>
                <span>{{ widgetMenuLabel }}</span>
                <el-icon class="more-chevron"><ArrowRight /></el-icon>
              </button>
              <button
                v-if="isAndroidScheduleApp"
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
                  背景仅保存在当前设备，不会上传到服务器。现在默认直接保存本地图，是否能存下主要取决于浏览器本地空间；浅色插画或照片的效果会更接近参考图。
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
          :disabled="loading"
          aria-label="刷新课表"
          @click="refreshCurrentSchedule"
        >
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
    </header>

    <!-- 按设备分流的安装引导：移动端安装/加主屏，桌面端下载原生客户端 -->
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
        :disabled="loading"
        @click="weekDialogOpen = true"
      >
        <b>第 {{ currentWeekValue() || "--" }} 周</b>
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

    <section v-if="sessionChecking && !parsed" class="state-card session-checking-state">
      <el-skeleton :rows="4" animated />
      <p>正在检查教务状态，请稍候…</p>
    </section>

    <section v-else-if="academicDataUnavailable && !parsed" class="state-card academic-empty-state">
      <el-icon class="big"><InfoFilled /></el-icon>
      <h2>暂无教务数据</h2>
      <p>学校没有返回授权失效提示，但尚未创建可读取的教务入口或课表数据。</p>
      <p>如果学校原站已经有课表，可以重新核验授权；新生暂无课表时不会被误报为登录失效。</p>
      <el-button type="primary" size="large" @click="$router.push({ name: 'jwxt', query: { reauthorize: '1', redirect: '/schedule' } })">
        重新核验授权
      </el-button>
    </section>

    <section v-else-if="!parsed && !jwxt.isLoggedIn" class="state-card">
      <el-icon class="big"><Lock /></el-icon>
      <h2>{{ jwxt.authorizationExpired ? "教务授权已失效" : "需要先登录教务" }}</h2>
      <p>{{ jwxt.authorizationExpired ? "学校返回了登录或统一认证提示，请重新完成教务授权。" : "登录后可快速查看课表，也可以把这个页面加到桌面方便下次打开。勾选保持登录后会在当前浏览器加密保存账号密码，验证码不会保存。" }}</p>
      <p class="scope-note">{{ scheduleLoginScopeText }}</p>
      <el-button type="primary" size="large" @click="$router.push({ name: 'jwxt', query: { reauthorize: jwxt.authorizationExpired ? '1' : undefined, redirect: '/schedule' } })">
        {{ jwxt.authorizationExpired ? "重新授权" : "前往登录" }}
      </el-button>
      <PrivacyPolicyNotice />
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
      @touchstart.passive="onScheduleTouchStart"
      @touchmove="onScheduleTouchMove"
      @touchend="onScheduleTouchEnd"
      @touchcancel="onScheduleTouchCancel"
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
      class="schedule-themed-dialog"
      :style="pageStyle"
    >
      <div class="week-grid-pick">
        <button
          v-for="w in weeks"
          :key="w.value"
          type="button"
          class="week-cell"
          :class="{ active: String(w.value) === week, current: Number(w.value) === calendar?.currentWeek }"
          :disabled="loading"
          @click="selectWeek(w.value)"
        >
          {{ w.value }}
        </button>
      </div>
      <template #footer>
        <el-button v-if="canJumpToCurrentWeek" type="primary" :disabled="loading" @click="onJumpAndClose">回到本周</el-button>
        <el-button @click="weekDialogOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-if="isDev"
      v-model="gradDebugDialogOpen"
      title="研究生课表调试"
      :width="gradDebugDialogWidth"
      align-center
      :show-close="true"
      append-to-body
      class="grad-debug-dialog schedule-themed-dialog"
      :style="pageStyle"
    >
      <div class="grad-debug-panel">
        <p class="grad-debug-intro">
          这一步已经改成自动调试模式。只要我在浏览器里抓到研究生课表页面，就能把本地样例直接套进当前本科生同款课表样式里预览。
        </p>
        <div class="grad-debug-target">
          <span>目标地址</span>
          <code>{{ GRAD_DEBUG_URL }}</code>
        </div>
        <div class="grad-debug-target">
          <span>本地样例</span>
          <code>{{ GRAD_DEBUG_FIXTURE_PATH }}</code>
        </div>
        <div class="grad-debug-actions">
          <el-button type="primary" :loading="gradDebugLoading" :disabled="gradDebugLoading" @click="loadGraduateDebugSchedule()">
            载入本地抓取样例
          </el-button>
          <el-button @click="openGradSystemDebug">打开研究生管理系统</el-button>
        </div>
        <div class="grad-debug-tips">
          <b>当前调试会做这两件事：</b>
          <ol>
            <li>优先读取本地保存的研究生课表 HTML 样例。</li>
            <li>把解析结果转成和本科生课表一致的数据结构与页面样式。</li>
            <li>如果你后面切到别的学期或重新登录，我再继续补自动抓取链路。</li>
          </ol>
        </div>
        <div class="grad-debug-foot">
          <span>{{ gradDebugStatusText }}</span>
          <div class="grad-debug-foot-actions">
            <el-button @click="copyGradDebugGuide">复制调试说明</el-button>
            <el-button
              v-if="isGraduateDebugSource"
              type="primary"
              plain
              @click="returnToPrimarySchedule"
            >
              退出调试样例
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="widgetDialogOpen"
      :width="420"
      align-center
      :show-close="true"
      append-to-body
      class="schedule-themed-dialog"
      :style="pageStyle"
    >
      <template #header>
        <div class="widget-dialog-title">
          <span>导入 iOS 课表小组件</span>
          <el-popover trigger="click" placement="bottom" :width="286" popper-class="widget-help-popover" :popper-style="pageStyle">
            <p class="widget-help-text">
              小组件只能读取你的课表；如果登录状态失效，会先显示最近一次成功加载的内容。重新登录后会自动恢复，不需要重新添加组件。
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
        <a class="widget-step" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener noreferrer">
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
      <p class="widget-copy-message">
        同一脚本可添加多次：小号默认“临近课程”，中号默认“今日课程”，大号默认“两日课表”；在小组件 Parameter 中填写“当前/接下来”，可切换为双课程样式。
      </p>
      <p class="support-note">
        仍有疑问，建议
        <button type="button" @click="openUserGroup">加入用户 QQ 群 {{ USER_QQ_GROUP }}</button>
        咨询。
      </p>
      <template #footer>
        <el-button @click="widgetDialogOpen = false">关闭</el-button>
              <el-button type="primary" :loading="widgetConfigCopying" :disabled="widgetConfigCopying" @click="copyScriptableWidgetScript">
          {{ scriptableWidgetScript ? "复制配置" : "生成并复制" }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="widgetInstructionOpen"
      title="导入后请先确认能正常显示"
      :width="420"
      align-center
      :show-close="true"
      append-to-body
      class="schedule-themed-dialog"
      :style="pageStyle"
      @open="startWidgetInstructionCountdown"
      @closed="stopWidgetInstructionCountdown"
    >
      <ol class="widget-instruction-list">
        <li>打开 Scriptable 后，先按提示授予软件权限，再把刚才复制的内容粘贴到打开的文本框里。</li>
        <li>粘贴完成后，点击右下角三角形运行一次，确认能看到课表预览。</li>
        <li>确认无误后回到桌面，长按空白处，进入编辑模式并选择添加小组件。</li>
        <li>找到 Scriptable 小组件并添加到桌面。</li>
        <li>添加后长按小组件，选择编辑小组件，把 Script 设为刚才导入的课表脚本。</li>
        <li>需要其他样式时，可再次添加同一脚本，并在 Parameter 填写“临近课程”“当前/接下来”“今日课程”或“两日课表”。</li>
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
      v-model="androidWidgetGuideOpen"
      title="添加安卓小组件"
      :width="420"
      align-center
      :show-close="true"
      append-to-body
      class="schedule-themed-dialog"
      :style="pageStyle"
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
        <div v-if="editDialogOpen" class="course-editor-overlay" :style="pageStyle" @click.self="closeCourseEditor">
          <section class="course-editor-panel" role="dialog" aria-modal="true">
            <header class="course-editor-nav">
              <button type="button" :disabled="courseEditBusy" @click="closeCourseEditor">取消</button>
              <h2>{{ editingCourseBlock ? "修改课程" : "添加课程" }}</h2>
              <button type="button" class="primary" :disabled="courseEditBusy" @click="saveCourseEdit">
                {{ courseEditAction === "save" ? "保存中" : "保存" }}
              </button>
            </header>

            <div class="course-editor-scroll">
              <section class="editor-card">
                <label class="editor-row">
                  <span>课程</span>
                  <input v-model="customCourseForm.name" maxlength="40" placeholder="课程名称" :disabled="courseEditBusy" />
                </label>
                <label class="editor-row">
                  <span>老师</span>
                  <input v-model="customCourseForm.teacher" maxlength="40" placeholder="选填" :disabled="courseEditBusy" />
                </label>
                <label class="editor-row">
                  <span>地点</span>
                  <input v-model="customCourseForm.location" maxlength="40" placeholder="选填" :disabled="courseEditBusy" />
                </label>
                <label class="editor-row">
                  <span>备注</span>
                  <input v-model="customCourseForm.note" maxlength="60" placeholder="选填" :disabled="courseEditBusy" />
                </label>
              </section>

              <div class="editor-section-title">
                <span>时间段</span>
                <div class="editor-actions">
                  <button v-if="canRestoreOriginalCourse" type="button" :disabled="courseEditBusy" @click="restoreOriginalCourse">
                    {{ courseEditAction === "restore" ? "恢复中" : "恢复原始" }}
                  </button>
                  <button v-if="editingCourseBlock" type="button" class="danger" :disabled="courseEditBusy" @click="deleteEditingCourse">
                    {{ courseEditAction === "delete" ? "删除中" : "删除" }}
                  </button>
                </div>
              </div>

              <section class="editor-card">
                <label class="editor-row">
                  <span>周数</span>
                  <select v-model="customCourseForm.weekMode" :disabled="courseEditBusy">
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
                      :disabled="courseEditBusy"
                      @click="toggleCustomWeek(w)"
                    >
                      {{ w }}
                    </button>
                  </div>
                </div>
                <label class="editor-row">
                  <span>星期</span>
                  <select v-model.number="customCourseForm.day" :disabled="courseEditBusy">
                    <option v-for="d in 7" :key="d" :value="d">{{ dayLabel(d) }}</option>
                  </select>
                </label>
                <div class="editor-row">
                  <span>时间</span>
                  <div class="slot-range-input">
                    <input v-model.number="customCourseForm.startSlot" type="number" min="1" :max="MAX_SMALL_SLOT" :disabled="courseEditBusy" />
                    <em>-</em>
                    <input v-model.number="customCourseForm.endSlot" type="number" :min="customCourseForm.startSlot" :max="MAX_SMALL_SLOT" :disabled="courseEditBusy" />
                    <b>节</b>
                  </div>
                </div>
              </section>

              <section v-if="hiddenCourseItems.length" class="editor-card hidden-restore-card">
                <div class="editor-card-title">已编辑课程</div>
                <div class="hidden-list">
                  <button v-for="item in hiddenCourseItems" :key="item.key" type="button" :disabled="courseEditBusy" @click="restoreHiddenCourse(item.key)">
                    {{ courseEditAction === "restoreHidden" ? "恢复中" : item.label }}
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
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Aim, ArrowLeft, ArrowRight, Download, InfoFilled, Iphone, Lock, Moon, MoreFilled, Picture, QuestionFilled, Refresh, Tools } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { useAuthStore } from "@/stores/auth";
import { useAppearanceStore } from "@/stores/appearance";
import { useJwxtStore } from "@/stores/jwxt";
import { detectInAppBrowser } from "@/utils/inAppBrowser";
import {
  detectClientPlatform,
  isAndroidAppUpdateAvailable,
  isAndroidNativeApp,
  isFlutterNativeShell,
  isHarmonyNativeApp,
  isIosNativeApp,
  isIosStandalone,
  supportsAndroidScheduleWidget,
} from "@/utils/clientInfo";
import { requestAndroidUpdatePrompt } from "@/utils/androidUpdatePrompt";
import { USER_QQ_GROUP, copyText, openUserGroup } from "@/utils/userGroup";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import AcademicDataSourceBadge from "@/components/jwxt/AcademicDataSourceBadge.vue";
import InstallPromptDialog from "@/components/install/InstallPromptDialog.vue";
import OpenBrowserPromptDialog from "@/components/install/OpenBrowserPromptDialog.vue";
import {
  DEFAULT_SCHEDULE_THEME,
  getColorGlassCourseTone,
  getScheduleThemePalette,
  normalizeScheduleTheme,
  scheduleThemeOptions,
  scheduleThemeCssVars,
  scheduleThemeDarkCssVars,
  type CourseTone,
  type ScheduleThemeKey,
} from "@/components/jwxt/scheduleTheme";
import {
  courseEditKey,
  emptyScheduleEdits,
  normalizeScheduleEditsState,
  type ScheduleEditState,
} from "@/utils/scheduleEdits";
import {
  buildScheduleCacheKey,
  isStale,
  readCache,
  readLatestScheduleCache,
  readStoredLastScheduleCacheKey,
  readStoredLastState,
  scheduleCalendarCacheKey,
  scheduleLastCacheKey,
  scheduleLastStateCacheKey,
  writeCache,
  writeStoredLastScheduleCacheKey,
  writeStoredLastState,
} from "@/views/schedule/cache";
import {
  buildCustomCourseItem,
  createCustomCourseForm,
  customCourseWeekList as resolveCustomCourseWeekList,
  deleteCourseEdit,
  fillFormForExistingCourse,
  fillFormForNewCourse,
  isOriginalCourseEditUnchanged,
  restoreHiddenCourseEdit,
  restoreOriginalCourseEdit,
  saveCustomCourseEdit,
  toggleCustomCourseWeek as toggleCustomCourseWeekSelection,
  type CourseEditAction,
} from "@/views/schedule/courseEditor";
import {
  buildGraduateFallbackCalendar,
  dayOfWeek,
  extendScheduleWeeksToCalendar,
  formatCacheTime,
  hydrateCalendar,
  resolveGraduateActiveDay,
  resolveGraduateInitialWeek,
} from "@/views/schedule/calendar";
import { buildScriptableWidgetScript } from "@/views/schedule/scriptableWidget";
import { resolveSwipeIntent, type SwipeIntent } from "@/views/schedule/swipeGesture";
import {
  claimOfficialScheduleChangeNotice,
  detectOfficialScheduleChange,
} from "@/views/schedule/scheduleChanges";
import {
  MAX_SMALL_SLOT,
  smallSlots,
} from "@/views/schedule/slots";
import { useScheduleBackground } from "@/views/schedule/useScheduleBackground";
import { createScheduleViewModelHelpers } from "@/views/schedule/viewModels";
import { DEFAULT_SCHEDULE_VIEW_MODE, resolveScheduleViewMode } from "@/views/schedule/types";
import type {
  CalendarResult,
  CacheEnvelope,
  FlatCourse,
  ScheduleCell,
  SchedulePageModel,
  ScheduleResult,
  ViewMode,
  WeekCourseBlock,
} from "@/views/schedule/types";

const auth = useAuthStore();
const appearance = useAppearanceStore();
const jwxt = useJwxtStore();
const route = useRoute();
const router = useRouter();
const sessionChecking = ref(!auth.academicIdentityUnavailable);
const parsed = ref<ScheduleResult | null>(null);
const calendar = ref<CalendarResult | null>(null);
const semester = ref("");
const week = ref("");
const activeDay = ref(dayOfWeek());
const viewMode = ref<ViewMode>(DEFAULT_SCHEDULE_VIEW_MODE);
const scheduleTheme = ref<ScheduleThemeKey>(DEFAULT_SCHEDULE_THEME);
const loading = ref(false);
const offlineMode = ref(typeof navigator !== "undefined" ? navigator.onLine === false : false);
const scheduleSavedAt = ref(0);
const scheduleEdits = ref<ScheduleEditState>(emptyScheduleEdits());
const viewportHeight = ref(0);
const viewportWidth = ref(0);
const touchLikeViewport = ref(false);
const compactViewport = ref(false);
// v2 intentionally resets earlier saved choices once so everyone sees the new colorful default.
const THEME_KEY = "cpu-schedule-theme-v2";
const GRAD_DEBUG_URL = "http://ygl.cpu.edu.cn/gmis5/oauthLogin/zgyk";
const GRAD_DEBUG_FIXTURE_PATH = "server/.debug/grad-schedule.html";
const scheduleCacheStore = new Map<string, CacheEnvelope<ScheduleResult>>();
const prewarmingScheduleKeys = new Set<string>();
const isNativeScheduleApp = ["android", "harmony", "ios"].includes(detectClientPlatform());
const isAndroidScheduleApp = isAndroidNativeApp() && !isFlutterNativeShell();
const isDev = computed(() => import.meta.env.DEV);
let scheduleEditsSaveTimer = 0;
let scheduleEditsLoadPromise: Promise<void> | null = null;
let pendingScheduleEditsSave: { semester: string; edits: ScheduleEditState } | null = null;
const editDialogOpen = ref(false);
const customCourseForm = reactive(createCustomCourseForm(dayOfWeek()));
const editingCourseBlock = ref<WeekCourseBlock | null>(null);
const editingCourseKey = ref("");
const editingWeekValue = ref("");
const courseEditAction = ref<CourseEditAction>("");
const courseEditBusy = computed(() => courseEditAction.value !== "");
const widgetCurrentWeekIntentPending = ref(false);
let scheduleMounted = false;
let widgetCurrentCalendarPromise: Promise<void> | null = null;

function refreshWidgetCurrentCalendar() {
  if (
    !scheduleMounted
    || !widgetCurrentWeekIntentPending.value
    || offlineMode.value
    || scheduleStorageScope() === "graduate"
  ) return Promise.resolve();
  if (widgetCurrentCalendarPromise) return widgetCurrentCalendarPromise;

  widgetCurrentCalendarPromise = loadCalendar("")
    .then(() => { applyWidgetCurrentWeekIntent(); })
    .finally(() => { widgetCurrentCalendarPromise = null; });
  return widgetCurrentCalendarPromise;
}

function applyWidgetCurrentWeekIntent() {
  if (!widgetCurrentWeekIntentPending.value) return false;
  // 本科课表响应里的 currentWeek 是课表下拉框当前选中的周，并不一定是
  // 校历当前周。必须等校历可用后再消费小组件意图，否则会原地切回旧周。
  const widgetWeek = Number(route.query.widgetWeek || 0);
  const current = Number.isInteger(widgetWeek) && widgetWeek >= 1 && widgetWeek <= 64
    ? widgetWeek
    : Number(calendar.value?.currentWeek || 0);
  if (!Number.isFinite(current) || current <= 0) {
    void refreshWidgetCurrentCalendar();
    return false;
  }

  widgetCurrentWeekIntentPending.value = false;
  const widgetSemester = Array.isArray(route.query.widgetSemester)
    ? route.query.widgetSemester[0]
    : route.query.widgetSemester;
  const currentSemester = String(widgetSemester || calendar.value?.currentSemester || "").trim();
  const nextQuery = { ...route.query };
  delete nextQuery.source;
  delete nextQuery.week;
  delete nextQuery.widgetSemester;
  delete nextQuery.widgetWeek;
  void router.replace({ path: route.path, query: nextQuery, hash: route.hash }).catch(() => undefined);
  void jumpToScheduleWeek(current, currentSemester).catch(() => undefined);
  return true;
}

watch(
  [() => route.query.source, () => route.query.week],
  ([source, targetWeek]) => {
    if (source !== "widget" || targetWeek !== "current") return;
    widgetCurrentWeekIntentPending.value = true;
    applyWidgetCurrentWeekIntent();
  },
  { immediate: true },
);

watch(
  () => calendar.value?.currentWeek,
  () => { applyWidgetCurrentWeekIntent(); },
);

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
  syncGraduateActiveDayForWeek(next);
  saveLastState();
  weekDialogOpen.value = false;
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    void refreshScheduleForCurrentSource({ background: true });
    return;
  }
  void refreshScheduleForCurrentSource();
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
const androidWidgetGuideOpen = ref(false);
const gradDebugDialogOpen = ref(false);
const gradDebugLoading = ref(false);
const graduateSourceMeta = ref<{
  mode?: "live" | "debug" | "debug-fallback";
  path?: string;
  savedAt?: string;
  fetchedAt?: string;
  semester?: string;
  termcode?: string;
} | null>(null);
const scheduleSource = ref<"jwxt" | "graduate" | "graduate-debug">("jwxt");
const moreMenuOpen = ref(false);
const moreMenuView = ref<"menu" | "theme" | "background">("menu");
const widgetConfigCopying = ref(false);
const widgetConfigCopied = ref(false);
const widgetInstalling = ref(false);
const {
  backgroundImageInputRef,
  backgroundPreviewStyle,
  backgroundSaving,
  backgroundVisibility,
  clearScheduleBackground,
  clearScheduleBackgroundPreview,
  hasScheduleBackground,
  onBackgroundBlurInput,
  onBackgroundVisibilityInput,
  onScheduleBackgroundPicked,
  pickScheduleBackground,
  restoreScheduleBackground,
  scheduleBackground,
} = useScheduleBackground();
const {
  weekInfoFor,
  weekRangeFor,
  dayTabsForWeek,
  cellsForWeek,
  dayCoursesFor,
  weekCourseBlocksFor,
  dayCourseBlocksFor,
  weekPageModel,
  dayPageModel,
  dayTarget,
  nextWeekValueFrom,
  courseTitle,
  courseFamilyKey,
  courseFamilySourceKeys,
  dayLabel,
} = createScheduleViewModelHelpers({
  calendar: () => calendar.value,
  parsed: () => parsed.value,
  weeks: () => weeks.value,
  scheduleEdits: () => scheduleEdits.value,
  activeDay: () => activeDay.value,
  currentWeekValue: () => currentWeekValue(),
  scheduleForWeek,
  allKnownScheduleSources,
});
const scriptableWidgetScript = ref("");
const widgetCopyMessage = ref("");
const SCRIPTABLE_ADD_URL = "https://open.scriptable.app/add";
let widgetInstructionTimer = 0;
const prefersGraduateIdentity = computed(() => auth.academicIdentity === "graduate");
const academicDataUnavailable = computed(() => Boolean(
  jwxt.isLoggedIn && auth.user?.studentSso && auth.academicIdentityUnavailable,
));
const scheduleLoginScopeText = computed(() => (
  "登录后会自动识别你当前可用的教务入口。本科生默认显示本科课表，研究生当前显示研究生课表。"
));
type WidgetMenuPlatform = "ios" | "ios-native" | "harmony" | "android" | "android-old";
interface AndroidWidgetBridge {
  getVersionCode?: () => number;
  getVersionName?: () => string;
  copyText?: (text: string) => boolean;
  supportsScheduleWidget?: () => boolean;
  installScheduleWidget?: (payload: string) => void;
  openExternalUrl?: (url: string) => void;
  supportsInAppApkDownload?: () => boolean;
  downloadAndInstallApk?: (url: string, fileName: string) => boolean;
}

interface IOSWidgetBridge {
  supportsScheduleWidget?: () => boolean;
  installScheduleWidget?: (payload: string) => void;
  setScheduleWidgetTheme?: (theme: string) => void;
}

type HarmonyWidgetBridge = IOSWidgetBridge;

function scheduleStorageScope() {
  if (scheduleSource.value === "graduate" || scheduleSource.value === "graduate-debug") return "graduate";
  if (scheduleSource.value === "jwxt") return "undergraduate";
  return prefersGraduateIdentity.value ? "graduate" : "undergraduate";
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

function getIOSWidgetBridge(): IOSWidgetBridge | null {
  return ((window as any).CPUIOS ?? null) as IOSWidgetBridge | null;
}

function getHarmonyWidgetBridge(): HarmonyWidgetBridge | null {
  return ((window as any).CPUHarmony ?? null) as HarmonyWidgetBridge | null;
}

function syncNativeWidgetTheme(value = scheduleTheme.value) {
  const theme = normalizeScheduleTheme(value);
  if (isIosNativeApp()) getIOSWidgetBridge()?.setScheduleWidgetTheme?.(theme);
  if (isHarmonyNativeApp()) getHarmonyWidgetBridge()?.setScheduleWidgetTheme?.(theme);
}

async function copyGradDebugGuide() {
  await copyText(gradDebugGuideText.value);
  ElMessage.success("已复制调试说明");
}

async function loadGraduateSchedule(
  targetSemester?: string,
  options?: { background?: boolean; force?: boolean },
) {
  if (disposed) return;
  const background = Boolean(options?.background);
  if (!jwxt.isLoggedIn) {
    const ready = await jwxt.ensureSession();
    if (!ready || disposed) return;
  }
  const requestSeq = ++scheduleRequestSeq;
  if (!background) {
    foregroundScheduleRequestSeq = requestSeq;
    loading.value = true;
  }
  try {
    const requestedSemester = targetSemester?.trim()
      || (scheduleSource.value === "graduate" ? semester.value || undefined : undefined);
    const result = await jwxt.withSessionRetry(() => jwxtApi.graduateSchedule({
      semester: requestedSemester,
      refresh: options?.force ? "1" : undefined,
    }));
    if (!isCurrentScheduleRequest(requestSeq, requestedSemester || "")) return;
    if (disposed) return;
    const fallbackCalendar = buildGraduateFallbackCalendar(result.parsed);
    const normalizedParsed = extendScheduleWeeksToCalendar(result.parsed, fallbackCalendar);
    const initialWeek = resolveGraduateInitialWeek(normalizedParsed, fallbackCalendar);
    parsed.value = normalizedParsed;
    calendar.value = fallbackCalendar;
    scheduleSource.value = "graduate";
    writeCache(calendarCacheKey(), calendar.value);
    graduateSourceMeta.value = result.source ?? { mode: "live" };
    semester.value = normalizedParsed?.currentSemester ?? "";
    if (!week.value || !normalizedParsed?.weeks.some((item) => String(item.value) === week.value)) {
      week.value = initialWeek;
    }
    activeDay.value = resolveGraduateActiveDay(normalizedParsed, week.value || initialWeek, fallbackCalendar);
    scheduleSavedAt.value = Date.now();
    scheduleEdits.value = emptyScheduleEdits();
    await loadScheduleEdits();
    saveScheduleCache();
    saveLastState();
  } finally {
    if (!disposed && !background && requestSeq === foregroundScheduleRequestSeq) loading.value = false;
  }
}

async function loadGraduateDebugSchedule(
  targetSemester?: string,
  options?: { background?: boolean; announce?: boolean },
) {
  if (disposed) return;
  const background = Boolean(options?.background);
  const requestSeq = ++scheduleRequestSeq;
  gradDebugLoading.value = true;
  if (!background) {
    foregroundScheduleRequestSeq = requestSeq;
    loading.value = true;
  }
  try {
    const requestedSemester = targetSemester?.trim()
      || (scheduleSource.value === "graduate-debug" ? semester.value || undefined : undefined);
    const result = await jwxtApi.graduateDebugSchedule({ semester: requestedSemester });
    if (!isCurrentScheduleRequest(requestSeq, requestedSemester || "")) return;
    if (disposed) return;
    const fallbackCalendar = buildGraduateFallbackCalendar(result.parsed);
    const normalizedParsed = extendScheduleWeeksToCalendar(result.parsed, fallbackCalendar);
    const initialWeek = resolveGraduateInitialWeek(normalizedParsed, fallbackCalendar);
    parsed.value = normalizedParsed;
    calendar.value = fallbackCalendar;
    scheduleSource.value = "graduate-debug";
    writeCache(calendarCacheKey(), calendar.value);
    graduateSourceMeta.value = {
      ...(result.source ?? {}),
      mode: "debug",
    };
    semester.value = normalizedParsed?.currentSemester ?? "";
    if (!week.value || !normalizedParsed?.weeks.some((item) => String(item.value) === week.value)) {
      week.value = initialWeek;
    }
    activeDay.value = resolveGraduateActiveDay(normalizedParsed, week.value || initialWeek, fallbackCalendar);
    scheduleSavedAt.value = Date.now();
    scheduleEdits.value = emptyScheduleEdits();
    saveScheduleCache();
    saveLastState();
    if (options?.announce ?? true) {
      gradDebugDialogOpen.value = false;
      ElMessage.success("已载入研究生课表调试样例");
    }
  } finally {
    if (!disposed) gradDebugLoading.value = false;
    if (!disposed && !background && requestSeq === foregroundScheduleRequestSeq) loading.value = false;
  }
}

async function refreshScheduleForCurrentSource(options?: { force?: boolean; background?: boolean }) {
  if (scheduleSource.value === "graduate") {
    await loadGraduateSchedule(undefined, { background: options?.background, force: options?.force });
    return;
  }
  if (scheduleSource.value === "graduate-debug") {
    await loadGraduateDebugSchedule(undefined, {
      background: options?.background,
      announce: false,
    });
    return;
  }
  await loadSchedule(options?.force ?? false, options?.background ?? false);
}

async function returnToPrimarySchedule() {
  graduateSourceMeta.value = null;
  parsed.value = null;
  calendar.value = null;
  semester.value = "";
  week.value = "";
  scheduleSavedAt.value = 0;
  scheduleEdits.value = emptyScheduleEdits();
  scheduleSource.value = prefersGraduateIdentity.value ? "graduate" : "jwxt";
  if (jwxt.isLoggedIn) {
    if (prefersGraduateIdentity.value) {
      await loadGraduateSchedule();
      ElMessage.success("已回到研究生正式课表");
      return;
    }
    await loadCalendar();
    await loadSchedule(true);
    ElMessage.success("已切回本科教务课表");
    return;
  }
  parsed.value = null;
  calendar.value = null;
  semester.value = "";
  week.value = "";
  ElMessage.info("已退出研究生调试样例");
}

function openGradSystemDebug() {
  const bridge = getAndroidWidgetBridge();
  if (typeof bridge?.openExternalUrl === "function") {
    bridge.openExternalUrl(GRAD_DEBUG_URL);
    return;
  }
  window.open(GRAD_DEBUG_URL, "_blank", "noopener,noreferrer");
}

const widgetMenuPlatform = computed<WidgetMenuPlatform | null>(() => {
  const iosBridge = getIOSWidgetBridge();
  if (isIosNativeApp()
    && typeof iosBridge?.installScheduleWidget === "function"
    && iosBridge.supportsScheduleWidget?.() !== false) return "ios-native";
  if (isIosStandalone()) return "ios";
  const harmonyBridge = getHarmonyWidgetBridge();
  if (isHarmonyNativeApp()
    && typeof harmonyBridge?.installScheduleWidget === "function"
    && harmonyBridge.supportsScheduleWidget?.() !== false) return "harmony";
  if (isFlutterNativeShell()) return null;
  if (!isAndroidNativeApp()) return null;
  return supportsAndroidScheduleWidget() ? "android" : "android-old";
});

const widgetMenuLabel = computed(() => {
  if (widgetMenuPlatform.value === "ios-native") return "添加 iOS 小组件";
  if (widgetMenuPlatform.value === "harmony") return "添加鸿蒙小组件";
  if (widgetMenuPlatform.value === "android") return "添加安卓小组件";
  if (widgetMenuPlatform.value === "android-old") return "更新安卓客户端";
  return "导入 iOS 小组件";
});
const androidAppUpdateAvailable = computed(() => isAndroidAppUpdateAvailable());
const androidUpdateMenuLabel = computed(() => (
  androidAppUpdateAvailable.value ? "更新安卓客户端" : "检查客户端更新"
));
const canShowAndroidClientDownload = computed(() => {
  if (isAndroidNativeApp() || isFlutterNativeShell()) return false;
  const platform = detectClientPlatform();
  if (platform === "desktop" || platform === "ios" || platform === "harmony" || isIosStandalone()) return false;
  return true;
});

function handleWidgetMenuAction() {
  if (widgetMenuPlatform.value === "ios-native") {
    void installIOSWidget();
    return;
  }
  if (widgetMenuPlatform.value === "ios") {
    openWidgetDialog();
    return;
  }
  if (widgetMenuPlatform.value === "harmony") {
    void installHarmonyWidget();
    return;
  }
  if (widgetMenuPlatform.value === "android") {
    void installAndroidWidget();
    return;
  }
  showAndroidUpdateRequired("widget");
}

async function installIOSWidget() {
  moreMenuOpen.value = false;
  const bridge = getIOSWidgetBridge();
  if (typeof bridge?.installScheduleWidget !== "function") {
    ElMessage.warning("当前 iOS 客户端暂不支持原生小组件");
    return;
  }
  if (!jwxt.isLoggedIn) {
    ElMessage.warning("请先完成教务授权，再添加 iOS 小组件");
    return;
  }

  widgetInstalling.value = true;
  try {
    const token = await jwxtApi.createScheduleWidgetToken({ name: "iOS 小组件" });
    bridge.installScheduleWidget(JSON.stringify({
      endpoint: token.endpoint,
      title: "药大课表",
      theme: scheduleTheme.value,
    }));
  } finally {
    widgetInstalling.value = false;
  }
}

async function installHarmonyWidget() {
  moreMenuOpen.value = false;
  const bridge = getHarmonyWidgetBridge();
  if (typeof bridge?.installScheduleWidget !== "function") {
    ElMessage.warning("当前鸿蒙客户端暂不支持原生小组件");
    return;
  }
  if (!jwxt.isLoggedIn) {
    ElMessage.warning("请先完成教务授权，再添加鸿蒙小组件");
    return;
  }

  widgetInstalling.value = true;
  try {
    const token = await jwxtApi.createScheduleWidgetToken({ name: "鸿蒙小组件" });
    bridge.installScheduleWidget(JSON.stringify({
      endpoint: token.endpoint,
      title: "药大课表",
      theme: scheduleTheme.value,
    }));
  } finally {
    widgetInstalling.value = false;
  }
}

function openWidgetDialog() {
  moreMenuOpen.value = false;
  widgetDialogOpen.value = true;
}

function openAndroidClientDownload() {
  moreMenuOpen.value = false;
  if (detectInAppBrowser().isInApp) {
    openBrowserPromptRef.value?.openDialog();
    return;
  }
  requestAndroidUpdatePrompt({ kind: "install" });
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

  widgetInstalling.value = true;
  try {
    const token = await jwxtApi.createScheduleWidgetToken({ name: "Android 小组件" });
    bridge.installScheduleWidget(JSON.stringify({
      endpoint: token.endpoint,
      title: "药大课表",
    }));
    androidWidgetGuideOpen.value = true;
    ElMessage.success("小组件配置已保存");
  } finally {
    widgetInstalling.value = false;
  }
}

function showAndroidUpdateRequired(kind: "app" | "widget" | "install" = "widget") {
  moreMenuOpen.value = false;
  requestAndroidUpdatePrompt({ kind });
}

function checkAndroidAppUpdate() {
  moreMenuOpen.value = false;
  requestAndroidUpdatePrompt({ kind: "app" });
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

onMounted(() => {
  disposed = false;
  document.documentElement.classList.add("schedule-scroll-lock");
  document.body.classList.add("schedule-scroll-lock");
  jwxt.hydrate();
  scheduleSource.value = prefersGraduateIdentity.value ? "graduate" : "jwxt";
  scheduleMounted = true;
  syncNetworkStatus();
  restoreScheduleTheme();

  // 缓存恢复必须发生在图片、会话和网络工作之前，保证课表首帧不被任何异步步骤阻塞。
  restoreLastState();
  if (widgetCurrentWeekIntentPending.value && scheduleStorageScope() !== "graduate") {
    restoreCachedCalendar("");
  } else {
    restoreCachedCalendar();
  }
  restoreLastScheduleCache();
  applyWidgetCurrentWeekIntent();
  loadScheduleEdits();
  void restoreScheduleBackground();

  updateViewportHeight();
  window.addEventListener("resize", updateViewportHeight);
  window.addEventListener("online", syncNetworkStatus);
  window.addEventListener("offline", syncNetworkStatus);
  window.visualViewport?.addEventListener("resize", updateViewportHeight);
  window.visualViewport?.addEventListener("scroll", updateViewportHeight);

  // 服务号来源作为微信客户端使用；普通微信链接由全局关注引导接管，其他受限内置浏览器仍提示跳转。
  openBrowserPromptRef.value?.autoPromptIfEligible();
  installPromptRef.value?.autoPromptIfEligible();

  if (offlineMode.value) {
    sessionChecking.value = false;
    return;
  }

  // 后台静默恢复：缓存保持可见，同时用本机加密保存的信息续回学校会话。
  void (async () => {
    try {
      if (!auth.ready) await auth.fetchMe({ probe: true }).catch(() => undefined);
      jwxt.hydrate();
      const ready = await jwxt.ensureSession({
        refresh: true,
        silent: true,
        allowAutoLogin: true,
        repairUnavailableSession: true,
      });
      if (disposed || !ready) return;
      if (jwxt.isLoggedIn) {
        const background = Boolean(parsed.value);
        if (prefersGraduateIdentity.value) {
          await loadGraduateSchedule(undefined, { background });
        } else if (widgetCurrentWeekIntentPending.value) {
          await refreshWidgetCurrentCalendar();
        } else {
          await Promise.all([
            loadCalendar(),
            loadSchedule(false, background),
          ]);
        }
      }
    } catch {
      /* Keep visible cache when background sync fails. */
    } finally {
      if (!disposed) sessionChecking.value = false;
    }
  })();
});

onBeforeUnmount(() => {
  disposed = true;
  scheduleMounted = false;
  scheduleRequestSeq += 1;
  foregroundScheduleRequestSeq = scheduleRequestSeq;
  loading.value = false;
  gradDebugLoading.value = false;
  document.documentElement.classList.remove("schedule-scroll-lock");
  document.body.classList.remove("schedule-scroll-lock");
  window.removeEventListener("resize", updateViewportHeight);
  window.removeEventListener("online", syncNetworkStatus);
  window.removeEventListener("offline", syncNetworkStatus);
  window.visualViewport?.removeEventListener("resize", updateViewportHeight);
  window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
  clearDragTimers();
  clearStaticWeekAnimation();
  stopWidgetInstructionCountdown();
  flushScheduleEditsSave();
  clearScheduleBackgroundPreview();
});

const semesters = computed(() => parsed.value?.semesters ?? []);
const weeks = computed(() => parsed.value?.weeks ?? []);
const currentWeekInfo = computed(() => weekInfoFor(currentWeekValue()));
const currentWeekRange = computed(() => weekRangeFor(currentWeekValue()));
const dayTabs = computed(() => dayTabsForWeek(currentWeekValue()));
const activeDayLabel = computed(() => dayTabs.value.find((d) => d.day === activeDay.value)?.label ?? "今日");
const activeWeekNumber = computed(() => {
  const value = Number(week.value || parsed.value?.currentWeek || calendar.value?.currentWeek || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
});
const currentThemePreview = computed(() => (
  scheduleThemeOptions.find((item) => item.key === scheduleTheme.value)?.preview ?? scheduleThemeOptions[0]?.preview ?? "#22c55e"
));
const isViewingToday = computed(() => {
  const cur = calendar.value?.currentWeek;
  if (!cur || String(cur) !== currentWeekValue()) return false;
  return viewMode.value === "week" || activeDay.value === dayOfWeek();
});
const scheduleHasBottomTabbar = computed(() => {
  if (isFlutterNativeShell()) return false;
  if (viewportWidth.value <= 768) return true;
  return touchLikeViewport.value && viewportHeight.value >= viewportWidth.value;
});
const showScheduleExitButton = computed(() => !scheduleHasBottomTabbar.value);
const pageStyle = computed(() => ({
  ...scheduleThemeCssVars(scheduleTheme.value),
  ...(appearance.isDark ? {
    ...scheduleThemeDarkCssVars(scheduleTheme.value),
    "--schedule-page-bg": "linear-gradient(180deg, #12231f 0%, #162d27 48%, #101c19 100%)",
    "--schedule-bg-overlay": hasScheduleBackground.value
      ? `rgba(11, 27, 24, ${Math.max(0.22, scheduleBackground.overlayOpacity * 0.58)})`
      : "rgba(11, 27, 24, 0.78)",
    "--schedule-surface-bg": hasScheduleBackground.value ? "rgba(26, 41, 37, 0.62)" : "rgba(26, 41, 37, 0.94)",
    "--schedule-surface-bg-soft": hasScheduleBackground.value ? "rgba(32, 49, 44, 0.68)" : "rgba(32, 49, 44, 0.88)",
    "--schedule-text": "#eef8f5",
    "--schedule-text-secondary": "#abc5be",
    "--schedule-text-muted": "#819d95",
    "--schedule-border": "rgba(163, 186, 179, 0.28)",
    "--schedule-cell-bg": "rgba(30, 48, 43, 0.52)",
    "--schedule-cell-bg-strong": "rgba(38, 58, 52, 0.68)",
    "--schedule-cell-border": "rgba(163, 186, 179, 0.20)",
    "--schedule-panel-shadow": "0 14px 34px rgba(0, 0, 0, 0.22)",
  } : {
    "--schedule-bg-overlay": `rgba(248, 251, 255, ${hasScheduleBackground.value ? scheduleBackground.overlayOpacity : 0.84})`,
    "--schedule-surface-bg": hasScheduleBackground.value ? "rgba(255, 255, 255, 0.60)" : "#ffffff",
    "--schedule-surface-bg-soft": hasScheduleBackground.value ? "rgba(255, 255, 255, 0.72)" : "#f9fafb",
    "--schedule-text": "#172033",
    "--schedule-text-secondary": "#667085",
    "--schedule-text-muted": "#8a94a6",
    "--schedule-border": "#dde4ee",
    "--schedule-cell-bg": "rgba(255, 255, 255, 0.36)",
    "--schedule-cell-bg-strong": "rgba(255, 255, 255, 0.56)",
    "--schedule-cell-border": "rgba(218, 227, 239, 0.82)",
    "--schedule-panel-shadow": "0 10px 24px rgba(24, 34, 51, 0.08)",
  }),
  "--schedule-bg-image": hasScheduleBackground.value ? `url("${scheduleBackground.imageDataUrl}")` : "none",
  "--schedule-bg-blur": `${scheduleBackground.blur}px`,
  ...(viewportHeight.value ? { "--schedule-vh": `${viewportHeight.value / 100}px` } : {}),
}));
const useStaticWeekSwipe = computed(() => false);
const currentCells = computed<ScheduleCell[]>(() => cellsForWeek(activeWeekNumber.value, parsed.value));
const dayCourses = computed<FlatCourse[]>(() => dayCoursesFor(activeWeekNumber.value, activeDay.value, parsed.value));
const dayCourseBlocks = computed<WeekCourseBlock[]>(() => (
  dayCourseBlocksFor(activeWeekNumber.value, activeDay.value, parsed.value)
));
const weekCourseBlocks = computed<WeekCourseBlock[]>(() => weekCourseBlocksFor(activeWeekNumber.value, parsed.value));
const editDialogWidth = computed(() => compactViewport.value ? "92dvw" : "560px");
const gradDebugDialogWidth = computed(() => compactViewport.value ? "calc(100dvw - 16px)" : "680px");
const isGraduateSource = computed(() => scheduleSource.value === "graduate" || scheduleSource.value === "graduate-debug");
const isGraduateDebugSource = computed(() => scheduleSource.value === "graduate-debug");
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
const gradDebugGuideText = computed(() => [
  "研究生课表调试说明",
  `1. 打开 ${GRAD_DEBUG_URL} 并完成登录。`,
  `2. 我会把课表样例保存到 ${GRAD_DEBUG_FIXTURE_PATH}。`,
  "3. 在调试面板点击“载入本地抓取样例”，就会直接用本科生同款课表样式预览研究生课表。",
].join("\n"));
const gradDebugStatusText = computed(() => {
  if (gradDebugLoading.value) return "正在解析本地研究生课表样例...";
  if (graduateSourceMeta.value?.savedAt) {
    return `已就绪：${graduateSourceMeta.value.path || GRAD_DEBUG_FIXTURE_PATH} · ${formatCacheTime(Date.parse(graduateSourceMeta.value.savedAt))}`;
  }
  return `等待载入本地样例：${GRAD_DEBUG_FIXTURE_PATH}`;
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
  axis: "pending" as SwipeIntent,
});
const touchGesture: {
  tracking: boolean;
  identifier: number;
  startX: number;
  startY: number;
  intent: SwipeIntent;
} = {
  tracking: false,
  identifier: -1,
  startX: 0,
  startY: 0,
  intent: "pending",
};
let dragOffsetX = 0;
let dragLastX = 0;
let dragLastTime = 0;
let dragVelocityX = 0;
let dragFrame = 0;
let pendingTrackOffset = 0;
let dragCommitDelta = 0;
let dragCommitTimer = 0;
let dragResetTimer = 0;
let dragSuppressClickTimer = 0;
let dragCaptureTarget: HTMLElement | null = null;
const staticWeekAnimationClass = ref<"" | "week-slide-in-next" | "week-slide-in-prev">("");
let staticWeekAnimationTimer = 0;
let scheduleRequestSeq = 0;
let foregroundScheduleRequestSeq = 0;
let disposed = false;
const activePageScrollKey = computed(() => (
  viewMode.value === "week"
    ? `week:${currentWeekValue()}`
    : `day:${currentWeekValue()}:${activeDay.value}`
));
const carouselPages = computed<SchedulePageModel[]>(() => {
  const deltas = useStaticWeekSwipe.value ? [0] : [-1, 0, 1];
  return deltas.map((delta) => (viewMode.value === "week" ? weekPageModel(delta) : dayPageModel(delta)));
});

watch(activePageScrollKey, (value, previousValue) => {
  if (!previousValue || value === previousValue) return;
  void nextTick(() => resetActiveScheduleBodyScroll());
});

async function loadCalendar(targetSemester = semester.value || parsed.value?.currentSemester || "") {
  if (disposed) return;
  const requestedSemester = String(targetSemester || "").trim();
  const hadCache = restoreCachedCalendar(requestedSemester);
  if (!hadCache && requestedSemester && calendar.value?.currentSemester !== requestedSemester) {
    calendar.value = null;
  }
  try {
    const ready = await jwxt.ensureSession();
    if (!ready || disposed) return;
    const r: any = await jwxt.withSessionRetry(() => jwxtApi.calendar(
      requestedSemester ? { semester: requestedSemester } : undefined,
      { silent: true },
    ));
    if (disposed) return;
    if (requestedSemester && semester.value && semester.value !== requestedSemester) return;
    const nextCalendar = hydrateCalendar(r.parsed);
    if (requestedSemester && nextCalendar?.currentSemester && nextCalendar.currentSemester !== requestedSemester) return;
    calendar.value = nextCalendar;
    writeCache(calendarCacheKey(nextCalendar?.currentSemester || requestedSemester), calendar.value);
    if (!requestedSemester) writeCache(calendarCacheKey(""), calendar.value);
    if (!week.value) week.value = currentWeekValue();
  } catch { /* calendar is best effort */ }
}

async function onScheduleSemesterChange() {
  if (scheduleSource.value === "graduate") {
    const loadedSemester = parsed.value?.currentSemester ?? "";
    if (!semester.value || semester.value === loadedSemester) return;
    try {
      await loadGraduateSchedule(semester.value);
    } catch {
      semester.value = loadedSemester;
    }
    return;
  }
  if (scheduleSource.value === "graduate-debug") {
    const loadedSemester = parsed.value?.currentSemester ?? "";
    if (!semester.value || semester.value === loadedSemester) return;
    try {
      await loadGraduateDebugSchedule(semester.value);
    } catch {
      semester.value = loadedSemester;
    }
    return;
  }
  await Promise.all([
    loadCalendar(semester.value),
    loadSchedule(false),
  ]);
}

async function refreshCurrentSchedule() {
  if (scheduleSource.value === "graduate") {
    await loadGraduateSchedule(undefined, { force: true });
    return;
  }
  if (scheduleSource.value === "graduate-debug") {
    await loadGraduateDebugSchedule();
    return;
  }
  await loadCalendar(semester.value);
  if (disposed) return;
  await loadSchedule(true);
}

async function loadSchedule(force = false, background = false) {
  if (disposed) return;
  if (loading.value && !background) return;
  const hadCache = !force && restoreScheduleCache();
  const canFallbackToVisibleSchedule = Boolean(parsed.value) && (
    !semester.value
    || !parsed.value?.currentSemester
    || semester.value === parsed.value.currentSemester
  );
  if (hadCache) {
    saveLastState();
  }
  if (!jwxt.isLoggedIn) {
    const ready = await jwxt.ensureSession();
    if (!ready || disposed) return;
  }
  const requestSeq = ++scheduleRequestSeq;
  const requestedSemester = semester.value || parsed.value?.currentSemester || "";
  const requestedWeek = week.value || "";
  if (!background) {
    foregroundScheduleRequestSeq = requestSeq;
    loading.value = !parsed.value || force || !hadCache;
  }
  try {
    const r: any = await jwxt.withSessionRetry(() => jwxtApi.schedule(
      { semester: semester.value, week: week.value, refresh: force ? "1" : undefined },
      { silent: background || hadCache || (offlineMode.value && canFallbackToVisibleSchedule) },
    ));
    if (disposed) return;
    if (!isCurrentScheduleRequest(requestSeq, requestedSemester, requestedWeek)) {
      if (r?.parsed) writeScheduleCache(scheduleCacheKey(r.parsed.currentSemester || requestedSemester, requestedWeek), r.parsed);
      return;
    }
    scheduleSource.value = "jwxt";
    graduateSourceMeta.value = null;
    parsed.value = r.parsed;
    if (!semester.value) semester.value = parsed.value?.currentSemester ?? "";
    if (!week.value) week.value = currentWeekValue();
    loadScheduleEdits();
    scheduleSavedAt.value = Date.now();
    saveScheduleCache();
    saveLastState();
    prewarmAdjacentWeekCaches();
  } catch (error) {
    if (!isCurrentScheduleRequest(requestSeq, requestedSemester, requestedWeek)) return;
    if (!hadCache && !canFallbackToVisibleSchedule) throw error;
  } finally {
    if (!disposed && !background && requestSeq === foregroundScheduleRequestSeq) loading.value = false;
  }
}

function isCurrentScheduleRequest(seq: number, requestedSemester = "", requestedWeek = "") {
  if (disposed) return false;
  if (seq !== scheduleRequestSeq) return false;
  if (requestedSemester && semester.value && semester.value !== requestedSemester) return false;
  if (requestedWeek && week.value && week.value !== requestedWeek) return false;
  return true;
}

function canChangeWeek(delta: number) {
  const next = nextWeekValue(delta);
  return Boolean(next && next !== week.value);
}

async function changeWeek(delta: number) {
  const next = nextWeekValue(delta);
  if (!next) return;
  week.value = next;
  syncGraduateActiveDayForWeek(next);
  saveLastState();
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    void refreshScheduleForCurrentSource({ background: true });
    return;
  }
  await refreshScheduleForCurrentSource();
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
  await jumpToScheduleWeek(cur, String(calendar.value?.currentSemester || "").trim());
}

async function jumpToScheduleWeek(cur: number, targetSemester = semester.value) {
  const semesterChanged = Boolean(targetSemester && targetSemester !== semester.value);
  if (semesterChanged) {
    semester.value = targetSemester;
    // 即使两个学期恰好都是同一周次，也必须继续加载目标学期的课表。
    week.value = "";
  }
  const today = dayOfWeek();
  if (!semesterChanged && String(cur) === week.value) {
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
    void refreshScheduleForCurrentSource({ background: true });
    return;
  }
  await refreshScheduleForCurrentSource();
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
  dragState.axis = "pending";
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
  dragState.axis = resolveSwipeIntent(dx, dy, dragState.axis);
  const dt = Math.max(1, now - dragLastTime);
  dragVelocityX = (event.clientX - dragLastX) / dt;
  dragLastX = event.clientX;
  dragLastTime = now;
  if (dragState.axis === "horizontal" && event.cancelable) event.preventDefault();
  if (!dragState.dragging) {
    if (dragState.axis === "vertical") {
      resetDrag();
      return;
    }
    if (dragState.axis !== "horizontal") return;
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
    scheduleDragReset();
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
  resetTouchGesture();
  releaseDragPointer();
  animateDragTo(0);
  scheduleDragReset();
}

function onScheduleTouchStart(event: TouchEvent) {
  if (loading.value || dragState.settling || event.touches.length !== 1) {
    resetTouchGesture();
    return;
  }
  const touch = event.touches.item(0);
  if (!touch) return;
  touchGesture.tracking = true;
  touchGesture.identifier = touch.identifier;
  touchGesture.startX = touch.clientX;
  touchGesture.startY = touch.clientY;
  touchGesture.intent = "pending";
}

function onScheduleTouchMove(event: TouchEvent) {
  if (!touchGesture.tracking) return;
  const touch = trackedTouch(event.touches);
  if (!touch) return;
  touchGesture.intent = resolveSwipeIntent(
    touch.clientX - touchGesture.startX,
    touch.clientY - touchGesture.startY,
    touchGesture.intent,
  );
  if (touchGesture.intent === "horizontal" && event.cancelable) event.preventDefault();
}

function onScheduleTouchEnd(event: TouchEvent) {
  if (!trackedTouch(event.touches)) resetTouchGesture();
}

function onScheduleTouchCancel() {
  resetTouchGesture();
}

function trackedTouch(touches: TouchList) {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === touchGesture.identifier) return touch;
  }
  return null;
}

function resetTouchGesture() {
  touchGesture.tracking = false;
  touchGesture.identifier = -1;
  touchGesture.intent = "pending";
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
  dragFrame = window.requestAnimationFrame(() => {
    dragFrame = 0;
    setTrackOffset(targetX);
  });
}

function resetDrag() {
  releaseDragPointer();
  clearDragTimers();
  clearStaticWeekAnimation();
  dragCommitDelta = 0;
  dragState.tracking = false;
  dragState.dragging = false;
  dragState.settling = false;
  dragState.pointerId = -1;
  dragState.offsetX = 0;
  dragState.axis = "pending";
  dragOffsetX = 0;
  dragVelocityX = 0;
  setDragClasses(false, false);
  clearTrackOffset();
  dragSuppressClickTimer = window.setTimeout(() => {
    dragSuppressClickTimer = 0;
    dragState.suppressClick = false;
  }, 220);
}

function scheduleDragReset() {
  if (dragResetTimer) window.clearTimeout(dragResetTimer);
  dragResetTimer = window.setTimeout(() => {
    dragResetTimer = 0;
    resetDrag();
  }, 180);
}

function clearDragTimers() {
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  if (dragResetTimer) {
    window.clearTimeout(dragResetTimer);
    dragResetTimer = 0;
  }
  if (dragSuppressClickTimer) {
    window.clearTimeout(dragSuppressClickTimer);
    dragSuppressClickTimer = 0;
  }
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

function resetActiveScheduleBodyScroll() {
  const scrollBody = contentRef.value?.querySelector<HTMLElement>(".schedule-panel.active .schedule-body-scroll");
  if (!scrollBody) return;
  scrollBody.scrollTop = 0;
}

function updateViewportHeight() {
  const visualHeight = window.visualViewport?.height ?? window.innerHeight;
  const visualWidth = window.visualViewport?.width ?? window.innerWidth;
  const height = Math.min(visualHeight, window.innerHeight);
  const width = Math.min(visualWidth, window.innerWidth);
  viewportHeight.value = Math.max(0, Math.round(height || 0));
  viewportWidth.value = Math.max(0, Math.round(width || 0));
  touchLikeViewport.value = isTouchLikeViewport();
  compactViewport.value = window.matchMedia?.("(max-width: 760px)").matches ?? width <= 760;
}

function isTouchLikeViewport() {
  return Boolean(
    window.matchMedia?.("(pointer: coarse)").matches
    || window.matchMedia?.("(hover: none)").matches
    || navigator.maxTouchPoints > 0
  );
}

function syncNetworkStatus() {
  offlineMode.value = navigator.onLine === false;
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

function syncGraduateActiveDayForWeek(targetWeek = week.value) {
  if (scheduleStorageScope() !== "graduate" || !parsed.value) return;
  const weekNo = Number(targetWeek || 0);
  if (!weekNo) return;
  if (dayCourseBlocksFor(weekNo, activeDay.value, parsed.value).length) return;
  activeDay.value = resolveGraduateActiveDay(parsed.value, String(targetWeek || ""), calendar.value);
}

function currentWeekValue() {
  const fallback = buildGraduateFallbackCalendar(parsed.value);
  return week.value
    || String(calendar.value?.currentWeek || "")
    || String(fallback?.currentWeek || "")
    || String(parsed.value?.currentWeek || "")
    || String(parsed.value?.weeks.find((item) => item.current)?.value || "")
    || String(parsed.value?.weeks[0]?.value || "");
}

function nextWeekValue(delta: number) {
  return nextWeekValueFrom(currentWeekValue(), delta);
}

function toneFor(name: string): CourseTone {
  if (scheduleTheme.value === "color-glass") return getColorGlassCourseTone(name, appearance.isDark);
  const theme = getScheduleThemePalette(scheduleTheme.value);
  if (appearance.isDark) {
    return {
      bg: "var(--schedule-course-bg)",
      border: "var(--schedule-course-border)",
      text: "var(--schedule-course-text)",
    };
  }
  return { bg: theme.courseBg, border: theme.courseBorder, text: theme.courseText };
}

function hasScheduleEditAuth() {
  return auth.isLoggedIn;
}

function canUseScheduleEdit() {
  const client = detectClientPlatform();
  if (scheduleSource.value === "graduate" || scheduleSource.value === "graduate-debug") return false;
  return (client === "android" || client === "ios" || client === "harmony" || client === "desktop")
    && hasScheduleEditAuth();
}

function ensureScheduleEditEnabled() {
  return canUseScheduleEdit();
}

function showEditorMessage(type: "success" | "warning", message: string) {
  ElMessage({ type, message, offset: 96 });
}

function closeCourseEditor() {
  if (courseEditBusy.value) return;
  editDialogOpen.value = false;
}

async function restoreHiddenCourse(key: string) {
  if (courseEditBusy.value) return;
  courseEditAction.value = "restoreHidden";
  try {
    await loadScheduleEdits();
    const confirmed = await ElMessageBox.confirm("确定恢复这门已编辑课程吗？恢复后会重新出现在课表里。", "恢复已编辑课程", {
      confirmButtonText: "恢复",
      cancelButtonText: "取消",
      type: "warning",
    }).then(() => true).catch(() => false);
    if (!confirmed) return;
    scheduleEdits.value = restoreHiddenCourseEdit(scheduleEdits.value, {
      key,
      sources: allKnownScheduleSources(),
      courseFamilyKey,
    });
    persistScheduleEdits();
  } finally {
    if (courseEditAction.value === "restoreHidden") courseEditAction.value = "";
  }
}

async function openAddCourse(day = activeDay.value, slot = 1, targetWeek = currentWeekValue()) {
  if (courseEditBusy.value) return;
  if (!ensureScheduleEditEnabled()) return;
  await loadScheduleEdits();
  editingCourseBlock.value = null;
  editingCourseKey.value = "";
  editingWeekValue.value = String(targetWeek || currentWeekValue());
  fillFormForNewCourse(customCourseForm, {
    day,
    slot,
    targetWeek: editingWeekValue.value,
    activeWeekNumber: activeWeekNumber.value,
    currentWeek: week.value,
  });
  editDialogOpen.value = true;
}

async function openCourseEditor(block: WeekCourseBlock, targetWeek = currentWeekValue()) {
  if (courseEditBusy.value) return;
  if (!ensureScheduleEditEnabled()) return;
  await loadScheduleEdits();
  editingCourseBlock.value = block;
  editingCourseKey.value = courseEditKey(block.day, block.bigSlot, block.course);
  editingWeekValue.value = String(targetWeek || currentWeekValue());
  fillFormForExistingCourse(customCourseForm, block, courseEditorWeekContext());
  editDialogOpen.value = true;
}

function saveCourseEdit() {
  if (courseEditBusy.value) return;
  const name = customCourseForm.name.trim();
  if (!name) {
    showEditorMessage("warning", "请填写课程名称");
    return;
  }
  const weekList = customCourseWeekList();
  if (customCourseForm.weekMode === "custom" && !weekList.length) {
    showEditorMessage("warning", "请选择周次");
    return;
  }
  courseEditAction.value = "save";
  try {
    const existing = editingCourseBlock.value?.course.customId
      ? scheduleEdits.value.custom.find((item) => item.id === editingCourseBlock.value?.course.customId)
      : null;
    const { item } = buildCustomCourseItem(customCourseForm, {
      weekList,
      existing,
      editingCourseKey: editingCourseKey.value,
    });
    const editingBlock = editingCourseBlock.value;
    if (editingBlock && isOriginalCourseEditUnchanged(editingBlock, item, weekNumberOptions.value)) {
      editDialogOpen.value = false;
      showEditorMessage("success", "课程没有变化，无需保存");
      return;
    }
    scheduleEdits.value = saveCustomCourseEdit(scheduleEdits.value, item, {
      editingBlock,
      editingCourseKey: editingCourseKey.value,
      courseFamilyKey,
      courseFamilySourceKeys,
    });
    persistScheduleEdits();
    editDialogOpen.value = false;
    showEditorMessage("success", editingCourseBlock.value ? "已保存课程" : "已添加到课表");
  } finally {
    if (courseEditAction.value === "save") courseEditAction.value = "";
  }
}

async function deleteEditingCourse() {
  if (courseEditBusy.value) return;
  courseEditAction.value = "delete";
  try {
    await loadScheduleEdits();
    const block = editingCourseBlock.value;
    if (!block) return;
    const confirmed = await ElMessageBox.confirm(
      block.course.customId ? "确定删除这门自定义课程吗？删除后会从课表中移除。" : "确定隐藏这门课程吗？隐藏后可在已编辑课程中恢复。",
      block.course.customId ? "删除自定义课程" : "隐藏课程",
      {
        confirmButtonText: block.course.customId ? "删除" : "隐藏",
        cancelButtonText: "取消",
        type: "warning",
      },
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
    scheduleEdits.value = deleteCourseEdit(scheduleEdits.value, block, {
      editingCourseKey: editingCourseKey.value,
      courseFamilyKey,
      courseFamilySourceKeys,
    });
    persistScheduleEdits();
    editDialogOpen.value = false;
    showEditorMessage("success", block.course.customId ? "已删除课程" : "已从课表隐藏");
  } finally {
    if (courseEditAction.value === "delete") courseEditAction.value = "";
  }
}

async function restoreOriginalCourse() {
  if (courseEditBusy.value) return;
  courseEditAction.value = "restore";
  try {
    await loadScheduleEdits();
    const block = editingCourseBlock.value;
    const sourceKey = block?.course.sourceKey;
    const customId = block?.course.customId;
    if (!sourceKey) return;
    const confirmed = await ElMessageBox.confirm("确定恢复原始课程吗？当前自定义修改会被移除。", "恢复原始课程", {
      confirmButtonText: "恢复",
      cancelButtonText: "取消",
      type: "warning",
    }).then(() => true).catch(() => false);
    if (!confirmed) return;
    scheduleEdits.value = restoreOriginalCourseEdit(scheduleEdits.value, block, {
      sourceKey,
      customId,
      courseFamilyKey,
      courseFamilySourceKeys,
    });
    persistScheduleEdits();
    editDialogOpen.value = false;
    showEditorMessage("success", "已恢复原始课程");
  } finally {
    if (courseEditAction.value === "restore") courseEditAction.value = "";
  }
}

function customCourseWeekList() {
  return resolveCustomCourseWeekList(customCourseForm, courseEditorWeekContext());
}

function toggleCustomWeek(weekNo: number) {
  if (courseEditBusy.value) return;
  toggleCustomCourseWeekSelection(customCourseForm, weekNo);
}

function courseEditorWeekContext() {
  return {
    editingWeekValue: editingWeekValue.value,
    activeWeekNumber: activeWeekNumber.value,
    currentWeek: week.value,
    weekNumberOptions: weekNumberOptions.value,
  };
}

function loadScheduleEdits() {
  if (disposed) return Promise.resolve();
  if (!canUseScheduleEdit()) {
    scheduleEdits.value = emptyScheduleEdits();
    return Promise.resolve();
  }
  if (scheduleEditsLoadPromise) return scheduleEditsLoadPromise;
  const sem = semester.value || parsed.value?.currentSemester || "current";
  scheduleEditsLoadPromise = (async () => {
    try {
      const r = await jwxtApi.getScheduleEdits(sem, { silent: true });
      if (disposed) return;
      scheduleEdits.value = normalizeScheduleEditsState(r.edits);
    } catch {
      if (disposed) return;
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
  pendingScheduleEditsSave = {
    semester: sem,
    edits: normalizeScheduleEditsState(scheduleEdits.value),
  };
  if (scheduleEditsSaveTimer) window.clearTimeout(scheduleEditsSaveTimer);
  scheduleEditsSaveTimer = window.setTimeout(() => {
    flushScheduleEditsSave();
  }, 160);
}

function flushScheduleEditsSave() {
  if (scheduleEditsSaveTimer) {
    window.clearTimeout(scheduleEditsSaveTimer);
    scheduleEditsSaveTimer = 0;
  }
  const pending = pendingScheduleEditsSave;
  if (!pending) return;
  pendingScheduleEditsSave = null;
  void jwxtApi.saveScheduleEdits({ semester: pending.semester, edits: pending.edits }, { silent: true })
    .catch(() => null);
}

function allKnownScheduleSources() {
  const sources: ScheduleResult[] = [];
  if (parsed.value) sources.push(parsed.value);
  for (const envelope of scheduleCacheStore.values()) {
    if (envelope.data && !sources.includes(envelope.data)) sources.push(envelope.data);
  }
  return sources;
}

function restoreScheduleTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    scheduleTheme.value = normalizeScheduleTheme(saved);
  } catch {
    /* ignore */
  }
  syncNativeWidgetTheme();
}

function persistScheduleTheme(value = scheduleTheme.value) {
  scheduleTheme.value = normalizeScheduleTheme(value);
  try {
    localStorage.setItem(THEME_KEY, scheduleTheme.value);
  } catch {
    /* ignore */
  }
  syncNativeWidgetTheme();
}

function courseBlockStyle(block: WeekCourseBlock) {
  const colors = toneFor(block.course.name);
  return {
    gridColumn: `${block.day + 1} / ${block.day + 2}`,
    gridRow: `${block.startSlot} / ${block.endSlot + 1}`,
    "--course-bg": colors.bg,
    "--course-border": colors.border,
    "--course-text": colors.text,
  };
}

function dayCourseBlockStyle(block: WeekCourseBlock) {
  const colors = toneFor(block.course.name);
  return {
    gridColumn: "2 / 3",
    gridRow: `${block.startSlot} / ${block.endSlot + 1}`,
    "--course-bg": colors.bg,
    "--course-border": colors.border,
    "--course-text": colors.text,
  };
}

function scheduleCacheKey(sem = semester.value, wk = week.value) {
  return buildScheduleCacheKey({
    scope: scheduleStorageScope(),
    semester: sem,
    week: wk,
    currentSemester: parsed.value?.currentSemester,
    currentWeek: parsed.value?.currentWeek,
    calendarWeek: calendar.value?.currentWeek,
    graduate: scheduleStorageScope() === "graduate",
  });
}

function writeScheduleCache(key: string, data: ScheduleResult) {
  const envelope = writeCache(key, data);
  if (envelope) rememberScheduleCache(key, envelope);
}

function notifyOfficialScheduleChange(previous: ScheduleResult | undefined, next: ScheduleResult) {
  const change = detectOfficialScheduleChange(previous, next);
  if (!change || !claimOfficialScheduleChangeNotice(change)) return;
  const visibleDetails = change.details.slice(0, 6);
  const remaining = change.details.length - visibleDetails.length;
  void ElMessageBox.alert(
    h("div", { style: { textAlign: "left", lineHeight: "1.55" } }, [
      h("p", { style: { margin: "0 0 10px" } }, "检测到教务原始课表有以下变化："),
      h("div", { style: { maxHeight: "38vh", overflowY: "auto" } }, [
        ...visibleDetails.map((detail) => h("p", { style: { margin: "7px 0" } }, detail.text)),
        ...(remaining > 0 ? [h("p", { style: { margin: "7px 0" } }, `另有 ${remaining} 项变化，请在课表中核对。`)] : []),
      ]),
      h("p", { style: { margin: "12px 0 0", color: "var(--el-text-color-secondary)" } }, "如果你编辑过上述课程，请重新核对自定义内容，必要时恢复原始课程。"),
    ]),
    "教务课表已更新",
    {
      type: "warning",
      confirmButtonText: "我知道了",
      showClose: false,
      closeOnClickModal: false,
      closeOnPressEscape: false,
    },
  ).catch(() => undefined);
}

function rememberScheduleCache(key: string, envelope: CacheEnvelope<ScheduleResult>) {
  scheduleCacheStore.set(key, envelope);
}

function calendarCacheKey(sem = semester.value || parsed.value?.currentSemester || "") {
  return scheduleCalendarCacheKey(scheduleStorageScope(), sem);
}

function lastStateCacheKey() {
  return scheduleLastStateCacheKey(scheduleStorageScope());
}

function lastScheduleCacheKey() {
  return scheduleLastCacheKey(scheduleStorageScope());
}

function restoreCachedCalendar(sem = semester.value || parsed.value?.currentSemester || "") {
  const cached = readCache<CalendarResult>(calendarCacheKey(sem));
  if (!cached?.data) return false;
  calendar.value = hydrateCalendar(cached.data);
  return true;
}

function restoreLastState() {
  const state = readStoredLastState(lastStateCacheKey());
  if (!state) return;
  if (scheduleStorageScope() !== "graduate") {
    if (state.semester) semester.value = state.semester;
    if (state.week) week.value = state.week;
  }
  if (state.activeDay >= 1 && state.activeDay <= 7) activeDay.value = state.activeDay;
  viewMode.value = resolveScheduleViewMode(state.viewMode);
}

function saveLastState() {
  writeStoredLastState(lastStateCacheKey(), {
    semester: semester.value,
    week: week.value,
    activeDay: activeDay.value,
    viewMode: viewMode.value,
  });
}

function restoreLastScheduleCache() {
  const key = readStoredLastScheduleCacheKey(lastScheduleCacheKey());
  if (key && applyScheduleCache(key)) return true;
  const fallback = readLatestScheduleCache<ScheduleResult>([
    scheduleStorageScope(),
    "undergraduate",
    "jwxt",
    "graduate",
  ]);
  if (!fallback) return false;
  scheduleSource.value = fallback.scope === "graduate" ? "graduate" : "jwxt";
  return applyScheduleCache(fallback.key);
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
  if (scheduleStorageScope() === "graduate") {
    const fallbackCalendar = hydrateCalendar(calendar.value ?? buildGraduateFallbackCalendar(cached.data));
    if (fallbackCalendar) {
      calendar.value = fallbackCalendar;
      parsed.value = extendScheduleWeeksToCalendar(cached.data, fallbackCalendar);
    }
  }
  scheduleSavedAt.value = cached.savedAt;
  if (!semester.value) semester.value = cached.data.currentSemester || "";
  if (!week.value) {
    week.value = scheduleStorageScope() === "graduate"
      ? resolveGraduateInitialWeek(parsed.value, calendar.value)
      : String(cached.data.currentWeek || "");
  }
  syncGraduateActiveDayForWeek(week.value);
  loadScheduleEdits();
  prewarmAdjacentWeekCaches();
  return true;
}

function saveScheduleCache() {
  if (!parsed.value) return;
  const key = scheduleCacheKey(parsed.value.currentSemester || semester.value, week.value || parsed.value.currentWeek);
  if (scheduleStorageScope() === "undergraduate") {
    const previous = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
    notifyOfficialScheduleChange(previous?.data, parsed.value);
  }
  writeScheduleCache(key, parsed.value);
  const lastKey = lastScheduleCacheKey();
  writeStoredLastScheduleCacheKey(lastKey, key);
}

function prewarmAdjacentWeekCaches() {
  if (scheduleStorageScope() === "graduate") return;
  if (!parsed.value || !semester.value) return;
  const current = currentWeekValue();
  [nextWeekValueFrom(current, -1), nextWeekValueFrom(current, 1)]
    .filter(Boolean)
    .forEach((wk) => prewarmScheduleCacheForWeek(wk));
}

function prewarmScheduleCacheForWeek(wk: string) {
  if (scheduleStorageScope() === "graduate") return;
  const key = scheduleCacheKey(parsed.value?.currentSemester || semester.value, wk);
  if (!key) return;
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data && !isStale(cached.savedAt)) {
    if (!scheduleCacheStore.has(key)) rememberScheduleCache(key, cached);
    return;
  }
  if (prewarmingScheduleKeys.has(key)) return;
  prewarmingScheduleKeys.add(key);
  void jwxt.withSessionRetry(() => jwxtApi.schedule(
    { semester: semester.value, week: wk },
    { silent: true },
  ))
    .then((r: any) => {
      if (r?.parsed) writeScheduleCache(key, r.parsed);
    })
    .finally(() => {
      prewarmingScheduleKeys.delete(key);
    });
}
</script>

<style scoped lang="scss" src="./schedule/styles/schedule-shell.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-layout.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-grid.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-editor.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-responsive.scss"></style>
