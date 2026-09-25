import Foundation
import WidgetKit

enum AppWidgetConfiguration {
    static var appGroup: String {
        let configured = Bundle.main.object(forInfoDictionaryKey: "CPUAppGroupIdentifier") as? String
        let value = configured?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? "group.cn.cputime.mobile" : value
    }
    /// App 按日期展开写好的本地课表（`NativeWidgetLocalSchedule`），小组件只读这一份。
    static let localDaysFileName = "schedule-widget-local-days.json"
    static let themeKey = "scheduleWidgetTheme"
    static let displayOptionsKey = "scheduleWidgetDisplayOptions"
    static let appURL = URL(string: "cputime-next://schedule?source=widget&week=current")!

    static func appURL(semester: String?, currentWeek: Int?) -> URL {
        guard var components = URLComponents(url: appURL, resolvingAgainstBaseURL: false) else {
            return appURL
        }
        var query = components.queryItems ?? []
        if let semester = semester?.trimmingCharacters(in: .whitespacesAndNewlines),
           !semester.isEmpty {
            query.append(URLQueryItem(name: "widgetSemester", value: semester))
        }
        if let currentWeek, (1...64).contains(currentWeek) {
            query.append(URLQueryItem(name: "widgetWeek", value: String(currentWeek)))
        }
        components.queryItems = query
        return components.url ?? appURL
    }

    static var scheduleTheme: ScheduleWidgetTheme {
        let value = UserDefaults(suiteName: appGroup)?.string(forKey: themeKey)
        return ScheduleWidgetTheme(rawValue: value ?? "") ?? .colorGlass
    }

    static var displayOptions: ScheduleWidgetDisplayOptions {
        ScheduleWidgetDisplayOptions.load(
            defaults: UserDefaults(suiteName: appGroup)
        )
    }
}

/// User-selectable widget fields. The app writes this value to the shared App
/// Group; all iOS widget families and the Watch complication read the same
/// keys so their content stays consistent.
struct ScheduleWidgetDisplayOptions: Codable, Equatable {
    var showCourseName: Bool
    var showRoom: Bool
    var showTeacher: Bool
    var showTime: Bool
    /// 日期栏里的农历日期。
    var showLunarDate: Bool
    /// 节日与法定假期提示。
    var showHoliday: Bool
    /// 最近的节假日常驻在日期栏右侧，而不是只在今天课上完之后才出现。
    var holidayAlwaysVisible: Bool
    /// 今天的课上完之后显示什么。不在 App 里存，每个小组件在「编辑小组件」里各选各的，
    /// 渲染时由 `ScheduleWidgetRoot` 填进来。
    var afterClass: ScheduleWidgetAfterClassStyle

    static let `default` = ScheduleWidgetDisplayOptions(
        showCourseName: true,
        showRoom: true,
        showTeacher: true,
        showTime: true
    )

    init(
        showCourseName: Bool,
        showRoom: Bool,
        showTeacher: Bool,
        showTime: Bool,
        showLunarDate: Bool = true,
        showHoliday: Bool = true,
        holidayAlwaysVisible: Bool = true,
        afterClass: ScheduleWidgetAfterClassStyle = .tomorrow
    ) {
        self.showCourseName = showCourseName
        self.showRoom = showRoom
        self.showTeacher = showTeacher
        self.showTime = showTime
        self.showLunarDate = showLunarDate
        self.showHoliday = showHoliday
        self.holidayAlwaysVisible = holidayAlwaysVisible
        self.afterClass = afterClass
    }

    /// 旧版本写进 App Group 的 JSON 没有农历和节假日字段。缺字段时按默认值补齐，
    /// 否则整份显示设置会解码失败、把用户已经关掉的开关又打开。
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            showCourseName: try values.decodeIfPresent(Bool.self, forKey: .showCourseName) ?? true,
            showRoom: try values.decodeIfPresent(Bool.self, forKey: .showRoom) ?? true,
            showTeacher: try values.decodeIfPresent(Bool.self, forKey: .showTeacher) ?? true,
            showTime: try values.decodeIfPresent(Bool.self, forKey: .showTime) ?? true,
            showLunarDate: try values.decodeIfPresent(Bool.self, forKey: .showLunarDate) ?? true,
            showHoliday: try values.decodeIfPresent(Bool.self, forKey: .showHoliday) ?? true,
            holidayAlwaysVisible: try values.decodeIfPresent(Bool.self, forKey: .holidayAlwaysVisible) ?? true
        )
    }

    /// 今天没有未结束的课程时，`.none` 之外的选项会接管那块空间。
    var showsAfterClassPreview: Bool { afterClass != .none }

    /// 日期栏右侧是否常驻显示最近的节假日。关掉节假日提示时一并关掉。
    var showsResidentHoliday: Bool { showHoliday && holidayAlwaysVisible }

    static func load(defaults: UserDefaults?) -> Self {
        guard let data = defaults?.data(forKey: AppWidgetConfiguration.displayOptionsKey),
              let value = try? JSONDecoder().decode(Self.self, from: data) else {
            return .default
        }
        return value
    }

    func metadata(for course: ScheduleCourse) -> String? {
        let values = [showRoom ? course.normalizedLocation : nil,
                      showTeacher ? course.normalizedTeacher : nil]
            .compactMap { $0 }
        return values.isEmpty ? nil : values.joined(separator: " · ")
    }

    func primaryValue(for course: ScheduleCourse) -> String? {
        if showCourseName { return course.displayName }
        if showRoom { return course.normalizedLocation }
        if showTeacher { return course.normalizedTeacher }
        if showTime { return course.timeRange }
        return nil
    }
}

