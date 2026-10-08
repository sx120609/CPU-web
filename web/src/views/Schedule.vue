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
    'view-month': viewMode === 'month',
    'has-style-canvas': hasStyleCanvas,
    'sd-compact': display.compact,
    'sd-no-slot-time': !display.showSlotTime,
    [`schedule-style-${scheduleStyle}`]: true,
  }"
  :style="[pageStyle, displayStyle]"
>
    <IosAppRecommendation style="--ios-app-recommendation-max-width: 720px" />
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
          <button type="button" :class="{ active: viewMode === 'month' }" :disabled="loading" @click="setViewMode('month')">月</button>
        </div>
        <button
          v-if="parsed && display.showBackToWeek"
          type="button"
          class="icon-btn"
          :class="{ active: isViewingToday }"
          :disabled="loading"
          :aria-label="todayButtonLabel"
          :title="todayButtonLabel"
          @click="jumpToToday"
        >
          <el-icon><Aim /></el-icon>
        </button>
        <el-popover
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
              <div class="more-quick">
                <button v-if="parsed" type="button" :disabled="loading" @click="runMoreAction(manualRefreshSchedule)">
                  <el-icon><Refresh /></el-icon>
                  <span>刷新</span>
                </button>
                <button v-if="parsed && canUseScheduleEdit()" type="button" @click="runMoreAction(() => openAddCourse())">
                  <el-icon><Plus /></el-icon>
                  <span>添加课程</span>
                </button>
                <button type="button" @click="runMoreAction(openSharingDialog)">
                  <el-icon><Share /></el-icon>
                  <span>共享课表</span>
                </button>
                <button v-if="parsed" type="button" class="couple-quick" @click="openCoupleDialog()">
                  <el-icon><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.2 21 8.9c0 3.3-3 6-7.7 10.2L12 20.3z" /></svg></el-icon>
                  <span>情侣课表</span>
                </button>
                <button v-if="parsed && calendar && !isNativeScheduleApp" type="button" @click="runMoreAction(exportWeekCalendarFile)">
                  <el-icon><Calendar /></el-icon>
                  <span>导出日历</span>
                </button>
                <button v-if="canShowInstallAction" type="button" @click="runMoreAction(openInstallPrompt)">
                  <el-icon><Download /></el-icon>
                  <span>添加到桌面</span>
                </button>
                <button v-if="isDev" type="button" @click="runMoreAction(() => { gradDebugDialogOpen = true; })">
                  <el-icon><Tools /></el-icon>
                  <span>研究生调试</span>
                </button>
              </div>
              <button type="button" class="more-action" @click="moreMenuView = 'style'">
                <el-icon><Brush /></el-icon>
                <span>课表风格 · {{ currentStyleTitle }}</span>
                <el-icon class="more-chevron"><ArrowRight /></el-icon>
              </button>
              <button type="button" class="more-action" @click="moreMenuView = 'display'">
                <el-icon><Operation /></el-icon>
                <span>显示设置</span>
                <el-icon class="more-chevron"><ArrowRight /></el-icon>
              </button>
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

            <template v-else-if="moreMenuView === 'style'">
              <button type="button" class="more-back" @click="moreMenuView = 'menu'">
                <el-icon><ArrowLeft /></el-icon>
                <span>课表风格</span>
              </button>
              <ScheduleStylePicker
                :model-value="scheduleStyle"
                :palette="scheduleTheme"
                :dark="appearance.isDark"
                @update:model-value="selectScheduleStyle"
              />
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

            <template v-else-if="moreMenuView === 'display'">
              <button type="button" class="more-back" @click="moreMenuView = 'menu'">
                <el-icon><ArrowLeft /></el-icon>
                <span>显示设置</span>
              </button>
              <div class="display-panel">
                <p class="display-group">课程格子</p>
                <label class="background-control">
                  <span class="background-control-head">
                    <b>格子高度</b>
                    <em>{{ display.rowHeight }}%</em>
                  </span>
                  <input
                    type="range"
                    :min="SCHEDULE_ROW_HEIGHT_MIN"
                    :max="SCHEDULE_ROW_HEIGHT_MAX"
                    :step="SCHEDULE_ROW_HEIGHT_STEP"
                    :value="display.rowHeight"
                    aria-label="格子高度"
                    @input="onDisplayRowHeightInput"
                  />
                </label>
                <div class="display-row">
                  <b>文字大小</b>
                  <div class="display-segment" role="radiogroup" aria-label="文字大小">
                    <button
                      v-for="option in scheduleTextSizeOptions"
                      :key="option.key"
                      type="button"
                      role="radio"
                      :class="{ active: display.textSize === option.key }"
                      :aria-checked="display.textSize === option.key"
                      @click="updateDisplay({ textSize: option.key })"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
                <div v-for="item in displayCourseSwitches" :key="item.key" class="display-row">
                  <b>{{ item.label }}</b>
                  <el-switch
                    size="small"
                    :model-value="display[item.key]"
                    :aria-label="item.label"
                    @update:model-value="(value: unknown) => updateDisplay({ [item.key]: Boolean(value) })"
                  />
                </div>
                <p class="display-group">课表网格</p>
                <div v-for="item in displayGridSwitches" :key="item.key" class="display-row">
                  <b>{{ item.label }}</b>
                  <el-switch
                    size="small"
                    :model-value="display[item.key]"
                    :disabled="item.key === 'sundayFirst' && !display.showSunday"
                    :aria-label="item.label"
                    @update:model-value="(value: unknown) => updateDisplay({ [item.key]: Boolean(value) })"
                  />
                </div>
                <p class="background-note">这些设置用在周视图上，只保存在当前设备。关掉的周六、周日如果有课或补班，那一天仍会显示。</p>
                <button type="button" class="more-subaction" :disabled="displayIsDefault" @click="resetDisplay">恢复默认</button>
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
      </div>
    </header>

    <!-- 按设备分流的安装引导：移动端安装/加主屏，桌面端下载原生客户端 -->
    <OpenBrowserPromptDialog ref="openBrowserPromptRef" />
    <InstallPromptDialog ref="installPromptRef" />
    <ScheduleUsageNotice />
    <input
      ref="backgroundImageInputRef"
      type="file"
      accept="image/*"
      class="hidden-file-input"
      @change="onScheduleBackgroundPicked"
    />

    <section v-if="parsed && viewMode === 'month'" class="week-switcher">
      <button type="button" class="week-btn" :disabled="!canChangeMonth(-1)" @click="changeMonth(-1)">
        <el-icon><ArrowLeft /></el-icon>
        上一月
      </button>
      <div class="week-title">
        <b>{{ monthTitle }}</b>
        <span v-if="monthWeekRange">{{ monthWeekRange }}</span>
      </div>
      <button type="button" class="week-btn" :disabled="!canChangeMonth(1)" @click="changeMonth(1)">
        下一月
        <el-icon><ArrowRight /></el-icon>
      </button>
    </section>

    <section v-else-if="parsed" class="week-switcher" :class="{ coupled: coupleBound }">
      <button type="button" class="week-btn" aria-label="上一周" :disabled="!canChangeWeek(-1)" @click="changeWeek(-1)">
        <el-icon><ArrowLeft /></el-icon>
        <span class="week-btn-label">上一周</span>
      </button>
      <!-- 绑定了情侣课表时，TA 此刻的状态就写在周次这一块里，不再另占一行。 -->
      <div v-if="coupleBound" class="week-title coupled" :style="coupleBarStyle">
        <button type="button" class="week-title-main" :disabled="loading" @click="weekDialogOpen = true">
          <b>第 {{ currentWeekValue() || "--" }} 周</b>
          <span v-if="currentWeekRange">{{ currentWeekRange }}</span>
        </button>
        <div class="couple-line">
          <button type="button" class="couple-line-main" aria-label="情侣课表" @click="openCoupleDialog()">
            <i class="couple-line-dot" aria-hidden="true" />
            <span class="couple-line-text">{{ coupleBarText }}</span>
            <em v-if="couple.togetherDays.value" class="couple-line-days"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.2 21 8.9c0 3.3-3 6-7.7 10.2L12 20.3z" /></svg>{{ couple.togetherDays.value }}</em>
          </button>
          <button
            type="button"
            class="couple-line-toggle"
            :class="{ active: couple.visible.value }"
            :aria-pressed="couple.visible.value"
            :aria-label="couple.visible.value ? '只看我的课' : '显示 TA 的课'"
            :title="couple.visible.value ? '只看我的课' : '显示 TA 的课'"
            @click="couple.setVisible(!couple.visible.value)"
          >
            <svg v-if="couple.visible.value" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" fill="currentColor" /><circle cx="16.5" cy="9" r="2.6" fill="currentColor" opacity=".75" /><path fill="currentColor" d="M3 19c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6v.6H3V19z" /><path fill="currentColor" opacity=".75" d="M16 13.4c2.9 0 5 2 5 4.9v1.3h-4.4V19c0-2.1-.8-4-2.2-5.3.5-.2 1-.3 1.6-.3z" /></svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4" fill="currentColor" /><path fill="currentColor" d="M5.5 19.2c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6v.6h-13v-.6z" /></svg>
          </button>
        </div>
      </div>
      <button
        v-else
        type="button"
        class="week-title clickable"
        :disabled="loading"
        @click="weekDialogOpen = true"
      >
        <b>第 {{ currentWeekValue() || "--" }} 周</b>
        <span v-if="currentWeekRange">{{ currentWeekRange }}</span>
      </button>
      <button type="button" class="week-btn" aria-label="下一周" :disabled="!canChangeWeek(1)" @click="changeWeek(1)">
        <span class="week-btn-label">下一周</span>
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
      <el-button data-cpu-button-theme="schedule" type="primary" size="large" @click="$router.push({ name: 'jwxt', query: { reauthorize: '1', redirect: '/schedule' } })">
        重新核验授权
      </el-button>
    </section>

    <section v-else-if="!parsed && !jwxt.isLoggedIn" class="state-card">
      <el-icon class="big"><Lock /></el-icon>
      <h2>{{ jwxt.authorizationExpired ? "教务授权已失效" : "需要先登录教务" }}</h2>
      <p>{{ jwxt.authorizationExpired ? "学校返回了登录或统一认证提示，请重新完成教务授权。" : "登录后可快速查看课表，也可以把这个页面加到桌面方便下次打开。勾选保持登录后会在当前浏览器加密保存账号密码，验证码不会保存。" }}</p>
      <p class="scope-note">{{ scheduleLoginScopeText }}</p>
      <el-button data-cpu-button-theme="schedule" type="primary" size="large" @click="$router.push({ name: 'jwxt', query: { reauthorize: jwxt.authorizationExpired ? '1' : undefined, redirect: '/schedule' } })">
        {{ jwxt.authorizationExpired ? "重新授权" : "前往登录" }}
      </el-button>
      <PrivacyPolicyNotice />
    </section>

    <section v-else-if="parsed && viewMode === 'month'" class="content month-content">
      <div class="schedule-body-scroll">
        <ScheduleMonthView
          :visual-style="scheduleStyle"
          :palette="scheduleTheme"
          :dark="appearance.isDark"
          :has-background="hasScheduleBackground"
          :days="monthDays"
          :selected-date="monthSelectedDate"
          :today-date="todayYmd"
          :clocks="smallSlots"
          :priorities="schedulePriority"
          can-open-day
          :partner-counts="monthPartnerCounts"
          :partner-tone="monthPartnerTone"
          :own-tone="monthOwnTone"
          :can-shift-previous="canChangeMonth(-1)"
          :can-shift-next="canChangeMonth(1)"
          @shift="changeMonth"
          @select="onMonthSelect"
          @open-day="openMonthDay"
        />
      </div>
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
              <section
                v-if="viewMode === 'week' && scheduleStyle === 'classic'"
                class="week-overview"
                :class="{ 'couple-on': couple.active.value }"
                :style="{ '--sd-columns': columnsFor(page).length }"
                aria-label="整周课表"
              >
                <div class="week-grid-head">
                  <div class="time-head">节次</div>
                  <div
                    v-for="d in visibleTabsFor(page)"
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
                    <div class="slot-axis" :style="{ gridColumn: '1 / 2', gridRow: `${slot.no} / ${slot.no + 1}` }">
                      <b>{{ slot.no }}</b>
                      <span>{{ slot.start }}</span>
                      <span>{{ slot.end }}</span>
                    </div>
                    <div
                      v-for="(day, column) in columnsFor(page)"
                      :key="`bg-${page.key}-${slot.no}-${day}`"
                      class="week-slot-cell"
                      :style="{ gridColumn: `${column + 2} / ${column + 3}`, gridRow: `${slot.no} / ${slot.no + 1}` }"
                      :class="{ today: page.dayTabs[day - 1]?.isToday }"
                      @click="onWeekPageSlotClick($event, page, day, slot.no)"
                    />
                  </template>
                  <!-- 非本周的课：淡淡地画在本周空着的节次里。 -->
                  <article
                    v-for="piece in offWeekPiecesFor(page)"
                    :key="`off-${page.weekValue}-${piece.id}`"
                    class="week-course off-week"
                    :style="courseBlockStyle(piece, 'me', false, page)"
                    :title="courseTitle(piece.block.course)"
                    @click.stop="onOffWeekCourseClick($event, piece.block, page)"
                  >
                    <i class="off-week-tag">非本周</i>
                    <strong>{{ piece.block.course.name }}</strong>
                    <span v-if="piece.block.course.location">@{{ piece.block.course.location }}</span>
                  </article>
                  <article
                    v-for="piece in piecesFor(page)"
                    :key="`${page.weekValue}-${piece.id}`"
                    class="week-course"
                    :class="{ 'couple-noted': isCoupleShared(page, piece.block) || coupleClashesFor(page, piece.block).length > 0 }"
                    :style="courseBlockStyle(piece, 'me', isCoupleShared(page, piece.block), page)"
                    :title="courseTitle(piece.block.course)"
                    @click.stop="onWeekPageCourseClick($event, page, piece.block)"
                  >
                    <strong>{{ piece.block.course.name }}</strong>
                    <span v-if="piece.block.course.location">@{{ piece.block.course.location }}</span>
                    <span v-if="display.showTeacher && piece.block.course.teacher" class="week-course-teacher">{{ piece.block.course.teacher }}</span>
                    <em>{{ piece.block.course.slotNote || piece.block.course.weeks }}</em>
                    <div v-if="isCoupleShared(page, piece.block) || coupleClashesFor(page, piece.block).length" class="couple-notes">
                      <b v-if="isCoupleShared(page, piece.block)" class="couple-note together">一起上</b>
                      <b
                        v-for="other in coupleClashesFor(page, piece.block).slice(0, 1)"
                        :key="`${other.startSlot}-${other.course.name}`"
                        class="couple-note"
                        :style="coupleNoteStyle(other)"
                        role="button"
                        @click.stop="onPartnerCourseClick($event, other)"
                      >TA {{ coupleClashesFor(page, piece.block).length > 1 ? `${coupleClashesFor(page, piece.block).length} 门课` : other.course.name }}</b>
                    </div>
                  </article>
                  <article
                    v-for="block in couplePartnerTilesFor(page)"
                    :key="`ta-${page.weekValue}-${block.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
                    class="week-course couple-partner"
                    :style="courseBlockStyle(block, 'ta', false, page)"
                    :title="`TA · ${courseTitle(block.course)}`"
                    @click.stop="onPartnerCourseClick($event, block)"
                  >
                    <i class="couple-ta-tag">TA</i>
                    <strong>{{ block.course.name }}</strong>
                    <span v-if="block.course.location">@{{ block.course.location }}</span>
                  </article>
                  <!-- 「现在」：节次栏上的时间和今天那一列上的一条线。 -->
                  <template v-if="classicNowFor(page)">
                    <div class="classic-now-anchor" :style="{ gridColumn: 1, gridRow: classicNowFor(page)!.row + 1 }" aria-hidden="true">
                      <span class="classic-now-badge" :style="classicNowFor(page)!.style">{{ nowClockText }}</span>
                    </div>
                    <div class="classic-now-anchor" :style="{ gridColumn: classicNowFor(page)!.column + 1, gridRow: classicNowFor(page)!.row + 1 }" aria-hidden="true">
                      <span class="classic-now-line" :style="classicNowFor(page)!.style" />
                    </div>
                  </template>
                </div>
              </section>

              <StyledWeekGrid
                v-else-if="viewMode === 'week'"
                :visual-style="scheduleStyle"
                :palette="scheduleTheme"
                :dark="appearance.isDark"
                :has-background="hasScheduleBackground"
                :days="styledDaysFor(page)"
                :clocks="smallSlots"
                :now-minutes="displayNowMinutes"
                :tone-resolver="coupleToneResolver"
                :show-teacher="display.showTeacher"
                :show-slot-time="display.showSlotTime"
                :compact="display.compact"
                @course="(block, owner, source) => onStyledPageCourseClick(source, block, owner, page)"
                @off-week="(block, source) => onOffWeekCourseClick(source, block, page)"
                @slot="(day, slot) => onWeekPageSlotClick(null, page, day, slot)"
                @day="(day) => page.delta === 0 && onDayClick(day)"
              />

              <!-- 双人模式的日视图：时间轴在中间，我的课在左、TA 的课在右，所有风格共用。 -->
              <CoupleDayView
                v-else-if="couple.active.value"
                :visual-style="scheduleStyle"
                :palette="scheduleTheme"
                :dark="appearance.isDark"
                :has-background="hasScheduleBackground"
                :clocks="smallSlots"
                :pieces="coupleDayFor(page)[0].pieces"
                :partner-pieces="coupleDayFor(page)[0].partnerPieces ?? []"
                :shared-ids="coupleDayFor(page)[0].sharedIds"
                :partner-name="couplePartnerName"
                :partner-color="couplePartnerColor"
                :my-color="coupleMyColor"
                :now-minutes="pageIsToday(page) ? displayNowMinutes : null"
                @course="(block, owner, source) => owner === 'ta' ? onPartnerCourseClick(source, block) : onCourseBlockClick(source, block, page.weekValue)"
                @slot="(slot) => onStyledSlotClick(page.day, slot, page.weekValue)"
              />

              <StyledDayView
                v-else-if="!usesClassicDay"
                :visual-style="scheduleStyle"
                :palette="scheduleTheme"
                :dark="appearance.isDark"
                :has-background="hasScheduleBackground"
                :day="page.day"
                :pieces="dayPiecesFor(page)"
                :clocks="smallSlots"
                :now-minutes="pageIsToday(page) ? displayNowMinutes : null"
                :completed-before="pageIsPast(page) ? 24 * 60 : null"
                :empty-note="dayEmptyNote(page)"
                @course="(block, source) => onCourseBlockClick(source, block, page.weekValue)"
                @slot="(slot) => onStyledSlotClick(page.day, slot, page.weekValue)"
              />

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
                      v-for="piece in dayPiecesFor(page)"
                      :key="`${page.weekValue}-${page.day}-${piece.id}`"
                      class="day-course-block"
                      :style="dayCourseBlockStyle(piece)"
                      :title="courseTitle(piece.block.course)"
                      @click.stop="onCourseBlockClick($event, piece.block, page.weekValue)"
                    >
                      <div class="day-course-name">{{ piece.block.course.name }}</div>
                      <div class="day-course-meta">
                        <span v-if="piece.block.course.location">@{{ piece.block.course.location }}</span>
                        <span v-if="piece.block.course.teacher">{{ piece.block.course.teacher }}</span>
                      </div>
                      <div class="day-course-note">{{ piece.block.course.slotNote || piece.block.course.weeks }}</div>
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
        <el-button data-cpu-button-theme="schedule" v-if="canJumpToCurrentWeek" type="primary" :disabled="loading" @click="onJumpAndClose">回到本周</el-button>
        <el-button data-cpu-button-theme="schedule" @click="weekDialogOpen = false">关闭</el-button>
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
          <el-button data-cpu-button-theme="schedule" type="primary" :loading="gradDebugLoading" :disabled="gradDebugLoading" @click="loadGraduateDebugSchedule()">
            载入本地抓取样例
          </el-button>
          <el-button data-cpu-button-theme="schedule" @click="openGradSystemDebug">打开研究生管理系统</el-button>
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
            <el-button data-cpu-button-theme="schedule" @click="copyGradDebugGuide">复制调试说明</el-button>
            <el-button data-cpu-button-theme="schedule"
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
        <el-button data-cpu-button-theme="schedule" @click="widgetDialogOpen = false">关闭</el-button>
              <el-button data-cpu-button-theme="schedule" type="primary" :loading="widgetConfigCopying" :disabled="widgetConfigCopying" @click="copyScriptableWidgetScript">
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
        <el-button data-cpu-button-theme="schedule" @click="widgetInstructionOpen = false">再看看</el-button>
        <el-button data-cpu-button-theme="schedule" type="primary" :disabled="widgetInstructionCountdown > 0" @click="continueToScriptable">
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
        <el-button data-cpu-button-theme="schedule" type="primary" @click="androidWidgetGuideOpen = false">我知道了</el-button>
      </template>
    </el-dialog>

    <ScheduleSharingDialog
      v-model="sharingDialogOpen"
      :semester="shareSemester"
      :semester-label="shareSemesterLabel"
      :signed-in="auth.isLoggedIn"
      :can-publish="canPublishShare"
      :build-body="buildShareBody"
      :page-style="pageStyle"
      @open="openSharedSchedule"
    />

    <CoupleDialog :couple="couple" :page-style="pageStyle" :initial-code="coupleInviteCode" @changed="onCoupleStatusChanged" />

    <CourseQuickLook
      :block="quickLook?.block ?? null"
      :schedule-line="quickLookLine"
      :accent="quickLookAccent"
      :can-edit="quickLook?.canEdit ?? false"
      :owner-label="quickLook?.ownerLabel ?? ''"
      :page-style="pageStyle"
      @close="quickLook = null"
      @edit="editQuickLookCourse"
    />

    <Teleport to="body">
      <Transition name="course-editor">
        <div v-if="editDialogOpen" class="course-editor-overlay" :style="pageStyle" @click.self="closeCourseEditor">
          <section class="course-editor-panel" role="dialog" aria-modal="true">
            <header class="course-editor-nav">
              <button type="button" :disabled="courseEditBusy" @click="closeCourseEditor">取消</button>
              <h2>{{ editingCourseBlock ? "编辑课程" : "添加课程" }}</h2>
              <button type="button" class="primary" :disabled="courseEditBusy" @click="saveCourseEdit()">
                {{ courseEditAction === "save" ? "保存中" : "保存" }}
              </button>
            </header>

            <div class="course-editor-scroll">
              <ScheduleCourseStatus v-if="editingCourseBlock" :course="editingCourseBlock.course" detail>
                <button v-if="editingCourseBlock.course.orphaned" type="button" :disabled="courseEditBusy" @click="saveCourseEdit(true)">
                  保留为自定义课程
                </button>
              </ScheduleCourseStatus>
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
                    {{ courseEditAction === "restore" ? "处理中" : "使用教务安排" }}
                  </button>
                  <button v-if="editingCourseBlock" type="button" class="danger" :disabled="courseEditBusy" @click="deleteEditingCourse">
                    {{ courseEditAction === "delete" ? "删除中" : "删除" }}
                  </button>
                </div>
              </div>

              <template v-for="(arrangement, index) in editorArrangements" :key="arrangement.id">
                <div v-if="editorArrangements.length > 1" class="editor-arrangement-head">
                  <span>上课时间 {{ index + 1 }}</span>
                  <button v-if="index > 0" type="button" class="danger" :disabled="courseEditBusy" @click="removeArrangement(arrangement.id)">移除</button>
                </div>
                <section class="editor-card">
                  <label class="editor-row">
                    <span>周数</span>
                    <select v-model="arrangement.weekMode" :disabled="courseEditBusy" @change="onArrangementWeekModeChange(arrangement)">
                      <option value="current">本周</option>
                      <option value="all">全部周</option>
                      <option value="custom">指定周次</option>
                    </select>
                  </label>
                  <div v-if="arrangement.weekMode === 'custom'" class="editor-week-picker">
                    <span>指定周</span>
                    <div class="week-chip-grid">
                      <button
                        v-for="w in weekNumberOptions"
                        :key="w"
                        type="button"
                        :class="{ active: arrangement.weekList.includes(w) }"
                        :disabled="courseEditBusy"
                        @click="toggleArrangementWeek(arrangement, w)"
                      >
                        {{ w }}
                      </button>
                    </div>
                  </div>
                  <label class="editor-row">
                    <span>星期</span>
                    <select v-model.number="arrangement.day" :disabled="courseEditBusy">
                      <option v-for="d in 7" :key="d" :value="d">{{ dayLabel(d) }}</option>
                    </select>
                  </label>
                  <div class="editor-week-picker editor-slot-picker">
                    <span>节次</span>
                    <div>
                      <div class="week-chip-grid">
                        <button
                          v-for="slot in smallSlots"
                          :key="slot.no"
                          type="button"
                          :class="{ active: arrangement.slots.includes(slot.no) }"
                          :disabled="courseEditBusy"
                          :aria-label="`第 ${slot.no} 节，${slot.start} 至 ${slot.end}`"
                          :aria-pressed="arrangement.slots.includes(slot.no)"
                          @click="toggleArrangementSlot(arrangement, slot.no)"
                        >
                          {{ slot.no }}
                        </button>
                      </div>
                      <p class="editor-slot-summary">{{ arrangementSlotSummary(arrangement.slots) }}</p>
                    </div>
                  </div>
                </section>
                <!-- 只是提示：时间重叠的课程照样可以保存。 -->
                <p v-if="arrangementConflictNames(arrangement).length" class="editor-conflict">
                  <el-icon><WarningFilled /></el-icon>与「{{ arrangementConflictNames(arrangement).join("」「") }}」时间重叠
                </p>
              </template>

              <button type="button" class="editor-add-arrangement" :disabled="courseEditBusy" @click="addArrangement">
                <el-icon><CirclePlus /></el-icon>添加上课时间
              </button>

              <section v-if="editorOverlappingNames.length || editorPreferred" class="editor-card editor-priority-card">
                <label class="editor-switch-row">
                  <span>
                    <b>优先显示这门课</b>
                    <small>{{ editorPriorityHint }}</small>
                  </span>
                  <el-switch v-model="editorPreferred" :disabled="courseEditBusy" />
                </label>
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
import ScheduleCourseStatus from "@/components/jwxt/ScheduleCourseStatus.vue";
import ScheduleUsageNotice from "@/components/jwxt/ScheduleUsageNotice.vue";
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Aim, ArrowLeft, ArrowRight, Brush, Calendar, CirclePlus, Download, InfoFilled, Iphone, Lock, Moon, MoreFilled, Operation, Picture, Plus, QuestionFilled, Refresh, Share, Tools, WarningFilled } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { syncCoupleScheduleIfBound } from "@/views/schedule/coupleSync";
import { coupleCourseTone } from "@/views/schedule/couple";
import { useCoupleOverlay } from "@/views/schedule/useCoupleOverlay";
import CoupleDialog from "@/views/schedule/CoupleDialog.vue";
import CoupleDayView from "@/views/schedule/CoupleDayView.vue";
import { useAuthStore } from "@/stores/auth";
import { useAppearanceStore } from "@/stores/appearance";
import { useJwxtStore } from "@/stores/jwxt";
import { detectInAppBrowser } from "@/utils/inAppBrowser";
import {
  canInstallAndroidApk,
  detectClientPlatform,
  isAndroidAppUpdateAvailable,
  isAndroidNativeApp,
  isFlutterNativeShell,
  isHarmonyNativeApp,
  isIosNativeApp,
  isIosStandalone,
  supportsAndroidScheduleWidget,
} from "@/utils/clientInfo";
import { useFormFactor } from "@/utils/formFactor";
import { requestAndroidUpdatePrompt } from "@/utils/androidUpdatePrompt";
import { USER_QQ_GROUP, copyText, openUserGroup } from "@/utils/userGroup";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import AcademicDataSourceBadge from "@/components/jwxt/AcademicDataSourceBadge.vue";
import InstallPromptDialog from "@/components/install/InstallPromptDialog.vue";
import IosAppRecommendation from "@/components/install/IosAppRecommendation.vue";
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
  createCustomCourseId,
  emptyScheduleEdits,
  applyScheduleEditsToCells,
  normalizeScheduleEditsState,
  keepScheduleCourseAsCustom,
  type ScheduleEditState,
} from "@/utils/scheduleEdits";
import CourseQuickLook from "@/views/schedule/CourseQuickLook.vue";
import ScheduleMonthView from "@/views/schedule/ScheduleMonthView.vue";
import ScheduleSharingDialog from "@/views/schedule/ScheduleSharingDialog.vue";
import ScheduleStylePicker from "@/views/schedule/ScheduleStylePicker.vue";
import StyledDayView from "@/views/schedule/StyledDayView.vue";
import StyledWeekGrid from "@/views/schedule/StyledWeekGrid.vue";
import {
  arrangementConflicts,
  arrangementCustomItems,
  arrangementSlotSummary,
  type CourseArrangement,
} from "@/views/schedule/arrangements";
import {
  normalizeSchedulePriority,
  placeCourseBlocks,
  schedulePriorityValue,
  withCoursePreferred,
  type PlacedCourseBlock,
  type SchedulePriorityMap,
} from "@/views/schedule/displayPriority";
import { buildWeekIcs, saveWeekIcs, weekIcsFileName } from "@/views/schedule/icsExport";
import { buildDateIndex, buildMonthDays, calendarMonths, monthKeyOf } from "@/views/schedule/monthModel";
import { blockScheduleLine, formatClock, nowRowPosition, shanghaiMinutes } from "@/views/schedule/nowIndicator";
import {
  DEFAULT_SCHEDULE_STYLE,
  readStoredScheduleStyle,
  rgbToCss,
  scheduleStyleCanvas,
  scheduleStyleCourseTone,
  scheduleStyleCssVars,
  scheduleStyleOptions,
  writeStoredScheduleStyle,
  type ScheduleStyleKey,
} from "@/views/schedule/scheduleStyle";
import { withOwnCourseNotes } from "@/views/schedule/ownNotes";
import { SCHEDULE_THEME_STORAGE_KEY, scheduleSurfaceCssVars } from "@/views/schedule/pageVars";
import { buildSharePublishBody } from "@/views/schedule/sharedSchedules";
import type { StyledDay, TileOwner, TileToneResolver } from "@/views/schedule/styledTypes";
import { useSharedSchedules } from "@/views/schedule/useSharedSchedules";
import {
  buildScheduleCacheKey,
  clearSemesterScheduleCache,
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
  createCustomCourseForm,
  deleteCourseEdit,
  fillFormForExistingCourse,
  fillFormForNewCourse,
  isOriginalCourseEditUnchanged,
  restoreHiddenCourseEdit,
  restoreOriginalCourseEdit,
  saveCustomCourseEdit,
  type CourseEditAction,
} from "@/views/schedule/courseEditor";
import {
  addDaysToCalendarYmd,
  buildGraduateFallbackCalendar,
  dayOfWeek,
  extendScheduleWeeksToCalendar,
  formatCacheTime,
  hydrateCalendar,
  normalizeCalendarWeekDays,
  resolveGraduateActiveDay,
  resolveGraduateInitialWeek,
  resolveScheduleCurrentWeek,
  shortDate,
  todayKey,
} from "@/views/schedule/calendar";
import {
  DEFAULT_SCHEDULE_DISPLAY,
  SCHEDULE_ROW_HEIGHT_MAX,
  SCHEDULE_ROW_HEIGHT_MIN,
  SCHEDULE_ROW_HEIGHT_STEP,
  isDefaultScheduleDisplay,
  normalizeScheduleDisplay,
  readStoredScheduleDisplay,
  scheduleDisplayTextScale,
  scheduleTextSizeOptions,
  scheduleWeekColumns,
  selectOffWeekBlocks,
  writeStoredScheduleDisplay,
  type ScheduleDisplaySettings,
} from "@/views/schedule/displaySettings";
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
import { createSemesterScheduleLoader, type ScheduleResponse } from "@/views/schedule/semesterLoader";
import { useScheduleBackground } from "@/views/schedule/useScheduleBackground";
import { createScheduleViewModelHelpers } from "@/views/schedule/viewModels";
import {
  buildScheduleWidgetLocalRecord,
  saveAndroidScheduleWidgetLocalDays,
  supportsAndroidScheduleWidgetLocalDays,
} from "@/views/schedule/widgetLocalDays";
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
const couple = useCoupleOverlay(() => auth.user?.id);
watch(() => auth.user?.id, () => { void couple.refresh(); });
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
// 日视图和周视图按节次画网格，月视图是一张日历；这一页自己记着第三种。
type PageViewMode = ViewMode | "month";
const viewMode = ref<PageViewMode>(DEFAULT_SCHEDULE_VIEW_MODE);
const scheduleTheme = ref<ScheduleThemeKey>(DEFAULT_SCHEDULE_THEME);
// 课表风格和课程配色、深浅色无关：切换它不动课程数据、所选周次或编辑权限。
const scheduleStyle = ref<ScheduleStyleKey>(DEFAULT_SCHEDULE_STYLE);
const display = ref<ScheduleDisplaySettings>({ ...DEFAULT_SCHEDULE_DISPLAY });
// 重叠课程的显示优先级，课程名 → 正整数，和课表编辑一起读取和保存。
const schedulePriority = ref<SchedulePriorityMap>({});
// 读到过服务端的优先级之后保存时才带上这个字段；没读到就不带，服务端会沿用已保存的。
let schedulePriorityKnown = false;
// 「现在」每隔一会儿更新一次，用来画当前时间线和上课状态。
const nowMinutes = ref<number | null>(shanghaiMinutes());
const todayYmd = ref(todayKey());
let nowTimer = 0;
// 月视图显示的月份（yyyy-MM）和选中的那一天。
const monthKey = ref("");
const monthSelectedDate = ref("");
const loading = ref(false);
const offlineMode = ref(typeof navigator !== "undefined" ? navigator.onLine === false : false);
const scheduleSavedAt = ref(0);
const scheduleEdits = ref<ScheduleEditState>(emptyScheduleEdits());
const viewportHeight = ref(0);
const formFactor = useFormFactor();
const compactViewport = ref(false);
// v2 intentionally resets earlier saved choices once so everyone sees the new colorful default.
const THEME_KEY = SCHEDULE_THEME_STORAGE_KEY;
const GRAD_DEBUG_URL = "http://ygl.cpu.edu.cn/gmis5/oauthLogin/zgyk";
const GRAD_DEBUG_FIXTURE_PATH = "server/.debug/grad-schedule.html";
const scheduleCacheStore = reactive(new Map<string, CacheEnvelope<ScheduleResult>>());
const semesterLoader = createSemesterScheduleLoader(
  params => jwxt.withSessionRetry(() => jwxtApi.schedule(params, { silent: true })) as Promise<ScheduleResponse>,
  (response, targetWeek, reset) => {
    if (disposed) return;
    const key = scheduleCacheKey(response.parsed.currentSemester, targetWeek);
    const previous = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
    notifyOfficialScheduleChange(previous?.data, response.parsed);
    if (reset) clearSemesterScheduleCache(scheduleCacheKey(response.parsed.currentSemester, "all"), scheduleCacheStore);
    writeScheduleCache(key, response.parsed);
  },
);
watch(() => auth.sessionVersion, () => {
  semesterLoader.clear();
  scheduleCacheStore.clear();
}, { flush: "sync" });
const isNativeScheduleApp = ["android", "harmony", "ios"].includes(detectClientPlatform());
const isAndroidScheduleApp = isAndroidNativeApp() && !isFlutterNativeShell();
const isDev = computed(() => import.meta.env.DEV);
let scheduleEditsSaveTimer = 0;
let scheduleEditsSaveSeq = 0;
let scheduleEditsLoadPromise: Promise<void> | null = null;
let pendingScheduleEditsSave: { semester: string; edits: ScheduleEditState & { priority?: SchedulePriorityMap } } | null = null;
const editDialogOpen = ref(false);
const customCourseForm = reactive(createCustomCourseForm(dayOfWeek()));
const editingCourseBlock = ref<WeekCourseBlock | null>(null);
const editingCourseKey = ref("");
const editingWeekValue = ref("");
const courseEditAction = ref<CourseEditAction>("");
const courseEditBusy = computed(() => courseEditAction.value !== "");
const sharing = useSharedSchedules();
const sharingDialogOpen = ref(false);
watch(() => auth.user?.id, (id) => sharing.adoptAccount(id), { immediate: true });
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
  [
    () => route.query.source,
    () => route.query.week,
    () => route.query.widgetSemester,
    () => route.query.widgetWeek,
  ],
  ([source, targetWeek]) => {
    if (source !== "widget" || targetWeek !== "current") return;
    widgetCurrentWeekIntentPending.value = true;
    // immediate watcher 会在 setup 尚未执行完时触发；此时切周依赖的
    // slideDirection 等状态仍处于 TDZ，必须等 onMounted 完成初始化。
    if (scheduleMounted) applyWidgetCurrentWeekIntent();
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
  const key = availableScheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key, false);
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
const moreMenuView = ref<"menu" | "style" | "display" | "theme" | "background">("menu");
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

