import SwiftUI
import Foundation
import UIKit

/// The native timetable surface. Data loading and authentication stay in
/// NativeScheduleStore so the SwiftUI surface can also be embedded beside the
/// existing web routes.
@available(iOS 17.0, *)
struct NativeScheduleView: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject private var store: NativeScheduleStore
    @ObservedObject private var preferences = NativeSchedulePreferences.shared
    @ObservedObject private var couple = NativeCoupleService.shared
    @ObservedObject private var styleSettings = NativeScheduleStyleSettings.shared
    private let onDeviceSettings: () -> Void
    private let onLogin: () -> Void
    private let isBackgroundPreview: Bool

    @State private var selectedDay = 1
    @State private var didInitializeDay = false
    @State private var viewMode: ScheduleViewMode = .week
    // Keep editing and adding in one presentation state. Two independent
    // `.sheet(item:)` modifiers can race when a course card overlaps the slot
    // grid, causing SwiftUI to show the add form for a real course.
    @State private var courseEditorPresentation: CourseEditorPresentation?
    @State private var weekPickerPresented = false
    @State private var scheduleToolsPresented = false
    @State private var backgroundEditorPresented = false
    @State private var stylePickerPresented = false
    @State private var sharingPresented = false
    @State private var couplePresented = false
    /// Two of the user's own courses in one period, to be pointed out once.
    @State private var overlapNotice: ScheduleOverlapNotice?
    /// The minute the partner's status line was last worked out for.
    @State private var coupleClock = Date()
    @State private var viewedShare: NativeSharedSchedule?
    @State private var scheduleToolsContentHeight: CGFloat = 0
    @State private var sharePayload: NativeScheduleSharePayload?
    // Native pagers own the horizontal pan and keep the current page under the
    // finger. The center page is restored after a transition commits the new
    // week/day to the store, so vertical scrolling never competes with a
    // hand-written DragGesture.
    @State private var weekPageSelection = 1
    @State private var dayPageSelection = 1
    @State private var weekPaging = false
    @State private var dayPaging = false
    @State private var weekTransitionToken = 0
    @State private var dayTransitionToken = 0
    @State private var monthAnchor = ""
    @State private var selectedMonthDate = ""
    @State private var pendingMonthDay: String?

    init(
        store: NativeScheduleStore,
        onLogin: @escaping () -> Void = {},
        onDeviceSettings: @escaping () -> Void = {},
        isBackgroundPreview: Bool = false
    ) {
        _store = ObservedObject(wrappedValue: store)
        self.onDeviceSettings = onDeviceSettings
        self.onLogin = onLogin
        self.isBackgroundPreview = isBackgroundPreview
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Keep the controls pinned while the timetable is being swiped.
            // The Web version treats this region as chrome outside its pager.
            if let result = store.result {
                scheduleHeader(result)
                    .padding(.horizontal, Self.contentInset)
                    .padding(.top, 8)
                    .padding(.bottom, 8)
                    .background {
                        if preferences.backgroundImage != nil {
                            NativeScheduleBackgroundSurface().ignoresSafeArea(edges: .top)
                        } else if let canvas = styleCanvas {
                            canvas.ignoresSafeArea(edges: .top)
                        } else {
                            Color(uiColor: .systemGroupedBackground)
                        }
                    }
                    .overlay(alignment: .bottom) { Divider() }
            }

            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 16) {
                    // A timetable already on screen is never replaced by a
                    // state card. Authorization and refresh problems appear as
                    // a banner above it instead.
                    if let result = store.result {
                        if isUnauthorized {
                            authorizationBanner
                        } else if !isLoading, let message = errorMessage {
                            errorBanner(message)
                        }

                        if viewMode == .day,
                           let adjustment = adjustment(day: selectedDay, week: weekNumber(store.selectedWeek), result: result) {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "calendar.badge.exclamationmark")
                                    .foregroundStyle(Color.orange)
                                Text("\(shortDate(adjustment.date)) \(ChineseCalendarInfo.weekdayLabel(adjustment.date) ?? "") · \(adjustmentDetail(adjustment))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                        }

                        if viewMode == .week {
                            weekGrid(result)
                                .padding(.horizontal, -Self.contentInset)
                        } else if viewMode == .day {
                            dayGrid(result)
                        } else {
                            monthCalendar(result)
                        }
                    } else if isUnauthorized {
                        authorizationState
                    } else if isLoading {
                        loadingState
                    } else if let message = errorMessage {
                        errorState(message)
                    } else {
                        loadingState
                    }
                }
                .padding(.horizontal, Self.contentInset)
                .padding(.top, 8)
                .padding(.bottom, 8)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background {
            // Paper and board bring their own page colour; a photo still wins.
            if preferences.backgroundImage == nil, let canvas = styleCanvas {
                canvas.ignoresSafeArea()
            } else {
                NativeScheduleBackground(image: preferences.backgroundImage,
                                         visibility: preferences.backgroundVisibility,
                                         blur: preferences.backgroundBlur)
                    .ignoresSafeArea()
            }
        }
        .environment(\.scheduleHasBackground, preferences.backgroundImage != nil)
        .environment(\.scheduleBackgroundVisibility, preferences.backgroundVisibility)
        .environment(\.scheduleStyle, style)
        .environment(\.scheduleCouple, coupleLayer)
        .environment(\.schedulePalette, preferences.palette)
        .environment(\.scheduleThemeBrand, ScheduleStyle.themeBrand(palette: preferences.palette))
        .task {
            viewMode = ScheduleViewMode(rawValue: preferences.defaultView) ?? .week
            adoptSelectionIfNeeded()
            if viewMode == .month { seedMonthSelection(store.result) }
#if DEBUG
            if !isBackgroundPreview,
               ProcessInfo.processInfo.environment["CPU_DEBUG_BACKGROUND_EDITOR"] == "1" {
                backgroundEditorPresented = true
            }
            // `CPU_DEBUG_SCHEDULE_ACTION` runs one action once the timetable has
            // loaded, so its result can be checked without tapping through:
            // `share-image`, `calendar-file`, `course-sheet`, `course-editor`, `style-picker`, `live-activity`,
            // `sharing` (the share-code page with sample state), `shared-view`
            // (a sample shared timetable, read-only), or against a real server
            // (see `connectDebugShareAPI`) `share-open`, `share-publish`, and
            // `share-import` or `share-import-view` with `CPU_DEBUG_SHARE_CODE`.
            // `CPU_DEBUG_COUPLE=active` binds the sample timetable to a sample
            // partner (`pending` shows an invite); the `couple` action opens the sheet.
            if !isBackgroundPreview, !isReadOnly,
               let state = ProcessInfo.processInfo.environment["CPU_DEBUG_COUPLE"] {
                for _ in 0..<40 where store.result == nil || store.calendar == nil {
                    try? await Task.sleep(for: .milliseconds(100))
                }
                if state == "pending" {
                    NativeCoupleService.shared.installDebugState(status: .pending(code: "K7M2QX", expired: false), partner: nil)
                } else if let result = store.result {
                    NativeCoupleService.shared.installDebugState(
                        status: .active(anniversary: "2025-05-20",
                                        me: CoupleMember(nickname: "阿青", color: "blue", syncedAt: "2026-10-08T01:30:00.000Z"),
                                        partner: CoupleMember(nickname: "小鹿", color: "pink", syncedAt: "2026-10-08T03:10:00.000Z")),
                        partner: debugPartnerSchedule(result)
                    )
                }
            }
            if !isBackgroundPreview, !isReadOnly,
               let action = ProcessInfo.processInfo.environment["CPU_DEBUG_SCHEDULE_ACTION"] {
                for _ in 0..<40 where store.result == nil {
                    try? await Task.sleep(for: .milliseconds(100))
                }
                // `CPU_DEBUG_SCHEDULE_PRIORITY` names the courses to show first, in order.
                if let names = ProcessInfo.processInfo.environment["CPU_DEBUG_SCHEDULE_PRIORITY"] {
                    let ordered = names.split(separator: ",").map { NativeSchedulePriority.key(String($0)) }
                    store.installDebugPriorities(Dictionary(
                        uniqueKeysWithValues: ordered.reversed().enumerated().map { ($1, $0 + 1) }
                    ))
                }
                if let result = store.result {
                    switch action {
                    case "couple": couplePresented = true
                    case "share-image": exportScheduleImage(result)
                    case "calendar-file": exportWeekCalendarFile(result)
                    case "course-sheet", "course-editor":
                        let week = weekNumber(store.selectedWeek)
                        if let (day, block) = (1...7).lazy.compactMap({ day in
                            blocks(for: day, week: week, result: result).first.map { (day, $0) }
                        }).first {
                            selectCourse(block, day: day, week: week, result: result)
                            if action == "course-editor", case .preview(let selection) = courseEditorPresentation {
                                courseEditorPresentation = .edit(selection)
                            }
                        }
                    case "sharing", "shared-view":
                        guard let sample = debugSharedSchedule(result) else { break }
                        NativeScheduleSharingService.shared.installDebugState(
                            library: NativeSharedScheduleLibrary(account: "debug", schedules: [sample], caredCode: sample.meta.code),
                            mine: [NativeScheduleShareMeta(
                                code: "K7QM4WPX", owner: "阿青", semester: result.currentSemester,
                                courseCount: result.cells.reduce(0) { $0 + $1.courses.count },
                                updatedAt: "2026-10-07T02:00:00.000Z"
                            )]
                        )
                        if action == "sharing" { sharingPresented = true } else { viewedShare = sample }
                    case "style-picker":
                        stylePickerPresented = true
                    case "live-activity":
                        // The demo class from the device settings, for a lock screen or Dynamic Island shot.
                        NativeLiveActivityController.shared.startPreview()
                    case "share-open":
                        sharingPresented = true
                    case "share-publish":
                        // The real thing, against whatever `CPU_DEBUG_API_ORIGIN` names.
                        do { try await NativeScheduleSharingService.shared.publish() } catch { print("share-publish failed: \(error.localizedDescription)") }
                        sharingPresented = true
                    case "share-import", "share-import-view":
                        let service = NativeScheduleSharingService.shared
                        do {
                            let code = ProcessInfo.processInfo.environment["CPU_DEBUG_SHARE_CODE"] ?? ""
                            let schedule = try await service.preview(code)
                            service.save(schedule, remark: ProcessInfo.processInfo.environment["CPU_DEBUG_SHARE_REMARK"] ?? "")
                            service.care(schedule.meta.code)
                            try? await service.loadMine()
                            if action == "share-import" { sharingPresented = true } else { viewedShare = service.library.schedules.first { $0.meta.code == schedule.meta.code } }
                        } catch {
                            print("share-import failed: \(error.localizedDescription)")
                            sharingPresented = true
                        }
                    default: break
                    }
                }
            }
#endif
        }
        .task(id: store.selectedSemester) {
            await store.refreshDisplayPriorities()
        }
        .task(id: overlapCheckID) {
            // Once the week has settled on screen.
            do { try await Task.sleep(for: .milliseconds(900)) } catch { return }
            checkOverlapNotice()
        }
        .alert(ScheduleOverlapNotice.title, isPresented: Binding(
            get: { overlapNotice != nil }, set: { if !$0 { overlapNotice = nil } }
        ), presenting: overlapNotice) { _ in
            Button("知道了", role: .cancel) {}
        } message: { notice in
            Text(notice.text)
        }
        .onChange(of: store.result?.currentSemester) { _, _ in
            adoptSelectionIfNeeded()
        }
        .onChange(of: store.result?.currentWeek) { _, _ in
            adoptSelectionIfNeeded()
        }
        .onChange(of: store.selectedWeek) { _, _ in
            guard !weekPaging, !dayPaging else { return }
            finishMonthDaySelectionIfReady()
            if pendingMonthDay == nil, !visibleDays.contains(selectedDay) { selectedDay = visibleDays.last ?? 1 }
            resetPagerSelections()
        }
        .onChange(of: store.calendar) { _, _ in
            finishMonthDaySelectionIfReady()
        }
        .onChange(of: preferences.showSaturday) { _, _ in
            if !visibleDays.contains(selectedDay) { selectedDay = visibleDays.last ?? 1 }
            resetPagerSelections()
        }
        .onChange(of: preferences.showSunday) { _, _ in
            if !visibleDays.contains(selectedDay) { selectedDay = visibleDays.last ?? 1 }
            resetPagerSelections()
        }
        .onChange(of: viewMode) { _, mode in
            resetPagerSelections()
            if mode == .month { seedMonthSelection(store.result, reset: true) }
        }
        .onDisappear {
            weekTransitionToken &+= 1
            dayTransitionToken &+= 1
            weekPaging = false
            dayPaging = false
        }
        .sheet(item: $courseEditorPresentation) { presentation in
            Group {
                switch presentation {
                case .preview(let selection):
                    NativeCourseQuickLookSheet(selection: selection, store: store)
                        .environment(\.schedulePalette, preferences.palette)
                        .environment(\.scheduleThemeBrand, ScheduleStyle.themeBrand(palette: preferences.palette))
                case .edit(let selection):
                    NativeCourseEditorSheet(selection: selection, store: store)
                        .presentationDetents([.large])
                case .add(let context):
                    NativeCourseEditorSheet(
                        selection: nil,
                        store: store,
                        defaultDay: context.day,
                        defaultWeek: context.week,
                        defaultStartSlot: context.startSlot
                    )
                    .presentationDetents([.large])
                }
            }
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $weekPickerPresented) {
            weekPicker
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $backgroundEditorPresented) {
            NavigationStack {
                NativeScheduleBackgroundEditor(preferences: preferences, scheduleStore: store)
            }
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $stylePickerPresented) {
            NavigationStack {
                ScheduleStylePicker(palette: preferences.palette)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("完成") { stylePickerPresented = false }
                        }
                    }
            }
            .tint(.cpuBrand)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $scheduleToolsPresented) {
            Group {
                if let result = store.result {
                    scheduleToolsSheet(result)
                }
            }
            .presentationDetents([.height(scheduleToolsDetentHeight), .large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(28)
            .presentationBackground(.regularMaterial)
        }
        .sheet(item: scheduleChangeNoticeBinding) { notice in
            NativeScheduleChangeNoticeSheet(notice: notice) {
                store.dismissScheduleChangeNotice()
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $sharePayload) { payload in
            NativeActivityView(activityItems: payload.items)
                .ignoresSafeArea()
        }
        .sheet(isPresented: $sharingPresented) {
            NativeScheduleSharingView(store: store) { schedule in
                // Let the sheet finish closing before the cover goes up.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { viewedShare = schedule }
            }
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $viewedShare) { schedule in
            NativeSharedScheduleScreen(schedule: schedule)
        }
        .sheet(isPresented: $couplePresented) {
            NativeCoupleSheet(partnerNow: { coupleNowText(now: $0, short: false) ?? "" })
                .presentationDragIndicator(.visible)
        }
    }

    /// Somebody else's shared timetable: everything that would change it is off.
    private var isReadOnly: Bool { store.isReadOnly }

#if DEBUG
    /// The timetable on screen dressed up as one a roommate shared.
    private func debugSharedSchedule(_ result: NativeScheduleResult) -> NativeSharedSchedule? {
        guard let calendar = store.calendar else { return nil }
        return NativeSharedSchedule(
            meta: NativeScheduleShareMeta(
                code: "R8TN3HVC", owner: "小王", semester: result.currentSemester,
                courseCount: result.cells.reduce(0) { $0 + $1.courses.count },
                updatedAt: "2026-10-06T08:00:00.000Z"
            ),
            schedule: result, calendar: calendar, remark: "室友小王"
        )
    }

    /// A partner for the sample timetable: every third course is taken
    /// together, another third sits one period later so the two overlap, and
    /// the rest moves into periods the user has free.
    private func debugPartnerSchedule(_ result: NativeScheduleResult) -> NativeSharedSchedule? {
        guard let calendar = store.calendar else { return nil }
        let names = ["物理化学", "天然药物化学", "生药学", "药用植物学", "临床药理学", "药物毒理学"]
        var index = 0
        let cells = result.cells.map { cell in
            NativeScheduleCell(day: cell.day, bigSlot: cell.bigSlot, courses: cell.courses.map { course in
                defer { index += 1 }
                let start = course.startSlot ?? cell.bigSlot * 2 - 1, end = course.endSlot ?? cell.bigSlot * 2
                func copy(_ name: String, _ start: Int, _ end: Int) -> NativeScheduleCourse {
                    NativeScheduleCourse(name: name, teacher: "陈老师", weeks: course.weeks, weekList: course.weekList,
                                         location: "实验楼 \(301 + index)", startSlot: min(12, start), endSlot: min(12, end))
                }
                switch index % 3 {
                case 0: return copy(course.name, start, end)
                case 1: return copy(names[index % names.count], start + 1, end + 1)
                default: return copy(names[index % names.count], start <= 2 ? 7 : 3, start <= 2 ? 8 : 4)
                }
            })
        }
        let schedule = NativeScheduleResult(source: result.source, semesters: result.semesters, weeks: result.weeks,
                                            currentSemester: result.currentSemester, currentWeek: result.currentWeek, cells: cells)
        return NativeSharedSchedule(
            meta: NativeScheduleShareMeta(code: "COUPLE", owner: "小鹿", semester: result.currentSemester),
            schedule: schedule, calendar: calendar, remark: ""
        )
    }
#endif

    private var isLoading: Bool {
        store.state == .loading
    }

    private var isUnauthorized: Bool {
        store.state == .unauthorized
    }

    private var errorMessage: String? {
        let value = store.errorMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }

    private var style: ScheduleStyle { styleSettings.style }

    /// The page colour a style brings with it, if any.
    private var styleCanvas: Color? { style.canvasColor(dark: colorScheme == .dark) }

    private var scheduleChangeNoticeBinding: Binding<NativeScheduleChangeNotice?> {
        Binding(
            get: { store.scheduleChangeNotice },
            set: { if $0 == nil { store.dismissScheduleChangeNotice() } }
        )
    }

    private func scheduleHeader(_ result: NativeScheduleResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                semesterMenu(result)

                Spacer(minLength: 8)

                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("正在更新课表")
                }

                Picker("课表视图", selection: $viewMode) {
                    // Keep the day/week order from Web; month follows them.
                    Text("日").tag(ScheduleViewMode.day)
                    Text("周").tag(ScheduleViewMode.week)
                    Text("月").tag(ScheduleViewMode.month)
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                .labelsHidden()
                .frame(width: 120)
                .accessibilityLabel("切换课表视图")

                if preferences.showBackToWeek {
                    Button {
                        switch viewMode {
                        case .day: jumpToCurrentDay(result)
                        case .week: jumpToCurrentWeek(result)
                        case .month: jumpToCurrentMonth()
                        }
                    } label: {
                        Image(systemName: "location.north.line")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 34, height: 34)
                            .modifier(ScheduleGlassControl(cornerRadius: 17))
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.primary)
                    .accessibilityLabel(viewMode == .month ? "回到本月" : (viewMode == .day ? "跳转到今日" : "回到本周"))
                    // A background refresh keeps the cached timetable usable, so
                    // only the meaningless jump is disabled.
                    .disabled(isViewingCurrentPosition(result))
                }

                // Keep the overflow action at the trailing edge, matching the
                // Web header and leaving refresh/additional actions in one
                // predictable place.
                scheduleToolsMenu()
            }

            if viewMode == .month {
                monthNavigator()
            } else {
            HStack(spacing: 6) {
                weekStepButton(
                    systemName: "chevron.left",
                    label: "上一周",
                    enabled: canMoveWeek(-1, result: result)
                ) {
                    moveWeek(-1, result: result)
                }

                if isCoupleBound {
                    // Bound: the week and its dates share the first line, and
                    // the partner's status takes the second. No extra row.
                    VStack(spacing: 3) {
                        Button {
                            weekPickerPresented = true
                        } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(weekTitle(result))
                                    .font(.headline)
                                    .fontDesign(navigatorTitleDesign)
                                if let range = weekRange(result), !range.isEmpty {
                                    Text(range)
                                        .font(.caption)
                                        .fontDesign(navigatorDateDesign)
                                        .foregroundStyle(navigatorSecondary)
                                }
                            }
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("选择周次")
                        coupleStatusLine
                    }
                    .frame(maxWidth: .infinity, minHeight: 42)
                } else {
                Button {
                    weekPickerPresented = true
                } label: {
                    VStack(spacing: 2) {
                        Text(weekTitle(result))
                            .font(.headline)
                            .fontDesign(navigatorTitleDesign)
                            .lineLimit(1)
                        if let range = weekRange(result), !range.isEmpty {
                            Text(range)
                                .font(.caption)
                                .fontDesign(navigatorDateDesign)
                                .foregroundStyle(navigatorSecondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 42)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("选择周次")
                }

                weekStepButton(
                    systemName: "chevron.right",
                    label: "下一周",
                    enabled: canMoveWeek(1, result: result)
                ) {
                    moveWeek(1, result: result)
                }
            }
            }

            // Web's day view keeps the week navigator and the seven-day strip
            // as separate controls. The strip is the compact day selector;
            // the grid below can therefore start directly at the first slot.
            if viewMode == .day {
                dayPicker(result)
            }

        }
    }

    private func monthNavigator() -> some View {
        HStack(spacing: 6) {
            weekStepButton(systemName: "chevron.left", label: "上一月", enabled: true) { moveMonth(-1) }
            VStack(spacing: 2) {
                Text(monthTitle).font(.headline).fontDesign(navigatorTitleDesign).lineLimit(1)
                if let lunar = ChineseCalendarInfo.info(forDate: monthAnchor)?.lunar.yearLabel {
                    Text("农历\(lunar)").font(.caption).fontDesign(navigatorTitleDesign)
                        .foregroundStyle(navigatorSecondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 42)
            weekStepButton(systemName: "chevron.right", label: "下一月", enabled: true) { moveMonth(1) }
        }
    }

    private func monthCalendar(_ result: NativeScheduleResult) -> some View {
        NativeScheduleMonthView(
            monthAnchor: monthAnchor.isEmpty ? (Self.todayDate ?? "") : monthAnchor,
            todayDate: Self.todayDate,
            dateIndex: monthDateIndex,
            blocks: { day, week in blocks(for: day, week: week, result: result) },
            adjustments: Dictionary((store.calendar?.adjustments ?? []).map { ($0.date, $0) }, uniquingKeysWith: { _, latest in latest }),
            palette: preferences.palette,
            partnerCourses: { date in
                guard let layer = coupleLayer else { return 0 }
                return NativeScheduleMonthView.courseNames(Self.partnerBlocks(on: date, layer: layer) ?? []).count
            },
            canOpenDay: { date in
                guard let slot = monthDateIndex[date] else { return false }
                return visibleDays(week: slot.week, result: result).contains(slot.day)
            },
            onOpenDay: openDayView,
            onMoveMonth: { moveMonth($0) }
        )
    }

    private var monthDateIndex: [String: NativeScheduleMonthView.DaySlot] {
        guard let calendar = store.calendar else { return [:] }
        var index: [String: NativeScheduleMonthView.DaySlot] = [:]
        for week in calendar.weeks {
            for (offset, date) in week.days.enumerated() where !date.isEmpty {
                index[date] = .init(week: week.week, day: offset + 1)
            }
        }
        return index
    }

    private var monthTitle: String {
        let pieces = monthAnchor.split(separator: "-")
        guard pieces.count >= 2, let year = Int(pieces[0]), let month = Int(pieces[1]) else { return monthAnchor }
        return "\(year) 年 \(month) 月"
    }

    private func moveMonth(_ offset: Int) {
        guard let date = ChineseCalendarInfo.date(fromDate: monthAnchor),
              let moved = ChineseCalendarInfo.gregorian.date(byAdding: .month, value: offset, to: date) else { return }
        withAnimation(.easeInOut(duration: 0.2)) { monthAnchor = ChineseCalendarInfo.dateString(moved) }
    }

    private func openDayView(_ date: String) {
        guard let result = store.result, monthDateIndex[date] != nil else { return }
        selectMonthDate(date, result: result)
        viewMode = .day
    }

    private func selectMonthDate(_ date: String, result: NativeScheduleResult) {
        selectedMonthDate = date
        pendingMonthDay = nil
        guard let slot = monthDateIndex[date],
              visibleDays(week: slot.week, result: result).contains(slot.day) else { return }
        didInitializeDay = true
        if store.selectedWeek == String(slot.week) {
            selectedDay = slot.day
            resetPagerSelections()
        } else {
            pendingMonthDay = date
            selectedDay = slot.day
            store.commitWeekSelection(String(slot.week))
        }
    }

    private func finishMonthDaySelectionIfReady() {
        guard let date = pendingMonthDay,
              let slot = monthDateIndex[date], String(slot.week) == store.selectedWeek,
              let week = store.calendar?.weeks.first(where: { $0.week == slot.week }),
              week.days.indices.contains(slot.day - 1), week.days[slot.day - 1] == date else { return }
        selectedDay = slot.day
        pendingMonthDay = nil
    }

    private func jumpToCurrentMonth() {
        guard let today = Self.todayDate else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            selectedMonthDate = today
            monthAnchor = today
        }
        if let result = store.result { selectMonthDate(today, result: result) }
    }

    private func seedMonthSelection(_ result: NativeScheduleResult?, reset: Bool = false) {
        let browsing = result.flatMap { rawDayDate(selectedDay, week: weekNumber(store.selectedWeek), result: $0) }
        let fallback = browsing ?? Self.todayDate ?? ChineseCalendarInfo.dateString(.now)
        if reset || selectedMonthDate.isEmpty { selectedMonthDate = fallback }
        if reset || monthAnchor.isEmpty { monthAnchor = selectedMonthDate }
    }

    private func isViewingCurrentPosition(_ result: NativeScheduleResult) -> Bool {
        switch viewMode {
        case .day: return isViewingCurrentDay(result)
        case .week: return isViewingCurrentWeek(result) && isSelectionToday
        case .month:
            guard let today = Self.todayDate else { return true }
            return selectedMonthDate == today && monthAnchor.prefix(7) == today.prefix(7)
        }
    }

    private var isSelectionToday: Bool {
        guard let today = Self.todayDate else { return true }
        return selectedMonthDate == today && monthAnchor.prefix(7) == today.prefix(7)
            && selectedDay == Self.chinaWeekday
    }

    @ViewBuilder
    private func semesterMenu(_ result: NativeScheduleResult) -> some View {
        if isReadOnly {
            // One timetable, nothing to switch to.
            Label(semesterTitle(result), systemImage: "person.2")
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .foregroundStyle(.primary)
                .padding(.horizontal, 12)
                .frame(minHeight: 34)
                .modifier(ScheduleGlassControl(cornerRadius: 17))
                .clipShape(Capsule())
                .accessibilityLabel("共享课表：\(semesterTitle(result))")
        } else {
            ownSemesterMenu(result)
        }
    }

    private func ownSemesterMenu(_ result: NativeScheduleResult) -> some View {
        Menu {
            ForEach(result.semesters, id: \.value) { semester in
                Button {
                    Task { await store.selectSemester(semester.value) }
                } label: {
                    if semester.value == store.selectedSemester {
                        Label(semester.label, systemImage: "checkmark")
                    } else {
                        Text(semester.label)
                    }
                }
            }
        } label: {
            Text(semesterTitle(result))
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .foregroundStyle(.primary)
                .padding(.horizontal, 12)
                .frame(minHeight: 34)
                .modifier(ScheduleGlassControl(cornerRadius: 17))
                .clipShape(Capsule())
        }
        .accessibilityLabel("选择学期")
    }

    /// Keep this as a single icon in the header, but present the actions in a
    /// bottom sheet. SwiftUI's `Menu` is allowed to flip to a left popover near
    /// the trailing edge, which made the same control appear in two places.
    private func scheduleToolsMenu() -> some View {
        Button {
            scheduleToolsContentHeight = 0
            scheduleToolsPresented = true
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 34, height: 34)
                .modifier(ScheduleGlassControl(cornerRadius: 17))
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .accessibilityLabel("更多课表操作")
    }

    private func scheduleToolsSheet(_ result: NativeScheduleResult) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                scheduleToolsSection("课表") {
                    scheduleToolRow("刷新课表", systemImage: "arrow.clockwise", disabled: isLoading) {
                        scheduleToolsPresented = false
                        refresh()
                    }
                    if result.source != .graduate, !isReadOnly {
                        scheduleToolRow("添加课程", systemImage: "plus") {
                            scheduleToolsPresented = false
                            presentAddCourse(
                                day: selectedDay,
                                week: Int(store.selectedWeek),
                                startSlot: 1
                            )
                        }
                    }
                }

                scheduleToolsSection("设备与设置") {
                    scheduleToolRow("课表风格", systemImage: "paintpalette") {
                        scheduleToolsPresented = false
                        DispatchQueue.main.async { stylePickerPresented = true }
                    }
                    if !isReadOnly {
                        scheduleToolRow("背景自定义", systemImage: "photo") {
                            scheduleToolsPresented = false
                            DispatchQueue.main.async { backgroundEditorPresented = true }
                        }
                        scheduleToolRow("课表、设备与小组件", systemImage: "slider.horizontal.3") {
                            scheduleToolsPresented = false
                            DispatchQueue.main.async { onDeviceSettings() }
                        }
                    }
                }

                scheduleToolsSection("分享") {
                    scheduleToolRow("分享本周课表", systemImage: "square.and.arrow.up") {
                        scheduleToolsPresented = false
                        exportScheduleImage(result)
                    }
                    scheduleToolRow("导出本周日历文件", systemImage: "calendar.badge.plus") {
                        scheduleToolsPresented = false
                        exportWeekCalendarFile(result)
                    }
                    if !isReadOnly {
                        scheduleToolRow("共享课表", systemImage: "person.2") {
                            scheduleToolsPresented = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { sharingPresented = true }
                        }
                        scheduleToolRow("情侣课表", systemImage: "heart") {
                            scheduleToolsPresented = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { couplePresented = true }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(GeometryReader { proxy in
                Color.clear.preference(key: NativeScheduleToolsHeightKey.self, value: proxy.size.height)
            })
            .onPreferenceChange(NativeScheduleToolsHeightKey.self) { value in
                guard value > 0 else { return }
                scheduleToolsContentHeight = value
            }
            .navigationTitle("更多")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { scheduleToolsPresented = false }
                }
            }
        }
        .tint(.cpuBrand)
    }

    private func scheduleToolsSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.leading, 4)
            VStack(spacing: 0, content: content)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private func scheduleToolRow(
        _ title: String,
        systemImage: String,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(disabled ? Color(uiColor: .tertiaryLabel) : Color.cpuBrand)
                    .frame(width: 24)
                Text(title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(disabled ? Color(uiColor: .tertiaryLabel) : Color.primary)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private var scheduleToolsDetentHeight: CGFloat {
        let measured = scheduleToolsContentHeight > 0 ? scheduleToolsContentHeight + 54 : 420
        return min(max(measured, 330), UIScreen.main.bounds.height * 0.82)
    }

    private func weekStepButton(
        systemName: String,
        label: String,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                // Bound to a partner, the words give their width to the status line.
                let arrowOnly = isCoupleBound && viewMode != .month
                if systemName == "chevron.right" {
                    if !arrowOnly { Text(label) }
                    Image(systemName: systemName)
                } else {
                    Image(systemName: systemName)
                    if !arrowOnly { Text(label) }
                }
            }
            .font(.caption.weight(.medium))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(minWidth: isCoupleBound && viewMode != .month ? 36 : 68, minHeight: 42)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(enabled ? AnyShapeStyle(style.inkColor(dark: colorScheme == .dark)) : AnyShapeStyle(.tertiary))
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    /// The week and month titles follow the style's typeface. Classic and
    /// minimal stay on the system face.
    private var navigatorTitleDesign: Font.Design? {
        style == .classic || style == .minimal ? nil : style.textDesign
    }
    /// The date range under the week title is all digits, so the board may
    /// keep its monospaced face there.
    private var navigatorDateDesign: Font.Design? {
        style == .classic || style == .minimal ? nil : style.fontDesign
    }
    /// Paper and board have a page colour of their own; the second line is
    /// their ink, thinned, in place of the system grey.
    private var navigatorSecondary: AnyShapeStyle {
        style == .paper || style == .board
            ? AnyShapeStyle(style.inkColor(dark: colorScheme == .dark).opacity(0.62)) : AnyShapeStyle(.secondary)
    }

    /// The day view's seven-day strip. Classic keeps its own; every other
    /// style draws it its own way, see `ScheduleDayStrip`.
    @ViewBuilder
    private func dayPicker(_ result: NativeScheduleResult) -> some View {
        if style == .classic {
            classicDayPicker(result)
        } else {
            let week = weekNumber(store.selectedWeek)
            ScheduleDayStrip(
                days: visibleDays.map { day in
                    let dayAdjustment = adjustment(day: day, week: week, result: result)
                    return .init(day: day, number: dayNumber(day, week: week, result: result),
                                 date: dayDate(day, week: week, result: result),
                                 isToday: dayIsToday(day, week: week, result: result),
                                 adjustmentKind: dayAdjustment?.kind,
                                 adjustmentDetail: dayAdjustment.map(adjustmentDetail),
                                 courseCount: blocks(for: day, week: week, result: result).count)
                },
                selectedDay: selectedDay
            ) { day in
                selectDay(day, week: week, result: result)
            }
            .padding(.top, 2)
        }
    }

    private func selectDay(_ day: Int, week: Int?, result: NativeScheduleResult) {
        withAnimation(.snappy(duration: 0.2)) {
            selectedDay = day
            if let date = rawDayDate(day, week: week, result: result) {
                selectedMonthDate = date
                monthAnchor = date
            }
        }
    }

    private func classicDayPicker(_ result: NativeScheduleResult) -> some View {
        let week = weekNumber(store.selectedWeek)
        return HStack(spacing: 2) {
            ForEach(visibleDays, id: \.self) { day in
                let isSelected = selectedDay == day
                let isToday = dayIsToday(day, week: week, result: result)
                let hasCourses = !blocks(for: day, week: week, result: result).isEmpty
                Button {
                    selectDay(day, week: week, result: result)
                } label: {
                    VStack(spacing: 5) {
                        Text(dayShortLabel(day))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(isSelected ? Color.cpuBrand : (day >= 6 ? Color.pink.opacity(0.75) : Color.secondary))
                            .lineLimit(1)

                        ZStack {
                            Circle().fill(isSelected ? Color.cpuBrand : Color.clear)
                            if isToday && !isSelected {
                                Circle().strokeBorder(Color.cpuBrand.opacity(0.55), lineWidth: 1)
                            }
                            Text(dayNumber(day, week: week, result: result) ?? "-")
                                .font(.system(size: 15, weight: isSelected || isToday ? .semibold : .regular, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(isSelected ? Color.white : (isToday ? Color.cpuBrand : Color.primary))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .frame(width: 32, height: 32)

                        Circle()
                            .fill(isSelected ? Color.cpuBrand : Color.cpuBrand.opacity(0.4))
                            .frame(width: 4, height: 4)
                            .opacity(hasCourses ? 1 : 0)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(dayLabel(day)) \(dayDate(day, result: result) ?? "")\(adjustment(day: day, week: week, result: result).map { "，\(adjustmentDetail($0))" } ?? "")")
                .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : [.isButton])
            }
        }
        .padding(.top, 2)
    }

    private func weekGrid(_ result: NativeScheduleResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                weekPager(result: result, width: proxy.size.width) { week in
                    let days = weekColumns(week: week, result: result)
                    if style == .classic {
                        let columnWidth = max(
                            24,
                            (proxy.size.width - 2 * Self.contentInset - Self.slotAxisWidth
                                - CGFloat(days.count) * Self.columnGap) / CGFloat(days.count)
                        )
                        scheduleRows(
                            result: result,
                            week: week,
                            days: days,
                            columnWidth: columnWidth,
                            compactCards: preferences.density == "compact",
                            rowHeight: weekRowHeight,
                            showsDateHeader: preferences.showDateHeader
                        )
                        // Keep the date headers' top border clear of the
                        // pager's clipping edge.
                        .padding(.top, Self.weekGridTopInset)
                        .padding(.horizontal, Self.contentInset)
                        .frame(width: proxy.size.width, alignment: .leading)
                    } else {
                        styledWeekRows(
                            result: result,
                            week: week,
                            days: days,
                            contentWidth: proxy.size.width - 2 * Self.contentInset
                        )
                        .padding(.top, Self.weekGridTopInset)
                        .padding(.horizontal, Self.contentInset)
                        .frame(width: proxy.size.width, alignment: .leading)
                    }
                }
            }
            .frame(height: weekGridHeight)
        }
        .environment(\.scheduleWeekDisplay, ScheduleWeekDisplay(
            textScale: CGFloat(preferences.weekTextScale),
            showTeacher: preferences.showTeacherInWeek,
            showSlotTime: preferences.showSlotTime
        ))
    }

    /// The pager's fixed cross axis for the week view in the current style.
    private var weekGridHeight: CGFloat {
        style == .classic
            // The rows end with 4pt of padding. Left out of the pager's height,
            // the taller page was centred and lost its top 2pt.
            ? Self.scheduleGridHeight(rowHeight: weekRowHeight, topInset: Self.weekGridTopInset) + 4
            : ScheduleStyledWeekRows.height(rowHeight: weekRowHeight, slotCount: ScheduleSlot.all.count,
                                            showsDateHeader: preferences.showDateHeader, style: style)
                + Self.weekGridTopInset + 2
    }

    /// The week grid of every style except classic. Calendar resolution, lanes
    /// and editing are the same as the classic grid; only the drawing differs.
    private func styledWeekRows(
        result: NativeScheduleResult,
        week: Int?,
        days: [Int],
        contentWidth: CGFloat,
        isStatic: Bool = false
    ) -> some View {
        ScheduleStyledWeekRows(
            days: days.map { day in
                // With Sunday first, the Sunday column belongs to the week before.
                let dayWeek = columnWeek(day, week: week, days: days)
                let shown = columnBlocks(for: day, week: week, days: days, result: result, couple: !isStatic)
                let clashes = isStatic ? [] : coupleClashes(for: day, week: week, days: days, result: result)
                return ScheduleStyledDay(
                    day: day,
                    dateText: dayDate(day, week: dayWeek, result: result),
                    rawDate: rawDayDate(day, week: dayWeek, result: result),
                    isToday: dayIsToday(day, week: dayWeek, result: result),
                    adjustmentKind: adjustment(day: day, week: dayWeek, result: result)?.kind,
                    blocks: shown,
                    offWeekBlocks: isStatic ? [] : offWeekBlocks(for: day, week: dayWeek, result: result, taken: shown + clashes),
                    coupleClashes: clashes
                )
            },
            columnWidth: ScheduleStyledWeekRows.columnWidth(contentWidth: contentWidth, dayCount: days.count, style: style),
            rowHeight: weekRowHeight,
            compactCards: !isStatic && preferences.density == "compact",
            showsDateHeader: isStatic || preferences.showDateHeader,
            showLocation: preferences.showLocation,
            showsNow: !isStatic && preferences.showNowIndicator,
            onCourseSelected: { day, block in
                selectCourse(block, day: day.day, week: columnWeek(day.day, week: week, days: days), result: result)
            },
            onEmptySlot: { day, slot in
                let dayWeek = columnWeek(day.day, week: week, days: days)
                guard dayWeek == week || hasCalendarWeek(dayWeek) else { return }
                let effective = effectiveSlot(day: day.day, week: dayWeek, result: result)
                presentAddCourse(day: effective.day, week: effective.week, startSlot: slot)
            }
        )
    }

    // MARK: Display settings

    /// The week view's columns, left to right. A hidden Saturday or Sunday
    /// stays when it has a class or is a make-up or holiday date.
    private func weekColumns(week: Int?, result: NativeScheduleResult) -> [Int] {
        let sundayWeek = preferences.sundayFirst ? week.map { $0 - 1 } : week
        var kept = Set<Int>()
        if adjustment(day: 6, week: week, result: result) != nil
            || !blocks(for: 6, week: week, result: result).isEmpty
            || partnerHasCourse(day: 6, week: week, result: result) { kept.insert(6) }
        if adjustment(day: 7, week: sundayWeek, result: result) != nil
            || ((sundayWeek == week || hasCalendarWeek(sundayWeek))
                && (!blocks(for: 7, week: sundayWeek, result: result).isEmpty
                    || partnerHasCourse(day: 7, week: sundayWeek, result: result))) { kept.insert(7) }
        return preferences.weekColumns(adjustedDays: kept)
    }

    /// The teaching week a column of `days` belongs to. When Sunday leads a
    /// week's columns it is the day before that Monday: the week before.
    private func columnWeek(_ day: Int, week: Int?, days: [Int]) -> Int? {
        guard day == 7, days.count > 1, days.first == 7, let week else { return week }
        return week - 1
    }

    private func hasCalendarWeek(_ week: Int?) -> Bool {
        guard let week else { return false }
        return store.calendar?.weeks.contains(where: { $0.week == week }) == true
    }

    /// The courses a week-view column shows. The Sunday before the term's
    /// first week has none.
    private func columnBlocks(for day: Int, week: Int?, days: [Int],
                              result: NativeScheduleResult, couple: Bool = true) -> [NativeScheduleCourseBlock] {
        let dayWeek = columnWeek(day, week: week, days: days)
        if dayWeek != week, !hasCalendarWeek(dayWeek) { return [] }
        let mine = blocks(for: day, week: dayWeek, result: result)
        return couple ? coupleBlocks(mine, date: rawDayDate(day, week: dayWeek, result: result)) : mine
    }

    // MARK: Couple timetable

    /// The partner's timetable while it is drawn here. Somebody else's shared
    /// timetable is shown on its own.
    private var coupleLayer: NativeCoupleLayer? { isReadOnly ? nil : couple.layer }

    /// The partner's courses on `date`, laid out with their own calendar, so
    /// a make-up day or a different week numbering on their side still lands
    /// on the right column. Nil when the date is outside their term.
    private static func partnerBlocks(on date: String?, layer: NativeCoupleLayer) -> [NativeScheduleCourseBlock]? {
        guard let date, date.count == 10,
              let week = layer.partner.calendar.weeks.first(where: { $0.days.contains(date) }),
              let index = week.days.firstIndex(of: date) else { return nil }
        return dayBlocks(day: index + 1, week: week.week, result: layer.partner.schedule,
                         calendar: layer.partner.calendar, priorities: [:], idPrefix: "ta:")
    }

    /// The user's courses of `date` as the week view draws them beside the
    /// partner's: `tiles` are whole cells (the user's courses, and the
    /// partner's that meet none of them), `clashes` are the partner's courses
    /// that do meet one, named in a line at the foot of that course.
    private func coupleColumn(_ mine: [NativeScheduleCourseBlock], date: String?)
        -> (tiles: [NativeScheduleCourseBlock], clashes: [NativeScheduleCourseBlock]) {
        guard let layer = coupleLayer else { return (mine, []) }
        let theirs = Self.partnerBlocks(on: date, layer: layer) ?? []
        func piece(_ block: NativeScheduleCourseBlock) -> CoupleRules.Piece {
            .init(startSlot: block.courseStartSlot, endSlot: block.courseEndSlot, name: block.course.name)
        }
        var tiles: [NativeScheduleCourseBlock] = [], clashes: [NativeScheduleCourseBlock] = []
        for placed in CoupleRules.merge(mine: mine.map(piece), theirs: theirs.map(piece)) {
            var block = (placed.fromPartner ? theirs : mine)[placed.index]
            block.owner = placed.owner
            block.coupleMeets = placed.meets
            if placed.fromPartner && placed.meets { clashes.append(block) } else { tiles.append(block) }
        }
        return (tiles, clashes)
    }

    private func coupleBlocks(_ mine: [NativeScheduleCourseBlock], date: String?) -> [NativeScheduleCourseBlock] {
        coupleColumn(mine, date: date).tiles
    }

    /// The partner's courses of a week-view column that meet one of the user's.
    private func coupleClashes(for day: Int, week: Int?, days: [Int], result: NativeScheduleResult) -> [NativeScheduleCourseBlock] {
        guard coupleLayer != nil else { return [] }
        let dayWeek = columnWeek(day, week: week, days: days)
        if dayWeek != week, !hasCalendarWeek(dayWeek) { return [] }
        return coupleColumn(blocks(for: day, week: dayWeek, result: result),
                            date: rawDayDate(day, week: dayWeek, result: result)).clashes
    }

    /// Whether the partner has a course on that column's date: a hidden
    /// weekend day still shows then.
    private func partnerHasCourse(day: Int, week: Int?, result: NativeScheduleResult) -> Bool {
        guard let layer = coupleLayer else { return false }
        return Self.partnerBlocks(on: rawDayDate(day, week: week, result: result), layer: layer)?.isEmpty == false
    }

    /// What the partner is doing now, for the line under the week title; nil
    /// when the user is not bound.
    private func coupleNowText(now: Date, short: Bool = true) -> String? {
        guard !isReadOnly, let other = couple.partnerMember else { return nil }
        guard let partner = couple.partner, let me = couple.me else {
            return short ? CoupleRules.nowText(name: other.nickname, hasData: false, courses: nil, minutes: 0) : "还没有同步课表"
        }
        let layer = NativeCoupleLayer(partner: partner, myColor: me.color, partnerColor: other.color, partnerName: other.nickname)
        let periods = partner.calendar.periods.isEmpty ? NativeSchedulePeriod.bundledTimetable : partner.calendar.periods
        func time(_ slot: Int, end: Bool) -> String {
            let period = periods.first { $0.number == slot }
            return (end ? period?.endTime : period?.startTime) ?? ""
        }
        let courses = Self.partnerBlocks(on: Self.todayDate, layer: layer)?.map { block in
            CoupleRules.TimedCourse(
                name: block.course.name,
                start: block.course.customStartTime?.trimmedNonEmpty ?? time(block.courseStartSlot, end: false),
                end: block.course.customEndTime?.trimmedNonEmpty ?? time(block.courseEndSlot, end: true)
            )
        }
        let text = CoupleRules.nowText(name: other.nickname, hasData: true, courses: courses,
                                       minutes: ScheduleStyleTime.minutes(now), short: short)
        // The long form sits beside 「TA 此刻」, so it does not repeat the name.
        let who = (other.nickname.isEmpty ? "TA" : other.nickname) + " "
        return !short && text.hasPrefix(who) ? String(text.dropFirst(who.count)) : text
    }

    /// Bound to a partner, and this is the user's own timetable.
    private var isCoupleBound: Bool { !isReadOnly && couple.isActive }

    /// The second line of the week title: what the partner is doing, the days
    /// together, and the switch for their courses in the grid. Tapping the
    /// text opens the manage sheet.
    private var coupleStatusLine: some View {
        // A clock of its own rather than a `TimelineView`: one in this header
        // kept the whole page re-laying itself out without end.
        coupleStatusLine(now: coupleClock)
            .task {
                while !Task.isCancelled {
                    let seconds = 60 - Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
                    do { try await Task.sleep(for: .seconds(seconds + 0.2)) } catch { return }
                    coupleClock = Date()
                }
            }
    }

    private func coupleStatusLine(now: Date) -> some View {
        HStack(spacing: 6) {
            Button {
                couplePresented = true
            } label: {
                HStack(spacing: 5) {
                    Circle().fill(Color.pink).frame(width: 6, height: 6).accessibilityHidden(true)
                    Text(coupleNowText(now: now) ?? "")
                        .font(.caption)
                        .foregroundStyle(navigatorSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .truncationMode(.tail)
                        .layoutPriority(1)
                    if let days = CoupleRules.daysTogether(couple.anniversary, today: Self.todayDate ?? "") {
                        HStack(spacing: 2) {
                            Image(systemName: "heart.fill").font(.system(size: 9)).foregroundStyle(.pink)
                            Text("\(days) 天").font(.caption2.weight(.semibold)).monospacedDigit()
                                .foregroundStyle(navigatorSecondary)
                        }
                        .fixedSize()
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("在一起第 \(days) 天")
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("打开情侣课表")
            Button {
                withAnimation(.snappy(duration: 0.18)) { couple.setVisible(!couple.visible) }
            } label: {
                // A small switch: a 28×16 track, with a larger area to tap.
                Capsule()
                    .fill(couple.visible ? AnyShapeStyle(CoupleRGB.heart.color) : AnyShapeStyle(Color.secondary.opacity(0.35)))
                    .frame(width: 28, height: 16)
                    .overlay(alignment: couple.visible ? .trailing : .leading) {
                        Circle().fill(.white).frame(width: 12, height: 12).padding(2)
                            .shadow(color: .black.opacity(0.15), radius: 1, y: 0.5)
                    }
                    .frame(width: 40, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("在课表里显示 TA 的课")
            .accessibilityValue(couple.visible ? "开" : "关")
        }
        .frame(maxWidth: .infinity)
    }

    /// The courses of a weekday that do not run in `week`, for the periods
    /// `taken` leaves free. Where several share a period the one that runs
    /// soonest stays. Holidays and make-up days follow their own date and get none.
    private func offWeekBlocks(for day: Int, week: Int?, result: NativeScheduleResult,
                               taken: [NativeScheduleCourseBlock]) -> [NativeScheduleCourseBlock] {
        guard preferences.showOffWeek, let week, store.calendar == nil || hasCalendarWeek(week),
              adjustment(day: day, week: week, result: result) == nil else { return [] }
        var candidates: [(block: NativeScheduleCourseBlock, distance: Int)] = []
        for cell in result.cells where cell.day == day {
            for (index, course) in cell.courses.enumerated() {
                let weeks = Self.nativeCourseWeekList(course)
                guard !weeks.isEmpty, !weeks.contains(week) else { continue }
                let upcoming = weeks.filter { $0 > week }.min()
                let past = weeks.filter { $0 < week }.max()
                let distance: Int
                if let upcoming {
                    distance = upcoming - week
                } else if let past {
                    distance = 1000 + week - past
                } else {
                    continue
                }
                let start = min(max(course.startSlot ?? cell.bigSlot * 2 - 1, 1), ScheduleSlot.all.count)
                let end = min(max(course.endSlot ?? cell.bigSlot * 2, start), ScheduleSlot.all.count)
                if taken.contains(where: { $0.startSlot <= end && start <= $0.endSlot }) { continue }
                candidates.append((
                    block: NativeScheduleCourseBlock(
                        id: "off-\(week)-\(day)-\(cell.bigSlot)-\(index)-\(course.name)",
                        course: course, bigSlot: cell.bigSlot, startSlot: start, endSlot: end
                    ),
                    distance: distance
                ))
            }
        }
        candidates.sort { lhs, rhs in
            if lhs.distance != rhs.distance { return lhs.distance < rhs.distance }
            return lhs.block.startSlot < rhs.block.startSlot
        }
        var chosen: [NativeScheduleCourseBlock] = []
        for candidate in candidates {
            let block = candidate.block
            if !chosen.contains(where: { $0.startSlot <= block.endSlot && block.startSlot <= $0.endSlot }) {
                chosen.append(block)
            }
        }
        return chosen
    }

    /// "yyyy-MM-dd" moved by whole days.
    private static func shiftedDate(_ value: String, by days: Int) -> String? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: value) else { return nil }
        return formatter.string(from: date.addingTimeInterval(TimeInterval(days) * 86_400))
    }

    private func styledDay(_ day: Int, week: Int?, result: NativeScheduleResult) -> ScheduleStyledDay {
        ScheduleStyledDay(
            day: day,
            dateText: dayDate(day, week: week, result: result),
            rawDate: rawDayDate(day, week: week, result: result),
            isToday: dayIsToday(day, week: week, result: result),
            adjustmentKind: adjustment(day: day, week: week, result: result)?.kind,
            blocks: blocks(for: day, week: week, result: result)
        )
    }

    /// Opens the quick look for a course shown on `day`. The quick look names
    /// the weekday it is shown on; editing from it uses the weekday the course
    /// actually belongs to, which differs on a make-up day.
    private func selectCourse(_ shown: NativeScheduleCourseBlock, day: Int, week: Int?, result: NativeScheduleResult) {
        let effective = effectiveSlot(day: day, week: week, result: result)
        // A piece left visible beside a course in front still opens the whole course.
        let block = shown.whole
        courseEditorPresentation = .preview(SelectedCourse(
            id: block.id,
            course: block.course,
            day: effective.day,
            bigSlot: block.bigSlot,
            startSlot: block.startSlot,
            endSlot: block.endSlot,
            schedule: scheduleText(block, day: day),
            // The partner's course can be looked at, not edited.
            ownerTitle: block.owner == .partner ? coupleLayer?.ownerTitle : nil
        ))
    }

    /// "周三 · 第 5–6 节 · 13:30–15:10"
    private func scheduleText(_ block: NativeScheduleCourseBlock, day: Int) -> String {
        let status = ScheduleStyledDayStatus(clocks: ScheduleSlot.all, now: nil, completedBefore: nil)
        let slots = block.startSlot == block.endSlot
            ? "第 \(block.startSlot) 节" : "第 \(block.startSlot)–\(block.endSlot) 节"
        return [ScheduleStyleTime.weekday(day), slots, "\(status.start(block))–\(status.end(block))"]
            .joined(separator: " · ")
    }

    private func dayGrid(_ result: NativeScheduleResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                let columnWidth = max(220, proxy.size.width - Self.slotAxisWidth - Self.columnGap)
                dayPager(result: result, width: proxy.size.width) { page in
                    if let pair = coupleDay(page, result: result) {
                        // Bound to a partner, every style shows the day as two columns.
                        coupleDayPage(pair, page: page, result: result)
                            .padding(.vertical, Self.styledDayInset)
                            .padding(.horizontal, Self.contentInset)
                            .frame(width: proxy.size.width, height: dayGridHeight(result), alignment: .top)
                    } else if style == .classic {
                        scheduleRows(
                            result: result,
                            week: page.week.flatMap(Int.init),
                            days: [page.day],
                            columnWidth: columnWidth,
                            compactCards: preferences.density == "compact",
                            rowHeight: dayRowHeight,
                            showsDateHeader: false
                        )
                        // TabView's page container can clip content that starts
                        // exactly on its top edge during the native page
                        // transition. Keep a small, day-only breathing room so
                        // the first course card is never cut by that edge.
                        .padding(.top, Self.dayGridTopInset)
                        .frame(width: proxy.size.width, alignment: .leading)
                    } else {
                        styledDay(result: result, week: page.week.flatMap(Int.init), day: page.day)
                            .padding(.vertical, Self.styledDayInset)
                            .frame(width: proxy.size.width, height: dayGridHeight(result), alignment: .top)
                    }
                }
            }
            .frame(height: dayGridHeight(result))
        }
    }

    /// The day pager has a fixed cross axis, so it takes the tallest of the
    /// three pages it can show.
    private func dayGridHeight(_ result: NativeScheduleResult) -> CGFloat {
        let own = ownDayGridHeight(result)
        return coupleLayer == nil ? own : max(own, ScheduleCoupleDayView.height() + 2 * Self.styledDayInset)
    }

    /// The user's and the partner's courses of a day page; nil while the
    /// couple timetable is off, or when neither has a class that day, which
    /// keeps the style's own empty day.
    private func coupleDay(_ page: NativeScheduleDayPage, result: NativeScheduleResult)
        -> (layer: NativeCoupleLayer, mine: [NativeScheduleCourseBlock], theirs: [NativeScheduleCourseBlock])? {
        guard let layer = coupleLayer else { return nil }
        let week = page.week.flatMap(Int.init)
        let mine = blocks(for: page.day, week: week, result: result)
        let theirs = (Self.partnerBlocks(on: rawDayDate(page.day, week: week, result: result), layer: layer) ?? []).map {
            var block = $0
            block.owner = .partner
            return block
        }
        return mine.isEmpty && theirs.isEmpty ? nil : (layer, mine, theirs)
    }

    private func coupleDayPage(
        _ pair: (layer: NativeCoupleLayer, mine: [NativeScheduleCourseBlock], theirs: [NativeScheduleCourseBlock]),
        page: NativeScheduleDayPage, result: NativeScheduleResult
    ) -> some View {
        let week = page.week.flatMap(Int.init)
        let isToday = dayIsToday(page.day, week: week, result: result)
        func view(_ now: Date?) -> ScheduleCoupleDayView {
            ScheduleCoupleDayView(
                layer: pair.layer, mine: pair.mine, theirs: pair.theirs,
                nowMinutes: preferences.showNowIndicator ? now.map { ScheduleStyleTime.minutes($0) } : nil,
                showLocation: preferences.showLocation,
                onCourseSelected: { block in selectCourse(block, day: page.day, week: week, result: result) },
                onEmptySlot: { slot in
                    let effective = effectiveSlot(day: page.day, week: week, result: result)
                    presentAddCourse(day: effective.day, week: effective.week, startSlot: slot)
                }
            )
        }
        return Group {
            if isToday {
                TimelineView(.everyMinute) { context in view(context.date) }
            } else {
                view(nil)
            }
        }
    }

    private func ownDayGridHeight(_ result: NativeScheduleResult) -> CGFloat {
        guard style != .classic else {
            return Self.scheduleGridHeight(
                rowHeight: dayRowHeight,
                includesDateHeader: false,
                topInset: Self.dayGridTopInset
            )
        }
        let pages = [
            adjacentDayPage(-1, result: result),
            NativeScheduleDayPage(week: store.selectedWeek.nilIfEmpty, day: selectedDay),
            adjacentDayPage(1, result: result),
        ].compactMap { $0 }
        let tallest = pages.map { page in
            ScheduleStyledDayView.height(
                style: style,
                blocks: blocks(for: page.day, week: page.week.flatMap(Int.init), result: result),
                clocks: ScheduleSlot.all,
                slotCount: ScheduleSlot.all.count,
                cardHeight: styledDayCardHeight
            )
        }.max() ?? 0
        return tallest + 2 * Self.styledDayInset
    }

    private var styledDayCardHeight: CGFloat {
        ScheduleStyledDayView.standardCardHeight * (preferences.density == "compact" ? 0.9 : 1)
    }

    /// The day view of every style except classic. Today refreshes each minute
    /// so the in-class and next-up states stay current.
    private func styledDay(result: NativeScheduleResult, week: Int?, day: Int) -> some View {
        let date = rawDayDate(day, week: week, result: result)
        let isToday = dayIsToday(day, week: week, result: result)
        let adjustment = adjustment(day: day, week: week, result: result)
        func view(_ now: Date?) -> ScheduleStyledDayView {
            ScheduleStyledDayView(
                day: day,
                blocks: blocks(for: day, week: week, result: result),
                nowMinutes: preferences.showNowIndicator ? now.map { ScheduleStyleTime.minutes($0) } : nil,
                completedBeforeMinutes: date.flatMap { date in
                    guard let today = Self.todayDate else { return nil }
                    if date < today { return 24 * 60 }
                    return date == today ? ScheduleStyleTime.minutes(now ?? .now) : nil
                },
                cardHeight: styledDayCardHeight,
                emptyNote: adjustment.map(adjustmentDetail),
                holidayGreeting: date.flatMap { ChineseCalendarInfo.restGreeting(forDate: $0) },
                showLocation: preferences.showLocation,
                showTeacher: preferences.showTeacher,
                onCourseSelected: { block in selectCourse(block, day: day, week: week, result: result) },
                onEmptySlot: { slot in
                    let effective = effectiveSlot(day: day, week: week, result: result)
                    presentAddCourse(day: effective.day, week: effective.week, startSlot: slot)
                }
            )
        }
        return Group {
            if isToday {
                TimelineView(.everyMinute) { context in view(context.date) }
            } else {
                view(nil)
            }
        }
    }

    private var weekRowHeight: CGFloat {
        (preferences.density == "compact" ? 40 : NativeScheduleDayColumn.slotHeight)
            * CGFloat(NativeSchedulePreferences.normalizedRowHeight(preferences.rowHeight) / 100)
    }

    private var dayRowHeight: CGFloat {
        preferences.density == "compact" ? 37 : NativeScheduleDayColumn.daySlotHeight
    }

    private var visibleDays: [Int] {
        guard let result = store.result else { return preferences.visibleDays(adjustedDays: []) }
        return visibleDays(week: weekNumber(store.selectedWeek), result: result)
    }

    private func visibleDays(week: Int?, result: NativeScheduleResult) -> [Int] {
        // With weekends hidden, a weekend day still shows when it is a make-up
        // or holiday date, or when it has a course: hiding it would hide the course.
        let adjustedDays = Set((6...7).filter {
            adjustment(day: $0, week: week, result: result) != nil
                || !blocks(for: $0, week: week, result: result).isEmpty
                || partnerHasCourse(day: $0, week: week, result: result)
        })
        return preferences.visibleDays(adjustedDays: adjustedDays)
    }

    /// Daily mode uses the same native page controller as the weekly pager. A
    /// page is one day; crossing Sunday/Monday commits the adjacent week after
    /// the system animation has carried the page off screen.
    private func dayPager<Page: View>(
        result: NativeScheduleResult,
        width: CGFloat,
        @ViewBuilder page: @escaping (NativeScheduleDayPage) -> Page
    ) -> some View {
        let previous = adjacentDayPage(-1, result: result)
        let current = NativeScheduleDayPage(week: store.selectedWeek.nilIfEmpty, day: selectedDay)
        let next = adjacentDayPage(1, result: result)
        return TabView(selection: $dayPageSelection) {
            dayPagerPage(id: 0, value: previous, width: width, page: page)
            dayPagerPage(id: 1, value: current, width: width, page: page)
            dayPagerPage(id: 2, value: next, width: width, page: page)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(width: width, alignment: .leading)
        .clipped()
        .onAppear { dayPageSelection = 1 }
        .onChange(of: dayPageSelection) { _, selection in
            handleDayPageSelection(selection, result: result)
        }
    }

    @ViewBuilder
    private func dayPagerPage<Page: View>(
        id: Int,
        value: NativeScheduleDayPage?,
        width: CGFloat,
        @ViewBuilder page: @escaping (NativeScheduleDayPage) -> Page
    ) -> some View {
        Group {
            if let value {
                page(value)
                    .frame(width: width, alignment: .leading)
            } else {
                Color.clear
                    .frame(
                        width: width,
                        height: Self.scheduleGridHeight(
                            rowHeight: dayRowHeight,
                            includesDateHeader: false,
                            topInset: Self.dayGridTopInset
                        )
                    )
            }
        }
        .tag(id)
        .accessibilityHidden(id != 1)
    }

    /// The system page style owns the horizontal pan, rubber-banding and
    /// velocity curve. Only the semantic selection is committed here, after a
    /// short delay that lets the native page finish its visible transition.
    private func weekPager<Page: View>(
        result: NativeScheduleResult,
        width: CGFloat,
        @ViewBuilder page: @escaping (Int?) -> Page
    ) -> some View {
        let previous = adjacentWeekValue(-1, result: result).flatMap(weekNumber)
        let current = weekNumber(store.selectedWeek)
        let next = adjacentWeekValue(1, result: result).flatMap(weekNumber)
        return TabView(selection: $weekPageSelection) {
            weekPagerPage(id: 0, value: previous, width: width, page: page)
            weekPagerPage(id: 1, value: current, width: width, page: page)
            weekPagerPage(id: 2, value: next, width: width, page: page)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(width: width, alignment: .leading)
        .clipped()
        .onAppear { weekPageSelection = 1 }
        .onChange(of: weekPageSelection) { _, selection in
            handleWeekPageSelection(selection, result: result)
        }
    }

    @ViewBuilder
    private func weekPagerPage<Page: View>(
        id: Int,
        value: Int?,
        width: CGFloat,
        @ViewBuilder page: @escaping (Int?) -> Page
    ) -> some View {
        Group {
            if let value {
                page(value)
                    .frame(width: width, alignment: .leading)
            } else {
                Color.clear
                    .frame(width: width, height: Self.scheduleGridHeight(rowHeight: weekRowHeight))
            }
        }
        .tag(id)
        .accessibilityHidden(id != 1)
    }

    private func handleWeekPageSelection(_ selection: Int, result: NativeScheduleResult) {
        guard selection != 1, !weekPaging, courseEditorPresentation == nil else { return }
        let direction = selection == 2 ? 1 : -1
        guard let target = adjacentWeekValue(direction, result: result) else {
            resetPagerSelections()
            return
        }
        weekPaging = true
        weekTransitionToken &+= 1
        let token = weekTransitionToken
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, token == weekTransitionToken else { return }
            store.commitWeekSelection(target)
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                weekPageSelection = 1
                weekPaging = false
            }
        }
    }

    private func handleDayPageSelection(_ selection: Int, result: NativeScheduleResult) {
        guard selection != 1, !dayPaging, courseEditorPresentation == nil else { return }
        let direction = selection == 2 ? 1 : -1
        guard let target = adjacentDayPage(direction, result: result) else {
            resetPagerSelections()
            return
        }
        dayPaging = true
        dayTransitionToken &+= 1
        let token = dayTransitionToken
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, token == dayTransitionToken else { return }
            if let week = target.week, week != store.selectedWeek {
                store.commitWeekSelection(week)
            }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                selectedDay = target.day
                if let date = rawDayDate(target.day, week: target.week.flatMap(Int.init), result: result) {
                    selectedMonthDate = date
                    monthAnchor = date
                }
                dayPageSelection = 1
                dayPaging = false
            }
        }
    }

    private func resetPagerSelections() {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            weekPageSelection = 1
            dayPageSelection = 1
        }
    }

    private func scheduleRows(
        result: NativeScheduleResult,
        week: Int?,
        days: [Int],
        columnWidth: CGFloat,
        compactCards: Bool,
        rowHeight: CGFloat = NativeScheduleDayColumn.slotHeight,
        showsDateHeader: Bool = true,
        showsNow: Bool = true
    ) -> some View {
        let todayIndex = showsNow && preferences.showNowIndicator
            ? days.firstIndex { dayIsToday($0, week: columnWeek($0, week: week, days: days), result: result) } : nil
        // The period times can be hidden in the week view; the day view keeps them.
        let showsSlotTime = days.count == 1 || !showsNow || preferences.showSlotTime
        return HStack(alignment: .top, spacing: Self.columnGap) {
            slotAxis(rowHeight: rowHeight, showsHeader: showsDateHeader, showsTime: showsSlotTime)

            ForEach(days, id: \.self) { day in
                // With Sunday first, the Sunday column belongs to the week before.
                let dayWeek = columnWeek(day, week: week, days: days)
                let effective = effectiveSlot(day: day, week: dayWeek, result: result)
                let shown = columnBlocks(for: day, week: week, days: days, result: result)
                let clashes = days.count > 1 ? coupleClashes(for: day, week: week, days: days, result: result) : []
                NativeScheduleDayColumn(
                    day: day,
                    dateText: dayDate(day, week: dayWeek, result: result),
                    isToday: dayIsToday(day, week: dayWeek, result: result),
                    adjustment: adjustment(day: day, week: dayWeek, result: result),
                    columnWidth: columnWidth,
                    rowHeight: rowHeight,
                    compactCards: compactCards,
                    showsDateHeader: showsDateHeader,
                    blocks: shown,
                    palette: preferences.palette,
                    showLocation: preferences.showLocation,
                    showTeacher: preferences.showTeacher,
                    showPeriod: preferences.showPeriod,
                    showWeeks: preferences.showWeeks,
                    onCourseSelected: { block in
                        // A cell tap can arrive in the same run loop as a
                        // neighbouring empty-slot gesture. Selecting a real
                        // course always presents that course.
                        selectCourse(block, day: day, week: dayWeek, result: result)
                    },
                    onEmptySlot: { slot in
                        guard dayWeek == week || hasCalendarWeek(dayWeek) else { return }
                        presentAddCourse(day: effective.day, week: effective.week, startSlot: slot)
                    },
                    offWeekBlocks: days.count > 1 && showsNow
                        ? offWeekBlocks(for: day, week: dayWeek, result: result, taken: shown + clashes) : [],
                    coupleClashes: clashes
                )
            }
        }
        .overlay(alignment: .topLeading) {
            if let todayIndex {
                // The current time: a capsule on the period axis and a line
                // across today's column, refreshed each minute.
                TimelineView(.everyMinute) { context in
                    let minutes = ScheduleStyleTime.minutes(context.date)
                    let headerHeight = showsDateHeader ? NativeScheduleDayColumn.dateHeaderHeight : 0
                    if let y = ScheduleStyledWeekRows.nowOffset(minutes, rows: ScheduleSlot.all, rowHeight: rowHeight) {
                        ZStack(alignment: .topLeading) {
                            // The day view's single wide card carries its title
                            // where the line would run, so only the week draws it.
                            if days.count > 1 {
                                ScheduleNowLine(width: columnWidth)
                                    .offset(x: Self.slotAxisWidth + Self.columnGap
                                                + CGFloat(todayIndex) * (columnWidth + Self.columnGap),
                                            y: headerHeight + y)
                            }
                            ScheduleNowBadge(minutes: minutes)
                                .frame(width: Self.slotAxisWidth)
                                .offset(y: headerHeight + y - ScheduleNowBadge.height / 2)
                        }
                    }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
        .padding(.bottom, 4)
    }

    private func slotAxis(
        rowHeight: CGFloat = NativeScheduleDayColumn.slotHeight,
        showsHeader: Bool = true,
        showsTime: Bool = true
    ) -> some View {
        VStack(spacing: 0) {
            if showsHeader {
                Text("节次")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(NativeScheduleThemeColor.secondary(colorScheme))
                    .frame(width: Self.slotAxisWidth, height: NativeScheduleDayColumn.dateHeaderHeight)
            }

            VStack(spacing: NativeScheduleDayColumn.slotGap) {
                ForEach(ScheduleSlot.all, id: \.number) { slot in
                    VStack(spacing: 2) {
                        Text("\(slot.number)")
                            .font(.system(size: 13, weight: .bold).monospacedDigit())
                            .foregroundStyle(NativeScheduleThemeColor.primary(colorScheme))
                        // The number and both times need about 42pt. A row
                        // set shorter than that keeps the start time, and a
                        // very short one the number alone, rather than
                        // letting the labels run into each other.
                        if showsTime, rowHeight >= 27 {
                            Text(slot.start)
                                .font(.system(size: 9).monospacedDigit())
                                .foregroundStyle(NativeScheduleThemeColor.secondary(colorScheme))
                            if rowHeight >= 42 {
                                Text(slot.end)
                                    .font(.system(size: 9).monospacedDigit())
                                    .foregroundStyle(NativeScheduleThemeColor.secondary(colorScheme))
                            }
                        }
                    }
                    .frame(width: Self.slotAxisWidth, height: rowHeight)

                }
            }
        }
        .background {
            if preferences.backgroundImage != nil {
                NativeScheduleBackgroundSurface()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color.orange.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var loadingState: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("课表").font(.title2.bold())
                Spacer()
                ProgressView().controlSize(.small)
                Text("正在同步课表").font(.caption).foregroundStyle(.secondary)
            }
            .frame(minHeight: 34)

            Text("课程安排加载后会显示在这里")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 42)

            GeometryReader { proxy in
                HStack(alignment: .top, spacing: 0) {
                    slotAxis()
                    ForEach(1...7, id: \.self) { day in
                        NativeScheduleDayColumn(
                            day: day,
                            dateText: nil,
                            isToday: day == Self.chinaWeekday,
                            columnWidth: max(1, (proxy.size.width - Self.slotAxisWidth) / 7),
                            rowHeight: NativeScheduleDayColumn.slotHeight,
                            compactCards: true,
                            showsDateHeader: true,
                            blocks: [],
                            onCourseSelected: { _ in },
                            onEmptySlot: { _ in }
                        )
                    }
                }
            }
            .frame(height: Self.scheduleGridHeight())
            .accessibilityHidden(true)
        }
    }

    private var authorizationBanner: some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: "lock")
                .foregroundStyle(.orange)
            Text(errorMessage ?? "教务授权已失效，课表可能不是最新的")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 8)
            Button("去登录", action: onLogin)
                .font(.caption.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(Color.cpuBrand)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color.orange.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var authorizationState: some View {
        StateCard(
            systemImage: "lock",
            title: "需要教务授权",
            message: "登录教务后，原生课表才能读取课程安排",
            actionTitle: "去登录",
            action: onLogin,
            showsProgress: false
        )
    }

    private func errorState(_ message: String) -> some View {
        StateCard(
            systemImage: "exclamationmark.triangle",
            title: "课表读取失败",
            message: message,
            actionTitle: "重试",
            action: refresh,
            showsProgress: false
        )
    }

    private var weekPicker: some View {
        NavigationStack {
            ScrollView {
                if let result = store.result, !result.weeks.isEmpty {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5),
                        spacing: 8
                    ) {
                        ForEach(result.weeks, id: \.value) { week in
                            let isSelected = week.value == store.selectedWeek
                            let isCurrent = Int(week.value) == store.calendar?.currentWeek
                            Button {
                                weekPickerPresented = false
                                Task { await store.selectWeek(week.value) }
                            } label: {
                                Text(week.value)
                                    .font(.subheadline.weight(.medium))
                                    .frame(maxWidth: .infinity, minHeight: 40)
                                .foregroundStyle(isSelected ? Color.white : (isCurrent ? Color.cpuBrand : .primary))
                                    .background {
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .fill(isSelected ? Color.cpuBrand : Color(uiColor: .secondarySystemGroupedBackground))
                                    }
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .stroke(isCurrent && !isSelected ? Color.cpuBrand : Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
                                    }
                            }
                            .buttonStyle(.plain)
                            .disabled(isLoading)
                            .accessibilityLabel("第 \(week.value) 周")
                            .accessibilityAddTraits(isSelected ? .isSelected : [])
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                } else {
                    Text("暂无可选周次")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 160)
                }
            }
            .scrollIndicators(.hidden)
            .navigationTitle("选择周次")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let result = store.result, !isViewingCurrentPosition(result) {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("回到本周") {
                            weekPickerPresented = false
                            jumpToCurrentWeek(result)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") {
                        weekPickerPresented = false
                    }
                }
            }
        }
    }

    private func adoptSelectionIfNeeded() {
        guard let result = store.result else { return }
        if store.selectedSemester.isEmpty {
            store.selectedSemester = store.calendar?.currentSemester.nilIfEmpty ?? result.currentSemester
        }
        let availableWeeks = Set(result.weeks.map(\.value))
        if store.selectedWeek.isEmpty || (!availableWeeks.isEmpty && !availableWeeks.contains(store.selectedWeek)) {
            // Legacy payloads can carry the calendar's real current week even
            // when their data only advertises an older range. Prefer a week
            // that is actually present, which makes old schedules open on the
            // first week without an extra manual picker tap.
            let currentWeek = store.calendar
                .map { $0.currentWeek }
                .flatMap { value in
                    let candidate = value > 0 ? String(value) : ""
                    return availableWeeks.isEmpty || availableWeeks.contains(candidate) ? candidate.nilIfEmpty : nil
                }
            store.selectedWeek = currentWeek
                ?? result.currentWeek.trimmedNonEmpty.flatMap { value in
                    availableWeeks.isEmpty || availableWeeks.contains(value) ? value : nil
                }
                ?? result.weeks.first(where: { $0.current })?.value
                ?? result.weeks.first?.value
                ?? ""
        }
        if !didInitializeDay {
            selectedDay = visibleDays.first(where: { dayIsToday($0, result: result) }) ?? visibleDays.first ?? 1
            didInitializeDay = true
        }
    }

    private func requestLoad(force: Bool = false) {
        let semester = store.selectedSemester.isEmpty ? nil : store.selectedSemester
        let week = store.selectedWeek.isEmpty ? nil : store.selectedWeek
        Task { @MainActor in
            await store.load(semester: semester, week: week, force: force)
        }
    }

    private func loadAsync(force: Bool = false) async {
        let semester = store.selectedSemester.isEmpty ? nil : store.selectedSemester
        let week = store.selectedWeek.isEmpty ? nil : store.selectedWeek
        await store.load(semester: semester, week: week, force: force)
    }

    private func refresh() {
        guard !isReadOnly else {
            // A shared timetable is refreshed from its share, not from 教务.
            Task {
                await NativeScheduleSharingService.shared.refresh()
                await store.load(force: true)
            }
            return
        }
        requestLoad(force: true)
    }

    @MainActor
    private func exportScheduleImage(_ result: NativeScheduleResult) {
        let week = Int(store.selectedWeek) ?? Int(result.currentWeek) ?? 1
        let isDayView = false
        // Sharing always exports the complete week, even when the user is
        // currently looking at the compact day view. This matches the Web
        // action and produces a useful image instead of a one-column crop.
        let canvasWidth: CGFloat = 980
        let gridWidth = canvasWidth - 48
        let columnWidth = max(72, (gridWidth - Self.slotAxisWidth - CGFloat(6) * Self.columnGap) / 7)
        let grid = style == .classic
            ? AnyView(
                scheduleRows(
                    result: result,
                    week: week,
                    days: Array(1...7),
                    columnWidth: columnWidth,
                    compactCards: false,
                    rowHeight: weekRowHeight,
                    showsDateHeader: preferences.showDateHeader,
                    showsNow: false
                )
            )
            // The styled grid follows the chosen style, palette and appearance,
            // and is drawn static: no today, no "now", so the picture reads the
            // same whenever it is opened.
            : AnyView(
                styledWeekRows(result: result, week: week, days: Array(1...7),
                               contentWidth: gridWidth, isStatic: true)
            )

        let content = VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("药大拾间")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.cpuBrand)
                    Text("\(semesterTitle(result)) · 第 \(week) 周")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if isDayView {
                    Text("\(dayLabel(selectedDay)) · \(dayDate(selectedDay, week: week, result: result) ?? "")")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.secondary)
                } else if let range = weekRange(result), !range.isEmpty {
                    Text(range)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
            }
            grid
        }
        .padding(24)
        .frame(width: canvasWidth, alignment: .leading)
        .background(styleCanvas ?? Color(uiColor: .systemGroupedBackground))
        // ImageRenderer starts from a fresh environment.
        .environment(\.scheduleStyle, style)
        .environment(\.schedulePalette, preferences.palette)
        .environment(\.scheduleThemeBrand, ScheduleStyle.themeBrand(palette: preferences.palette))
        .environment(\.scheduleStaticRendering, true)
        .environment(\.colorScheme, style == .classic ? .light : colorScheme)

        let renderer = ImageRenderer(content: content)
        renderer.scale = UIScreen.main.scale
        guard let image = renderer.uiImage else { return }
        guard let url = NativeScheduleSharePresenter.writeImage(image, fileName: "药大拾间-第\(week)周-周课表.png") else { return }
        Task { @MainActor in
            // Let the More sheet finish its dismissal before asking SwiftUI
            // to present the system share controller.
            try? await Task.sleep(for: .milliseconds(350))
            sharePayload = NativeScheduleSharePayload(items: [url])
        }
    }

    /// Shares the viewed week as an `.ics` file. It carries the courses each
    /// date actually runs: nothing on a day off, the swapped courses on a make-up day.
    private func exportWeekCalendarFile(_ result: NativeScheduleResult) {
        guard let week = Int(store.selectedWeek) ?? Int(result.currentWeek) else { return }
        let days = (1...7).compactMap { day -> NativeScheduleICSExporter.Day? in
            guard let date = rawDayDate(day, week: week, result: result) else { return nil }
            return .init(date: date, blocks: blocks(for: day, week: week, result: result))
        }
        let ics = NativeScheduleICSExporter.make(week: week, days: days, clocks: ScheduleSlot.all)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("药大拾间-第\(week)周课表.ics")
        guard (try? Data(ics.utf8).write(to: url, options: .atomic)) != nil else { return }
        Task { @MainActor in
            // Let the More sheet finish its dismissal before presenting the share sheet.
            try? await Task.sleep(for: .milliseconds(350))
            sharePayload = NativeScheduleSharePayload(items: [url])
        }
    }

    private func presentAddCourse(day: Int, week: Int?, startSlot: Int) {
        // A course card and the slot grid are siblings in the same ZStack. On
        // older SwiftUI releases a delayed empty-slot callback can arrive
        // after the course callback; never let it replace an editor that is
        // already being presented.
        guard courseEditorPresentation == nil, !isReadOnly else { return }
        let context = AddCourseContext(
            day: min(max(day, 1), 7),
            week: week ?? Int(store.selectedWeek) ?? 1,
            startSlot: min(max(startSlot, 1), ScheduleSlot.all.count)
        )
        // Give a real course tap in the same touch cycle a chance to win
        // before committing the lower-priority add request.
        Task { @MainActor in
            await Task.yield()
            guard courseEditorPresentation == nil else { return }
            courseEditorPresentation = .add(context)
        }
    }

    private func moveWeek(_ offset: Int, result: NativeScheduleResult) {
        guard !weekPaging, let target = adjacentWeekValue(offset, result: result) else { return }
        guard viewMode == .week else {
            Task { await store.selectWeek(target) }
            return
        }
        guard let currentIndex = result.weeks.firstIndex(where: { $0.value == store.selectedWeek }),
              let targetIndex = result.weeks.firstIndex(where: { $0.value == target }) else { return }
        let selection = targetIndex > currentIndex ? 2 : 0
        withAnimation(.easeInOut(duration: 0.3)) {
            weekPageSelection = selection
        }
    }

    private func moveDay(_ offset: Int, result: NativeScheduleResult) {
        guard offset != 0, adjacentDayPage(offset, result: result) != nil, !dayPaging else { return }
        withAnimation(.easeInOut(duration: 0.3)) {
            dayPageSelection = offset > 0 ? 2 : 0
        }
    }

    private func adjacentDayPage(_ offset: Int, result: NativeScheduleResult) -> NativeScheduleDayPage? {
        guard offset != 0 else { return nil }
        let days = visibleDays
        let currentIndex = days.firstIndex(of: selectedDay) ?? 0
        let targetIndex = currentIndex + offset
        if days.indices.contains(targetIndex) {
            return NativeScheduleDayPage(week: store.selectedWeek.nilIfEmpty, day: days[targetIndex])
        }
        let weekOffset = offset > 0 ? 1 : -1
        guard let targetWeek = adjacentWeekValue(weekOffset, result: result) else { return nil }
        let targetDays = visibleDays(week: weekNumber(targetWeek), result: result)
        return NativeScheduleDayPage(week: targetWeek, day: offset > 0 ? (targetDays.first ?? 1) : (targetDays.last ?? 5))
    }

    private func adjacentWeekValue(_ offset: Int, result: NativeScheduleResult) -> String? {
        guard let currentIndex = result.weeks.firstIndex(where: { $0.value == store.selectedWeek }) else {
            return nil
        }
        let targetIndex = currentIndex + offset
        guard result.weeks.indices.contains(targetIndex) else { return nil }
        return result.weeks[targetIndex].value
    }

    private func jumpToCurrentWeek(_ result: NativeScheduleResult) {
        if let today = Self.todayDate {
            selectedMonthDate = today
            monthAnchor = today
        }
        pendingMonthDay = nil
        selectedDay = store.calendar?.weeks.first(where: { $0.week == store.calendar?.currentWeek })
            .flatMap { week in Self.todayDate.flatMap(week.days.firstIndex(of:)).map { $0 + 1 } }
            ?? Self.chinaWeekday
        didInitializeDay = true
        resetPagerSelections()
        guard !isViewingCurrentWeek(result) else { return }
        guard let calendar = store.calendar,
              calendar.currentWeek > 0,
              let semester = calendar.currentSemester.nilIfEmpty,
              let week = calendar.weeks.first(where: { $0.week == calendar.currentWeek }),
              let today = Self.todayDate,
              week.days.contains(today) else {
            store.selectedSemester = ""
            store.selectedWeek = ""
            selectedDay = Self.chinaWeekday
            didInitializeDay = true
            Task {
                await store.load(semester: nil, week: nil, force: true)
            }
            return
        }
        Task {
            await store.load(semester: semester, week: String(calendar.currentWeek), force: false)
        }
    }

    /// Daily mode has two independent selections: the teaching week and the
    /// weekday page. Returning to the current week alone left the selected
    /// weekday untouched, so the button became a no-op whenever another day
    /// in the same week was open.
    private func jumpToCurrentDay(_ result: NativeScheduleResult) {
        pendingMonthDay = nil
        if let today = Self.todayDate {
            selectedMonthDate = today
            monthAnchor = today
        }
        guard let calendar = store.calendar,
              calendar.currentWeek > 0,
              let semester = calendar.currentSemester.nilIfEmpty,
              let week = calendar.weeks.first(where: { $0.week == calendar.currentWeek }),
              let today = Self.todayDate else {
            selectedDay = Self.chinaWeekday
            didInitializeDay = true
            store.selectedSemester = ""
            store.selectedWeek = ""
            Task { await store.load(semester: nil, week: nil, force: true) }
            return
        }

        let targetDay = week.days.firstIndex(of: today).map { $0 + 1 } ?? Self.chinaWeekday
        let targetWeek = String(calendar.currentWeek)
        let sameWeek = store.selectedSemester == semester && store.selectedWeek == targetWeek

        guard sameWeek else {
            selectedDay = targetDay
            didInitializeDay = true
            Task { await store.load(semester: semester, week: targetWeek, force: false) }
            return
        }

        guard selectedDay != targetDay else { return }
        didInitializeDay = true
        // "返回今日" is a position reset, not a day swipe. Reusing the swipe
        // track here made a same-week jump animate in the wrong direction and
        // briefly exposed the neighbouring day. Commit every related state in
        // one animation-free transaction.
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            selectedDay = targetDay
            dayPageSelection = 1
        }
    }

    private func canMoveWeek(_ offset: Int, result: NativeScheduleResult) -> Bool {
        guard let currentIndex = result.weeks.firstIndex(where: { $0.value == store.selectedWeek }) else {
            return false
        }
        return result.weeks.indices.contains(currentIndex + offset)
    }

    private func isViewingCurrentWeek(_ result: NativeScheduleResult) -> Bool {
        guard let calendar = store.calendar,
              calendar.currentWeek > 0,
              let currentSemester = calendar.currentSemester.nilIfEmpty,
              let week = calendar.weeks.first(where: { $0.week == calendar.currentWeek }),
              let today = Self.todayDate,
              week.days.contains(today) else {
            return false
        }
        return store.selectedSemester == currentSemester && store.selectedWeek == String(calendar.currentWeek)
    }

    private func isViewingCurrentDay(_ result: NativeScheduleResult) -> Bool {
        guard isViewingCurrentWeek(result), dayIsToday(selectedDay, result: result) else { return false }
        return true
    }

    private func semesterTitle(_ result: NativeScheduleResult) -> String {
        result.semesters.first(where: { $0.value == store.selectedSemester })?.label
            ?? store.selectedSemester
            .nilIfEmpty
            ?? "选择学期"
    }

    private func weekTitle(_ result: NativeScheduleResult) -> String {
        if let label = result.weeks.first(where: { $0.value == store.selectedWeek })?.label, !label.isEmpty {
            return label
        }
        return store.selectedWeek.isEmpty ? "选择周次" : "第 \(store.selectedWeek) 周"
    }

    private func weekRange(_ result: NativeScheduleResult) -> String? {
        guard let weekNumber = Int(store.selectedWeek), let calendar = store.calendar,
              let item = calendar.weeks.first(where: { $0.week == weekNumber }) else {
            return nil
        }
        if !item.monday.isEmpty && !item.sunday.isEmpty {
            return "\(shortDate(item.monday)) - \(shortDate(item.sunday))"
        }
        return nil
    }

    private func dayDate(_ day: Int, result: NativeScheduleResult) -> String? {
        dayDate(day, week: weekNumber(store.selectedWeek), result: result)
    }

    private func dayDate(_ day: Int, week: Int?, result: NativeScheduleResult) -> String? {
        guard let value = rawDayDate(day, week: week, result: result) else { return nil }
        return shortDate(value)
    }

    private func dayIsToday(_ day: Int, result: NativeScheduleResult) -> Bool {
        dayIsToday(day, week: weekNumber(store.selectedWeek), result: result)
    }

    private func dayIsToday(_ day: Int, week: Int?, result: NativeScheduleResult) -> Bool {
        guard let value = rawDayDate(day, week: week, result: result), let today = Self.todayDate else {
            return false
        }
        return value == today
    }

    private func rawDayDate(_ day: Int, week: Int?, result: NativeScheduleResult) -> String? {
        guard let weekNumber = week, let calendar = store.calendar else { return nil }
        if let item = calendar.weeks.first(where: { $0.week == weekNumber }) {
            return item.days.indices.contains(day - 1) ? item.days[day - 1] : nil
        }
        // The Sunday before the term's first week: shown as the leading column
        // when the week starts on Sunday.
        if day == 7, let next = calendar.weeks.first(where: { $0.week == weekNumber + 1 }),
           let monday = next.days.first {
            return Self.shiftedDate(monday, by: -1)
        }
        return nil
    }

    private func adjustment(day: Int, week: Int?, result: NativeScheduleResult) -> NativeScheduleAdjustment? {
        guard let date = rawDayDate(day, week: week, result: result) else { return nil }
        return store.calendar?.adjustments.last(where: { $0.date == date && ($0.kind == "off" || $0.kind == "swap") })
    }

    private func adjustmentDetail(_ adjustment: NativeScheduleAdjustment) -> String {
        if adjustment.kind == "swap", adjustment.source?.isEmpty != false {
            return "补班，课程待确认"
        }
        if let note = adjustment.note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            return note
        }
        if adjustment.kind == "off" { return "放假，不上课" }
        guard let source = adjustment.source, !source.isEmpty else { return "调课" }
        return "上 \(shortDate(source)) 的课"
    }

    private func effectiveSlot(day: Int, week: Int?, result: NativeScheduleResult) -> (day: Int, week: Int?) {
        guard let adjustment = adjustment(day: day, week: week, result: result),
              adjustment.kind == "swap", let source = adjustment.source,
              let sourceWeek = store.calendar?.weeks.first(where: { $0.days.contains(source) }),
              let sourceIndex = sourceWeek.days.firstIndex(of: source) else { return (day, week) }
        return (sourceIndex + 1, sourceWeek.week)
    }

    private func dayShortLabel(_ day: Int) -> String {
        let labels = ["一", "二", "三", "四", "五", "六", "日"]
        return labels.indices.contains(day - 1) ? labels[day - 1] : String(day)
    }

    private func dayNumber(_ day: Int, week: Int?, result: NativeScheduleResult) -> String? {
        guard let date = rawDayDate(day, week: week, result: result),
              let last = date.split(separator: "-").last, let number = Int(last) else { return nil }
        return String(number)
    }

    private func weekNumber(_ value: String) -> Int? {
        Int(value.trimmingCharacters(in: .whitespaces))
    }

    // MARK: Two courses in one period

    /// Changes whenever the week on screen or what is in it does.
    private var overlapCheckID: String {
        "\(store.selectedSemester)|\(store.selectedWeek)|\(store.result?.cells.reduce(0) { $0 + $1.courses.count } ?? -1)|\(store.displayPriorities.count)"
    }

    /// Points out, once per place, two different courses of the user's own
    /// that the shown week draws side by side. Somebody else's timetable and
    /// the partner's courses are left out, and nothing is raised over another sheet.
    private func checkOverlapNotice() {
        guard !isBackgroundPreview, !isReadOnly, overlapNotice == nil, let result = store.result,
              let week = weekNumber(store.selectedWeek),
              courseEditorPresentation == nil, !weekPickerPresented, !scheduleToolsPresented, !backgroundEditorPresented,
              !stylePickerPresented, !sharingPresented, !couplePresented else { return }
        let pieces = (1...7).flatMap { day in
            blocks(for: day, week: week, result: result).map {
                ScheduleOverlapNotice.Piece(day: day, startSlot: $0.startSlot, endSlot: $0.endSlot, lane: $0.lane, name: $0.course.name)
            }
        }
        guard let notice = ScheduleOverlapNotice.find(pieces) else { return }
        let key = notice.key(semester: store.selectedSemester)
        guard !ScheduleOverlapNotice.seen(key) else { return }
        ScheduleOverlapNotice.remember(key)
        overlapNotice = notice
    }

    private func shortDate(_ value: String) -> String {
        let pieces = value.split(separator: "-")
        guard pieces.count >= 3 else { return value }
        return "\(pieces[pieces.count - 2]).\(pieces[pieces.count - 1])"
    }

    private func dayLabel(_ day: Int) -> String {
        ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].indices.contains(day - 1)
            ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1]
            : "周\(day)"
    }

    private func blocks(for day: Int, week: Int?, result: NativeScheduleResult) -> [NativeScheduleCourseBlock] {
        Self.dayBlocks(day: day, week: week, result: result, calendar: store.calendar, priorities: store.displayPriorities)
    }

    /// The courses of one weekday of a timetable, placed in lanes. `calendar`
    /// resolves days off and make-up days. Also used for the partner's
    /// timetable of the couple view, with their own calendar.
    private static func dayBlocks(day: Int, week: Int?, result: NativeScheduleResult, calendar: NativeScheduleCalendar?,
                                  priorities: [String: Int], idPrefix: String = "") -> [NativeScheduleCourseBlock] {
        var sourceDay = day
        var sourceWeek = week
        if let week,
           let calendar,
           let targetWeek = calendar.weeks.first(where: { $0.week == week }),
           targetWeek.days.indices.contains(day - 1),
           let adjustment = calendar.adjustments.first(where: { $0.date == targetWeek.days[day - 1] }) {
            if adjustment.kind == "off" { return [] }
            if adjustment.kind == "swap" {
                guard let source = adjustment.source,
                      let sourceWeekInfo = calendar.weeks.first(where: { $0.days.contains(source) }),
                      let sourceIndex = sourceWeekInfo.days.firstIndex(of: source) else { return [] }
                sourceWeek = sourceWeekInfo.week
                sourceDay = sourceIndex + 1
            }
        }
        let rawBlocks = result.cells
            .filter { $0.day == sourceDay }
            .flatMap { cell in
                cell.courses.enumerated().compactMap { index, course -> NativeScheduleCourseBlockRecord? in
                    let courseWeeks = nativeCourseWeekList(course)
                    if let sourceWeek, !courseWeeks.isEmpty, !courseWeeks.contains(sourceWeek) {
                        return nil
                    }
                    let fallbackStart = cell.bigSlot * 2 - 1
                    let fallbackEnd = cell.bigSlot * 2
                    var start = min(max(course.startSlot ?? fallbackStart, 1), ScheduleSlot.all.count)
                    var end = min(max(course.endSlot ?? fallbackEnd, start), ScheduleSlot.all.count)
                    // The parser's explicit range comes from the course detail
                    // and remains authoritative even when JWXT repeats the
                    // same course under a neighbouring physical big-slot row.
                    // Falling back to that row here splits one occurrence into
                    // two adjacent cards and makes it look duplicated.
                    return NativeScheduleCourseBlockRecord(
                        id: "\(idPrefix)\(week.map(String.init) ?? "-")-\(day)-\(cell.bigSlot)-\(index)-\(course.name)",
                        course: course,
                        bigSlot: cell.bigSlot,
                        startSlot: start,
                        endSlot: end
                    )
                }
            }
            .sorted { lhs, rhs in
                if lhs.startSlot != rhs.startSlot { return lhs.startSlot < rhs.startSlot }
                return lhs.endSlot < rhs.endSlot
            }

        // A course set to show first covers the periods it shares with the
        // others; without any priority this is the plain side-by-side layout.
        return NativeSchedulePriority.place(
            NativeScheduleCourseBlockMerger.merge(rawBlocks),
            priorities: priorities
        ).map { placed in
            NativeScheduleCourseBlock(
                id: placed.id,
                course: placed.block.course,
                bigSlot: placed.block.bigSlot,
                startSlot: placed.startSlot,
                endSlot: placed.endSlot,
                lane: placed.lane,
                courseStartSlot: placed.block.startSlot,
                courseEndSlot: placed.block.endSlot
            )
        }
    }

    /// The bridge normally sends `weekList`, but an older Web bundle may only
    /// send the human-readable `weeks` field. Keep the native filter aligned
    /// with Web's `courseMatchesWeek` so a course never disappears from (or
    /// reappears in) a selected week just because the bridge was deployed
    /// before the normalized list was added.
    private static func nativeCourseWeekList(_ course: NativeScheduleCourse) -> [Int] {
        let text = course.weeks
            .unicodeScalars
            .map { scalar -> String in
                if (0xFF10...0xFF19).contains(scalar.value) {
                    return String(scalar.value - 0xFF10)
                }
                return String(scalar)
            }
            .joined()
            .replacingOccurrences(of: "（", with: "(")
            .replacingOccurrences(of: "）", with: ")")
            .replacingOccurrences(of: "［", with: "(")
            .replacingOccurrences(of: "］", with: ")")
            .replacingOccurrences(of: "【", with: "(")
            .replacingOccurrences(of: "】", with: ")")
            .replacingOccurrences(of: "－", with: "-")
            .replacingOccurrences(of: "–", with: "-")
            .replacingOccurrences(of: "—", with: "-")
            .replacingOccurrences(of: "～", with: "-")
            .replacingOccurrences(of: "~", with: "-")
            .replacingOccurrences(of: "第", with: "")
            .replacingOccurrences(of: " ", with: "")
        let clauses = text
            .split(whereSeparator: { ",，、;；".contains($0) })
            .map(String.init)
            .filter { !$0.isEmpty }
        let sourceClauses = clauses.isEmpty ? [text] : clauses
        let expression = try? NSRegularExpression(pattern: #"(\d{1,2})\s*(?:[-至到]\s*(\d{1,2}))?"#)
        var values = Set<Int>()
        for clause in sourceClauses {
            guard let expression else { continue }
            let nsClause = clause as NSString
            let range = NSRange(location: 0, length: nsClause.length)
            let kind: WeekParity
            if clause.contains("单双") {
                kind = .all
            } else if clause.contains("单周") || clause.contains("单数周") || clause.contains("(单)") || clause.contains("单") {
                kind = .odd
            } else if clause.contains("双周") || clause.contains("双数周") || clause.contains("(双)") || clause.contains("双") {
                kind = .even
            } else {
                kind = .all
            }
            expression.enumerateMatches(in: clause, range: range) { match, _, _ in
                guard let match else { return }
                guard let start = Int(nsClause.substring(with: match.range(at: 1))) else { return }
                let end = match.range(at: 2).location == NSNotFound
                    ? start
                    : (Int(nsClause.substring(with: match.range(at: 2))) ?? start)
                let lower = max(1, min(start, end))
                let upper = min(64, max(start, end))
                guard lower <= upper else { return }
                for value in lower...upper {
                    if kind == .odd && value % 2 == 0 { continue }
                    if kind == .even && value % 2 == 1 { continue }
                    values.insert(value)
                }
            }
        }
        return values.isEmpty
            ? Array(Set(course.weekList.filter { $0 > 0 })).sorted()
            : values.sorted()
    }

    /// Horizontal page margin of the scrolling content.
    private static let contentInset: CGFloat = 16
    private static let slotAxisWidth: CGFloat = 38
    private static let columnGap: CGFloat = 4

    /// Eleven teaching slots plus the date header, sized to keep a complete
    /// day visible above the native tab bar on an iPhone-sized surface.
    private static let dayGridTopInset: CGFloat = 6
    /// Room above the week grid inside the pager, so a date header's border is
    /// not drawn on the page's clipping edge.
    private static let weekGridTopInset: CGFloat = 2
    /// Room above and below a styled day page, so the pager does not clip a
    /// card's shadow or the first row's rule.
    private static let styledDayInset: CGFloat = 12

    private static func scheduleGridHeight(
        rowHeight: CGFloat = NativeScheduleDayColumn.slotHeight,
        includesDateHeader: Bool = true,
        topInset: CGFloat = 0
    ) -> CGFloat {
        topInset
            + (includesDateHeader ? NativeScheduleDayColumn.dateHeaderHeight : 0)
            + CGFloat(ScheduleSlot.all.count) * rowHeight
            + CGFloat(max(0, ScheduleSlot.all.count - 1)) * NativeScheduleDayColumn.slotGap
    }

    private static var todayDate: String? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: .now)
    }

    private static var chinaWeekday: Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        let weekday = calendar.component(.weekday, from: .now)
        return weekday == 1 ? 7 : weekday - 1
    }
}