/// 今天的课上完之后小组件显示什么。在每个小组件的「编辑小组件」里单独选；
/// 两日课表本来就带明天，不受这个设置影响。
enum ScheduleWidgetAfterClassStyle: String, Codable, CaseIterable, Sendable {
    /// 保持原来的「今天没有课程」。
    case none
    /// 明天的课程，灰色显示；明天也没课时退回最近的节假日。
    case tomorrow
    /// 最近的一段法定假期。
    case holiday
    /// 换成最近一个有课的日期（三周之内）的课：日期栏照旧是今天，标上「明天的课」「10/2 的课」，课程压暗；三周内都没课时退回最近的节假日。
    case nextCourseDay
}

enum ScheduleWidgetTheme: String {
    case green
    case blue
    case teal
    case indigo
    case violet
    case orange
    case rose
    case slate
    case colorGlass = "color-glass"
}

struct ScheduleCourse: Decodable, Identifiable {
    let name: String?
    let teacher: String?
    let location: String?
    let note: String?
    let slotNote: String?
    let startTime: String?
    let endTime: String?
    let startSlot: Int?
    let endSlot: Int?

    var id: String {
        [name, startTime, endTime, location].compactMap { $0 }.joined(separator: "|")
    }

    var displayName: String { normalized(name) ?? "课程" }
    var startLabel: String { normalized(startTime) ?? "--:--" }

    var normalizedLocation: String? { normalized(location) }
    var normalizedTeacher: String? { normalized(teacher) }

    var metadata: String {
        let values = [normalized(location), normalized(teacher), normalized(note) ?? normalized(slotNote)]
            .compactMap { $0 }
        return values.isEmpty ? "地点待确认" : values.joined(separator: " · ")
    }

    var timeRange: String {
        guard let start = normalized(startTime) else { return "时间待确认" }
        guard let end = normalized(endTime) else { return start }
        return "\(start) - \(end)"
    }

    var endMinutes: Int {
        if let value = Self.minutes(endTime) { return value }
        if let value = Self.minutes(startTime) { return value + 45 }
        return 0
    }

    var hasUsableStartTime: Bool { Self.minutes(startTime) != nil }

    func hasEnded(at minutes: Int) -> Bool {
        endMinutes > 0 && endMinutes < minutes
    }

    private func normalized(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func minutes(_ value: String?) -> Int? {
        guard let value, value.count >= 5 else { return nil }
        let pieces = value.prefix(5).split(separator: ":")
        guard pieces.count == 2, let hour = Int(pieces[0]), let minute = Int(pieces[1]) else { return nil }
        return hour * 60 + minute
    }
}

struct ScheduleDay: Decodable, Identifiable {
    let day: Int?
    let label: String?
    let date: String?
    let week: Int?
    let isToday: Bool?
    let courses: [ScheduleCourse]?