// 安卓小组件只读 App 写在本地的课表（docs/schedule-widget-rules.md 第 7 节）：
// 课表、校历、自定义课程有变化就按日期展开交给原生端。
let androidWidgetSyncTimer = 0;
function syncAndroidWidgetLocalDays() {
  androidWidgetSyncTimer = 0;
  if (disposed || !auth.isLoggedIn || !supportsAndroidScheduleWidgetLocalDays()) return;
  if (scheduleSource.value === "graduate-debug") return;
  const data = parsed.value;
  const source = calendar.value;
  if (!data?.currentSemester || !source?.weeks?.length) return;
  if (source.currentSemester && source.currentSemester !== data.currentSemester) return;
  // 小组件永远看当前学期；翻看往年学期时别把它换掉。
  const currentSemester = data.semesters?.find((item) => item.current)?.value;
  if (currentSemester && currentSemester !== data.currentSemester) return;
  const complete = data.scope === "semester" || scheduleStorageScope() === "graduate";
  const weeks = complete
    ? []
    : source.weeks.map((item) => Number(item.week)).filter((value) => Boolean(scheduleForWeek(value)));
  saveAndroidScheduleWidgetLocalDays(buildScheduleWidgetLocalRecord({
    semester: data.currentSemester,
    calendar: source,
    complete,
    weeks,
    blocksForWeek: (value) => weekCourseBlocksFor(value, complete ? data : scheduleForWeek(value)),
  }));
}
function queueAndroidWidgetLocalDaysSync() {
  if (!supportsAndroidScheduleWidgetLocalDays()) return;
  if (androidWidgetSyncTimer) window.clearTimeout(androidWidgetSyncTimer);
  androidWidgetSyncTimer = window.setTimeout(syncAndroidWidgetLocalDays, 400);
}
watch(
  () => [parsed.value, calendar.value, scheduleCacheStore.size, scheduleSource.value, auth.isLoggedIn],
  queueAndroidWidgetLocalDaysSync,
);
watch(scheduleEdits, queueAndroidWidgetLocalDaysSync, { deep: true });

