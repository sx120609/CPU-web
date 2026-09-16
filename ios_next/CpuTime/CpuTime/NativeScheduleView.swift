import SwiftUI
import Foundation
import UIKit

/// The native timetable surface. Data loading and authentication stay in
/// NativeScheduleStore so the SwiftUI surface can also be embedded beside the
/// existing web routes.
struct NativeScheduleView: View {
    @ObservedObject private var store: NativeScheduleStore
    @ObservedObject private var preferences = NativeSchedulePreferences.shared
    private let onDeviceSettings: () -> Void
    private let onLogin: () -> Void

    @State private var selectedDay = 1
    @State private var didInitializeDay = false
    @State private var viewMode: ScheduleViewMode = .week
    // Keep editing and adding in one presentation state. Two independent
    // `.sheet(item:)` modifiers can race when a course card overlaps the slot
    // grid, causing SwiftUI to show the add form for a real course.
    @State private var courseEditorPresentation: CourseEditorPresentation?
    @State private var weekPickerPresented = false
    @State private var scheduleToolsPresented = false
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

    init(
        store: NativeScheduleStore,
        onLogin: @escaping () -> Void = {},
        onDeviceSettings: @escaping () -> Void = {}
    ) {
        _store = ObservedObject(wrappedValue: store)
        self.onDeviceSettings = onDeviceSettings
        self.onLogin = onLogin
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
                    .background(Color(uiColor: .systemGroupedBackground).opacity(preferences.backgroundImage == nil ? 1 : 0.86))
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

                        if viewMode == .week {
                            weekGrid(result)
                        } else {
                            dayGrid(result)
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
                .background(Color(uiColor: .systemGroupedBackground).opacity(preferences.backgroundImage == nil ? 1 : 0.86).ignoresSafeArea(.container, edges: [.horizontal, .bottom]))
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background {
            ZStack {
                Color(uiColor: .systemGroupedBackground)
                if let image = preferences.backgroundImage {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .opacity(preferences.backgroundOpacity)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                }
            }
            .ignoresSafeArea()
        }
        .task {
            viewMode = preferences.defaultView == "day" ? .day : .week
            adoptSelectionIfNeeded()
        }
        .onChange(of: store.result?.currentSemester) { _, _ in
            adoptSelectionIfNeeded()
        }
        .onChange(of: store.result?.currentWeek) { _, _ in
            adoptSelectionIfNeeded()
        }
        .onChange(of: store.selectedWeek) { _, _ in
            guard !weekPaging, !dayPaging else { return }
            resetPagerSelections()
        }
        .onChange(of: viewMode) { _, _ in
            resetPagerSelections()
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
                case .edit(let selection):
                    NativeCourseEditorSheet(selection: selection, store: store)
                case .add(let context):
                    NativeCourseEditorSheet(
                        selection: nil,
                        store: store,
                        defaultDay: context.day,
                        defaultWeek: context.week,
                        defaultStartSlot: context.startSlot
                    )
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $weekPickerPresented) {
            weekPicker
                .presentationDetents([.medium, .large])
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
    }

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

    private var scheduleChangeNoticeBinding: Binding<NativeScheduleChangeNotice?> {
        Binding(
            get: { store.scheduleChangeNotice },
            set: { if $0 == nil { store.dismissScheduleChangeNotice() } }
        )
    }

    private func scheduleHeader(_ result: NativeScheduleResult) -> some View {
        VStack(alignment: .leading, spacing: viewMode == .day ? 8 : 12) {
            HStack(alignment: .center, spacing: 10) {
                semesterMenu(result)

                Spacer(minLength: 8)

                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("正在更新课表")
                }

                Button(action: refresh) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 34, height: 34)
                        .modifier(ScheduleGlassControl(cornerRadius: 17))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                .disabled(isLoading)
                .accessibilityLabel("刷新课表")

                // The schedule header has one overflow control. Device and
                // widget settings live in its own menu section alongside the
                // schedule actions instead of competing with a second icon.
                scheduleToolsMenu()

                Picker("课表视图", selection: $viewMode) {
                    // Keep the same order as Web's view switch: 日 / 周.
                    Text("日").tag(ScheduleViewMode.day)
                    Text("周").tag(ScheduleViewMode.week)
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                .labelsHidden()
                .frame(width: 88)
                .accessibilityLabel("切换课表视图")

                Button {
                    if viewMode == .day {
                        jumpToCurrentDay(result)
                    } else {
                        jumpToCurrentWeek(result)
                    }
                } label: {
                    let viewingToday = viewMode == .day ? isViewingCurrentDay(result) : isViewingCurrentWeek(result)
                    Image(systemName: viewingToday ? "scope" : "location.north.line")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 34, height: 34)
                        .modifier(ScheduleGlassControl(cornerRadius: 17))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle((viewMode == .day ? isViewingCurrentDay(result) : isViewingCurrentWeek(result)) ? Color.cpuBrand : .primary)
                .accessibilityLabel(viewMode == .day ? "跳转到今日" : "回到本周")
                // A background refresh keeps the cached timetable usable, so
                // only the meaningless jump is disabled.
                .disabled(viewMode == .day ? isViewingCurrentDay(result) : isViewingCurrentWeek(result))
            }

            HStack(spacing: 6) {
                weekStepButton(
                    systemName: "chevron.left",
                    label: "上一周",
                    enabled: canMoveWeek(-1, result: result)
                ) {
                    moveWeek(-1, result: result)
                }

                Button {
                    weekPickerPresented = true
                } label: {
                    VStack(spacing: 2) {
                        Text(weekTitle(result))
                            .font(.headline)
                            .lineLimit(1)
                        if let range = weekRange(result), !range.isEmpty {
                            Text(range)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 42)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("选择周次")

                weekStepButton(
                    systemName: "chevron.right",
                    label: "下一周",
                    enabled: canMoveWeek(1, result: result)
                ) {
                    moveWeek(1, result: result)
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

    private func semesterMenu(_ result: NativeScheduleResult) -> some View {
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
                    if result.source != .graduate {
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
                    scheduleToolRow("课表、设备与小组件", systemImage: "slider.horizontal.3") {
                        scheduleToolsPresented = false
                        DispatchQueue.main.async { onDeviceSettings() }
                    }
                }

                scheduleToolsSection("分享") {
                    scheduleToolRow("分享本周课表", systemImage: "square.and.arrow.up") {
                        scheduleToolsPresented = false
                        exportScheduleImage(result)
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
                if systemName == "chevron.right" {
                    Text(label)
                    Image(systemName: systemName)
                } else {
                    Image(systemName: systemName)
                    Text(label)
                }
            }
            .font(.caption.weight(.medium))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(minWidth: 68, minHeight: 42)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(enabled ? .primary : .tertiary)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func dayPicker(_ result: NativeScheduleResult) -> some View {
        HStack(spacing: 2) {
            ForEach(1...7, id: \.self) { day in
                Button {
                    selectedDay = day
                } label: {
                    VStack(spacing: 3) {
                        Text(dayLabel(day))
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                        Text(dayDate(day, result: result) ?? "--")
                            .font(.caption2)
                            .foregroundStyle(selectedDay == day ? Color.cpuBrand : .secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .background {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(selectedDay == day ? Color.cpuBrand.opacity(0.14) : .clear)
                            .overlay {
                                if dayIsToday(day, result: result) && selectedDay != day {
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .strokeBorder(Color.cpuBrand.opacity(0.42), lineWidth: 0.8)
                                }
                            }
                    }
                    .foregroundStyle(selectedDay == day ? Color.cpuBrand : .primary)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(dayLabel(day)) \(dayDate(day, result: result) ?? "")")
            }
        }
        .padding(3)
        .modifier(ScheduleGlassControl(cornerRadius: 12, interactive: false))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func weekGrid(_ result: NativeScheduleResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                let columnWidth = max(
                    24,
                    (proxy.size.width - Self.slotAxisWidth - CGFloat(6) * Self.columnGap) / 7
                )
                weekPager(result: result, width: proxy.size.width) { week in
                    scheduleRows(
                        result: result,
                        week: week,
                        days: Array(1...7),
                        columnWidth: columnWidth,
                        compactCards: preferences.density == "compact",
                        rowHeight: weekRowHeight,
                        showsDateHeader: preferences.showDateHeader
                    )
                        .frame(minWidth: proxy.size.width, alignment: .leading)
                }
            }
            .frame(height: Self.scheduleGridHeight(rowHeight: weekRowHeight))
        }
    }

    private func dayGrid(_ result: NativeScheduleResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                let columnWidth = max(220, proxy.size.width - Self.slotAxisWidth - Self.columnGap)
                dayPager(result: result, width: proxy.size.width) { page in
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
                }
            }
            .frame(height: Self.scheduleGridHeight(
                rowHeight: dayRowHeight,
                includesDateHeader: false,
                topInset: Self.dayGridTopInset
            ))
        }
    }

    private var weekRowHeight: CGFloat {
        preferences.density == "compact" ? 40 : NativeScheduleDayColumn.slotHeight
    }

    private var dayRowHeight: CGFloat {
        preferences.density == "compact" ? 37 : NativeScheduleDayColumn.daySlotHeight
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
        showsDateHeader: Bool = true
    ) -> some View {
        HStack(alignment: .top, spacing: Self.columnGap) {
            slotAxis(rowHeight: rowHeight, showsHeader: showsDateHeader)

            ForEach(days, id: \.self) { day in
                NativeScheduleDayColumn(
                    day: day,
                    dateText: dayDate(day, week: week, result: result),
                    isToday: dayIsToday(day, week: week, result: result),
                    columnWidth: columnWidth,
                    rowHeight: rowHeight,
                    compactCards: compactCards,
                    showsDateHeader: showsDateHeader,
                    blocks: blocks(for: day, week: week, result: result),
                    palette: preferences.palette,
                    showLocation: preferences.showLocation,
                    showTeacher: preferences.showTeacher,
                    showPeriod: preferences.showPeriod,
                    showWeeks: preferences.showWeeks,
                    onCourseSelected: { block in
                        // A cell tap can arrive in the same run loop as a
                        // neighbouring empty-slot gesture. Clear the add
                        // context first so selecting a real course always
                        // presents the editor for that course.
                        courseEditorPresentation = .edit(SelectedCourse(
                            id: block.id,
                            course: block.course,
                            day: day,
                            bigSlot: block.bigSlot,
                            startSlot: block.startSlot,
                            endSlot: block.endSlot
                        ))
                    },
                    onEmptySlot: { slot in
                        presentAddCourse(day: day, week: week, startSlot: slot)
                    }
                )
            }
        }
        .padding(.bottom, 4)
    }

    private func slotAxis(
        rowHeight: CGFloat = NativeScheduleDayColumn.slotHeight,
        showsHeader: Bool = true
    ) -> some View {
        VStack(spacing: 0) {
            if showsHeader {
                Text("节次")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: Self.slotAxisWidth, height: NativeScheduleDayColumn.dateHeaderHeight)
            }

            VStack(spacing: NativeScheduleDayColumn.slotGap) {
                ForEach(ScheduleSlot.all, id: \.number) { slot in
                    VStack(spacing: 2) {
                        Text("\(slot.number)")
                            .font(.caption.weight(.bold).monospacedDigit())
                        Text(slot.start)
                            .font(.system(size: 9).monospacedDigit())
                            .foregroundStyle(.secondary)
                        Text(slot.end)
                            .font(.system(size: 9).monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: Self.slotAxisWidth, height: rowHeight)
                    .overlay(alignment: .trailing) {
                        Rectangle()
                            .fill(Color(uiColor: .separator).opacity(0.5))
                            .frame(width: 0.5)
                    }
                }
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
                if let result = store.result, !isViewingCurrentWeek(result) {
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
            selectedDay = (1...7).first(where: { dayIsToday($0, result: result) }) ?? 1
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
        let grid = AnyView(
            scheduleRows(
                result: result,
                week: week,
                days: Array(1...7),
                columnWidth: columnWidth,
                compactCards: false,
                rowHeight: weekRowHeight,
                showsDateHeader: preferences.showDateHeader
            )
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
        .background(Color(uiColor: .systemGroupedBackground))

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

    private func presentAddCourse(day: Int, week: Int?, startSlot: Int) {
        // A course card and the slot grid are siblings in the same ZStack. On
        // older SwiftUI releases a delayed empty-slot callback can arrive
        // after the course callback; never let it replace an editor that is
        // already being presented.
        guard courseEditorPresentation == nil else { return }
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
        let targetDay = selectedDay + offset
        if (1...7).contains(targetDay) {
            return NativeScheduleDayPage(week: store.selectedWeek.nilIfEmpty, day: targetDay)
        }
        let weekOffset = offset > 0 ? 1 : -1
        guard let targetWeek = adjacentWeekValue(weekOffset, result: result) else { return nil }
        return NativeScheduleDayPage(week: targetWeek, day: offset > 0 ? 1 : 7)
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
        guard let weekNumber = week, let calendar = store.calendar,
              let item = calendar.weeks.first(where: { $0.week == weekNumber }),
              item.days.indices.contains(day - 1) else {
            return nil
        }
        return item.days[day - 1]
    }

    private func weekNumber(_ value: String) -> Int? {
        Int(value.trimmingCharacters(in: .whitespaces))
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
        let rawBlocks = result.cells
            .filter { $0.day == day }
            .flatMap { cell in
                cell.courses.enumerated().compactMap { index, course -> NativeScheduleCourseBlockRecord? in
                    let courseWeeks = nativeCourseWeekList(course)
                    if let week, !courseWeeks.isEmpty, !courseWeeks.contains(week) {
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
                        id: "\(week.map(String.init) ?? "-")-\(day)-\(cell.bigSlot)-\(index)-\(course.name)",
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

        let merged = NativeScheduleCourseBlockMerger.merge(rawBlocks).map { block in
            NativeScheduleCourseBlock(
                id: block.id,
                course: block.course,
                bigSlot: block.bigSlot,
                startSlot: block.startSlot,
                endSlot: block.endSlot
            )
        }
        var laneEnds: [Int] = []
        return merged.sorted(by: { ($0.startSlot, $0.endSlot, $0.id) < ($1.startSlot, $1.endSlot, $1.id) }).map { block in
            let lane = laneEnds.firstIndex(where: { $0 < block.startSlot }) ?? laneEnds.count
            if lane == laneEnds.count {
                laneEnds.append(block.endSlot)
            } else {
                laneEnds[lane] = block.endSlot
            }
            return block.withLane(lane)
        }
    }

    /// The bridge normally sends `weekList`, but an older Web bundle may only
    /// send the human-readable `weeks` field. Keep the native filter aligned
    /// with Web's `courseMatchesWeek` so a course never disappears from (or
    /// reappears in) a selected week just because the bridge was deployed
    /// before the normalized list was added.
    private func nativeCourseWeekList(_ course: NativeScheduleCourse) -> [Int] {
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
}

private struct NativeScheduleCourseBlock: Identifiable {
    let id: String
    let course: NativeScheduleCourse
    let bigSlot: Int
    let startSlot: Int
    let endSlot: Int
    let lane: Int

    init(id: String, course: NativeScheduleCourse, bigSlot: Int, startSlot: Int, endSlot: Int, lane: Int = 0) {
        self.id = id
        self.course = course
        self.bigSlot = bigSlot
        self.startSlot = startSlot
        self.endSlot = endSlot
        self.lane = lane
    }

    func withLane(_ lane: Int) -> NativeScheduleCourseBlock {
        NativeScheduleCourseBlock(id: id, course: course, bigSlot: bigSlot, startSlot: startSlot, endSlot: endSlot, lane: lane)
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
}

private struct AddCourseContext: Identifiable {
    let id = UUID()
    let day: Int
    let week: Int
    let startSlot: Int
}

private enum CourseEditorPresentation: Identifiable {
    case edit(SelectedCourse)
    case add(AddCourseContext)

    var id: String {
        switch self {
        case .edit(let selection): return selection.id
        case .add(let context): return "add:\(context.id.uuidString)"
        }
    }
}

private struct NativeScheduleDayPage: Equatable {
    let week: String?
    let day: Int
}

private struct ScheduleSlot {
    let number: Int
    let start: String
    let end: String

    static let all: [ScheduleSlot] = [
        ScheduleSlot(number: 1, start: "08:00", end: "08:45"),
        ScheduleSlot(number: 2, start: "08:55", end: "09:40"),
        ScheduleSlot(number: 3, start: "09:55", end: "10:40"),
        ScheduleSlot(number: 4, start: "10:50", end: "11:35"),
        ScheduleSlot(number: 5, start: "13:30", end: "14:15"),
        ScheduleSlot(number: 6, start: "14:25", end: "15:10"),
        ScheduleSlot(number: 7, start: "15:25", end: "16:10"),
        ScheduleSlot(number: 8, start: "16:20", end: "17:05"),
        ScheduleSlot(number: 9, start: "18:30", end: "19:15"),
        ScheduleSlot(number: 10, start: "19:25", end: "20:10"),
        ScheduleSlot(number: 11, start: "20:20", end: "21:05")
    ]
}

private struct NativeScheduleDayColumn: View {
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
    static let dateHeaderHeight: CGFloat = 46

    let day: Int
    let dateText: String?
    let isToday: Bool
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

    init(
        day: Int,
        dateText: String?,
        isToday: Bool,
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
        onEmptySlot: @escaping (Int) -> Void
    ) {
        self.day = day
        self.dateText = dateText
        self.isToday = isToday
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
                VStack(spacing: 2) {
                    Text(dayLabel)
                        .font(.caption.weight(.semibold))
                    Text(dateText ?? "--")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(width: columnWidth, height: Self.dateHeaderHeight)
                .background {
                    if isToday {
                        ScheduleGlassBackground(
                            cornerRadius: 12,
                            colors: [
                                Color(hue: 0.43, saturation: 0.22, brightness: 0.92).opacity(0.12),
                                Color(hue: 0.59, saturation: 0.20, brightness: 0.96).opacity(0.10),
                                Color(hue: 0.89, saturation: 0.18, brightness: 0.96).opacity(0.12),
                            ],
                            border: Color.cpuBrand.opacity(0.22)
                        )
                            .padding(.horizontal, 2)
                            .padding(.vertical, 3)
                    }
                }
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
                        NativeScheduleCourseCard(
                            course: block.course,
                            palette: palette,
                            showLocation: showLocation,
                            showTeacher: showTeacher,
                            showPeriod: showPeriod,
                            showWeeks: showWeeks,
                            compact: compactCards || columnWidth < 70
                        )
                            .frame(width: cardWidth, height: cardHeight)
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
            if rect.contains(point) { return block }
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
                        ScheduleGlassBackground(cornerRadius: 8)
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

private struct ScheduleGlassBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    let cornerRadius: CGFloat
    var colors: [Color] = [.clear, .clear]
    var border: Color = Color(uiColor: .separator).opacity(0.12)
    var lineWidth: CGFloat = 0.7

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        shape
            .fill(Color(uiColor: .secondarySystemGroupedBackground).opacity(0.86))
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
            .overlay { shape.strokeBorder(border, lineWidth: lineWidth) }
            .allowsHitTesting(false)
    }
}

private struct NativeScheduleCourseCard: View {
    @Environment(\.colorScheme) private var colorScheme
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
            let location = showLocation ? clean(course.location) : nil
            let teacher = showTeacher ? clean(course.teacher) : nil
            let details = [
                showPeriod ? clean(course.slotNote) : nil,
                showWeeks ? clean(course.weeks) : nil,
            ].compactMap { $0 }
            let note = details.isEmpty ? nil : details.joined(separator: " · ")
            let metadata: String? = {
                let values: [String] = compact
                    ? [location.map { "@\($0.trimmingCharacters(in: CharacterSet(charactersIn: "@＠")))" }].compactMap { $0 }
                    : [
                        location.map { "@\($0.trimmingCharacters(in: CharacterSet(charactersIn: "@＠")))" },
                        teacher,
                    ].compactMap { $0 }
                return values.isEmpty ? nil : values.joined(separator: " · ")
            }()

            VStack(spacing: compact ? 3 : (shortCard ? 2 : 5)) {
                Text(course.name)
                    .font(.system(size: compact || shortCard ? 11 : 14, weight: .semibold))
                    .lineLimit(shortCard ? 1 : (compact ? 3 : 2))
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity)
                    .layoutPriority(1)

                if let metadata {
                    Text(metadata)
                        .font(.system(size: compact || shortCard ? 9 : 12, weight: .medium))
                        .lineLimit(shortCard ? 1 : 2)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity)
                        .layoutPriority(2)
                }

                if !compact, !shortCard, let note {
                    Text(note)
                        .font(.system(size: 11, weight: .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .opacity(0.86)
                }
            }
            .multilineTextAlignment(.center)
            .foregroundStyle(accent)
            .padding(.horizontal, compact ? 3 : 10)
            .padding(.vertical, shortCard ? 4 : 7)
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .center)
        }
        .background {
            let shape = RoundedRectangle(cornerRadius: 9, style: .continuous)
            ZStack {
                // Match Web's color-glass tone: a colored surface with a
                // slightly darker lower stop, instead of a gray material
                // layer that washes the course color out.
                shape.fill(
                    LinearGradient(
                        colors: [
                            courseBackground.opacity(colorScheme == .dark ? 0.94 : 0.88),
                            courseBackgroundHighlight.opacity(colorScheme == .dark ? 0.94 : 0.88),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                // Web's inset highlight is subtle but gives every card a
                // glass edge when several cards sit next to one another.
                shape.fill(
                    LinearGradient(
                        stops: [
                            .init(color: .white.opacity(colorScheme == .dark ? 0.18 : 0.40), location: 0),
                            .init(color: .white.opacity(0.05), location: 0.34),
                            .init(color: .clear, location: 0.72),
                            .init(color: .black.opacity(colorScheme == .dark ? 0.10 : 0.025), location: 1),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                shape.strokeBorder(courseBorder, lineWidth: 1)
            }
            .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .shadow(
            color: colorScheme == .dark ? Color.black.opacity(0.24) : Color(red: 44 / 255, green: 62 / 255, blue: 94 / 255).opacity(0.08),
            radius: colorScheme == .dark ? 8 : 5,
            y: colorScheme == .dark ? 3 : 2
        )
        .accessibilityElement(children: .combine)
    }

    private var accent: Color {
        if colorScheme == .dark {
            return hslColor(hue: hue, saturation: min(0.82, saturation + 0.08), lightness: 0.72)
        }
        return hslColor(hue: hue, saturation: min(0.76, saturation + 0.04), lightness: textLightness)
    }

    private var courseBorder: Color {
        if colorScheme == .dark {
            return hslColor(hue: hue, saturation: min(0.86, saturation + 0.08), lightness: 0.72).opacity(0.72)
        }
        let hash = course.name.unicodeScalars.reduce(UInt64(0)) { ($0 &* 31) &+ UInt64($1.value) }
        let lightness = 0.48 + Double((hash >> 20) % 10) / 100
        return hslColor(hue: hue, saturation: min(0.82, saturation + 0.08), lightness: lightness).opacity(0.48)
    }

    private var hue: Double {
        let hash = course.name.unicodeScalars.reduce(UInt64(0)) { ($0 &* 31) &+ UInt64($1.value) }
        if let base = paletteHue {
            return (base + Double(hash % 23) / 360).truncatingRemainder(dividingBy: 1)
        }
        return Double(hash % 360) / 360
    }

    private var paletteHue: Double? {
        switch palette {
        case "green": return 0.42
        case "blue": return 0.58
        case "teal": return 0.50
        case "indigo": return 0.66
        case "violet": return 0.75
        case "orange": return 0.08
        case "rose": return 0.93
        case "slate": return 0.58
        default: return nil
        }
    }

    private var saturation: Double {
        let hash = course.name.unicodeScalars.reduce(UInt64(0)) { ($0 &* 31) &+ UInt64($1.value) }
        if palette == "slate" { return 0.20 + Double((hash >> 8) % 8) / 100 }
        return 0.58 + Double((hash >> 8) % 18) / 100
    }

    private var backgroundLightness: Double {
        let hash = course.name.unicodeScalars.reduce(UInt64(0)) { ($0 &* 31) &+ UInt64($1.value) }
        return 0.89 + Double((hash >> 16) % 5) / 100
    }

    private var textLightness: Double {
        let hash = course.name.unicodeScalars.reduce(UInt64(0)) { ($0 &* 31) &+ UInt64($1.value) }
        return 0.25 + Double((hash >> 24) % 8) / 100
    }

    private var courseBackground: Color {
        if colorScheme == .dark {
            return hslColor(hue: hue, saturation: min(0.82, saturation + 0.04), lightness: 0.34)
        }
        return hslColor(hue: hue, saturation: saturation, lightness: backgroundLightness)
    }

    private var courseBackgroundHighlight: Color {
        if colorScheme == .dark {
            return hslColor(hue: hue, saturation: min(0.82, saturation + 0.04), lightness: 0.24)
        }
        return hslColor(hue: hue, saturation: saturation, lightness: max(0.84, backgroundLightness - 0.04))
    }

    private func hslColor(hue: Double, saturation: Double, lightness: Double) -> Color {
        let chroma = (1 - abs(2 * lightness - 1)) * saturation
        let scaled = hue * 6
        let x = chroma * (1 - abs(scaled.truncatingRemainder(dividingBy: 2) - 1))
        let base: (Double, Double, Double)
        switch scaled {
        case 0..<1: base = (chroma, x, 0)
        case 1..<2: base = (x, chroma, 0)
        case 2..<3: base = (0, chroma, x)
        case 3..<4: base = (0, x, chroma)
        case 4..<5: base = (x, 0, chroma)
        default: base = (chroma, 0, x)
        }
        let match = lightness - chroma / 2
        return Color(red: base.0 + match, green: base.1 + match, blue: base.2 + match)
    }

    private func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }
}

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
    @State private var day: Int
    @State private var startSlot: Int
    @State private var endSlot: Int
    @State private var weekMode: String
    @State private var selectedWeeks: Set<Int>
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
        _note = State(initialValue: course?.slotNote ?? "")
        _day = State(initialValue: selection?.day ?? defaultDay)
        _startSlot = State(initialValue: selection?.startSlot ?? defaultStartSlot)
        _endSlot = State(initialValue: selection?.endSlot ?? min(defaultStartSlot + 1, ScheduleSlot.all.count))
        let list = course?.weekList ?? [defaultWeek]
        _weekMode = State(initialValue: list.isEmpty ? "all" : (list == [defaultWeek] ? "current" : "custom"))
        _selectedWeeks = State(initialValue: Set(list.isEmpty ? [defaultWeek] : list))
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

                    editorCard {
                        editorFieldRow("周数") {
                            Picker("周次范围", selection: $weekMode) {
                                Text("本周").tag("current")
                                Text("全部周").tag("all")
                                Text("指定周次").tag("custom")
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                        }
                        if weekMode == "custom" {
                            weekChipPicker
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                        } else {
                            Text(weekMode == "all" ? "这门课会显示在全部周次" : "第 \(defaultWeek) 周")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 14)
                                .padding(.bottom, 10)
                        }
                        editorFieldRow("星期") {
                            Picker("星期", selection: $day) {
                                ForEach(1...7, id: \.self) { Text(dayLabel($0)).tag($0) }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                        }
                        editorStepperRow("开始第 \(startSlot) 节", value: $startSlot, range: 1...11)
                        editorStepperRow("结束第 \(endSlot) 节", value: $endSlot, range: startSlot...11)
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
            .onChange(of: weekMode) { _, mode in
                if mode == "all" {
                    selectedWeeks = Set(weekNumberOptions)
                } else if mode == "current" {
                    selectedWeeks = [defaultWeek]
                }
            }
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
        let start = min(max(startSlot, 1), 11)
        let end = min(max(endSlot, start), 11)
        let weekList: [Int]
        if weekMode == "all" {
            weekList = []
        } else if weekMode == "current" {
            weekList = [defaultWeek]
        } else {
            weekList = selectedWeeks.sorted()
            guard !weekList.isEmpty else {
                errorMessage = "请选择至少一个周次"
                return
            }
        }
        let weeks = weekList.isEmpty ? "全部周" : "第 \(weekList.map(String.init).joined(separator: ",")) 周"
        let source = selection?.course
        let editingSourceKey: String? = source.flatMap {
            // A pure custom course has no official source to hide or restore.
            if $0.customId != nil, $0.sourceKey == nil { return nil }
            return nativeCourseEditKey(
                day: selection?.day ?? day,
                bigSlot: selection?.bigSlot ?? Int(ceil(Double(start) / 2)),
                course: $0
            )
        }
        let savedSourceKey = keepAsCustom ? nil : editingSourceKey
        let customID = source?.customId ?? "custom-\(UUID().uuidString.lowercased())"
        let item = NativeScheduleCustomItem(
            id: customID,
            sourceKey: savedSourceKey,
            day: day,
            bigSlot: Int(ceil(Double(start) / 2)),
            course: NativeScheduleCourse(
                name: trimmedName,
                teacher: teacher,
                weeks: weeks,
                weekList: weekList,
                location: location,
                slotNote: note.isEmpty ? "第 \(start)-\(end) 节" : note,
                startSlot: start,
                endSlot: end,
                sourceKey: savedSourceKey,
                customId: customID,
                custom: true
            )
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
                edits.custom.removeAll { $0.id == item.id }
                edits.custom.append(item)
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

    private var weekChipPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("指定周")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)

            ScrollView(.vertical, showsIndicators: false) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(minimum: 30), spacing: 6), count: 6), spacing: 6) {
                    ForEach(weekNumberOptions, id: \.self) { week in
                        Button {
                            if selectedWeeks.contains(week) {
                                selectedWeeks.remove(week)
                            } else {
                                selectedWeeks.insert(week)
                            }
                        } label: {
                            Text("\(week)")
                                .font(.caption.weight(.medium))
                                .frame(maxWidth: .infinity, minHeight: 30)
                                .foregroundStyle(selectedWeeks.contains(week) ? Color.cpuBrand : .secondary)
                                .background {
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .fill(selectedWeeks.contains(week) ? Color.cpuBrand.opacity(0.14) : Color(uiColor: .secondarySystemGroupedBackground))
                                }
                                .overlay {
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .stroke(selectedWeeks.contains(week) ? Color.cpuBrand : Color(uiColor: .separator).opacity(0.45), lineWidth: 1)
                                }
                        }
                        .buttonStyle(.plain)
                        .disabled(saving)
                        .accessibilityLabel("第 \(week) 周")
                        .accessibilityAddTraits(selectedWeeks.contains(week) ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(maxHeight: 132)
        }
    }
}

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

private struct CourseDetailSheet: View {
    let course: NativeScheduleCourse
    let day: Int
    let startSlot: Int
    let endSlot: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(course.name)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.primary)
                }

                Section("课程信息") {
                    detailRow("老师", course.teacher)
                    detailRow("地点", course.location)
                    detailRow("星期", dayLabel)
                    detailRow("周次", course.weeks)
                    detailRow("节次", course.slotNote ?? slotRange)
                    detailRow("时间", timeRange)
                }
            }
            .navigationTitle("课程详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func detailRow(_ label: String, _ value: String?) -> some View {
        if let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            LabeledContent(label, value: value)
        }
    }

    private var slotRange: String? {
        startSlot == endSlot ? "第 \(startSlot) 节" : "第 \(startSlot)-\(endSlot) 节"
    }

    private var dayLabel: String {
        ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].indices.contains(day - 1)
            ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1]
            : "周\(day)"
    }

    private var timeRange: String? {
        let slots = ScheduleSlot.all
        guard slots.indices.contains(startSlot - 1), slots.indices.contains(endSlot - 1) else { return nil }
        return "\(slots[startSlot - 1].start) - \(slots[endSlot - 1].end)"
    }
}

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

private enum NativeScheduleICSExporter {
    static func make(
        result: NativeScheduleResult,
        week: NativeCalendarWeek,
        periods: [NativeSchedulePeriod]
    ) -> String {
        var lines = [
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CPUTime//Schedule//CN",
            "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        ]
        for cell in result.cells where (1...7).contains(cell.day) {
            guard week.days.indices.contains(cell.day - 1),
                  let day = parseDate(week.days[cell.day - 1]) else { continue }
            for course in cell.courses {
                let range = NativeSchedulePeriod.normalizedRange(
                    bigSlot: cell.bigSlot,
                    startSlot: course.startSlot,
                    endSlot: course.endSlot,
                    periods: periods
                )
                guard let startPeriod = periods.first(where: { $0.number == range.start }),
                      let endPeriod = periods.first(where: { $0.number == range.end }),
                      let start = date(day: day, time: startPeriod.startTime),
                      let end = date(day: day, time: endPeriod.endTime), end > start else { continue }
                let identity = course.nativeId ?? course.sourceKey ?? course.name
                let uid = "\(week.week)-\(cell.day)-\(range.start)-\(range.end)-\(identity)"
                    .unicodeScalars.map { $0.value < 128 ? String($0) : String(format: "%02X", $0.value) }.joined()
                lines.append("BEGIN:VEVENT")
                lines.append("UID:\(escape(uid))@cputime")
                lines.append("DTSTAMP:\(format(Date.now))")
                lines.append("DTSTART;TZID=Asia/Shanghai:\(format(start))")
                lines.append("DTEND;TZID=Asia/Shanghai:\(format(end))")
                lines.append("SUMMARY:\(escape(course.name.trimmedNonEmpty ?? "课程"))")
                if let location = course.location?.trimmedNonEmpty { lines.append("LOCATION:\(escape(location))") }
                let details = [course.teacher?.trimmedNonEmpty, course.slotNote?.trimmedNonEmpty]
                    .compactMap { $0 }.joined(separator: " · ")
                if !details.isEmpty { lines.append("DESCRIPTION:\(escape(details))") }
                lines.append("END:VEVENT")
            }
        }
        lines.append("END:VCALENDAR")
        return lines.joined(separator: "\r\n") + "\r\n"
    }

    private static func parseDate(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private static func date(day: Date, time: String) -> Date? {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        var components = calendar.dateComponents([.year, .month, .day], from: day)
        components.hour = parts[0]
        components.minute = parts[1]
        components.second = 0
        return calendar.date(from: components)
    }

    private static func format(_ value: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyyMMdd'T'HHmmss"
        return formatter.string(from: value)
    }

    private static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: ";", with: "\\;")
            .replacingOccurrences(of: ",", with: "\\,")
            .replacingOccurrences(of: "\n", with: "\\n")
    }
}

#Preview {
    Text("NativeScheduleView requires a NativeScheduleStore")
}