    var id: String { date ?? "day-\(day ?? 0)" }
    var courseList: [ScheduleCourse] { courses ?? [] }
    var displayLabel: String {
        // Older widget payloads used "今天" as the day label. It is a
        // status marker, not a second date heading, so keep it out of the UI.
        (label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
            .replacingOccurrences(of: "今天", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    var shortLabel: String { displayLabel.isEmpty ? compactDate : displayLabel }

    /// 调休说明。App 写的本地课表还没带这一句，先不显示。
    var normalizedNote: String? { nil }

    var compactDate: String {
        guard let date, date.count >= 10 else { return "课表" }
        let month = Int(date.dropFirst(5).prefix(2)) ?? 0
        let day = Int(date.dropFirst(8).prefix(2)) ?? 0
        return month > 0 && day > 0 ? "\(month).\(day)" : String(date.dropFirst(5)).replacingOccurrences(of: "-", with: ".")
    }

    func courseWindow(limit: Int, nowMinutes: Int?) -> ScheduleCourseWindow {
        let safeLimit = max(0, limit)
        let overflow = max(0, courseList.count - safeLimit)
        let completedPrefix = nowMinutes.map { minutes in
            courseList.prefix { $0.hasEnded(at: minutes) }.count
        } ?? 0
        let skippedCompletedCount = min(overflow, completedPrefix)
        let visible = Array(courseList.dropFirst(skippedCompletedCount).prefix(safeLimit))
        let remainingCount = max(0, courseList.count - skippedCompletedCount - visible.count)
        return ScheduleCourseWindow(
            courses: visible,
            remainingCount: remainingCount,
            skippedCompletedCount: skippedCompletedCount
        )
    }
}

struct ScheduleCourseWindow {
    let courses: [ScheduleCourse]
    let remainingCount: Int
    let skippedCompletedCount: Int
}

struct SchedulePayload: Decodable {
    /// 「最近有课的一天」往后找几天。一周跨不过中秋接国庆这样的长假，三周连寒暑假前后的空档也够用。
    static let lookaheadDays = 21

    let title: String?
    let generatedAt: String?
    let cachedAt: String?
    let semester: String?
    let week: Int?
    let currentWeek: Int?
    let displayWeek: Int?
    let strictDate: Bool?
    let stale: Bool?
    let today: ScheduleDay?
    let days: [ScheduleDay]?
    let weekDays: [ScheduleDay]?
    /// App 写的本地课表里的所有日子（整学期），`weekDays` 之外的日子在这里找。
    var localDays: [ScheduleDay]? = nil

    private enum CodingKeys: String, CodingKey {
        case title, generatedAt, cachedAt, semester, week, currentWeek, displayWeek, strictDate, stale, today, days, weekDays
    }

    func day(for date: String, fallbackOffset: Int) -> ScheduleDay {
        if fallbackOffset == 0, today?.date == date, let today { return today }
        if let exact = (days ?? []).first(where: { $0.date == date }) { return exact }
        if strictDate == true {
            return ScheduleDay.empty(date: date, offset: fallbackOffset)
        }
        let targetDay = Calendar.current.component(.weekday, from: Calendar.current.date(byAdding: .day, value: fallbackOffset, to: .now) ?? .now)
        let mondayBasedDay = targetDay == 1 ? 7 : targetDay - 1
        return (days ?? []).first(where: { $0.day == mondayBasedDay })
            ?? (fallbackOffset == 0 ? today : nil)
            ?? ScheduleDay.empty(date: date, offset: fallbackOffset)
    }

    func fullDay(for date: String, fallbackOffset: Int) -> ScheduleDay {
        if let exact = (weekDays ?? []).first(where: { $0.date == date }) { return exact }
        if let exact = (days ?? []).first(where: { $0.date == date }) { return exact }
        if today?.date != date, let local = localDay(for: date) { return local }
        return day(for: date, fallbackOffset: fallbackOffset)
    }

    /// 只在确实有这一天的数据时返回，`nil` 表示本地课表里没有这一天。
    func knownDay(for date: String) -> ScheduleDay? {
        if let exact = (weekDays ?? []).first(where: { $0.date == date }) { return exact }
        if let exact = (days ?? []).first(where: { $0.date == date }) { return exact }
        if today?.date == date { return today }
        return localDay(for: date)
    }

    /// `weekDays` 之外的日子。
    func localDay(for date: String) -> ScheduleDay? {
        (localDays ?? []).first(where: { $0.date == date })
    }

    /// 明天那一天；本地课表里没有就返回 `nil`。
    func tomorrow(now: Date = .now) -> ScheduleDay? {
        guard let date = Calendar.current.date(byAdding: .day, value: 1, to: now) else { return nil }
        return knownDay(for: Self.dateString(date))
    }

    /// 今天这一天（完整的一天，包括已经下课的课）。
    func currentDay(now: Date = .now) -> ScheduleDay {
        fullDay(for: Self.dateString(now), fallbackOffset: 0)
    }

    /// 今天还没上完的课（包括没有具体时间、没法判断的）。
    func remainingCourses(in day: ScheduleDay, now: Date = .now) -> [ScheduleCourse] {
        let minutes = Self.minutesSinceMidnight(now)
        return day.courseList.filter {
            $0.endMinutes >= minutes || (!$0.hasUsableStartTime && $0.endMinutes <= 0)
        }
    }

    /// 今天之后三周之内第一个有课的日期；找不到就是 `nil`。
    func nextCourseDay(after now: Date = .now) -> (day: ScheduleDay, offset: Int)? {
        for offset in 1...Self.lookaheadDays {
            let date = Calendar.current.date(byAdding: .day, value: offset, to: now) ?? now
            let candidate = fullDay(for: Self.dateString(date), fallbackOffset: offset)
            if !candidate.courseList.isEmpty { return (candidate, offset) }
        }
        return nil
    }

    /// Mirrors the Web/Scriptable widget rule: keep today's remaining classes,
    /// otherwise show the next day within the published window that has a
    /// course. The offset is retained so the caller can choose whether to
    /// dim completed courses and how to find the following day.
    func preferredCourseDay(now: Date = .now) -> (day: ScheduleDay, offset: Int) {
        let minutes = Self.minutesSinceMidnight(now)
        let todayDate = Self.dateString(now)
        let today = fullDay(for: todayDate, fallbackOffset: 0)
        let hasRemaining = today.courseList.contains { course in
            course.endMinutes >= minutes || (!course.hasUsableStartTime && course.endMinutes <= 0)
        }
        if hasRemaining { return (today, 0) }

        for offset in 1...Self.lookaheadDays {
            let date = Calendar.current.date(byAdding: .day, value: offset, to: now) ?? now
            let candidate = fullDay(for: Self.dateString(date), fallbackOffset: offset)
            if !candidate.courseList.isEmpty { return (candidate, offset) }
        }

        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now) ?? now
        return (fullDay(for: Self.dateString(tomorrow), fallbackOffset: 1), 1)
    }

    /// `.nextCourseDay` 是原来的行为：今天上完就往后找最近有课的一天。
    /// 其他选项停在今天，空出来的位置交给课后区域。
    func upcoming(
        now: Date = .now,
        afterClass: ScheduleWidgetAfterClassStyle = .nextCourseDay
    ) -> (ScheduleDay, [ScheduleCourse]) {
        guard afterClass == .nextCourseDay else {
            let today = currentDay(now: now)
            return (today, Array(remainingCourses(in: today, now: now).prefix(2)))
        }
        let selected = preferredCourseDay(now: now)
        let courses: [ScheduleCourse]
        if selected.offset == 0 {
            let minutes = Self.minutesSinceMidnight(now)
            courses = selected.day.courseList.filter {
                $0.endMinutes >= minutes || (!$0.hasUsableStartTime && $0.endMinutes <= 0)
            }
        } else {
            courses = selected.day.courseList
        }
        // 三周内都没课：别停在明天的日期上说今天的事，退回今天，交给课后区域。
        guard !courses.isEmpty else { return (currentDay(now: now), []) }
        return (selected.day, Array(courses.prefix(2)))
    }

    static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func minutesSinceMidnight(_ date: Date) -> Int {
        Calendar.current.component(.hour, from: date) * 60
            + Calendar.current.component(.minute, from: date)
    }
}

private extension ScheduleDay {
    static func empty(date: String, offset: Int) -> ScheduleDay {
        let target = Calendar.current.date(byAdding: .day, value: offset, to: .now) ?? .now
        let weekday = Calendar.current.component(.weekday, from: target)
        let day = weekday == 1 ? 7 : weekday - 1
        let labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        return ScheduleDay(
            day: day,
            label: labels[day - 1],
            date: date,
            week: nil,
            isToday: offset == 0,
            courses: []
        )
    }
}

enum ScheduleWidgetError: LocalizedError {
    case unconfigured

    var errorDescription: String? {
        "请先打开 App 登录并同步一次课表"
    }
}

/// 小组件只读 App 写的本地课表，不再请求服务端。课表跟着 App 更新，
/// 课程边界上的刷新只是重新读一遍这份文件。
enum ScheduleWidgetClient {
    static func load(now: Date = .now) async throws -> SchedulePayload {
        guard let payload = ScheduleLocalDays.payload(now: now) else {
            throw ScheduleWidgetError.unconfigured
        }
        return payload
    }
}

/// App 写的本地课表（`NativeWidgetLocalSchedule`）。App 退出登录时会删掉这份文件。
private enum ScheduleLocalDays {
    private struct Record: Decodable {
        let semester: String?
        let days: [ScheduleDay]
    }

    /// 拼出小组件用的课表。今天不在学期里（假期）时给一个空的今天，照样显示「今天没有课」和节假日。
    static func payload(now: Date) -> SchedulePayload? {
        guard let record = record() else { return nil }
        let todayDate = SchedulePayload.dateString(now)
        let today = record.days.first(where: { $0.date == todayDate }) ?? .empty(date: todayDate, offset: 0)
        let week = today.week
        return SchedulePayload(
            title: nil,
            generatedAt: nil,
            cachedAt: nil,
            semester: record.semester,
            week: week,
            currentWeek: week,
            displayWeek: week,
            strictDate: true,
            stale: true,
            today: today,
            days: nil,
            weekDays: week.map { week in record.days.filter { $0.week == week } },
            localDays: record.days
        )
    }

    private static func record() -> Record? {
        guard let url = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: AppWidgetConfiguration.appGroup)?
            .appendingPathComponent(AppWidgetConfiguration.localDaysFileName),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Record.self, from: data)
    }
}

enum ScheduleEntryState {
    case loaded(SchedulePayload)
    case unconfigured
    case failed(String)
}

struct ScheduleEntry: TimelineEntry {
    let date: Date
    let state: ScheduleEntryState
    var configuration = ScheduleWidgetConfiguration()