// 情侣课表：已绑定时把当前学期课表（含自定义修改）同步给对方，见 docs/couple-schedule.md。
let coupleSyncTimer = 0;
function syncCoupleSchedule() {
  coupleSyncTimer = 0;
  if (disposed || loading.value || !auth.isLoggedIn || !auth.user?.id) return;
  if (scheduleSource.value === "graduate-debug") return;
  const data = parsed.value;
  const source = calendar.value;
  if (!data?.currentSemester || !source?.weeks?.length) return;
  if (source.currentSemester && source.currentSemester !== data.currentSemester) return;
  // 对方看到的永远是当前学期；翻看往年学期时不覆盖。
  const currentSemester = data.semesters?.find((item) => item.current)?.value;
  if (currentSemester && currentSemester !== data.currentSemester) return;
  const complete = data.scope === "semester" || scheduleStorageScope() === "graduate";
  void syncCoupleScheduleIfBound({
    userId: auth.user.id,
    semester: data.currentSemester,
    parsed: complete ? { ...data, scope: "semester" } : data,
    calendar: source,
    edits: scheduleEdits.value,
    loadSemesterSchedule: scheduleSource.value === "jwxt" ? () => loadSemesterCompleteSchedule(data.currentSemester) : undefined,
  });
}
function queueCoupleScheduleSync() {
  if (coupleSyncTimer) window.clearTimeout(coupleSyncTimer);
  // 等教务课表与自定义修改都加载完再同步，避免同一次打开上传两次。
  coupleSyncTimer = window.setTimeout(syncCoupleSchedule, 4000);
}
watch(() => [parsed.value, calendar.value, scheduleSource.value, auth.isLoggedIn], queueCoupleScheduleSync);
watch(scheduleEdits, queueCoupleScheduleSync, { deep: true });

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
  setScheduleWidgetTheme?: (theme: string) => void;
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
  // 旧版安卓壳没有这个方法，按有没有来调用。
  if (isAndroidNativeApp()) getAndroidWidgetBridge()?.setScheduleWidgetTheme?.(theme);
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
    if (!ready || disposed) {
      return;
    }
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
    }, { silent: background }));
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
    if (!disposed && !background && requestSeq === foregroundScheduleRequestSeq) {
      loading.value = false;
    }
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
  // iPad/iPhone Safari and HarmonyOS NEXT report a plain "web" platform but cannot install an APK.
  if (!canInstallAndroidApk()) return false;
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
  couple.start();
  void couple.refresh();
  // 旧的 /schedule/couple 链接和邀请链接都会带 couple=1 打开情侣课表弹窗。
  if (route.query.couple === "1") {
    const code = typeof route.query.code === "string" ? route.query.code : "";
    const { couple: _couple, code: _code, ...rest } = route.query;
    void router.replace({ query: rest });
    // 课表是公开页，进入时站内登录状态可能还没恢复完。
    void (async () => {
      if (!auth.user && auth.token) await auth.fetchMe().catch(() => undefined);
      if (!disposed) openCoupleDialog(code);
    })();
  }
  document.documentElement.classList.add("schedule-scroll-lock");
  document.body.classList.add("schedule-scroll-lock");
  jwxt.hydrate();
  scheduleSource.value = prefersGraduateIdentity.value ? "graduate" : "jwxt";
  scheduleMounted = true;
  syncNetworkStatus();
  restoreScheduleTheme();
  scheduleStyle.value = readStoredScheduleStyle();
  display.value = readStoredScheduleDisplay();
  tickNow();
  nowTimer = window.setInterval(tickNow, 20000);
  document.addEventListener("visibilitychange", tickNow);

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
    loading.value = false;
    return;
  }

  // 后台静默恢复：缓存保持可见，同时用本机加密保存的信息续回学校会话。
  // Restored data is already interactive. Session repair must not acquire the
  // foreground loading lock used by toolbar controls and swipe handlers.
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
      if (!disposed) {
        sessionChecking.value = false;
      }
    }
  })();
});

