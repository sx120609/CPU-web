import SwiftUI

/// The native timetable surface. Data loading and authentication stay in
/// NativeScheduleStore so the SwiftUI surface can also be embedded beside the
/// existing web routes.
struct NativeScheduleView: View {
    @ObservedObject private var store: NativeScheduleStore
    private let onWidgets: () -> Void
    private let onLogin: () -> Void

    @State private var selectedDay = 1
    @State private var didInitializeDay = false
    @State private var viewMode: ScheduleViewMode = .week
    @State private var selectedCourse: SelectedCourse?
    @State private var weekPickerPresented = false
    // Horizontal week paging state. The track holds the previous, current and
    // next week so a swipe drags the neighbouring timetable into view instead
    // of replacing the grid in place.
    @State private var weekDragOffset: CGFloat = 0
    @State private var weekDragAxis: ScheduleSwipeAxis = .pending
    @State private var weekSliding = false
    @State private var weekPageWidth: CGFloat = 0

    init(store: NativeScheduleStore, onLogin: @escaping () -> Void = {}, onWidgets: @escaping () -> Void = {}) {
        _store = ObservedObject(wrappedValue: store)
        self.onWidgets = onWidgets
        self.onLogin = onLogin
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                    // A timetable already on screen is never replaced by a
                    // state card. Authorization and refresh problems appear as
                    // a banner above it instead.
                    if let result = store.result {
                        scheduleHeader(result)

                        if isUnauthorized {
                            authorizationBanner
                        } else if !isLoading, let message = errorMessage {
                            errorBanner(message)
                        }

                        if viewMode == .day {
                            dayPicker(result)
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
                // Floating tab bars can overlay the scroll view without reporting
                // their full height as a safe-area inset. Keep scrollable clearance.
                .padding(.bottom, 116)
            .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea(.container, edges: [.horizontal, .bottom]))
        }
        .task {
            adoptSelectionIfNeeded()

        }
        .refreshable {
            await store.refresh()
        }
        .onChange(of: store.result?.currentSemester) { _, _ in
            adoptSelectionIfNeeded()
        }
        .onChange(of: store.result?.currentWeek) { _, _ in
            adoptSelectionIfNeeded()
        }
        .sheet(item: $selectedCourse) { selection in
            CourseDetailSheet(
                course: selection.course,
                day: selection.day,
                startSlot: selection.startSlot,
                endSlot: selection.endSlot
            )
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $weekPickerPresented) {
            weekPicker
                .presentationDetents([.medium, .large])
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
                    Text("周").tag(ScheduleViewMode.week)
                    Text("日").tag(ScheduleViewMode.day)
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                .labelsHidden()
                .frame(width: 88)
                .accessibilityLabel("切换课表视图")

                Button {
                    jumpToCurrentWeek(result)
                } label: {
                    Image(systemName: isViewingCurrentWeek(result) ? "scope" : "location.north.line")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 34, height: 34)
                        .modifier(ScheduleGlassControl(cornerRadius: 17))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(isViewingCurrentWeek(result) ? Color.accentColor : .primary)
                .accessibilityLabel("回到本周")
                // A background refresh keeps the cached timetable usable, so
                // only the meaningless jump is disabled.
                .disabled(isViewingCurrentWeek(result))
            }

            HStack(spacing: 8) {
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
            Divider()
            Button(action: onWidgets) {
                Label("课表小组件", systemImage: "square.grid.2x2")
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

    private func weekStepButton(
        systemName: String,
        label: String,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .bold))
                .frame(width: 44, height: 42)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(enabled ? .primary : .tertiary)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func dayPicker(_ result: NativeScheduleResult) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(1...7, id: \.self) { day in
                    Button {
                        selectedDay = day
                    } label: {
                        VStack(spacing: 4) {
                            Text(dayLabel(day))
                                .font(.caption.weight(.semibold))
                            Text(dayDate(day, result: result) ?? "--")
                                .font(.caption2)
                                .foregroundStyle(selectedDay == day ? Color.accentColor : .secondary)
                        }
                        .frame(width: 58, height: 48)
                        .modifier(ScheduleGlassControl(
                            cornerRadius: 11,
                            tint: selectedDay == day ? Color.accentColor.opacity(0.12) : nil
                        ))
                        .foregroundStyle(selectedDay == day ? Color.accentColor : .primary)
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(dayLabel(day)) \(dayDate(day, result: result) ?? "")")
                }
            }
        }
    }