private enum WeekParity {
    case all
    case odd
    case even
}

private enum ScheduleViewMode: String, Hashable {
    case week
    case day
    case month
}

struct NativeScheduleCourseBlock: Identifiable {
    let id: String
    let course: NativeScheduleCourse
    let bigSlot: Int
    let startSlot: Int
    let endSlot: Int
    let lane: Int
    /// The periods the course really covers. They differ from `startSlot` and
    /// `endSlot` only when a course shown in front hides part of this one.
    let courseStartSlot: Int
    let courseEndSlot: Int
    /// Set while the couple timetable is drawn: whose course this is.
    var owner: CoupleOwner? = nil
    /// The couple timetable: this course of the user's meets one of the
    /// partner's and names it in a line at its foot.
    var coupleMeets = false

    init(
        id: String, course: NativeScheduleCourse, bigSlot: Int, startSlot: Int, endSlot: Int, lane: Int = 0,
        courseStartSlot: Int? = nil, courseEndSlot: Int? = nil
    ) {
        self.id = id
        self.course = course
        self.bigSlot = bigSlot
        self.startSlot = startSlot
        self.endSlot = endSlot
        self.lane = lane
        self.courseStartSlot = courseStartSlot ?? startSlot
        self.courseEndSlot = courseEndSlot ?? endSlot
    }