onBeforeUnmount(() => {
  disposed = true;
  couple.stop();
  if (androidWidgetSyncTimer) window.clearTimeout(androidWidgetSyncTimer);
  androidWidgetSyncTimer = 0;
  if (coupleSyncTimer) window.clearTimeout(coupleSyncTimer);
  coupleSyncTimer = 0;
  if (nowTimer) window.clearInterval(nowTimer);
  nowTimer = 0;
  document.removeEventListener("visibilitychange", tickNow);
  semesterLoader.clear();
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
  if (viewMode.value === "month") return monthSelectedDate.value === todayYmd.value;
  const cur = resolveScheduleCurrentWeek(calendar.value, parsed.value);
  if (!cur || String(cur) !== currentWeekValue()) return false;
  return viewMode.value === "week" || activeDay.value === dayOfWeek();
});
// MainLayout shows its web tab bar exactly on compact layouts, and native shells (always compact) own
// the chrome. The Flutter shell has no tab bar over /schedule, so it keeps the 退出 button.
const scheduleHasBottomTabbar = computed(() => !isFlutterNativeShell() && formFactor.value.compact);
const showScheduleExitButton = computed(() => !scheduleHasBottomTabbar.value);
const pageStyle = computed(() => ({
  ...scheduleThemeCssVars(scheduleTheme.value),
  ...(appearance.isDark ? scheduleThemeDarkCssVars(scheduleTheme.value) : {}),
  ...scheduleSurfaceCssVars({
    dark: appearance.isDark,
    hasBackground: hasScheduleBackground.value,
    overlayOpacity: scheduleBackground.overlayOpacity,
  }),
  // 素笺和站牌自带页面色；设了背景图就让位给图片。
  ...(styleCanvasCss.value ? {
    "--schedule-page-bg": styleCanvasCss.value,
    "--schedule-bg-overlay": styleCanvasCss.value,
  } : {}),
  ...scheduleStyleCssVars({
    style: scheduleStyle.value,
    palette: scheduleTheme.value,
    dark: appearance.isDark,
    hasBackground: hasScheduleBackground.value,
    backgroundVisibility: backgroundVisibility.value / 100,
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
  viewMode.value === "month"
    ? `month:${monthKey.value}`
    : viewMode.value === "week"
      ? `week:${currentWeekValue()}`
      : `day:${currentWeekValue()}:${activeDay.value}`
));
/** 周日排在首列时，周日那一列是上一个教学周的周日；`sundayWeek` 记下它属于哪一周（没有上一周时是空字符串）。 */
type WeekPage = SchedulePageModel & { sundayWeek?: string };

function withLeadingSunday(page: SchedulePageModel): WeekPage {
  const previous = nextWeekValueFrom(page.weekValue, -1);
  const sunday = previous
    ? weekCourseBlocksFor(Number(previous), scheduleForWeek(previous)).filter((block) => block.day === 7)
    : [];
  const blocks = [...page.weekCourseBlocks.filter((block) => block.day !== 7), ...sunday]
    .sort((a, b) => a.startSlot - b.startSlot || a.day - b.day || a.index - b.index);
  const leading: WeekPage = { ...page, sundayWeek: previous, weekCourseBlocks: blocks, courseCount: blocks.length };
  const date = pageDate(leading, 7);
  leading.dayTabs = page.dayTabs.map((tab) => (
    tab.day === 7 ? { ...tab, date: shortDate(date), isToday: Boolean(date) && date === todayYmd.value } : tab
  ));
  return leading;
}

function weekValueFor(page: WeekPage, day: number) {
  return day === 7 && page.sundayWeek !== undefined ? page.sundayWeek : page.weekValue;
}

const carouselPages = computed<WeekPage[]>(() => {
  const deltas = useStaticWeekSwipe.value ? [0] : [-1, 0, 1];
  return deltas.map((delta) => {
    const model = viewMode.value === "week" ? weekPageModel(delta) : dayPageModel(delta);
    const page = viewMode.value === "week" && display.value.sundayFirst ? withLeadingSunday(model) : model;
    // 合并连续节次时备注会被换成节次范围；把自己写的备注放回去，给速览和编辑器用。
    return {
      ...page,
      weekCourseBlocks: withOwnCourseNotes(page.weekCourseBlocks, scheduleEdits.value),
      dayCourseBlocks: withOwnCourseNotes(page.dayCourseBlocks, scheduleEdits.value),
    };
  });
});

// 情侣课表叠加层：TA 的课按日期对齐到当前网格，见 docs/couple-schedule.md。
// `split`：和对方的课撞在同一时段的课（"me|…" 是我的，"ta|…" 是 TA 的），只有这些才左右各占半格。
type CouplePageData = { partnerBlocks: WeekCourseBlock[]; shared: Set<string>; split: Set<string> };
const EMPTY_COUPLE_PAGE: CouplePageData = { partnerBlocks: [], shared: new Set(), split: new Set() };
function coupleBlockKey(block: WeekCourseBlock) {
  return `${block.day}|${block.startSlot}|${block.endSlot}|${block.course.name.replace(/\s+/gu, "")}`;
}
const couplePageData = computed(() => {
  const pages = new Map<string, CouplePageData>();
  if (!couple.active.value) return pages;
  const reader = couple.partnerReader.value;
  for (const page of carouselPages.value) {
    const days = viewMode.value === "week" ? [1, 2, 3, 4, 5, 6, 7] : [page.day];
    const data: CouplePageData = { partnerBlocks: [], shared: new Set(), split: new Set() };
    for (const day of days) {
      const date = pageDate(page, day);
      const theirs = date ? reader.blocksForDate(date) : null;
      if (!theirs) continue;
      const mine = page.weekCourseBlocks.filter((block) => block.day === day);
      const mineKeys = new Set(mine.map(coupleBlockKey));
      for (const block of theirs) {
        const placed = { ...block, day };
        // 同一节同一门课（一起上的课）只画一格。
        if (mineKeys.has(coupleBlockKey(placed))) {
          data.shared.add(coupleBlockKey(placed));
          continue;
        }
        data.partnerBlocks.push(placed);
        for (const own of mine) {
          if (own.startSlot > placed.endSlot || placed.startSlot > own.endSlot) continue;
          data.split.add(`me|${coupleBlockKey(own)}`);
          data.split.add(`ta|${coupleBlockKey(placed)}`);
        }
      }
    }
    pages.set(page.key, data);
  }
  return pages;
});
function coupleDataFor(page: SchedulePageModel) {
  return couplePageData.value.get(page.key) ?? EMPTY_COUPLE_PAGE;
}
function isCoupleShared(page: SchedulePageModel, block: WeekCourseBlock) {
  return coupleDataFor(page).shared.has(coupleBlockKey(block));
}
function isCoupleSplit(page: SchedulePageModel, block: WeekCourseBlock, owner: "me" | "ta") {
  return coupleDataFor(page).split.has(`${owner}|${coupleBlockKey(block)}`);
}
/** TA 和我这门课撞在同一时段的课：不另画一格，写在我的课下面。 */
function coupleClashesFor(page: SchedulePageModel, block: WeekCourseBlock) {
  if (!isCoupleSplit(page, block, "me")) return [];
  return coupleDataFor(page).partnerBlocks.filter((other) => (
    other.day === block.day && other.startSlot <= block.endSlot && block.startSlot <= other.endSlot
  ));
}
/** TA 单独占一格的课：和我的课撞在一起的那些已经写在我的课下面了。 */
function couplePartnerTilesFor(page: SchedulePageModel) {
  return coupleDataFor(page).partnerBlocks.filter((block) => !isCoupleSplit(page, block, "ta"));
}
function coupleNoteStyle(block: WeekCourseBlock) {
  const tone = coupleTone("ta", block.course.name);
  return { background: tone.bg, color: tone.text, borderColor: tone.border };
}
const coupleBound = computed(() => couple.status.value?.status === "active");
const coupleBarStyle = computed(() => {
  const value = couple.status.value;
  if (value?.status !== "active") return {};
  return {
    "--couple-partner-color": coupleCourseTone(value.partner.color, "", appearance.isDark).border,
  };
});
const canShowInstallAction = computed(() => Boolean(installPromptRef.value && (installPromptRef.value as any).canShow));
function runMoreAction(action: () => unknown) {
  moreMenuOpen.value = false;
  void action();
}
const coupleBarText = computed(() => {
  const value = couple.status.value;
  if (value?.status !== "active") return "";
  const name = value.partner.nickname || "TA";
  const now = couple.partnerNow.value;
  switch (now.kind) {
    case "no-data": return `${name} 还没有同步课表`;
    case "out-of-term": return `${name} 今天不在学期内`;
    case "free-day": return `${name} 今天没有课`;
    case "in-class": return `${name} 在上《${now.current.course.name}》· ${now.current.end} 下课`;
    case "between": return `${name} 下一节《${now.next.course.name}》· ${now.next.start}`;
    case "done": return `${name} 今天的课都上完了`;
  }
});
function onPartnerCourseClick(event: Event, block: WeekCourseBlock) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) {
    event.preventDefault();
    return;
  }
  const value = couple.status.value;
  const name = value?.status === "active" ? value.partner.nickname || "TA" : "TA";
  openQuickLook(block, currentWeekValue(), { ownerLabel: `${name} 的课`, canEdit: false });
}
function openCoupleDialog(code = "") {
  moreMenuOpen.value = false;
  if (!auth.isLoggedIn) {
    ElMessage.info("登录后才能使用情侣课表");
    void router.push({ name: "login", query: { redirect: "/schedule?couple=1" } });
    return;
  }
  coupleInviteCode.value = code;
  couple.dialogOpen.value = true;
}
const coupleInviteCode = ref("");
function onCoupleStatusChanged(next: string) {
  // 刚绑定时立即同步自己的课表，TA 马上就能看到。
  if (next === "active") {
    if (coupleSyncTimer) window.clearTimeout(coupleSyncTimer);
    coupleSyncTimer = window.setTimeout(syncCoupleSchedule, 300);
  }
}

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

async function manualRefreshSchedule() {
  try {
    await refreshCurrentSchedule();
  } catch {
    ElMessage.warning("课表刷新失败，请检查网络连接后重试。");
  }
}

const shareSemester = computed(() => semester.value || parsed.value?.currentSemester || "");
const shareSemesterLabel = computed(() => (
  semesters.value.find((item) => item.value === shareSemester.value)?.label?.trim() || shareSemester.value || "当前学期"
));
const canPublishShare = computed(() => Boolean(
  parsed.value && calendar.value?.weeks?.length && scheduleSource.value !== "graduate-debug",
));

function openSharingDialog() {
  sharing.adoptAccount(auth.user?.id);
  sharingDialogOpen.value = true;
}

function openSharedSchedule(code: string) {
  void router.push(`/schedule/share/${code}`);
}

async function buildShareBody() {
  if (!parsed.value || !calendar.value) throw new Error("课表还没有加载完，请刷新课表后再试");
  await loadScheduleEdits();
  let source = parsed.value;
  // The normal page request is weekly for fast navigation. A share must be
  // semester-complete so the reader can move through every teaching week.
  if (scheduleSource.value === "jwxt" && source.scope !== "semester") {
    source = await loadSemesterCompleteSchedule(semester.value || source.currentSemester);
  }
  const body = buildSharePublishBody({
    semester: semester.value || parsed.value.currentSemester,
    schedule: { ...source, cells: applyScheduleEditsToCells(source.cells, scheduleEdits.value) },
    calendar: calendar.value,
    ownerName: auth.user?.nickname,
  });
  if (!body.schedule.cells.length) throw new Error("这个学期没有课程，没有可以分享的内容");
  return body;
}

async function loadSemesterCompleteSchedule(targetSemester: string) {
  const all = await jwxt.withSessionRetry(() => jwxtApi.schedule(
    { semester: targetSemester, week: "all" },
    { silent: true },
  ));
  return all.parsed;
}

async function loadSchedule(force = false, background = false) {
  if (disposed) return;
  const hadCache = !force && restoreScheduleCache();
  if (hadCache && parsed.value?.scope === "semester" && !isStale(scheduleSavedAt.value)) return;
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
    if (!ready || disposed) {
      return;
    }
  }
  const requestSeq = ++scheduleRequestSeq;
  const requestedSemester = semester.value || parsed.value?.currentSemester || "";
  const requestedWeek = week.value || "";
  if (!background) {
    foregroundScheduleRequestSeq = requestSeq;
    loading.value = !parsed.value || force || !hadCache;
  }
  try {
    const r = await semesterLoader.load(requestedSemester, requestedWeek, force);
    if (disposed) return;
    if (!isCurrentScheduleRequest(requestSeq, requestedSemester, r.parsed.scope === "semester" ? "" : requestedWeek)) {
      return;
    }
    scheduleSource.value = "jwxt";
    graduateSourceMeta.value = null;
    parsed.value = r.parsed;
    if (r.calendar) {
      calendar.value = hydrateCalendar(r.calendar as CalendarResult);
      writeCache(calendarCacheKey(r.parsed.currentSemester), calendar.value);
    }
    if (!semester.value) semester.value = parsed.value?.currentSemester ?? "";
    if (!week.value) week.value = currentWeekValue();
    loadScheduleEdits();
    scheduleSavedAt.value = Date.parse(r.syncedAt || "") || Date.now();
    saveScheduleCache();
    saveLastState();
  } catch (error) {
    if (!isCurrentScheduleRequest(requestSeq, requestedSemester, requestedWeek)) return;
    if (!hadCache && !canFallbackToVisibleSchedule) throw error;
  } finally {
    if (!disposed && !background && requestSeq === foregroundScheduleRequestSeq) {
      loading.value = false;
    }
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
  const key = availableScheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key, false);
    return;
  }
  await refreshScheduleForCurrentSource();
}