    var appURL: URL {
        guard case .loaded(let payload) = state else { return AppWidgetConfiguration.appURL }
        return AppWidgetConfiguration.appURL(
            semester: payload.semester,
            currentWeek: payload.currentWeek
        )
    }

    static let placeholder = ScheduleEntry(
        date: .now,
        state: .loaded(
            SchedulePayload(
                title: "药大课表",
                generatedAt: nil,
                cachedAt: nil,
                semester: "2026-2027-1",
                week: 1,
                currentWeek: 1,
                displayWeek: 1,
                strictDate: true,
                stale: false,
                today: ScheduleDay(
                    day: 1,
                    label: "周一",
                    date: "2026-08-31",
                    week: 1,
                    isToday: true,
                    courses: [
                        ScheduleCourse(
                            name: "药物设计学", teacher: "邹老师", location: "D301",
                            note: nil, slotNote: nil, startTime: "08:00", endTime: "09:40", startSlot: 1, endSlot: 2
                        ),
                        ScheduleCourse(
                            name: "药剂学", teacher: "苏老师", location: "C204",
                            note: nil, slotNote: nil, startTime: "09:55", endTime: "11:35", startSlot: 3, endSlot: 4
                        ),
                    ]
                ),
                days: nil,
                weekDays: nil
            )
        )
    )
}

/// 生成时间线；各个小组件的配置由 `ScheduleIntentTimelineProvider` 再套上。
enum ScheduleTimeline {
    static func make(now: Date) async -> Timeline<ScheduleEntry> {
        let entry: ScheduleEntry
        var payload: SchedulePayload?
        do {
            let loaded = try await ScheduleWidgetClient.load(now: now)
            payload = loaded
            entry = ScheduleEntry(date: now, state: .loaded(loaded))
        } catch ScheduleWidgetError.unconfigured {
            entry = ScheduleEntry(date: now, state: .unconfigured)
        } catch {
            entry = ScheduleEntry(date: now, state: .failed(error.localizedDescription))
        }
        let periodic = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now.addingTimeInterval(1800)
        // 上课、下课那一刻就该换内容（划掉已结束的课、放学后切到明天），别等下一个半小时。
        // 这几次刷新只是重新读一遍本地课表。
        let refresh = payload.flatMap { nextBoundary(in: $0, now: now) }.map { min($0, periodic) } ?? periodic
        return Timeline(entries: [entry], policy: .after(refresh))
    }

    /// 今天剩下的课程边界里最近的一个（开始或结束），没有就返回 nil。
    private static func nextBoundary(in payload: SchedulePayload, now: Date) -> Date? {
        let today = payload.currentDay(now: now)
        let nowMinutes = SchedulePayload.minutesSinceMidnight(now)
        let startOfDay = Calendar.current.startOfDay(for: now)
        let minutes = today.courseList
            .flatMap { [Self.minutes($0.startTime), $0.endMinutes > 0 ? $0.endMinutes : nil] }
            .compactMap { $0 }
            .filter { $0 > nowMinutes }
            .min()
        guard let minutes else { return nil }
        // 边界后一分钟再刷新，免得刚好卡在同一分钟上还算成「没结束」。
        return startOfDay.addingTimeInterval(TimeInterval((minutes + 1) * 60))
    }

    private static func minutes(_ value: String?) -> Int? {
        guard let value, value.count >= 5 else { return nil }
        let pieces = value.prefix(5).split(separator: ":")
        guard pieces.count == 2, let hour = Int(pieces[0]), let minute = Int(pieces[1]) else { return nil }
        return hour * 60 + minute
    }
}