    func withLane(_ lane: Int) -> NativeScheduleCourseBlock {
        var copy = NativeScheduleCourseBlock(id: id, course: course, bigSlot: bigSlot, startSlot: startSlot, endSlot: endSlot,
                                             lane: lane, courseStartSlot: courseStartSlot, courseEndSlot: courseEndSlot)
        copy.owner = owner
        copy.coupleMeets = coupleMeets
        return copy
    }

    /// The whole course, for the quick look and the editor.
    var whole: NativeScheduleCourseBlock {
        var copy = NativeScheduleCourseBlock(id: id, course: course, bigSlot: bigSlot,
                                             startSlot: courseStartSlot, endSlot: courseEndSlot, lane: lane)
        copy.owner = owner
        return copy
    }
}

/// Keep the native editor's identity byte-for-byte compatible with Web's
/// `courseEditKey`. The bridge does not have to send a source key for every
/// untouched official course, so deriving the key here is what makes hiding or
/// editing one of those courses replace the original instead of duplicating it.
private func nativeCourseEditKey(day: Int, bigSlot: Int, course: NativeScheduleCourse) -> String {
    if let sourceKey = course.sourceKey?.trimmingCharacters(in: .whitespacesAndNewlines), !sourceKey.isEmpty {
        return sourceKey
    }
    func part(_ value: String?) -> String {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }
    return [
        "jwxt", String(day), String(bigSlot),
        course.startSlot.map(String.init) ?? "",
        course.endSlot.map(String.init) ?? "",
        part(course.name), part(course.teacher), part(course.location), part(course.weeks),
    ].joined(separator: "|")
}

