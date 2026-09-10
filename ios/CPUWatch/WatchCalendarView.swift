import SwiftUI

private struct WatchScheduleDay: Identifiable {
    let id: Int
    let date: Date
}

struct WatchCalendarPager: View {
    let snapshot: ScheduleEnvelope
    let now: Date
    let state: ScheduleDisplayState
    let connectionIssue: ScheduleFailure?
    @Binding var selectedDayID: Int
    let refresh: () -> Void
    @State private var selectedCourse: WatchCourse?
    @State private var suppressCourseSelection = false
    @State private var suppressionResetTask: Task<Void, Never>?

    private var days: [WatchScheduleDay] {
        guard let start = snapshot.date(snapshot.semester.startDate),
              let end = snapshot.date(snapshot.semester.endDate) else { return [] }
        var result: [WatchScheduleDay] = []
        var date = start
        while date <= end {
            result.append(WatchScheduleDay(id: Self.dayID(date, calendar: snapshot.calendar), date: date))
            guard let next = snapshot.calendar.date(byAdding: .day, value: 1, to: date) else { break }
            date = next
        }
        return result
    }

    private var todayID: Int {
        Self.dayID(now, calendar: snapshot.calendar)
    }

    private var selectedDay: WatchScheduleDay? {
        guard !days.isEmpty else { return nil }
        if let selected = days.first(where: { $0.id == selectedDayID }) { return selected }
        if let today = days.first(where: { $0.id == todayID }) { return today }
        let generatedID = Self.dayID(snapshot.generatedAt, calendar: snapshot.calendar)
        return days.first(where: { $0.id == generatedID }) ?? days[0]
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let selectedDay {
                WatchDaySchedulePage(
                    snapshot: snapshot,
                    day: selectedDay.date,
                    now: now,
                    state: state,
                    connectionIssue: connectionIssue,
                    openCourse: openCourse
                )
                    .id(selectedDay.id)
                    .transition(.opacity)
            } else {
                WatchCalendarNotice(symbol: "calendar.badge.exclamationmark", text: "课表日期无效")
            }

            NavigationLink {
                WatchScheduleOptionsView(
                    canReturnToday: selectedDay?.id != todayID && days.contains(where: { $0.id == todayID }),
                    updatedAt: WatchCalendarText.monthDayTime(snapshot.generatedAt, calendar: snapshot.calendar),
                    returnToday: {
                        withAnimation(.easeInOut(duration: 0.18)) { selectedDayID = todayID }
                    },
                    refresh: refresh
                )
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 32, height: 32)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("课表选项")
            .padding(.trailing, 6)
            .padding(.bottom, 4)
        }
        .contentShape(Rectangle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onChanged { value in
                    guard isHorizontalSwipe(value.translation, minimumDistance: 12) else { return }
                    suppressionResetTask?.cancel()
                    suppressCourseSelection = true
                }
                .onEnded { value in
                    if isHorizontalSwipe(value.translation, minimumDistance: 36) {
                        suppressCourseSelection = true
                        moveDay(by: value.translation.width < 0 ? 1 : -1)
                    }
                    resetCourseSelectionSuppression()
                }
        )
        .navigationDestination(isPresented: courseDetailPresented) {
            if let selectedCourse {
                WatchCourseDetailView(course: selectedCourse)
            }
        }
        .animation(.easeInOut(duration: 0.18), value: selectedDayID)
        .accessibilityAction(named: "前一天") { moveDay(by: -1) }
        .accessibilityAction(named: "后一天") { moveDay(by: 1) }
        .onAppear { normalizeSelection() }
        .onChange(of: snapshot.generatedAt) { _, _ in normalizeSelection() }
        .onDisappear { suppressionResetTask?.cancel() }
    }

    private var courseDetailPresented: Binding<Bool> {
        Binding(
            get: { selectedCourse != nil },
            set: { if !$0 { selectedCourse = nil } }
        )
    }

    private func openCourse(_ course: WatchCourse) {
        guard !suppressCourseSelection else { return }
        selectedCourse = course
    }

    private func isHorizontalSwipe(_ translation: CGSize, minimumDistance: CGFloat) -> Bool {
        abs(translation.width) > abs(translation.height) * 1.2
            && abs(translation.width) >= minimumDistance
    }

    private func resetCourseSelectionSuppression() {
        suppressionResetTask?.cancel()
        suppressionResetTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            suppressCourseSelection = false
        }
    }

    private func moveDay(by offset: Int) {
        guard let selectedDay,
              let index = days.firstIndex(where: { $0.id == selectedDay.id }) else { return }
        let destination = index + offset
        guard days.indices.contains(destination) else { return }
        withAnimation(.easeInOut(duration: 0.18)) {
            selectedDayID = days[destination].id
        }
    }

    private func normalizeSelection() {
        guard !days.isEmpty else { return }
        if days.contains(where: { $0.id == selectedDayID }) { return }
        if days.contains(where: { $0.id == todayID }) {
            selectedDayID = todayID
            return
        }
        let generatedID = Self.dayID(snapshot.generatedAt, calendar: snapshot.calendar)
        selectedDayID = days.first(where: { $0.id == generatedID })?.id ?? days[0].id
    }

    private static func dayID(_ date: Date, calendar: Calendar) -> Int {
        let values = calendar.dateComponents([.year, .month, .day], from: date)
        return (values.year ?? 0) * 10_000 + (values.month ?? 0) * 100 + (values.day ?? 0)
    }
}