    private func weekGrid(_ result: NativeScheduleResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                let columnWidth = max(24, (proxy.size.width - 46) / 7)
                // The track is widened back over the page margin so a swipe
                // carries the timetable to the screen edge instead of stopping
                // short at the content inset.
                weekPager(result: result, width: proxy.size.width + Self.contentInset * 2) { week in
                    scheduleRows(result: result, week: week, days: Array(1...7), columnWidth: columnWidth)
                        .frame(minWidth: proxy.size.width, alignment: .leading)
                        .padding(.horizontal, Self.contentInset)
                }
                .padding(.horizontal, -Self.contentInset)
            }
            .frame(minHeight: 610)
        }
    }

    private func dayGrid(_ result: NativeScheduleResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                let columnWidth = max(220, proxy.size.width - 46)
                weekPager(result: result, width: proxy.size.width + Self.contentInset * 2) { week in
                    scheduleRows(result: result, week: week, days: [selectedDay], columnWidth: columnWidth)
                        .frame(minWidth: proxy.size.width, alignment: .leading)
                        .padding(.horizontal, Self.contentInset)
                }
                .padding(.horizontal, -Self.contentInset)
            }
            .frame(minHeight: 618)
        }
    }

    /// Lays the previous / current / next week side by side and moves the whole
    /// track with the finger. Neighbouring pages are only built while the track
    /// is off centre, so a resting timetable still renders a single week.
    private func weekPager<Page: View>(
        result: NativeScheduleResult,
        width: CGFloat,
        @ViewBuilder page: @escaping (Int?) -> Page
    ) -> some View {
        let showsNeighbours = weekDragOffset != 0 || weekSliding
        return HStack(spacing: 0) {
            neighbourPage(offset: -1, result: result, width: width, visible: showsNeighbours, page: page)
            page(weekNumber(store.selectedWeek))
                .frame(width: width, alignment: .leading)
            neighbourPage(offset: 1, result: result, width: width, visible: showsNeighbours, page: page)
        }
        .offset(x: -width + weekDragOffset)
        .frame(width: width, alignment: .leading)
        .clipped()
        .contentShape(Rectangle())
        .onAppear { weekPageWidth = width }
        .onChange(of: width) { _, value in weekPageWidth = value }
        .simultaneousGesture(weekSwipeGesture(result: result, width: width))
    }

    @ViewBuilder
    private func neighbourPage<Page: View>(
        offset: Int,
        result: NativeScheduleResult,
        width: CGFloat,
        visible: Bool,
        @ViewBuilder page: @escaping (Int?) -> Page
    ) -> some View {
        if visible, let value = adjacentWeekValue(offset, result: result) {
            page(weekNumber(value))
                .frame(width: width, alignment: .leading)
        } else {
            // A placeholder keeps the track three pages wide without claiming
            // the height of a real timetable.
            Color.clear.frame(width: width, height: 0)
        }
    }

    private func weekSwipeGesture(result: NativeScheduleResult, width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                guard selectedCourse == nil, !weekSliding else { return }
                let horizontal = value.translation.width
                let vertical = value.translation.height
                weekDragAxis = resolveWeekSwipeAxis(horizontal, vertical, weekDragAxis)
                guard weekDragAxis == .horizontal else { return }
                let direction = horizontal < 0 ? 1 : -1
                // Pull against a missing neighbour instead of exposing a blank
                // page at the first or last week of the semester.
                let resistance = canMoveWeek(direction, result: result) ? 1.0 : 0.3
                weekDragOffset = horizontal * resistance
            }
            .onEnded { value in
                let axis = weekDragAxis
                weekDragAxis = .pending
                guard axis == .horizontal, !weekSliding else {
                    // A gesture abandoned mid-drag must never leave the track
                    // parked off centre.
                    if weekDragOffset != 0, !weekSliding {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                            weekDragOffset = 0
                        }
                    }
                    return
                }
                finishWeekSwipe(
                    result: result,
                    width: max(width, 1),
                    translation: value.translation.width,
                    predicted: value.predictedEndTranslation.width
                )
            }
    }

    private func finishWeekSwipe(
        result: NativeScheduleResult,
        width: CGFloat,
        translation: CGFloat,
        predicted: CGFloat
    ) {
        let direction = translation < 0 ? 1 : -1
        let threshold = max(52, width * 0.2)
        let flick = abs(predicted) >= width * 0.55 && abs(translation) >= 18
        guard abs(translation) >= threshold || flick,
              let target = adjacentWeekValue(direction, result: result) else {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                weekDragOffset = 0
            }
            return
        }
        slideToWeek(target, direction: direction, width: width)
    }

    /// Runs the page off screen, then swaps the week and recentres the track in
    /// a single unanimated transaction so the new timetable never flashes.
    private func slideToWeek(_ week: String, direction: Int, width: CGFloat) {
        weekSliding = true
        withAnimation(.spring(response: 0.3, dampingFraction: 0.88)) {
            weekDragOffset = direction > 0 ? -width : width
        } completion: {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                store.commitWeekSelection(week)
                weekDragOffset = 0
                weekSliding = false
            }
        }
    }

    private func scheduleRows(
        result: NativeScheduleResult,
        week: Int?,
        days: [Int],
        columnWidth: CGFloat
    ) -> some View {
        HStack(alignment: .top, spacing: 0) {
            slotAxis

            ForEach(days, id: \.self) { day in
                NativeScheduleDayColumn(
                    day: day,
                    dateText: dayDate(day, week: week, result: result),
                    isToday: dayIsToday(day, week: week, result: result),
                    columnWidth: columnWidth,
                    blocks: blocks(for: day, week: week, result: result),
                    onCourseSelected: { block in
                        selectedCourse = SelectedCourse(
                            course: block.course,
                            day: day,
                            startSlot: block.startSlot,
                            endSlot: block.endSlot
                        )
                    }
                )
            }
        }
        .padding(.bottom, 4)
    }

    private var slotAxis: some View {
        VStack(spacing: 0) {
            Text("节次")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 46, height: 52)

            VStack(spacing: 0) {
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
                    .frame(width: 46, height: NativeScheduleDayColumn.slotHeight)
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
                    slotAxis
                    ForEach(1...7, id: \.self) { day in
                        NativeScheduleDayColumn(
                            day: day,
                            dateText: nil,
                            isToday: day == Self.chinaWeekday,
                            columnWidth: max(1, (proxy.size.width - 46) / 7),
                            blocks: [],
                            onCourseSelected: { _ in }
                        )
                    }
                }
            }
            .frame(height: 52 + CGFloat(ScheduleSlot.all.count) * NativeScheduleDayColumn.slotHeight)
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
                .foregroundStyle(Color.accentColor)
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
            List {
                if let result = store.result, !result.weeks.isEmpty {
                    ForEach(result.weeks, id: \.value) { week in
                        Button {
                            weekPickerPresented = false
                            Task { await store.selectWeek(week.value) }
                        } label: {
                            HStack {
                                Text(week.label.isEmpty ? "第 \(week.value) 周" : week.label)
                                Spacer()
                                if week.value == store.selectedWeek {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color.accentColor)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                } else {
                    Text("暂无可选周次")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("选择周次")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
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
        if store.selectedWeek.isEmpty {
            let currentWeek = store.calendar.map { $0.currentWeek }.flatMap { $0 > 0 ? String($0) : nil }
            store.selectedWeek = currentWeek ?? result.currentWeek
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

    private func moveWeek(_ offset: Int, result: NativeScheduleResult) {
        guard !weekSliding, let target = adjacentWeekValue(offset, result: result) else { return }
        // The stepper buttons ride the same track as a swipe so both paths read
        // as one gesture. Without a measured page width, switch outright.
        guard weekPageWidth > 1 else {
            Task { await store.selectWeek(target) }
            return
        }
        slideToWeek(target, direction: offset, width: weekPageWidth)
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

    /// Mirrors the Web timetable's swipe lock: a sideways drag wins early
    /// because real thumbs never swipe perfectly straight, while a clear
    /// vertical drag is handed to the enclosing scroll view for good.
    private func resolveWeekSwipeAxis(
        _ horizontal: CGFloat,
        _ vertical: CGFloat,
        _ current: ScheduleSwipeAxis
    ) -> ScheduleSwipeAxis {
        if current != .pending { return current }
        let absH = abs(horizontal)
        let absV = abs(vertical)
        if absH >= 8, absH >= absV * 0.9 { return .horizontal }
        if absV >= 14, absV > absH * 1.6 { return .vertical }
        return .pending
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
                cell.courses.enumerated().compactMap { index, course -> NativeScheduleCourseBlock? in
                    if let week, !course.weekList.isEmpty, !course.weekList.contains(week) {
                        return nil
                    }
                    let fallbackStart = cell.bigSlot * 2 - 1
                    let fallbackEnd = cell.bigSlot * 2
                    var start = min(max(course.startSlot ?? fallbackStart, 1), ScheduleSlot.all.count)
                    var end = min(max(course.endSlot ?? fallbackEnd, start), ScheduleSlot.all.count)
                    // Match the Web timetable's handling of a course repeated
                    // in several large-period cells by the school parser.
                    if end < fallbackStart || start > fallbackEnd {
                        start = min(max(fallbackStart, 1), ScheduleSlot.all.count)
                        end = min(max(fallbackEnd, start), ScheduleSlot.all.count)
                    }
                    return NativeScheduleCourseBlock(
                        id: "\(week.map(String.init) ?? "-")-\(day)-\(cell.bigSlot)-\(index)-\(course.name)",
                        course: course,
                        startSlot: start,
                        endSlot: end
                    )
                }
            }
            .sorted { lhs, rhs in
                if lhs.startSlot != rhs.startSlot { return lhs.startSlot < rhs.startSlot }
                return lhs.endSlot < rhs.endSlot
            }

        let families = Dictionary(grouping: rawBlocks) { block in
            [block.course.customId ?? "", block.course.name, block.course.teacher ?? "",
             block.course.location ?? "", block.course.weeks].joined(separator: "\u{1F}")
        }
        var merged: [NativeScheduleCourseBlock] = []
        for family in families.values {
            var current: NativeScheduleCourseBlock?
            for block in family.sorted(by: { $0.startSlot < $1.startSlot }) {
                if let previous = current, block.startSlot <= previous.endSlot + 1 {
                    current = NativeScheduleCourseBlock(id: previous.id, course: previous.course,
                        startSlot: previous.startSlot, endSlot: max(previous.endSlot, block.endSlot))
                } else {
                    if let current { merged.append(current) }
                    current = block
                }
            }
            if let current { merged.append(current) }
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

    /// Horizontal page margin of the scrolling content.
    private static let contentInset: CGFloat = 16

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

private enum ScheduleSwipeAxis {
    case pending
    case horizontal
    case vertical
}

private enum ScheduleViewMode: String, Hashable {
    case week
    case day
}

private struct NativeScheduleCourseBlock: Identifiable {
    let id: String
    let course: NativeScheduleCourse
    let startSlot: Int
    let endSlot: Int
    let lane: Int

    init(id: String, course: NativeScheduleCourse, startSlot: Int, endSlot: Int, lane: Int = 0) {
        self.id = id
        self.course = course
        self.startSlot = startSlot
        self.endSlot = endSlot
        self.lane = lane
    }

    func withLane(_ lane: Int) -> NativeScheduleCourseBlock {
        NativeScheduleCourseBlock(id: id, course: course, startSlot: startSlot, endSlot: endSlot, lane: lane)
    }
}

private struct SelectedCourse: Identifiable {
    let id = UUID()
    let course: NativeScheduleCourse
    let day: Int
    let startSlot: Int
    let endSlot: Int
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
    static let slotHeight: CGFloat = 50

    let day: Int
    let dateText: String?
    let isToday: Bool
    let columnWidth: CGFloat
    let blocks: [NativeScheduleCourseBlock]
    let onCourseSelected: (NativeScheduleCourseBlock) -> Void

    private var laneCount: Int {
        max(1, (blocks.map(\.lane).max() ?? 0) + 1)
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 2) {
                Text(dayLabel)
                    .font(.caption.weight(.semibold))
                Text(dateText ?? "--")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(width: columnWidth, height: 52)
            .background {
                if isToday {
                    ScheduleGlassBackground(
                        cornerRadius: 12,
                        colors: [
                            Color(hue: 0.43, saturation: 0.22, brightness: 0.92).opacity(0.12),
                            Color(hue: 0.59, saturation: 0.20, brightness: 0.96).opacity(0.10),
                            Color(hue: 0.89, saturation: 0.18, brightness: 0.96).opacity(0.12),
                        ],
                        border: Color.accentColor.opacity(0.22)
                    )
                        .padding(.horizontal, 2)
                        .padding(.vertical, 3)
                }
            }

            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    ForEach(ScheduleSlot.all, id: \.number) { slot in
                        HStack(spacing: 0) {
                            ForEach(0..<laneCount, id: \.self) { lane in
                                let occupied = blocks.contains {
                                    $0.lane == lane && ($0.startSlot...$0.endSlot).contains(slot.number)
                                }
                                Group {
                                    if occupied {
                                        Color.clear
                                    } else {
                                        ScheduleGlassBackground(cornerRadius: 8)
                                    }
                                }
                                    .frame(width: max(12, columnWidth / CGFloat(laneCount) - 4), height: Self.slotHeight - 6)
                                    .frame(width: columnWidth / CGFloat(laneCount), height: Self.slotHeight)
                            }
                        }
                    }
                }
                .accessibilityHidden(true)

                ForEach(blocks) { block in
                    Button {
                        onCourseSelected(block)
                    } label: {
                        NativeScheduleCourseCard(course: block.course, compact: columnWidth < 70)
                            .frame(width: max(12, columnWidth / CGFloat(laneCount) - 4), height: max(42, CGFloat(block.endSlot - block.startSlot + 1) * Self.slotHeight - 6))
                            .clipped()
                    }
                    .buttonStyle(.plain)
                    .offset(x: 2 + CGFloat(block.lane) * (columnWidth / CGFloat(laneCount)), y: CGFloat(block.startSlot - 1) * Self.slotHeight + 3)
                }
            }
            .frame(width: columnWidth, height: CGFloat(ScheduleSlot.all.count) * Self.slotHeight)
        }
        .frame(width: columnWidth)
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
    var compact = false

    var body: some View {
        GeometryReader { geometry in
            let shortCard = geometry.size.height < 64
            let location = clean(course.location)

            VStack(spacing: compact ? 3 : 5) {
                Text(course.name)
                    .font(.system(size: compact ? 11 : 14, weight: .semibold))
                    .lineLimit(shortCard ? 1 : (compact ? 3 : 2))
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity)
                    .layoutPriority(1)

                if let location {
                    Text("@" + location.trimmingCharacters(in: CharacterSet(charactersIn: "@＠")))
                        .font(.system(size: compact ? 10 : 12, weight: .medium))
                        .lineLimit(shortCard ? 1 : 2)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity)
                        .layoutPriority(2)
                }
            }
            .multilineTextAlignment(.center)
            .foregroundStyle(accent)
            .padding(.horizontal, compact ? 3 : 10)
            .padding(.vertical, shortCard ? 4 : 7)
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .center)
        }
        .background {
            ScheduleGlassBackground(
                cornerRadius: 8,
                colors: [
                    Color(hue: hue, saturation: 0.58, brightness: 0.96).opacity(colorScheme == .dark ? 0.25 : 0.22),
                    Color(hue: (hue + 0.04).truncatingRemainder(dividingBy: 1), saturation: 0.44, brightness: 1)
                        .opacity(colorScheme == .dark ? 0.16 : 0.12),
                ],
                border: accent,
                lineWidth: 1
            )
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var accent: Color {
        Color(hue: hue, saturation: colorScheme == .dark ? 0.38 : 0.68,
              brightness: colorScheme == .dark ? 0.96 : 0.52)
    }

    private var hue: Double {
        // Keep one stable color per course, with a broader range of soft fills.
        let palette: [Double] = [0.01, 0.055, 0.105, 0.145, 0.21, 0.30, 0.39, 0.45,
                                 0.50, 0.55, 0.60, 0.65, 0.70, 0.76, 0.83, 0.92]
        let hash = course.name.unicodeScalars.reduce(UInt64(0)) { ($0 &* 31) &+ UInt64($1.value) }
        return palette[Int(hash % UInt64(palette.count))]
    }

    private func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
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
                    .foregroundStyle(Color.accentColor)
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

#Preview {
    Text("NativeScheduleView requires a NativeScheduleStore")
}