private struct SelectedCourse: Identifiable {
    let id: String
    let course: NativeScheduleCourse
    let day: Int
    let bigSlot: Int
    let startSlot: Int
    let endSlot: Int
    /// "周三 · 第 5–6 节 · 13:30–15:10", shown in the quick look.
    var schedule: String? = nil
    /// 「小鹿的课」 for a course of the partner's, which cannot be edited here.
    var ownerTitle: String? = nil
}

private struct AddCourseContext: Identifiable {
    let id = UUID()
    let day: Int
    let week: Int
    let startSlot: Int
}

private enum CourseEditorPresentation: Identifiable {
    /// The quick look; its edit button swaps the same sheet to the editor.
    case preview(SelectedCourse)
    case edit(SelectedCourse)
    case add(AddCourseContext)

    var id: String {
        switch self {
        case .preview(let selection): return "preview:\(selection.id)"
        case .edit(let selection): return selection.id
        case .add(let context): return "add:\(context.id.uuidString)"
        }
    }
}

private struct NativeScheduleDayPage: Equatable {
    let week: String?
    let day: Int
}

struct ScheduleSlot {
    let number: Int
    let start: String
    let end: String

    static let all = NativeSchedulePeriod.bundledTimetable.map {
        ScheduleSlot(number: $0.number, start: $0.startTime, end: $0.endTime)
    }

}