private struct WatchScheduleOptionsView: View {
    let canReturnToday: Bool
    let updatedAt: String
    let returnToday: () -> Void
    let refresh: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            if canReturnToday {
                Button("回到今天", systemImage: "calendar") {
                    returnToday()
                    dismiss()
                }
            }
            Button("刷新课表", systemImage: "arrow.clockwise") {
                refresh()
                dismiss()
            }
            Section("数据") {
                Text("更新于 \(updatedAt)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("课表选项")
    }
}

private struct WatchDaySchedulePage: View {
    let snapshot: ScheduleEnvelope
    let day: Date
    let now: Date
    let state: ScheduleDisplayState
    let connectionIssue: ScheduleFailure?
    let openCourse: (WatchCourse) -> Void

    private var calendar: Calendar { snapshot.calendar }
    private var week: Int { snapshot.week(on: day) }
    private var isCovered: Bool { snapshot.coveredWeeks.contains(week) }
    private var courses: [WatchCourse] { isCovered ? snapshot.courses(on: day) : [] }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 10) {
                WatchCalendarDayHeader(day: day, week: week, calendar: calendar, isToday: calendar.isDate(day, inSameDayAs: now))

                if let badge = WatchSyncBadge.value(for: state) {
                    WatchSyncBadge(label: badge.label, symbol: badge.symbol, tint: badge.tint)
                }
                if let issue = connectionIssue,
                   let badge = WatchSyncBadge.value(forConnectionIssue: issue),
                   !(state == .offlineCache && issue == .unavailable) {
                    WatchSyncBadge(label: badge.label, symbol: badge.symbol, tint: badge.tint)
                }

                if !isCovered {
                    WatchCalendarNotice(symbol: "icloud.slash", text: "这一周尚未同步")
                } else {
                    WatchPeriodTimeline(snapshot: snapshot, day: day, now: now, courses: courses, openCourse: openCourse)
                    if courses.isEmpty {
                        Label("今天没有课程", systemImage: "checkmark.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 42)
        }
        .scrollIndicators(.hidden)
    }
}

private struct WatchCalendarDayHeader: View {
    let day: Date
    let week: Int
    let calendar: Calendar
    let isToday: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(WatchCalendarText.month(day, calendar: calendar))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.red)
                Text(WatchCalendarText.weekday(day, calendar: calendar))
                    .font(.headline.weight(.semibold))
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if week > 0 {
                Text("第\(week)周")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            Text("\(calendar.component(.day, from: day))")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .frame(width: 30, height: 30)
                .foregroundStyle(isToday ? .white : .primary)
                .background(isToday ? Color.red : Color.clear, in: Circle())
                .overlay { Circle().stroke(.white.opacity(isToday ? 0 : 0.16), lineWidth: 1) }
        }
        .padding(.horizontal, 2)
    }
}

private struct WatchPeriodTimeline: View {
    let snapshot: ScheduleEnvelope
    let day: Date
    let now: Date
    let courses: [WatchCourse]
    let openCourse: (WatchCourse) -> Void

    private let rowHeight: CGFloat = 45
    private let gutterWidth: CGFloat = 42
    private var periods: [SchedulePeriod] { snapshot.displayPeriods }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                ForEach(Array(periods.enumerated()), id: \.element.id) { index, period in
                    periodRow(period)
                        .offset(y: CGFloat(index) * rowHeight)
                }