const canJumpToCurrentWeek = computed(() => {
  const cur = resolveScheduleCurrentWeek(calendar.value, parsed.value);
  return Boolean(cur && String(cur) !== week.value);
});

async function jumpToToday() {
  if (viewMode.value === "month") {
    selectMonthDate(todayKey(), true);
    return;
  }
  if (viewMode.value === "week") {
    await jumpToCurrentWeek();
    return;
  }
  viewMode.value = "day";
  if (!resolveScheduleCurrentWeek(calendar.value, parsed.value)) {
    slideDirection.value = dayOfWeek() >= activeDay.value ? "next" : "prev";
    activeDay.value = dayOfWeek();
    saveLastState();
    return;
  }
  await jumpToCurrentWeek();
}

async function jumpToCurrentWeek() {
  const cur = resolveScheduleCurrentWeek(calendar.value, parsed.value);
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
  const key = availableScheduleCacheKey(semester.value || parsed.value?.currentSemester, week.value);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key, false);
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

function setViewMode(mode: PageViewMode) {
  if (mode === "month" && viewMode.value !== "month") enterMonthView();
  // 从月视图回到日视图或周视图时，停在月历上选中的那一天所在的周。
  const selected = mode !== "month" && viewMode.value === "month" ? dateIndex.value.get(monthSelectedDate.value) : undefined;
  viewMode.value = mode;
  if (selected) {
    activeDay.value = selected.day;
    if (String(selected.week) !== week.value) {
      selectWeek(selected.week);
      activeDay.value = selected.day;
    }
  }
  saveLastState();
}

function onCourseBlockClick(event: Event, block: WeekCourseBlock, targetWeek = week.value) {
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
  openQuickLook(block, targetWeek);
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
  compactViewport.value = window.matchMedia?.("(max-width: 760px)").matches ?? width <= 760;
}

function syncNetworkStatus() {
  offlineMode.value = navigator.onLine === false;
}