@available(iOS 17.0, *)
private struct NativeAdjustmentBadge: View {
    let kind: String

    var body: some View {
        Text(kind == "off" ? "休" : "班")
            .font(.system(size: 8, weight: .semibold))
            .foregroundStyle(.white)
            .fixedSize()
            .frame(width: 11, height: 11)
            .background(
                (kind == "off" ? Color.pink : Color.orange).opacity(0.85),
                in: RoundedRectangle(cornerRadius: 3, style: .continuous)
            )
    }
}

@available(iOS 17.0, *)
private struct NativeScheduleDayColumn: View {
    @Environment(\.scheduleCouple) private var couple
    @Environment(\.colorScheme) private var colorScheme
    // Web's compact mobile grid uses 44px rows. Keeping that rhythm here
    // gives the week view enough breathing room while all eleven rows still
    // fit above the native tab bar.
    static let slotHeight: CGFloat = 44
    // The day layout has an extra seven-day picker above the grid. A slightly
    // shorter row keeps its eleventh slot clear of the native tab bar while
    // preserving the room needed for the teacher line in course cards.
    static let daySlotHeight: CGFloat = 41
    // The Web grid uses a 3px row gap on mobile. Keep the native cells on the
    // same rhythm so empty rows do not look stretched apart.
    static let slotGap: CGFloat = 3
    static let dateHeaderHeight: CGFloat = 54