                ForEach(courses.filter { course in
                    periods.contains(where: { $0.number == course.startPeriod })
                        && periods.contains(where: { $0.number == course.endPeriod })
                }) { course in
                    let start = periods.firstIndex(where: { $0.number == course.startPeriod }) ?? 0
                    let end = periods.firstIndex(where: { $0.number == course.endPeriod }) ?? start
                    let span = end - start + 1
                    Button { openCourse(course) } label: {
                        WatchCourseEventCard(
                            course: course,
                            span: span,
                            isCurrent: isCurrent(course),
                            isNext: isNext(course),
                            isPast: isPast(course)
                        )
                    }
                    .buttonStyle(.plain)
                    .frame(
                        width: max(1, proxy.size.width - gutterWidth - 5),
                        height: CGFloat(span) * rowHeight - 5,
                        alignment: .topLeading
                    )
                    .offset(x: gutterWidth + 5, y: CGFloat(start) * rowHeight + 2)
                }
            }
        }
        .frame(height: CGFloat(periods.count) * rowHeight)
        .accessibilityElement(children: .contain)
    }

    private func periodRow(_ period: SchedulePeriod) -> some View {
        HStack(alignment: .top, spacing: 4) {
            VStack(spacing: 0) {
                Text("\(period.number)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                if !period.startTime.isEmpty {
                    Text(period.startTime)
                        .font(.system(size: 7.5, weight: .medium, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                if !period.endTime.isEmpty {
                    Text(period.endTime)
                        .font(.system(size: 7.5, weight: .medium, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .frame(width: gutterWidth, alignment: .top)

            Rectangle()
                .fill(.white.opacity(0.12))
                .frame(height: 1)
                .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, minHeight: rowHeight, alignment: .topLeading)
    }

    private func isCurrent(_ course: WatchCourse) -> Bool {
        snapshot.calendar.isDate(day, inSameDayAs: now) && snapshot.currentCourse(at: now)?.id == course.id
    }

    private func isNext(_ course: WatchCourse) -> Bool {
        guard let next = snapshot.nextCourseOccurrence(at: now) else { return false }
        return next.course.id == course.id && snapshot.calendar.isDate(day, inSameDayAs: next.date)
    }

    private func isPast(_ course: WatchCourse) -> Bool {
        let selected = snapshot.calendar.startOfDay(for: day)
        let today = snapshot.calendar.startOfDay(for: now)
        if selected < today { return true }
        guard selected == today, let end = ScheduleEnvelope.minutes(course.endTime) else { return false }
        let minutes = snapshot.calendar.component(.hour, from: now) * 60 + snapshot.calendar.component(.minute, from: now)
        return end <= minutes
    }
}

private struct WatchCourseEventCard: View {
    let course: WatchCourse
    let span: Int
    let isCurrent: Bool
    let isNext: Bool
    let isPast: Bool

    private var tint: Color { WatchCourseColor.color(for: course.id) }

    var body: some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(isCurrent ? Color.green : tint)
                .frame(width: 3)
                .padding(.vertical, 4)

            VStack(alignment: .leading, spacing: span > 1 ? 3 : 1) {
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(course.name)
                        .font(.system(size: span > 1 ? 13 : 11, weight: .semibold))
                        .lineLimit(span > 1 ? 2 : 1)
                    Spacer(minLength: 0)
                    if isCurrent {
                        Text("进行中").foregroundStyle(.green)
                    } else if isNext {
                        Text("下一节").foregroundStyle(tint)
                    }
                }
                .font(.system(size: 8, weight: .bold))

                if span > 1 {
                    Text("\(course.startTime)–\(course.endTime) · 第\(course.startPeriod)–\(course.endPeriod)节")
                        .font(.system(size: 9, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Text(course.room?.isEmpty == false ? course.room! : "地点待确认")
                    .font(.system(size: span > 1 ? 10 : 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background((isCurrent ? Color.green : tint).opacity(isPast ? 0.07 : 0.16), in: RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke((isCurrent ? Color.green : tint).opacity(isCurrent ? 0.72 : 0.26), lineWidth: isCurrent ? 1.2 : 0.7)
        }
        .opacity(isPast ? 0.58 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(course.name)，第\(course.startPeriod)到\(course.endPeriod)节，\(course.startTime)到\(course.endTime)，\(course.room?.isEmpty == false ? course.room! : "地点待确认")")
    }
}

private struct WatchSyncBadge: View {
    let label: String
    let symbol: String
    let tint: Color

    var body: some View {
        Label(label, systemImage: symbol)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tint.opacity(0.13), in: Capsule())
    }

    static func value(for state: ScheduleDisplayState) -> (label: String, symbol: String, tint: Color)? {
        switch state {
        case .valid, .empty: return nil
        case .loading: return ("正在读取", "clock", .secondary)
        case .refreshing: return ("正在同步", "arrow.clockwise", .blue)
        case .offlineCache: return ("离线缓存", "wifi.slash", .orange)
        case .stale: return ("数据待更新", "clock.badge.exclamationmark", .orange)
        case .loginRequired: return ("需在 iPhone 登录", "iphone", .orange)
        case .awaitingFirstSync: return ("等待首次同步", "iphone.and.arrow.forward", .blue)
        case .failed: return ("同步失败", "exclamationmark.triangle", .orange)
        }
    }

    static func value(forConnectionIssue failure: ScheduleFailure) -> (label: String, symbol: String, tint: Color)? {
        switch failure {
        case .notActivated: return ("正在连接 iPhone", "iphone.radiowaves.left.and.right", .secondary)
        case .notPaired: return ("未检测到配对 iPhone", "iphone.slash", .orange)
        case .notInstalled: return ("iPhone App 未安装", "iphone.badge.exclamationmark", .orange)
        case .unavailable: return ("iPhone 当前不可达", "wifi.slash", .orange)
        default: return nil
        }
    }
}

private struct WatchCalendarNotice: View {
    let symbol: String
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.title3).foregroundStyle(.secondary)
            Text(text).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}

struct WatchScheduleUnavailableView: View {
    let state: ScheduleDisplayState
    let refreshing: Bool
    let refresh: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: 32, weight: .medium))
                    .foregroundStyle(.red)
                Text(title).font(.headline).multilineTextAlignment(.center)
                Text(message).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button(refreshing ? "正在同步…" : "从 iPhone 同步", action: refresh)
                    .disabled(refreshing)
            }
            .padding(.horizontal, 8)
            .padding(.top, 16)
        }
    }

    private var title: String {
        switch state {
        case .loginRequired: return "需要登录教务系统"
        case .failed: return "暂时无法同步"
        default: return "还没有课程表"
        }
    }

    private var message: String {
        switch state {
        case .loginRequired: return ScheduleFailure.loginRequired.localizedDescription
        case .failed(let failure): return failure.localizedDescription
        default: return "在 iPhone 打开课表，然后从个人中心的 Apple Watch 入口完成同步。"
        }
    }
}

struct WatchCourseDetailView: View {
    let course: WatchCourse
    private var tint: Color { WatchCourseColor.color(for: course.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 8) {
                    RoundedRectangle(cornerRadius: 2).fill(tint).frame(width: 4, height: 42)
                    Text(course.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                }

                VStack(spacing: 9) {
                    detailRow("clock", "\(course.startTime)–\(course.endTime)")
                    detailRow("number", "第 \(course.startPeriod)–\(course.endPeriod) 节")
                    detailRow("location", course.room?.isEmpty == false ? course.room! : "地点待确认")
                    if let campus = course.campus, !campus.isEmpty { detailRow("building.2", campus) }
                    detailRow("person", course.teacher?.isEmpty == false ? course.teacher! : "教师待确认")
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 8)
        }
        .navigationTitle("课程")
    }

    private func detailRow(_ symbol: String, _ value: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).foregroundStyle(tint).frame(width: 18)
            Text(value).font(.footnote)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private enum WatchCourseColor {
    static let palette: [Color] = [.blue, .green, .orange, .pink, .purple, .cyan, .yellow]

    static func color(for identifier: String) -> Color {
        var hash: UInt64 = 5_381
        for scalar in identifier.unicodeScalars {
            hash = ((hash << 5) &+ hash) &+ UInt64(scalar.value)
        }
        return palette[Int(hash % UInt64(palette.count))]
    }
}

private enum WatchCalendarText {
    static func month(_ date: Date, calendar: Calendar) -> String {
        format(date, pattern: "M月", calendar: calendar)
    }

    static func weekday(_ date: Date, calendar: Calendar) -> String {
        format(date, pattern: "EEEE", calendar: calendar)
    }

    static func monthDayTime(_ date: Date, calendar: Calendar) -> String {
        format(date, pattern: "M月d日 HH:mm", calendar: calendar)
    }

    private static func format(_ date: Date, pattern: String, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
}