function scheduleForWeek(weekValue: string | number) {
  const requested = String(weekValue || "");
  if (parsed.value && parsed.value.currentSemester === semester.value
    && (parsed.value.scope === "semester" || scheduleStorageScope() === "graduate")) return parsed.value;
  const cached = cachedScheduleEnvelopeForWeek(requested);
  return cached?.data ?? (requested === parsed.value?.currentWeek ? parsed.value : null);
}

function cachedScheduleEnvelopeForWeek(weekValue: string | number) {
  const key = availableScheduleCacheKey(semester.value || parsed.value?.currentSemester, String(weekValue || ""));
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

let editorMessage: { close: () => void } | null = null;

function showEditorMessage(type: "success" | "warning" | "error", message: string) {
  // 保存失败的提示要顶掉刚弹出的“已保存”，两条不能并排挂着。
  editorMessage?.close();
  editorMessage = ElMessage({ type, message, offset: 96 });
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
  resetEditorArrangements();
  editorPreferred.value = false;
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
  resetEditorArrangements();
  editorPreferred.value = schedulePriorityValue(block.course.name, schedulePriority.value) > 0;
  editDialogOpen.value = true;
}

function saveCourseEdit(keepAsCustom = false) {
  if (courseEditBusy.value) return;
  const name = customCourseForm.name.trim();
  if (!name) {
    showEditorMessage("warning", "请填写课程名称");
    return;
  }
  const drafts = editorArrangements.value;
  const resolved: CourseArrangement[] = [];
  for (const [index, draft] of drafts.entries()) {
    const title = drafts.length > 1 ? `上课时间 ${index + 1}：` : "";
    const slots = draft.slots.filter((slot) => slot >= 1 && slot <= MAX_SMALL_SLOT);
    if (!slots.length) {
      showEditorMessage("warning", `${title}请选择至少一节`);
      return;
    }
    const weekList = arrangementWeekList(draft);
    if (draft.weekMode === "custom" && !weekList.length) {
      showEditorMessage("warning", `${title}请选择周次`);
      return;
    }
    resolved.push({ day: draft.day, slots, weekList });
  }
  if (!resolved.length) return;
  courseEditAction.value = "save";
  try {
    const editingBlock = editingCourseBlock.value;
    const existing = editingBlock?.course.customId
      ? scheduleEdits.value.custom.find((item) => item.id === editingBlock.course.customId)
      : null;
    // 第一段保留正在编辑的那一块的身份；其余每一段都按同一门课存成普通的自定义条目，
    // 所以其他客户端不用改就能读。
    const [primary, ...extras] = arrangementCustomItems({
      details: {
        name,
        teacher: customCourseForm.teacher,
        location: customCourseForm.location,
        note: customCourseForm.note,
      },
      arrangements: resolved,
      primaryId: existing?.id || createCustomCourseId(),
      primarySourceKey: existing ? existing.sourceKey : editingCourseKey.value,
    });
    const nextPriority = schedulePriorityKnown
      ? withCoursePreferred(schedulePriority.value, name, editorPreferred.value)
      : schedulePriority.value;
    const priorityChanged = JSON.stringify(nextPriority) !== JSON.stringify(schedulePriority.value);
    const unchanged = Boolean(editingBlock) && !extras.length
      && isOriginalCourseEditUnchanged(editingBlock!, primary, weekNumberOptions.value);
    if (unchanged && !priorityChanged) {
      editDialogOpen.value = false;
      showEditorMessage("success", "课程没有变化，无需保存");
      return;
    }
    if (!unchanged) {
      let next = saveCustomCourseEdit(scheduleEdits.value, primary, {
        editingBlock,
        editingCourseKey: editingCourseKey.value,
        courseFamilyKey,
        courseFamilySourceKeys,
      });
      if (extras.length) {
        const ids = new Set(extras.map((item) => item.id));
        next = { ...next, custom: [...next.custom.filter((item) => !ids.has(item.id)), ...extras] };
      }
      if (keepAsCustom) next = keepScheduleCourseAsCustom(next, primary.id);
      scheduleEdits.value = next;
    }
    schedulePriority.value = nextPriority;
    persistScheduleEdits();
    editDialogOpen.value = false;
    showEditorMessage("success", keepAsCustom ? "已保留为自定义课程" : editingCourseBlock.value ? "已保存课程" : "已添加到课表");
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
    const confirmed = await ElMessageBox.confirm(
      "将移除这份个人编辑，显示当前教务课表中的安排。如果当前教务课表没有这门课，个人副本也会从课表移除。",
      "使用教务安排", {
      confirmButtonText: "使用教务安排",
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
    showEditorMessage("success", "已移除个人编辑，使用教务安排");
  } finally {
    if (courseEditAction.value === "restore") courseEditAction.value = "";
  }
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
    schedulePriority.value = {};
    schedulePriorityKnown = false;
    return Promise.resolve();
  }
  if (scheduleEditsLoadPromise) return scheduleEditsLoadPromise;
  const sem = semester.value || parsed.value?.currentSemester || "current";
  scheduleEditsLoadPromise = (async () => {
    try {
      const r = await jwxtApi.getScheduleEdits(sem, { silent: true });
      if (disposed) return;
      scheduleEdits.value = normalizeScheduleEditsState(r.edits);
      schedulePriority.value = normalizeSchedulePriority(r.edits.priority) ?? {};
      schedulePriorityKnown = true;
    } catch {
      if (disposed) return;
      scheduleEdits.value = emptyScheduleEdits();
      schedulePriority.value = {};
      schedulePriorityKnown = false;
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
    edits: {
      ...normalizeScheduleEditsState(scheduleEdits.value),
      // 课表编辑是整份覆盖的：读到过优先级才带上它，没读到就不带，服务端沿用已保存的。
      ...(schedulePriorityKnown ? { priority: { ...schedulePriority.value } } : {}),
    },
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
  const seq = ++scheduleEditsSaveSeq;
  void jwxtApi.saveScheduleEdits({ semester: pending.semester, edits: pending.edits }, { silent: true })
    .catch(() => {
      // 保存是整份覆盖的：后面还有一次保存在排队或在途时，由那一次的结果说了算。
      if (pendingScheduleEditsSave || seq !== scheduleEditsSaveSeq) return;
      showEditorMessage("error", "这次课表修改没有保存成功，请稍后重试");
      // 界面上是先改后存的，存失败就换回云端实际保存的内容，不留一份看似已保存的修改。
      void loadScheduleEdits();
    });
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

// 双人模式下一个人一种颜色：我的课全用我的颜色，TA 的课全用 TA 的颜色，不再一门课一个色，
// 一眼就能分出谁是谁。关掉「显示 TA 的课」后回到平时的配色。
function coupleTone(owner: "me" | "ta", name: string) {
  const value = couple.status.value;
  if (!couple.active.value || value?.status !== "active") return toneFor(name);
  return coupleCourseTone(owner === "ta" ? value.partner.color : value.me.color, "", appearance.isDark);
}
const coupleMyColor = computed(() => {
  const value = couple.status.value;
  return value?.status === "active" ? value.me.color : "blue";
});
/** 月视图里 TA 每天有几门课。 */
const monthPartnerCounts = computed(() => {
  const counts: Record<string, number> = {};
  if (!couple.active.value || viewMode.value !== "month") return counts;
  const reader = couple.partnerReader.value;
  for (const item of monthDays.value) {
    const total = new Set((reader.blocksForDate(item.date) ?? []).map((block) => block.course.name)).size;
    if (total) counts[item.date] = total;
  }
  return counts;
});
const monthPartnerTone = computed(() => {
  if (!couple.active.value) return null;
  const tone = coupleTone("ta", "");
  return { accent: tone.text, fill: tone.bg };
});
const monthOwnTone = computed(() => {
  if (!couple.active.value) return null;
  const tone = coupleTone("me", "");
  return { accent: tone.text, fill: tone.bg };
});
const couplePartnerName = computed(() => {
  const value = couple.status.value;
  return value?.status === "active" ? value.partner.nickname || "TA" : "TA";
});
const couplePartnerColor = computed(() => {
  const value = couple.status.value;
  return value?.status === "active" ? value.partner.color : "pink";
});

type DrawnBlock = WeekCourseBlock | PlacedCourseBlock;

function drawnBlockOf(item: DrawnBlock) {
  return "block" in item ? item.block : item;
}

// 并排的重叠课程按所在的道分宽度。
function laneStyle(item: DrawnBlock) {
  if (!("block" in item) || item.lanes <= 1) return {};
  const share = 100 / item.lanes;
  return {
    justifySelf: "start",
    width: `calc(${share}% - 2px)`,
    marginLeft: `calc(${share * item.lane}% + 1px)`,
  };
}

function courseBlockStyle(item: DrawnBlock, owner: "me" | "ta" = "me", shared = false, page?: WeekPage) {
  const block = drawnBlockOf(item);
  const colors = coupleTone(owner, block.course.name);
  // 关掉周末或把周日挪到首列以后，星期几不再等于第几列。
  const column = page ? columnsFor(page).indexOf(block.day) + 2 : block.day + 1;
  return {
    ...(column < 2 ? { display: "none" } : {}),
    gridColumn: `${column} / ${column + 1}`,
    gridRow: `${item.startSlot} / ${item.endSlot + 1}`,
    ...laneStyle(item),
    "--course-bg": colors.bg,
    "--course-border": colors.border,
    "--course-text": colors.text,
  };
}

function dayCourseBlockStyle(item: DrawnBlock) {
  const block = drawnBlockOf(item);
  const colors = coupleTone("me", block.course.name);
  return {
    gridColumn: "2 / 3",
    gridRow: `${item.startSlot} / ${item.endSlot + 1}`,
    ...laneStyle(item),
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
  viewMode.value = (state.viewMode as string) === "month" ? "month" : resolveScheduleViewMode(state.viewMode);
}

function saveLastState() {
  writeStoredLastState(lastStateCacheKey(), {
    semester: semester.value,
    week: week.value,
    activeDay: activeDay.value,
    // 旧版本读到不认识的值会回到周视图。
    viewMode: viewMode.value as ViewMode,
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

function availableScheduleCacheKey(sem = semester.value, wk = week.value) {
  const completeKey = scheduleCacheKey(sem, "all");
  const complete = scheduleCacheStore.get(completeKey) ?? readCache<ScheduleResult>(completeKey);
  if (complete?.data?.scope === "semester" && complete.data.currentSemester === sem) return completeKey;
  return scheduleCacheKey(sem, wk);
}

function restoreScheduleCache() {
  const key = availableScheduleCacheKey();
  return applyScheduleCache(key) || (!parsed.value && restoreLastScheduleCache());
}

function applyScheduleCache(key: string, reloadEdits = true) {
  if (!key) return false;
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (!cached?.data) return false;
  const semesterChanged = parsed.value?.currentSemester !== cached.data.currentSemester;
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
  semesterLoader.select(cached.data.currentSemester, week.value);
  if (reloadEdits || semesterChanged) loadScheduleEdits();
  return true;
}

function saveScheduleCache() {
  if (!parsed.value) return;
  const key = scheduleCacheKey(parsed.value.currentSemester || semester.value, parsed.value.scope === "semester" ? "all" : week.value || parsed.value.currentWeek);
  if (scheduleStorageScope() === "undergraduate") {
    const previous = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
    notifyOfficialScheduleChange(previous?.data, parsed.value);
  }
  writeScheduleCache(key, parsed.value);
  const lastKey = lastScheduleCacheKey();
  writeStoredLastScheduleCacheKey(lastKey, key);
}

// MARK: 课表风格

const currentStyleTitle = computed(() => (
  scheduleStyleOptions.find((item) => item.key === scheduleStyle.value)?.title ?? "经典"
));
// 经典样式保留自己的画法。双人模式的日视图是「我 | TA」两列对照，也沿用经典的网格。
const usesClassicDay = computed(() => scheduleStyle.value === "classic");

/** 双人模式的日视图交给风格网格画：一天一列，带上 TA 的课。 */
function coupleDayFor(page: SchedulePageModel): StyledDay[] {
  const data = coupleDataFor(page);
  const own = dayPiecesFor(page);
  const rawDate = pageDate(page);
  const adjustment = rawDate ? calendar.value?.adjustments?.find((item) => item.date === rawDate) : undefined;
  return [{
    day: page.day,
    dateText: page.dayTabs[page.day - 1]?.date ?? "",
    rawDate,
    isToday: pageIsToday(page),
    adjustmentKind: adjustment?.kind ?? null,
    pieces: own,
    partnerPieces: placeCourseBlocks(data.partnerBlocks.filter((block) => block.day === page.day)),
    sharedIds: new Set(own.filter((piece) => data.shared.has(coupleBlockKey(piece.block))).map((piece) => piece.id)),
  }];
}
const styleCanvasCss = computed(() => {
  if (hasScheduleBackground.value) return "";
  const canvas = scheduleStyleCanvas(scheduleStyle.value, appearance.isDark);
  return canvas ? rgbToCss(canvas) : "";
});
const hasStyleCanvas = computed(() => Boolean(styleCanvasCss.value));

function selectScheduleStyle(value: ScheduleStyleKey) {
  scheduleStyle.value = value;
  writeStoredScheduleStyle(value);
}

// MARK: 现在

function tickNow() {
  nowMinutes.value = shanghaiMinutes();
  todayYmd.value = todayKey();
}

const nowClockText = computed(() => (nowMinutes.value === null ? "" : formatClock(nowMinutes.value)));

/** 经典周视图里「现在」的位置：今天在这一页时才有。 */
function classicNowFor(page: SchedulePageModel) {
  if (displayNowMinutes.value === null) return null;
  const today = page.dayTabs.find((tab) => tab.isToday);
  if (!today) return null;
  const column = columnsFor(page).indexOf(today.day);
  if (column < 0) return null;
  const position = nowRowPosition(displayNowMinutes.value, smallSlots);
  if (!position) return null;
  return {
    column: column + 1,
    row: position.row,
    style: { top: position.inGap ? "-2px" : `${position.fraction * 100}%` },
  };
}

// MARK: 课程排布

// 按显示优先级排好每一页的课程：优先级更高的课盖住它和别的课共用的节次，
// 优先级相同的并排分道。
const pagePieces = computed(() => {
  const pieces = new Map<string, PlacedCourseBlock[]>();
  for (const page of carouselPages.value) {
    pieces.set(page.key, placeCourseBlocks(page.weekCourseBlocks, schedulePriority.value));
  }
  return pieces;
});

function piecesFor(page: SchedulePageModel) {
  return pagePieces.value.get(page.key) ?? [];
}

function dayPiecesFor(page: SchedulePageModel) {
  return piecesFor(page).filter((piece) => piece.block.day === page.day);
}

function pageDate(page: WeekPage, day = page.day) {
  const days = normalizeCalendarWeekDays(weekInfoFor(page.weekValue)?.days ?? []);
  const valid = (value: string) => (/^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : "");
  // 排在首列的周日是周一的前一天。
  if (day === 7 && page.sundayWeek !== undefined) {
    const monday = valid(days[0] ?? "");
    return monday ? addDaysToCalendarYmd(monday, -1) : "";
  }
  return valid(days[day - 1] ?? "");
}

// MARK: 显示设置

const displayCourseSwitches: Array<{ key: "compact" | "showTeacher" | "showOffWeek"; label: string }> = [
  { key: "compact", label: "紧凑排版" },
  { key: "showTeacher", label: "显示老师" },
  { key: "showOffWeek", label: "显示非本周课程" },
];
const displayGridSwitches: Array<{
  key: "showSlotTime" | "highlightNow" | "showBackToWeek" | "showSaturday" | "showSunday" | "sundayFirst";
  label: string;
}> = [
  { key: "showSlotTime", label: "显示节次时间" },
  { key: "highlightNow", label: "高亮当前节次" },
  { key: "showBackToWeek", label: "显示回到本周按钮" },
  { key: "showSaturday", label: "显示周六" },
  { key: "showSunday", label: "显示周日" },
  { key: "sundayFirst", label: "周日排在首列" },
];
const displayIsDefault = computed(() => isDefaultScheduleDisplay(display.value));
const displayNowMinutes = computed(() => (display.value.highlightNow ? nowMinutes.value : null));
const displayStyle = computed(() => ({
  "--sd-row-scale": String(display.value.rowHeight / 100),
  "--sd-text-scale": String(scheduleDisplayTextScale(display.value)),
}));

function updateDisplay(patch: Partial<ScheduleDisplaySettings>) {
  display.value = normalizeScheduleDisplay({ ...display.value, ...patch });
  writeStoredScheduleDisplay(display.value);
}

function resetDisplay() {
  updateDisplay({ ...DEFAULT_SCHEDULE_DISPLAY });
}

function onDisplayRowHeightInput(event: Event) {
  updateDisplay({ rowHeight: Number((event.target as HTMLInputElement).value) });
}

/** 每一页从左到右画哪几天。 */
const pageColumns = computed(() => {
  const pages = new Map<string, number[]>();
  const adjustments = calendar.value?.adjustments ?? [];
  for (const page of carouselPages.value) {
    const partner = coupleDataFor(page).partnerBlocks;
    pages.set(page.key, scheduleWeekColumns(display.value, (day) => {
      if (page.weekCourseBlocks.some((block) => block.day === day)) return true;
      if (partner.some((block) => block.day === day)) return true;
      const date = pageDate(page, day);
      return Boolean(date) && adjustments.some((item) => item.kind === "swap" && item.date === date);
    }));
  }
  return pages;
});

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function columnsFor(page: SchedulePageModel) {
  return pageColumns.value.get(page.key) ?? ALL_WEEKDAYS;
}

function visibleTabsFor(page: SchedulePageModel) {
  return columnsFor(page).map((day) => page.dayTabs[day - 1]).filter(Boolean);
}

// 非本周的课只有拿到整学期课表时才挑得出来；按周返回的旧数据里没有别的周，这里自然是空的。
const pageOffWeekPieces = computed(() => {
  const pages = new Map<string, PlacedCourseBlock[]>();
  if (!display.value.showOffWeek || viewMode.value !== "week") return pages;
  const adjustments = calendar.value?.adjustments ?? [];
  for (const page of carouselPages.value) {
    const source = scheduleForWeek(page.weekValue);
    if (!source) continue;
    const all = withOwnCourseNotes(weekCourseBlocksFor(0, source), scheduleEdits.value);
    const taken = [...page.weekCourseBlocks, ...coupleDataFor(page).partnerBlocks];
    const blocks = selectOffWeekBlocks(all, taken, (day) => {
      // 放假和补班的那一天按日期另有安排，不往里填别的周的课。
      const date = pageDate(page, day);
      if (date && adjustments.some((item) => item.date === date)) return 0;
      return Number(weekValueFor(page, day) || 0);
    });
    pages.set(page.key, placeCourseBlocks(blocks));
  }
  return pages;
});

function offWeekPiecesFor(page: SchedulePageModel) {
  return pageOffWeekPieces.value.get(page.key) ?? [];
}

function clickSuppressed() {
  return dragState.suppressClick || dragState.dragging || dragState.settling;
}

function onWeekPageCourseClick(event: Event, page: WeekPage, block: WeekCourseBlock) {
  const target = weekValueFor(page, block.day);
  if (target === page.weekValue) {
    onCourseBlockClick(event, block, target);
    return;
  }
  // 首列的周日属于上一周：打开它，但不把整页翻到上一周去。
  event.stopPropagation();
  if (clickSuppressed()) {
    event.preventDefault();
    return;
  }
  if (target) openQuickLook(block, target);
}

function onWeekPageSlotClick(event: MouseEvent | null, page: WeekPage, day: number, slot: number) {
  const target = weekValueFor(page, day);
  if (target === page.weekValue) {
    if (event) onWeekSlotClick(event, day, slot, target);
    else onStyledSlotClick(day, slot, target);
    return;
  }
  if (clickSuppressed() || !target || !ensureScheduleEditEnabled()) return;
  void openAddCourse(day, slot, target);
}

function onStyledPageCourseClick(source: Event, block: WeekCourseBlock, owner: TileOwner, page: WeekPage) {
  if (owner === "ta") {
    onPartnerCourseClick(source, block);
    return;
  }
  onWeekPageCourseClick(source, page, block);
}

function onOffWeekCourseClick(event: Event, block: WeekCourseBlock, page: WeekPage) {
  event.stopPropagation();
  if (clickSuppressed()) {
    event.preventDefault();
    return;
  }
  openQuickLook(block, page.weekValue, { canEdit: false, ownerLabel: "这门课本周不上" });
}

function pageIsToday(page: SchedulePageModel) {
  return pageDate(page) === todayYmd.value;
}

function pageIsPast(page: SchedulePageModel) {
  const date = pageDate(page);
  return Boolean(date) && date < todayYmd.value;
}

/** 休息卡下面的说明：放假时写原因。 */
function dayEmptyNote(page: SchedulePageModel) {
  const date = pageDate(page);
  const adjustment = date ? calendar.value?.adjustments?.find((item) => item.date === date) : undefined;
  if (adjustment?.kind !== "off") return "";
  return adjustment.note ? `放假：${adjustment.note}` : "这一天放假";
}

const styledPageDays = computed(() => {
  const pages = new Map<string, StyledDay[]>();
  if (scheduleStyle.value === "classic" || viewMode.value !== "week") return pages;
  const adjustments = calendar.value?.adjustments ?? [];
  const coupled = couple.active.value;
  for (const page of carouselPages.value) {
    const pieces = piecesFor(page);
    const coupleData = coupleDataFor(page);
    const offWeek = offWeekPiecesFor(page);
    pages.set(page.key, visibleTabsFor(page).map((tab) => {
      const rawDate = pageDate(page, tab.day);
      const adjustment = rawDate ? adjustments.find((item) => item.date === rawDate) : undefined;
      const own = pieces.filter((piece) => piece.block.day === tab.day);
      return {
        day: tab.day,
        dateText: tab.date,
        rawDate,
        isToday: tab.isToday,
        adjustmentKind: adjustment?.kind ?? null,
        pieces: own,
        offWeekPieces: offWeek.filter((piece) => piece.block.day === tab.day),
        ...(coupled ? {
          partnerPieces: placeCourseBlocks(coupleData.partnerBlocks.filter((block) => block.day === tab.day)),
          sharedIds: new Set(own
            .filter((piece) => coupleData.shared.has(coupleBlockKey(piece.block)))
            .map((piece) => piece.id)),
        } : {}),
      };
    }));
  }
  return pages;
});

function styledDaysFor(page: SchedulePageModel) {
  return styledPageDays.value.get(page.key) ?? [];
}

// 双人模式按人配色，新样式的网格也用同一套。
const coupleToneResolver: TileToneResolver = (block, owner) => {
  if (!couple.active.value || couple.status.value?.status !== "active") return null;
  const tone = coupleTone(owner, block.course.name);
  return { accent: tone.text, fill: tone.bg, border: tone.border, accentInverse: tone.text };
};

function onStyledCourseClick(source: Event, block: WeekCourseBlock, owner: TileOwner, targetWeek: string) {
  if (owner === "ta") {
    onPartnerCourseClick(source, block);
    return;
  }
  onCourseBlockClick(source, block, targetWeek);
}

function onStyledSlotClick(day: number, slot: number, targetWeek: string) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) return;
  if (viewMode.value === "week" && targetWeek && targetWeek !== week.value) {
    week.value = targetWeek;
    saveLastState();
  }
  if (!ensureScheduleEditEnabled()) return;
  void openAddCourse(day, slot, targetWeek);
}

// MARK: 课程速览

const quickLook = ref<{ block: WeekCourseBlock; weekValue: string; canEdit: boolean; ownerLabel: string } | null>(null);
const quickLookLine = computed(() => (quickLook.value ? blockScheduleLine(quickLook.value.block, smallSlots) : ""));
const quickLookAccent = computed(() => {
  const name = quickLook.value?.block.course.name;
  if (!name) return "var(--schedule-accent)";
  if (scheduleStyle.value === "classic") {
    const tone = toneFor(name);
    return appearance.isDark ? tone.border : tone.text;
  }
  return scheduleStyleCourseTone(name, scheduleTheme.value, appearance.isDark).accent;
});

function openQuickLook(
  block: WeekCourseBlock,
  weekValue: string = currentWeekValue(),
  options: { ownerLabel?: string; canEdit?: boolean } = {},
) {
  quickLook.value = {
    block,
    weekValue: String(weekValue || currentWeekValue()),
    canEdit: options.canEdit ?? canUseScheduleEdit(),
    ownerLabel: options.ownerLabel ?? "",
  };
}

function editQuickLookCourse() {
  const current = quickLook.value;
  quickLook.value = null;
  if (current) void openCourseEditor(current.block, current.weekValue);
}

// MARK: 月视图

const dateIndex = computed(() => buildDateIndex(calendar.value));
const availableMonths = computed(() => calendarMonths(calendar.value));
const monthDays = computed(() => {
  if (viewMode.value !== "month" || !monthKey.value) return [];
  const byWeek = new Map<number, WeekCourseBlock[]>();
  return buildMonthDays({
    monthKey: monthKey.value,
    calendar: calendar.value,
    blocksFor: (weekNo, day) => {
      let blocks = byWeek.get(weekNo);
      if (!blocks) {
        blocks = withOwnCourseNotes(weekCourseBlocksFor(weekNo, scheduleForWeek(weekNo)), scheduleEdits.value);
        byWeek.set(weekNo, blocks);
      }
      return blocks.filter((block) => block.day === day);
    },
  });
});
const monthTitle = computed(() => {
  const match = monthKey.value.match(/^(\d{4})-(\d{2})$/u);
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : "--";
});
const monthWeekRange = computed(() => {
  const weekNumbers = monthDays.value.filter((item) => item.inMonth && item.slot).map((item) => item.slot!.week);
  if (!weekNumbers.length) return "";
  const first = Math.min(...weekNumbers);
  const last = Math.max(...weekNumbers);
  return first === last ? `第 ${first} 周` : `第 ${first}–${last} 周`;
});
const todayButtonLabel = computed(() => (
  viewMode.value === "month" ? "回到今天" : viewMode.value === "week" ? "回到本周" : "跳转到当日"
));

/** 校历覆盖不到的月份（假期）收回到离它最近的那个月。 */
function clampMonth(key: string) {
  const months = availableMonths.value;
  if (!months.length || months.includes(key)) return key;
  return key < months[0] ? months[0] : months[months.length - 1];
}

function selectMonthDate(date: string, follow = false) {
  const key = monthKeyOf(date);
  const target = clampMonth(key);
  if (target !== key) {
    // 今天不在这个学期里：停在离它最近的月份，不把日期选到学期外面去。
    if (follow) monthKey.value = target;
    return;
  }
  monthSelectedDate.value = date;
  monthKey.value = key;
}

function enterMonthView() {
  const dates = normalizeCalendarWeekDays(weekInfoFor(currentWeekValue())?.days ?? []);
  const today = todayKey();
  const shown = dates[activeDay.value - 1] ?? "";
  // 从日视图和周视图正在看的那一天开始；正在看的就是本周时从今天开始。
  const start = dates.includes(today) || !/^\d{4}-\d{2}-\d{2}$/u.test(shown) ? today : shown;
  monthSelectedDate.value = start;
  monthKey.value = clampMonth(monthKeyOf(start));
}

function canChangeMonth(delta: number) {
  const months = availableMonths.value;
  const index = months.indexOf(monthKey.value);
  return index >= 0 && index + delta >= 0 && index + delta < months.length;
}

function changeMonth(delta: number) {
  if (!canChangeMonth(delta)) return;
  const months = availableMonths.value;
  monthKey.value = months[months.indexOf(monthKey.value) + delta];
}

function onMonthSelect(date: string) {
  selectMonthDate(date);
}

function openMonthDay(date: string) {
  const slot = dateIndex.value.get(date);
  if (!slot) return;
  activeDay.value = slot.day;
  viewMode.value = "day";
  if (String(slot.week) === week.value) {
    saveLastState();
    return;
  }
  selectWeek(slot.week);
  // 研究生课表在切周时会把日期挪到有课的那天；这里要的是用户点的那一天。
  activeDay.value = slot.day;
  saveLastState();
}

// 进到月视图时校历可能还没恢复，换学期后月份也会不在新校历里。
watch([viewMode, availableMonths], () => {
  if (viewMode.value !== "month") return;
  const months = availableMonths.value;
  if (!monthKey.value || (months.length && !months.includes(monthKey.value))) enterMonthView();
}, { immediate: true });

// MARK: 导出日历

async function exportWeekCalendarFile() {
  const weekValue = currentWeekValue();
  const weekNo = Number(weekValue);
  const dates = normalizeCalendarWeekDays(weekInfoFor(weekValue)?.days ?? []).slice(0, 7);
  if (!weekNo || dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date)).length < 7) {
    ElMessage.warning("这一周还没有日期，暂时不能导出");
    return;
  }
  // 用的是课表已经按日期解析好的课程：放假那天没有课，补班那天是它实际上的课。
  const weekBlocks = withOwnCourseNotes(weekCourseBlocksFor(weekNo, scheduleForWeek(weekValue)), scheduleEdits.value);
  const blocks = placeCourseBlocks(weekBlocks, schedulePriority.value)
    .map((piece) => ({ ...piece.block, startSlot: piece.startSlot, endSlot: piece.endSlot }));
  if (!blocks.length) {
    ElMessage.info("这一周没有课程，没有可以导出的内容");
    return;
  }
  const content = buildWeekIcs({
    week: weekNo,
    days: dates.map((date, index) => ({ date, blocks: blocks.filter((block) => block.day === index + 1) })),
    clocks: smallSlots,
  });
  const result = await saveWeekIcs(content, weekIcsFileName(weekNo));
  if (result === "downloaded") ElMessage.success(`已导出第 ${weekNo} 周的日历文件，用日历应用打开即可导入`);
}

// MARK: 编辑器里的上课时间

// 一门课可以有几个上课时间，每个都能选不连续的节次。第一个是正在编辑的那一块。
interface ArrangementDraft {
  id: number;
  day: number;
  slots: number[];
  weekMode: "current" | "all" | "custom";
  weekList: number[];
}

const editorArrangements = ref<ArrangementDraft[]>([]);
// 和别的课重叠时把这门课显示在前面。
const editorPreferred = ref(false);
let arrangementSeq = 0;

function resetEditorArrangements() {
  const start = Math.min(customCourseForm.startSlot, customCourseForm.endSlot);
  const end = Math.max(customCourseForm.startSlot, customCourseForm.endSlot);
  editorArrangements.value = [{
    id: arrangementSeq += 1,
    day: customCourseForm.day,
    slots: Array.from({ length: end - start + 1 }, (_, index) => start + index),
    weekMode: customCourseForm.weekMode,
    weekList: [...customCourseForm.weekList],
  }];
}

function addArrangement() {
  if (courseEditBusy.value) return;
  const last = editorArrangements.value[editorArrangements.value.length - 1];
  editorArrangements.value.push({
    id: arrangementSeq += 1,
    day: last?.day ?? customCourseForm.day,
    slots: [],
    weekMode: last?.weekMode ?? "all",
    weekList: [...(last?.weekList ?? [])],
  });
}

function removeArrangement(id: number) {
  if (courseEditBusy.value) return;
  editorArrangements.value = editorArrangements.value.filter((item) => item.id !== id);
}

function toggleNumber(list: number[], value: number) {
  const set = new Set(list);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set].sort((a, b) => a - b);
}

function toggleArrangementSlot(arrangement: ArrangementDraft, slot: number) {
  if (courseEditBusy.value) return;
  arrangement.slots = toggleNumber(arrangement.slots, slot);
}

function toggleArrangementWeek(arrangement: ArrangementDraft, weekNo: number) {
  if (courseEditBusy.value) return;
  arrangement.weekList = toggleNumber(arrangement.weekList, weekNo);
}

function editorCurrentWeek() {
  return Number(editingWeekValue.value || activeWeekNumber.value || week.value) || 1;
}

function onArrangementWeekModeChange(arrangement: ArrangementDraft) {
  if (arrangement.weekMode === "all") arrangement.weekList = [...weekNumberOptions.value];
  else if (arrangement.weekMode === "current") arrangement.weekList = [editorCurrentWeek()];
}

function arrangementWeekList(arrangement: ArrangementDraft) {
  if (arrangement.weekMode === "all") return [...weekNumberOptions.value];
  if (arrangement.weekMode === "custom") {
    return [...new Set(arrangement.weekList.map(Number).filter(Boolean))].sort((a, b) => a - b);
  }
  return [editorCurrentWeek()];
}

// 用来找重叠的课：有整学期课表就用整学期的，否则用屏幕上这一周的。
const editorConflictCells = computed<ScheduleCell[]>(() => {
  if (!editDialogOpen.value) return [];
  const complete = scheduleCacheStore.get(scheduleCacheKey(semester.value || parsed.value?.currentSemester, "all"))?.data;
  const source = parsed.value?.scope === "semester"
    ? parsed.value
    : complete?.scope === "semester" ? complete : parsed.value;
  return applyScheduleEditsToCells(source?.cells ?? null, scheduleEdits.value);
});

/** 这个上课时间会压在哪些课上；正在编辑的这门课不算和自己重叠。 */
function arrangementConflictNames(arrangement: ArrangementDraft) {
  const editing = editingCourseBlock.value;
  const sameName = (value: string) => value.trim().replace(/\s+/gu, " ") === editing?.course.name.trim().replace(/\s+/gu, " ");
  return arrangementConflicts(
    // 「全部周」比较时算每周都上。
    { day: arrangement.day, slots: arrangement.slots, weekList: arrangement.weekMode === "all" ? [] : arrangementWeekList(arrangement) },
    editorConflictCells.value,
    (course, cell) => {
      if (!editing) return false;
      if (editing.course.customId) return course.customId === editing.course.customId;
      return !course.customId && cell.day === editing.day && sameName(course.name);
    },
  );
}

const editorOverlappingNames = computed(() => {
  // 优先级按课程名记，所以没法让一门课排在它自己前面。
  const own = customCourseForm.name.trim();
  const names: string[] = [];
  for (const arrangement of editorArrangements.value) {
    for (const name of arrangementConflictNames(arrangement)) {
      if (name !== own && !names.includes(name)) names.push(name);
    }
  }
  return names;
});

const editorPriorityHint = computed(() => (
  editorOverlappingNames.value.length
    ? `和${editorOverlappingNames.value.map((name) => `「${name}」`).join("")}重叠的节次只显示这门课，其他课程仍保留在课表里。`
    : "和别的课重叠时，重叠的节次只显示这门课。"
));
</script>

<style scoped>
.share-dialog-copy{margin:0 0 16px;color:var(--schedule-text-secondary);line-height:1.6;font-size:13px}.share-preview-line{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--schedule-border);font-size:13px}.share-preview-line span{color:var(--schedule-text-muted)}.share-code{margin:12px 0;text-align:center;color:var(--schedule-course-text);font:700 28px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px}
</style>
<style scoped lang="scss" src="./schedule/styles/schedule-shell.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-layout.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-grid.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-editor.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-responsive.scss"></style>
<style scoped lang="scss" src="./schedule/styles/schedule-couple.scss"></style>