    let day: Int
    let dateText: String?
    let isToday: Bool
    let adjustment: NativeScheduleAdjustment?
    let columnWidth: CGFloat
    let rowHeight: CGFloat
    let compactCards: Bool
    let showsDateHeader: Bool
    let blocks: [NativeScheduleCourseBlock]
    let palette: String
    let showLocation: Bool
    let showTeacher: Bool
    let showPeriod: Bool
    let showWeeks: Bool
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void
    let onEmptySlot: (Int) -> Void
    /// Courses that do not run this week, faded under the others.
    let offWeekBlocks: [NativeScheduleCourseBlock]
    /// The partner's courses that meet one of the user's: named at the foot of that course.
    var coupleClashes: [NativeScheduleCourseBlock] = []

    init(
        day: Int,
        dateText: String?,
        isToday: Bool,
        adjustment: NativeScheduleAdjustment? = nil,
        columnWidth: CGFloat,
        rowHeight: CGFloat,
        compactCards: Bool,
        showsDateHeader: Bool,
        blocks: [NativeScheduleCourseBlock],
        palette: String = "color-glass",
        showLocation: Bool = true,
        showTeacher: Bool = true,
        showPeriod: Bool = true,
        showWeeks: Bool = true,
        onCourseSelected: @escaping (NativeScheduleCourseBlock) -> Void,
        onEmptySlot: @escaping (Int) -> Void,
        offWeekBlocks: [NativeScheduleCourseBlock] = [],
        coupleClashes: [NativeScheduleCourseBlock] = []
    ) {
        self.offWeekBlocks = offWeekBlocks
        self.coupleClashes = coupleClashes
        self.day = day
        self.dateText = dateText
        self.isToday = isToday
        self.adjustment = adjustment
        self.columnWidth = columnWidth
        self.rowHeight = rowHeight
        self.compactCards = compactCards
        self.showsDateHeader = showsDateHeader
        self.blocks = blocks
        self.palette = palette
        self.showLocation = showLocation
        self.showTeacher = showTeacher
        self.showPeriod = showPeriod
        self.showWeeks = showWeeks
        self.onCourseSelected = onCourseSelected
        self.onEmptySlot = onEmptySlot
    }

    /// A lane is only needed while course intervals overlap. The old grid
    /// used the maximum lane count for the entire day, which made every
    /// unrelated row render as a half-width empty column when one slot had a
    /// parallel class.
    private func laneCount(for block: NativeScheduleCourseBlock) -> Int {
        let overlapping = blocks.filter {
            $0.startSlot <= block.endSlot && block.startSlot <= $0.endSlot
        }
        return max(1, (overlapping.map(\.lane).max() ?? 0) + 1)
    }

    private func laneCount(forSlot slot: Int) -> Int {
        let active = blocks.filter { ($0.startSlot...$0.endSlot).contains(slot) }
        guard !active.isEmpty else { return 1 }
        return max(1, active.map { laneCount(for: $0) }.max() ?? 1)
    }

    var body: some View {
        VStack(spacing: 0) {
            if showsDateHeader {
                VStack(spacing: 3) {
                    Text(dayLabel).font(.system(size: 13, weight: .bold))
                    HStack(spacing: 1) {
                        Text(dateText ?? "--")
                            .font(.system(size: 11, weight: .semibold).monospacedDigit())
                            .lineLimit(1).minimumScaleFactor(0.6)
                        if let adjustment { NativeAdjustmentBadge(kind: adjustment.kind) }
                    }
                    .frame(maxWidth: max(0, columnWidth - 6))
                }
                .foregroundStyle(isToday
                    ? (colorScheme == .dark ? NativeSchedulePalette.RGBA(0x9fd9cf).color : Color.cpuBrand)
                    : NativeScheduleThemeColor.secondary(colorScheme))
                .frame(width: columnWidth, height: Self.dateHeaderHeight - 8)
                .background {
                    let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
                    NativeScheduleBackgroundSurface()
                        .overlay {
                            if isToday { Color.cpuBrand.opacity(colorScheme == .dark ? 0.18 : 0.10) }
                        }
                        .clipShape(shape)
                        .overlay { shape.strokeBorder(isToday ? Color.cpuBrand : NativeScheduleThemeColor.cellBorder(colorScheme), lineWidth: 1) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(dayLabel) \(dateText ?? "")\(adjustment.map { $0.kind == "off" ? "，休息" : "，补班" } ?? "")")
                .padding(.bottom, 8)
            }

            ZStack(alignment: .topLeading) {
                VStack(spacing: Self.slotGap) {
                    ForEach(ScheduleSlot.all, id: \.number) { slot in
                        // The grid-level spatial tap below owns the empty-cell
                        // action. Keeping these cells visual-only means a
                        // long course card can never lose its tap to a
                        // transparent button from an occupied row.
                        slotRow(slot)
                    }
                }
                // A course that does not run this week takes no taps, so the
                // free period under it still adds a course.
                ForEach(offWeekBlocks) { block in
                    let cardHeight = max(
                        34,
                        CGFloat(block.endSlot - block.startSlot + 1) * rowHeight
                            + CGFloat(block.endSlot - block.startSlot) * Self.slotGap
                            - 2
                    )
                    NativeScheduleCourseCard(
                        course: block.course,
                        palette: palette,
                        showLocation: showLocation,
                        showTeacher: showTeacher,
                        showPeriod: showPeriod,
                        showWeeks: showWeeks,
                        compact: compactCards || columnWidth < 70
                    )
                    .overlay(alignment: .bottom) { ScheduleOffWeekTag() }
                    .frame(width: max(12, columnWidth - 2), height: cardHeight)
                    .opacity(0.5)
                    .allowsHitTesting(false)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("非本周，\(block.course.name)")
                    .offset(x: 1, y: CGFloat(block.startSlot - 1) * (rowHeight + Self.slotGap) + 1)
                }
                ForEach(blocks) { block in
                    let blockLaneCount = laneCount(for: block)
                    let laneWidth = columnWidth / CGFloat(blockLaneCount)
                    let cardWidth = max(12, laneWidth - 2)
                    let cardHeight = max(
                        34,
                        CGFloat(block.endSlot - block.startSlot + 1) * rowHeight
                            + CGFloat(block.endSlot - block.startSlot) * Self.slotGap
                            - 2
                    )
                    Button {
                        onCourseSelected(block)
                    } label: {
                        if let owner = block.owner, let couple {
                            // One colour per person while the partner's courses are shown.
                            ScheduleCouplePersonTile(
                                course: block.course, layer: couple, partner: owner == .partner,
                                compact: compactCards || laneWidth < 70, showLocation: showLocation,
                                note: ScheduleCoupleNote.kind(for: block, clashes: coupleClashes), tiny: blockLaneCount > 2
                            )
                            .frame(width: cardWidth, height: cardHeight)
                        } else {
                            // Three or more side by side: a card two characters wide keeps the name only.
                            let tiny = blockLaneCount > 2
                            NativeScheduleCourseCard(
                                course: block.course,
                                palette: palette,
                                showLocation: showLocation && !tiny,
                                showTeacher: showTeacher && !tiny,
                                showPeriod: showPeriod && !tiny,
                                showWeeks: showWeeks && !tiny,
                                compact: compactCards || columnWidth < 70
                            )
                            .frame(width: cardWidth, height: cardHeight)
                        }
                    }
                    .buttonStyle(.plain)
                    // Fix the button's layout and hit rectangle at the same
                    // size as the visible card. This matters for long
                    // rowspan courses whose GeometryReader otherwise leaves
                    // the Button with an undersized intrinsic label.
                    .frame(width: cardWidth, height: cardHeight)
                    .contentShape(Rectangle())
                    .zIndex(10)
                    .offset(
                        x: 1 + CGFloat(block.lane) * laneWidth,
                        y: CGFloat(block.startSlot - 1) * (rowHeight + Self.slotGap) + 1
                    )
                }
            }
            .frame(
                width: columnWidth,
                height: CGFloat(ScheduleSlot.all.count) * rowHeight
                    + CGFloat(max(0, ScheduleSlot.all.count - 1)) * Self.slotGap
            )
            // SwiftUI can deliver a tap to the underlying grid when a card is
            // offset across several rows. Resolve the actual point here first
            // so a course always wins; only a point outside every card creates
            // a new course.
            .highPriorityGesture(
                SpatialTapGesture().onEnded { value in
                    if let block = block(at: value.location) {
                        onCourseSelected(block)
                    } else if let slot = slot(at: value.location) {
                        onEmptySlot(slot)
                    }
                }
            )
        }
        .frame(width: columnWidth)
    }

    private func block(at point: CGPoint) -> NativeScheduleCourseBlock? {
        // Iterate from the last rendered block so the hit test follows the
        // same topmost ordering SwiftUI uses for overlapping cards.
        for block in blocks.reversed() {
            let blockLaneCount = laneCount(for: block)
            let laneWidth = columnWidth / CGFloat(blockLaneCount)
            let width = max(12, laneWidth - 2)
            let height = max(
                34,
                CGFloat(block.endSlot - block.startSlot + 1) * rowHeight
                    + CGFloat(block.endSlot - block.startSlot) * Self.slotGap
                    - 2
            )
            let rect = CGRect(
                x: 1 + CGFloat(block.lane) * laneWidth,
                y: CGFloat(block.startSlot - 1) * (rowHeight + Self.slotGap) + 1,
                width: width,
                height: height
            )
            guard rect.contains(point) else { continue }
            // The line at the foot of the card opens the partner's course.
            if couple != nil, blockLaneCount < 3,
               case .partner(let theirs) = ScheduleCoupleNote.kind(for: block, clashes: coupleClashes),
               ScheduleCoupleNote.tapArea(in: rect).contains(point) {
                return theirs[0]
            }
            return block
        }
        return nil
    }

    private func slot(at point: CGPoint) -> Int? {
        guard point.y >= 0 else { return nil }
        let stride = rowHeight + Self.slotGap
        let value = Int(floor(point.y / stride)) + 1
        guard ScheduleSlot.all.indices.contains(value - 1) else { return nil }
        return value
    }

    private func slotRow(_ slot: ScheduleSlot) -> some View {
        let rowLaneCount = laneCount(forSlot: slot.number)
        return HStack(spacing: 0) {
            ForEach(0..<rowLaneCount, id: \.self) { lane in
                let laneOccupied = blocks.contains {
                    $0.lane == lane && ($0.startSlot...$0.endSlot).contains(slot.number)
                }
                Group {
                    if laneOccupied {
                        Color.clear
                    } else {
                        ScheduleGlassBackground(
                            cornerRadius: showsDateHeader ? 8 : 12,
                            colors: isToday ? [Color.cpuBrand.opacity(colorScheme == .dark ? 0.08 : 0.045)] : [.clear]
                        )
                    }
                }
                    .frame(width: max(12, columnWidth / CGFloat(rowLaneCount) - 2), height: rowHeight - 2)
                    .frame(width: columnWidth / CGFloat(rowLaneCount), height: rowHeight)
            }
        }
        .contentShape(Rectangle())
    }

    private var dayLabel: String {
        ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].indices.contains(day - 1)
            ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1]
            : "周\(day)"
    }
}

/// Native Liquid Glass is confined to controls. Course grids retain lightweight
/// gradients so scrolling does not create dozens of live blur surfaces.
@available(iOS 17.0, *)
private struct ScheduleGlassControl: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let cornerRadius: CGFloat
    var tint: Color? = nil
    var interactive = true

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color(uiColor: .secondarySystemGroupedBackground))
                    .overlay {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .strokeBorder(Color(uiColor: .separator).opacity(0.22), lineWidth: 0.7)
                    }
            }
        } else {
#if compiler(>=6.2)
            if #available(iOS 26.0, *) {
                content.glassEffect(
                    .regular.tint(tint).interactive(interactive && isEnabled && !reduceMotion),
                    in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                )
            } else {
                legacyMaterial(content)
            }
#else
            legacyMaterial(content)
#endif
        }
    }

    private func legacyMaterial(_ content: Content) -> some View {
        content.background {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(tint ?? .clear)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(LinearGradient(
                            colors: [.white.opacity(0.35), Color(uiColor: .separator).opacity(0.15)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ), lineWidth: 0.7)
                }
        }
    }
}

@available(iOS 17.0, *)
private struct ScheduleGlassBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    let cornerRadius: CGFloat
    var colors: [Color] = [.clear, .clear]
    var border: Color? = nil
    var lineWidth: CGFloat = 0.7

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        NativeScheduleBackgroundSurface(strength: .cell)
            .clipShape(shape)
            .overlay {
                shape.fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
            }
            .overlay {
                shape.fill(LinearGradient(
                    stops: [
                        .init(color: .white.opacity(colorScheme == .dark ? 0.08 : 0.32), location: 0),
                        .init(color: .white.opacity(0.02), location: 0.45),
                        .init(color: .clear, location: 1),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
            }
            .overlay { shape.strokeBorder(border ?? NativeScheduleThemeColor.cellBorder(colorScheme), lineWidth: lineWidth) }
            .allowsHitTesting(false)
    }
}

@available(iOS 17.0, *)
private struct NativeScheduleCourseCard: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scheduleWeekDisplay) private var display
    let course: NativeScheduleCourse
    let palette: String
    let showLocation: Bool
    let showTeacher: Bool
    let showPeriod: Bool
    let showWeeks: Bool
    var compact = false

    var body: some View {
        GeometryReader { geometry in
            let shortCard = geometry.size.height < 64
            let location = showLocation ? ScheduleStyleTime.location(course.location) : nil
            let teacher = showTeacher ? clean(course.teacher) : nil
            let details = [
                showPeriod ? clean(course.slotNote) : nil,
                showWeeks ? clean(course.weeks) : nil,
            ].compactMap { $0 }
            let note = details.isEmpty ? nil : details.joined(separator: " · ")
            // Week cards carry the teacher only when the display setting asks
            // for it, on a line of its own: a column is too narrow for
            // 「@教学楼 201 · 李老师」 and the name was the part cut off.
            let weekTeacher = compact && display.showTeacher && !shortCard ? clean(course.teacher) : nil
            let metadata: String? = {
                let values: [String] = compact
                    ? [
                        location.map { "@\($0.trimmingCharacters(in: CharacterSet(charactersIn: "@＠")))" },
                    ].compactMap { $0 }
                    : [
                        location.map { "@\($0.trimmingCharacters(in: CharacterSet(charactersIn: "@＠")))" },
                        teacher,
                    ].compactMap { $0 }
                return values.isEmpty ? nil : values.joined(separator: " · ")
            }()

            VStack(alignment: compact ? .center : .leading, spacing: compact ? 2 : (shortCard ? 3 : 7)) {
                Text(course.name)
                    .font(.system(size: (compact ? 10 : (shortCard ? 14 : 18)) * display.textScale, weight: .bold))
                    .lineLimit(shortCard ? 2 : (compact ? 4 : 3))
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity, alignment: compact ? .center : .leading)
                    .layoutPriority(1)

                if let metadata {
                    Text(metadata)
                        .font(.system(size: (compact ? 9 : 13) * display.textScale, weight: .semibold))
                        .lineLimit(shortCard ? 1 : 2)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity, alignment: compact ? .center : .leading)
                        .layoutPriority(0)
                }

                if let weekTeacher {
                    Text(weekTeacher)
                        .font(.system(size: 9 * display.textScale, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .opacity(0.86)
                }

                if !compact, !shortCard, let note {
                    Text(note)
                        .font(.system(size: 11, weight: .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, alignment: compact ? .center : .leading)
                        .opacity(0.86)
                }
            }
            .multilineTextAlignment(compact ? .center : .leading)
            .foregroundStyle(tone.text.color)
            .padding(.horizontal, compact ? 3 : 14)
            .padding(.vertical, shortCard ? 4 : 7)
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .center)
        }
        .background {
            let shape = RoundedRectangle(cornerRadius: compact ? 9 : 16, style: .continuous)
            shape.fill(LinearGradient(colors: [tone.top.color, tone.bottom.color],
                                      startPoint: .top, endPoint: .bottom))
                .overlay(alignment: .top) {
                    shape.strokeBorder(.white.opacity(colorScheme == .dark ? 0.20 : 0.32), lineWidth: 0.5)
                }
                .overlay { shape.strokeBorder(tone.border.color, lineWidth: 1.5) }
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: compact ? 9 : 16, style: .continuous))
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.22 : 0.06),
                radius: compact ? 4 : 8, y: compact ? 2 : 4)
        .accessibilityElement(children: .combine)
    }

    private var tone: NativeSchedulePalette.Tone {
        NativeSchedulePalette.tone(name: course.name, palette: palette, dark: colorScheme == .dark)
    }

    private func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }
}

/// The course sheet opened by a tap: the quick look at its content height,
/// then the editor at full height once "编辑" is pressed.
@available(iOS 17.0, *)
private struct NativeCourseQuickLookSheet: View {
    let selection: SelectedCourse
    @ObservedObject var store: NativeScheduleStore

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var editing = false
    @State private var detent: PresentationDetent = .height(280)
    @State private var previewHeight: CGFloat = 280

    var body: some View {
        Group {
            if editing {
                NativeCourseEditorSheet(selection: selection, store: store)
            } else {
                ScheduleCourseQuickLook(
                    course: selection.course,
                    schedule: selection.schedule,
                    ownerTitle: selection.ownerTitle,
                    onEdit: store.isReadOnly || selection.ownerTitle != nil ? nil : {
                        withAnimation(reduceMotion ? nil : .snappy(duration: 0.3)) {
                            detent = .large
                            editing = true
                        }
                    },
                    onHeightChange: { height in
                        let height = min(560, max(180, ceil(height)))
                        guard abs(height - previewHeight) > 1 else { return }
                        previewHeight = height
                        if !editing && detent != .large { detent = .height(height) }
                    }
                )
            }
        }
        // Short content hugs its height and can be pulled to full; the editor is full height only.
        .presentationDetents(editing ? [.large] : [.height(previewHeight), .large], selection: $detent)
    }
}

@available(iOS 17.0, *)
private struct NativeCourseEditorSheet: View {
    let selection: SelectedCourse?
    @ObservedObject var store: NativeScheduleStore
    let defaultDay: Int
    let defaultWeek: Int
    let defaultStartSlot: Int
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var teacher: String
    @State private var location: String
    @State private var note: String
    /// The "when it meets" groups. The first is the block being edited; more
    /// can be added, and each may pick periods that are not consecutive.
    @State private var arrangements: [ArrangementDraft]
    /// Show this course in front of the ones it overlaps.
    @State private var preferred: Bool
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var hiddenCourses: [(String, String)] = []

    init(selection: SelectedCourse?, store: NativeScheduleStore, defaultDay: Int = 1, defaultWeek: Int = 1, defaultStartSlot: Int = 1) {
        self.selection = selection
        self.store = store
        self.defaultDay = defaultDay
        self.defaultWeek = defaultWeek
        self.defaultStartSlot = defaultStartSlot
        let course = selection?.course
        _name = State(initialValue: course?.name ?? "")
        _teacher = State(initialValue: course?.teacher ?? "")
        _location = State(initialValue: course?.location ?? "")
        // The card shows the period label of a merged block; the field holds only what was written.
        _note = State(initialValue: course?.editableNote ?? "")
        _preferred = State(initialValue: course.map {
            NativeSchedulePriority.value(of: $0.name, in: store.displayPriorities) > 0
        } ?? false)
        let start = selection?.startSlot ?? defaultStartSlot
        let end = max(start, selection?.endSlot ?? min(defaultStartSlot + 1, ScheduleSlot.all.count))
        let list = course?.weekList ?? [defaultWeek]
        _arrangements = State(initialValue: [ArrangementDraft(
            day: selection?.day ?? defaultDay,
            slots: Set(start...end),
            weekMode: list.isEmpty ? "all" : (list == [defaultWeek] ? "current" : "custom"),
            selectedWeeks: Set(list.isEmpty ? [defaultWeek] : list)
        )])
    }

    private struct ArrangementDraft: Identifiable {
        let id = UUID()
        var day: Int
        var slots: Set<Int>
        /// "current", "all" or "custom".
        var weekMode: String
        var selectedWeeks: Set<Int>
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let selection, selection.course.custom || selection.course.orphaned {
                        editorCard { courseStatusCard(selection.course) }
                    }

                    Text("课程信息")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                    editorCard {
                        editorFieldRow("课程") {
                            TextField("课程名称", text: $name)
                                .multilineTextAlignment(.trailing)
                        }
                        editorFieldRow("老师") {
                            TextField("选填", text: $teacher)
                                .multilineTextAlignment(.trailing)
                        }
                        editorFieldRow("地点") {
                            TextField("选填", text: $location)
                                .multilineTextAlignment(.trailing)
                        }
                        editorFieldRow("备注") {
                            TextField("选填", text: $note)
                                .multilineTextAlignment(.trailing)
                        }
                    }

                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text("时间段")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 8)
                        if canRestoreOriginalCourse, let sourceKey = selection?.course.sourceKey {
                            Button("使用教务安排") { restoreOriginal(sourceKey: sourceKey) }
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.cpuBrand)
                                .disabled(saving)
                        }
                        if selection != nil {
                            Button("删除", role: .destructive) { deleteCourse() }
                                .font(.caption.weight(.semibold))
                                .disabled(saving)
                        }
                    }
                    .padding(.horizontal, 4)

                    ForEach($arrangements) { $arrangement in
                        arrangementCard($arrangement)
                    }

                    Button {
                        withAnimation(.snappy(duration: 0.2)) {
                            let last = arrangements.last
                            arrangements.append(ArrangementDraft(
                                day: last?.day ?? defaultDay,
                                slots: [],
                                weekMode: last?.weekMode ?? "all",
                                selectedWeeks: last?.selectedWeeks ?? [defaultWeek]
                            ))
                        }
                    } label: {
                        Label("添加上课时间", systemImage: "plus.circle")
                            .font(.body.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(Color(uiColor: .secondarySystemGroupedBackground),
                                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.cpuBrand)
                    .disabled(saving)

                    let overlapping = overlappingNames
                    if !overlapping.isEmpty || preferred {
                        editorCard {
                            Toggle(isOn: $preferred) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("优先显示这门课")
                                    Text(overlapping.isEmpty
                                         ? "和别的课重叠时，重叠的节次只显示这门课。"
                                         : "和\(overlapping.map { "「\($0)」" }.joined())重叠的节次只显示这门课，其他课程仍保留在课表里。")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .tint(.cpuBrand)
                            .disabled(saving)
                        }
                    }

                    if !hiddenCourses.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("已编辑课程")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                            editorCard {
                                ForEach(hiddenCourses, id: \.0) { item in
                                    Button("恢复：\(item.1)") { restoreHiddenCourse(item.0) }
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .disabled(saving)
                                }
                            }
                        }
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollIndicators(.hidden)
            .navigationTitle(selection == nil ? "添加课程" : "编辑课程")
            .navigationBarTitleDisplayMode(.inline)
            .task { await loadHiddenCourses() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "保存中" : "保存") { saveCourse() }
                        .disabled(saving)
                }
            }
        }
    }

    private var canRestoreOriginalCourse: Bool {
        guard let course = selection?.course else { return false }
        return course.customId != nil && course.sourceKey != nil
    }

    @ViewBuilder
    private func editorCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private func editorFieldRow<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.body)
                .foregroundStyle(.primary)
            Spacer(minLength: 8)
            content()
                .font(.body)
                .foregroundStyle(.primary)
                .frame(maxWidth: 190, alignment: .trailing)
        }
        .frame(minHeight: 48)
        .padding(.horizontal, 14)
        .overlay(alignment: .bottom) {
            Divider().padding(.horizontal, 14)
        }
    }

    private func editorStepperRow(_ title: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.body)
                .foregroundStyle(.primary)
            Spacer(minLength: 8)
            Stepper("", value: value, in: range)
                .labelsHidden()
        }
        .frame(minHeight: 48)
        .padding(.horizontal, 14)
        .overlay(alignment: .bottom) {
            Divider().padding(.horizontal, 14)
        }
    }

    @ViewBuilder
    private func courseStatusCard(_ course: NativeScheduleCourse) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(course.orphaned ? "这门课的安排需要核对" : statusTitle(for: course))
                .font(.subheadline.weight(.semibold))
            Text(statusMessage(for: course))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if course.orphaned {
                Text("继续用自己的安排，可保留为自定义课程；以教务为准，可选择“使用教务安排”。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("保留为自定义课程") { saveCourse(keepAsCustom: true) }
                    .disabled(saving)
            }
        }
        .padding(.vertical, 4)
    }

    private func statusTitle(for course: NativeScheduleCourse) -> String {
        if course.custom { return "自定义课程" }
        if course.sourceKey != nil { return "已编辑课程" }
        return "教务课程"
    }

    private func statusMessage(for course: NativeScheduleCourse) -> String {
        if course.orphaned {
            return "当前教务课表与保存编辑时的信息未能对应，可能是时间、周次、老师或地点变化，不表示课程已取消。这里仍保留着你的编辑。"
        }
        if course.sourceKey != nil {
            return "这是你编辑过的课程，可通过“使用教务安排”移除个人修改。"
        }
        if course.custom {
            return "这是你添加或保留的自定义课程，不属于教务课表。"
        }
        return "这是来自教务系统的课程安排。"
    }

    private func saveCourse(keepAsCustom: Bool = false) {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { errorMessage = "请填写课程名称"; return }
        var resolved: [NativeCourseArrangement] = []
        for (index, draft) in arrangements.enumerated() {
            let title = arrangements.count > 1 ? "上课时间 \(index + 1)：" : ""
            let slots = draft.slots.filter { (1...ScheduleSlot.all.count).contains($0) }
            guard !slots.isEmpty else { errorMessage = "\(title)请选择至少一节"; return }
            let weekList: [Int]
            switch draft.weekMode {
            case "all": weekList = []
            case "current": weekList = [defaultWeek]
            default:
                weekList = draft.selectedWeeks.sorted()
                guard !weekList.isEmpty else { errorMessage = "\(title)请选择至少一个周次"; return }
            }
            resolved.append(NativeCourseArrangement(day: draft.day, slots: slots, weekList: weekList))
        }
        guard let first = resolved.first, let firstRun = first.runs.first else { return }
        let source = selection?.course
        let editingSourceKey: String? = source.flatMap {
            // A pure custom course has no official source to hide or restore.
            if $0.customId != nil, $0.sourceKey == nil { return nil }
            return nativeCourseEditKey(
                day: selection?.day ?? first.day,
                bigSlot: selection?.bigSlot ?? (firstRun.lowerBound + 1) / 2,
                course: $0
            )
        }
        let savedSourceKey = keepAsCustom ? nil : editingSourceKey
        // The first block keeps the identity of the course being edited; every
        // further block is saved as a plain custom item of the same course.
        let items = NativeCourseArrangement.customItems(
            details: .init(name: trimmedName, teacher: teacher, location: location, note: note),
            arrangements: resolved,
            primaryID: source?.customId ?? "custom-\(UUID().uuidString.lowercased())",
            primarySourceKey: savedSourceKey,
            makeID: { "custom-\(UUID().uuidString.lowercased())" }
        )
        saving = true
        Task { @MainActor in
            do {
                var edits = try await store.loadScheduleEdits()
                if let source {
                    if let customId = source.customId {
                        edits.custom.removeAll { $0.id == customId }
                    } else {
                        if !keepAsCustom, let key = editingSourceKey, !key.isEmpty && !edits.hidden.contains(key) {
                            edits.hidden.append(key)
                        }
                        if let editingSourceKey {
                            edits.custom.removeAll { $0.sourceKey == editingSourceKey }
                        }
                    }
                }
                let ids = Set(items.map(\.id))
                edits.custom.removeAll { ids.contains($0.id) }
                edits.custom.append(contentsOf: items)
                let priorityKey = NativeSchedulePriority.key(trimmedName)
                if !preferred {
                    edits.priority[priorityKey] = nil
                } else if (edits.priority[priorityKey] ?? 0) <= 0
                            || edits.priority.contains(where: { $0.key != priorityKey && $0.value >= edits.priority[priorityKey] ?? 0 }) {
                    // In front of every course that already has a priority.
                    edits.priority[priorityKey] = NativeSchedulePriority.top(in: edits.priority)
                }
                try await store.saveScheduleEdits(edits)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private func loadHiddenCourses() async {
        guard selection == nil || selection?.course.customId == nil else { return }
        guard let result = store.result else { return }
        do {
            let edits = try await store.loadScheduleEdits()
            var values: [(String, String)] = []
            for cell in result.cells {
            for course in cell.courses {
                    let key = nativeCourseEditKey(day: cell.day, bigSlot: cell.bigSlot, course: course)
                    if edits.hidden.contains(key) {
                        values.append((key, course.name))
                    }
                }
            }
            hiddenCourses = values
        } catch {
            hiddenCourses = []
        }
    }

    private func deleteCourse() {
        guard let source = selection?.course else { return }
        saving = true
        Task { @MainActor in
            do {
                var edits = try await store.loadScheduleEdits()
                if let customId = source.customId {
                    edits.custom.removeAll { $0.id == customId }
                } else {
                    let key = nativeCourseEditKey(day: selection?.day ?? 1, bigSlot: selection?.bigSlot ?? 1, course: source)
                    if !key.isEmpty && !edits.hidden.contains(key) { edits.hidden.append(key) }
                    edits.custom.removeAll { $0.sourceKey == key }
                }
                try await store.saveScheduleEdits(edits)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private func restoreHiddenCourse(_ key: String) {
        saving = true
        Task { @MainActor in
            do {
                var edits = try await store.loadScheduleEdits()
                edits.hidden.removeAll { $0 == key }
                try await store.saveScheduleEdits(edits)
                hiddenCourses.removeAll { $0.0 == key }
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private func restoreOriginal(sourceKey: String) {
        saving = true
        Task { @MainActor in
            do {
                var edits = try await store.loadScheduleEdits()
                edits.hidden.removeAll { $0 == sourceKey }
                edits.custom.removeAll { $0.sourceKey == sourceKey }
                try await store.saveScheduleEdits(edits)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private func dayLabel(_ value: Int) -> String {
        ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].indices.contains(value - 1)
            ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][value - 1] : "周\(value)"
    }

    private var weekNumberOptions: [Int] {
        let values = (store.result?.weeks ?? []).compactMap { Int($0.value) }.filter { $0 > 0 }
        if !values.isEmpty { return Array(Set(values)).sorted() }
        let maxWeek = max(defaultWeek, 20)
        return Array(1...maxWeek)
    }

    /// One "when it meets" group: weeks, weekday and any set of periods.
    private func arrangementCard(_ arrangement: Binding<ArrangementDraft>) -> some View {
        let draft = arrangement.wrappedValue
        let index = arrangements.firstIndex { $0.id == draft.id } ?? 0
        let conflicts = conflictNames(draft)
        return VStack(alignment: .leading, spacing: 6) {
            if arrangements.count > 1 {
                HStack {
                    Text("上课时间 \(index + 1)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    if index > 0 {
                        Button("移除", role: .destructive) {
                            withAnimation(.snappy(duration: 0.2)) {
                                arrangements.removeAll { $0.id == draft.id }
                            }
                        }
                        .font(.caption.weight(.semibold))
                        .disabled(saving)
                    }
                }
                .padding(.horizontal, 4)
            }
            editorCard {
                editorFieldRow("周数") {
                    Picker("周次范围", selection: Binding(
                        get: { draft.weekMode },
                        set: { mode in
                            arrangement.wrappedValue.weekMode = mode
                            if mode == "all" {
                                arrangement.wrappedValue.selectedWeeks = Set(weekNumberOptions)
                            } else if mode == "current" {
                                arrangement.wrappedValue.selectedWeeks = [defaultWeek]
                            }
                        }
                    )) {
                        Text("本周").tag("current")
                        Text("全部周").tag("all")
                        Text("指定周次").tag("custom")
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                }
                if draft.weekMode == "custom" {
                    weekChipPicker(arrangement.selectedWeeks)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                } else {
                    Text(draft.weekMode == "all" ? "这门课会显示在全部周次" : "第 \(defaultWeek) 周")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.bottom, 10)
                }
                editorFieldRow("星期") {
                    Picker("星期", selection: arrangement.day) {
                        ForEach(1...7, id: \.self) { Text(dayLabel($0)).tag($0) }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                }
                slotChipPicker(arrangement.slots)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
            }
            if !conflicts.isEmpty {
                // A hint only: overlapping courses can still be saved.
                Label("与「\(conflicts.joined(separator: "」「"))」时间重叠", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// Courses already on the timetable that this group would overlap, other
    /// than the course being edited.
    /// Every course some arrangement of this one sits on top of.
    private var overlappingNames: [String] {
        var names: [String] = []
        let own = name.trimmingCharacters(in: .whitespacesAndNewlines)
        for draft in arrangements {
            // A priority is per course name, so it cannot rank a course against itself.
            for name in conflictNames(draft) where !names.contains(name) && name != own { names.append(name) }
        }
        return names
    }

    private func conflictNames(_ draft: ArrangementDraft) -> [String] {
        guard let result = store.result else { return [] }
        let weekList: [Int]
        switch draft.weekMode {
        case "all": weekList = []
        case "current": weekList = [defaultWeek]
        default: weekList = draft.selectedWeeks.sorted()
        }
        return NativeCourseArrangement(day: draft.day, slots: draft.slots, weekList: weekList)
            .conflicts(in: result.cells, ignoring: Set([selection?.course.id].compactMap { $0 }))
    }

    /// "第 1–2、5 节 · 08:00–09:40、13:30–14:15"
    private func slotSummary(_ slots: Set<Int>) -> String {
        let runs = NativeCourseArrangement(day: 1, slots: slots).runs
        guard !runs.isEmpty else { return "轻点选择上课的节次，可以不连续" }
        let numbers = runs.map { $0.lowerBound == $0.upperBound ? "\($0.lowerBound)" : "\($0.lowerBound)–\($0.upperBound)" }
        let times = runs.compactMap { run -> String? in
            guard let start = ScheduleSlot.all.first(where: { $0.number == run.lowerBound })?.start,
                  let end = ScheduleSlot.all.first(where: { $0.number == run.upperBound })?.end else { return nil }
            return "\(start)–\(end)"
        }
        return "第 \(numbers.joined(separator: "、")) 节 · \(times.joined(separator: "、"))"
    }

    private func slotChipPicker(_ slots: Binding<Set<Int>>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("节次")
                .font(.body)
                .foregroundStyle(.primary)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(minimum: 30), spacing: 6), count: 6), spacing: 6) {
                ForEach(ScheduleSlot.all, id: \.number) { slot in
                    let selected = slots.wrappedValue.contains(slot.number)
                    Button {
                        if selected { slots.wrappedValue.remove(slot.number) } else { slots.wrappedValue.insert(slot.number) }
                    } label: {
                        editorChip("\(slot.number)", selected: selected)
                    }
                    .buttonStyle(.plain)
                    .disabled(saving)
                    .accessibilityLabel("第 \(slot.number) 节，\(slot.start) 至 \(slot.end)")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            Text(slotSummary(slots.wrappedValue))
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func editorChip(_ title: String, selected: Bool) -> some View {
        Text(title)
            .font(.caption.weight(.medium))
            .frame(maxWidth: .infinity, minHeight: 30)
            .foregroundStyle(selected ? Color.cpuBrand : .secondary)
            .background {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(selected ? Color.cpuBrand.opacity(0.14) : Color(uiColor: .secondarySystemGroupedBackground))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(selected ? Color.cpuBrand : Color(uiColor: .separator).opacity(0.45), lineWidth: 1)
            }
    }

    private func weekChipPicker(_ selectedWeeks: Binding<Set<Int>>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("指定周")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 4)
                // Shortcuts for the common patterns; the chips below still toggle one week at a time.
                ForEach([("全部", 0), ("单周", 1), ("双周", 2), ("清空", 3)], id: \.1) { title, kind in
                    Button(title) {
                        switch kind {
                        case 0: selectedWeeks.wrappedValue = Set(weekNumberOptions)
                        case 1: selectedWeeks.wrappedValue = Set(weekNumberOptions.filter { $0 % 2 == 1 })
                        case 2: selectedWeeks.wrappedValue = Set(weekNumberOptions.filter { $0 % 2 == 0 })
                        default: selectedWeeks.wrappedValue = []
                        }
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.cpuBrand)
                    .disabled(saving)
                }
            }

            ScrollView(.vertical, showsIndicators: false) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(minimum: 30), spacing: 6), count: 6), spacing: 6) {
                    ForEach(weekNumberOptions, id: \.self) { week in
                        let selected = selectedWeeks.wrappedValue.contains(week)
                        Button {
                            if selected { selectedWeeks.wrappedValue.remove(week) } else { selectedWeeks.wrappedValue.insert(week) }
                        } label: {
                            editorChip("\(week)", selected: selected)
                        }
                        .buttonStyle(.plain)
                        .disabled(saving)
                        .accessibilityLabel("第 \(week) 周")
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(maxHeight: 132)
        }
    }
}

@available(iOS 17.0, *)
private struct NativeScheduleChangeNoticeSheet: View {
    let notice: NativeScheduleChangeNotice
    let onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label("检测到教务原始课表有以下变化：", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.orange)

                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(notice.details.enumerated()), id: \.offset) { _, detail in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: icon(for: detail))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(color(for: detail))
                                    .frame(width: 20)
                                Text(detail)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(16)
                    .background(Color(uiColor: .secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                    Text("如果你编辑过上述课程，请重新核对自定义内容，必要时恢复原始课程。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 28)
            }
            .navigationTitle("教务课表已更新")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("我知道了", action: onDismiss)
                }
            }
        }
    }

    private func icon(for detail: String) -> String {
        if detail.hasPrefix("新增") { return "plus.circle.fill" }
        if detail.hasPrefix("移除") { return "minus.circle.fill" }
        return "arrow.triangle.2.circlepath.circle.fill"
    }

    private func color(for detail: String) -> Color {
        if detail.hasPrefix("新增") { return .green }
        if detail.hasPrefix("移除") { return .red }
        return .orange
    }
}

@available(iOS 17.0, *)
private struct StateCard: View {
    let systemImage: String
    let title: String
    let message: String
    let actionTitle: String?
    let action: (() -> Void)?
    let showsProgress: Bool

    var body: some View {
        VStack(spacing: 12) {
            if showsProgress {
                ProgressView()
                    .controlSize(.large)
            } else {
                Image(systemName: systemImage)
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(Color.cpuBrand)
            }

            Text(title)
                .font(.headline)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.regular)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 250)
        .padding(24)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private struct NativeScheduleToolsHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

@MainActor
private enum NativeScheduleSharePresenter {
    static func writeImage(_ image: UIImage, fileName: String) -> URL? {
        guard let data = image.pngData() else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}

private struct NativeScheduleSharePayload: Identifiable {
    let id = UUID()
    let items: [Any]
}

private struct NativeActivityView: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

#Preview {
    Text("NativeScheduleView requires a NativeScheduleStore")
}
