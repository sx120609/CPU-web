import Foundation
import WidgetKit

// The models of the schedule widgets. The file is also compiled into the app's
// Debug build for the widget gallery (`NativeWidgetGallery`), whose target
// starts at iOS 15: anything that needs the widget extension's iOS 17 carries
// the annotation.

enum AppWidgetConfiguration {
    static var appGroup: String {
        let configured = Bundle.main.object(forInfoDictionaryKey: "CPUAppGroupIdentifier") as? String
        let value = configured?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? "group.cn.cputime.mobile" : value
    }
    /// App 按日期展开写好的本地课表（`NativeWidgetLocalSchedule`），小组件只读这一份。
    static let localDaysFileName = "schedule-widget-local-days.json"
    /// 今日概览. The app reloads it when the 日程 it counts change.
    static let overviewKind = "cn.cputime.mobile.widget.overview"
    static let themeKey = "scheduleWidgetTheme"
    static let displayOptionsKey = "scheduleWidgetDisplayOptions"
    /// App 里选的课表风格（`ScheduleStyle.storageKey`）。
    static let timetableStyleKey = "scheduleVisualStyle"
    /// 小组件自己的风格：`follow`（默认，跟随课表）或一种风格。
    static let widgetStyleKey = "scheduleWidgetStyle"
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

/// 小组件的文字大小。大小是整块内容一起缩放的（字、色条、间距同一个比例），
/// 所以放大后放不下的课会照常收进「后面还有 N 门课」，不会挤出去。
enum ScheduleWidgetTextSize: String, Codable, CaseIterable, Sendable {
    /// 内容少、放得下时自动放大一两档，放不下就是标准大小。
    case auto
    case small
    case standard
    case large

    /// 依次试的缩放比例：第一个整块放得下的就用，都放不下用最后一个。
    var scales: [CGFloat] {
        switch self {
        case .auto: return [1.16, 1.08, 1]
        case .small: return [0.9]
        case .standard: return [1]
        case .large: return [1.12]
        }
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
    /// 节日徽标与休息时的假期倒计时。
    var showHoliday: Bool
    /// 最近的节假日常驻在日期栏右侧（「距国庆节还有 5 天」），而不是只在休息时才出现。
    var holidayAlwaysVisible: Bool
    /// 桌面小组件的文字大小；「编辑小组件」里可以给单个小组件另选。
    var textSize: ScheduleWidgetTextSize
    /// 日期栏右边的「第 N 周」。
    var showWeek: Bool
    /// 时间线上长课间的「休息 2 小时」。
    var showBreaks: Bool
    /// 正在上的课带一条实时进度，标题旁边是「距下课」「距上课」的倒计时。
    var showProgress: Bool
    /// 今天已经上完的课不再灰着留在列表里。
    var hideCompleted: Bool

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
        textSize: ScheduleWidgetTextSize = .standard,
        showWeek: Bool = true,
        showBreaks: Bool = true,
        showProgress: Bool = true,
        hideCompleted: Bool = false
    ) {
        self.showCourseName = showCourseName
        self.showRoom = showRoom
        self.showTeacher = showTeacher
        self.showTime = showTime
        self.showLunarDate = showLunarDate
        self.showHoliday = showHoliday
        self.holidayAlwaysVisible = holidayAlwaysVisible
        self.textSize = textSize
        self.showWeek = showWeek
        self.showBreaks = showBreaks
        self.showProgress = showProgress
        self.hideCompleted = hideCompleted
    }

    /// 旧版本写进 App Group 的 JSON 没有后来加的字段（农历、节假日、常驻、文字大小、进度……）；
    /// 中间有几版去掉过常驻，那时存下的设置也没有它。缺字段时按默认值补齐，
    /// 否则整份显示设置会解码失败、把用户已经关掉的开关又打开。
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        func flag(_ key: CodingKeys, _ fallback: Bool) throws -> Bool {
            try values.decodeIfPresent(Bool.self, forKey: key) ?? fallback
        }
        self.init(
            showCourseName: try flag(.showCourseName, true),
            showRoom: try flag(.showRoom, true),
            showTeacher: try flag(.showTeacher, true),
            showTime: try flag(.showTime, true),
            showLunarDate: try flag(.showLunarDate, true),
            showHoliday: try flag(.showHoliday, true),
            holidayAlwaysVisible: try flag(.holidayAlwaysVisible, true),
            // 认不出的值（以后的版本写的）当标准大小，不让整份设置作废。
            textSize: (try values.decodeIfPresent(String.self, forKey: .textSize)).flatMap(ScheduleWidgetTextSize.init(rawValue:)) ?? .standard,
            showWeek: try flag(.showWeek, true),
            showBreaks: try flag(.showBreaks, true),
            showProgress: try flag(.showProgress, true),
            hideCompleted: try flag(.hideCompleted, false)
        )
    }

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

    /// 「教室 · 老师」放不下时退回的一项：教室优先。
    func shortMetadata(for course: ScheduleCourse) -> String? {
        (showRoom ? course.normalizedLocation : nil) ?? (showTeacher ? course.normalizedTeacher : nil)
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
/// 两日课表本来就带明天，不受这个设置影响。规则见 docs/schedule-widget-rules.md。
enum ScheduleWidgetAfterClassStyle: String, Codable, CaseIterable, Sendable {
    /// 换成最近一个有课的日期（三周之内）的课：日期栏照旧是今天，标上「明天的课」「10/2 的课」，
    /// 课程压暗；三周内都没课时显示休息状态。
    case nextCourseDay
    /// 停在今天：今日课表把上完的课灰着留在原处，其余显示休息状态。
    case todayOnly
}

enum ScheduleWidgetTheme: String, CaseIterable {
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
    /// 情侣课表开着、TA 也上这节课时 App 写 true；旧文件和别的课没有这一项。
    var together: Bool? = nil

    var id: String {
        [name, startTime, endTime, location].compactMap { $0 }.joined(separator: "|")
    }
    var isTogether: Bool { together == true }

    var displayName: String { normalized(name) ?? "课程" }
    var startLabel: String { normalized(startTime) ?? "--:--" }
    var endLabel: String? { normalized(endTime).map { String($0.prefix(5)) } }

    var normalizedLocation: String? { normalized(location) }
    var normalizedTeacher: String? { normalized(teacher) }

    var metadata: String {
        let values = [isTogether ? "♥ 一起" : nil, normalized(location), normalized(teacher), normalized(note) ?? normalized(slotNote)]
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

    var startMinutes: Int? { Self.minutes(startTime) }
    var hasUsableStartTime: Bool { startMinutes != nil }

    func isInProgress(at minutes: Int) -> Bool {
        guard let start = startMinutes else { return false }
        return start <= minutes && !hasEnded(at: minutes)
    }

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

    var compactDate: String {
        guard let date, date.count >= 10 else { return "课表" }
        let month = Int(date.dropFirst(5).prefix(2)) ?? 0
        let day = Int(date.dropFirst(8).prefix(2)) ?? 0
        return month > 0 && day > 0 ? "\(month).\(day)" : String(date.dropFirst(5)).replacingOccurrences(of: "-", with: ".")
    }

    /// 日期栏左边的大字：只写几号，月份交给旁边的星期和农历。
    var dayOfMonthLabel: String {
        guard let date, date.count >= 10, let day = Int(date.dropFirst(8).prefix(2)), day > 0 else {
            return compactDate
        }
        return "\(day)"
    }

    /// 这一天开头已经上完的课有几门（`nowMinutes` 为空时是别的日子，一门都不算）。
    func completedPrefixCount(nowMinutes: Int?) -> Int {
        nowMinutes.map { minutes in
            courseList.prefix { $0.hasEnded(at: minutes) }.count
        } ?? 0
    }

    /// 放得下 `limit` 门时显示哪几门。开头已经上完的课，放不下时才省掉；
    /// `hidesCompleted`（「隐藏已上完的课」）时一律省掉。
    func courseWindow(limit: Int, nowMinutes: Int?, hidesCompleted: Bool = false) -> ScheduleCourseWindow {
        let safeLimit = max(0, limit)
        let overflow = max(0, courseList.count - safeLimit)
        let completedPrefix = completedPrefixCount(nowMinutes: nowMinutes)
        let skippedCompletedCount = hidesCompleted ? completedPrefix : min(overflow, completedPrefix)
        let visible = Array(courseList.dropFirst(skippedCompletedCount).prefix(safeLimit))
        let remainingCount = max(0, courseList.count - skippedCompletedCount - visible.count)
        return ScheduleCourseWindow(
            courses: visible,
            remainingCount: remainingCount,
            skippedCompletedCount: skippedCompletedCount
        )
    }

    /// 没有这一天数据时的空日子。星期按日期本身算：时间线里零点那一条画的是明天，
    /// 不能拿真实的「现在」推。
    static func empty(date: String, offset: Int) -> ScheduleDay {
        let target = ChineseCalendarInfo.date(fromDate: date) ?? Date()
        let weekday = ChineseCalendarInfo.gregorian.component(.weekday, from: target)
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

struct ScheduleCourseWindow {
    let courses: [ScheduleCourse]
    let remainingCount: Int
    let skippedCompletedCount: Int
}

/// 今天不能照常列课的原因，见 `SchedulePayload.notice(now:)`。
enum ScheduleWidgetNotice: Equatable {
    case vacation(ScheduleWidgetVacation)
    /// 学期内，但本地课表里没有今天：「打开 App 更新课表」。
    case stale
}

/// 学期之外的日子。
struct ScheduleWidgetVacation: Equatable {
    enum Kind: Equatable {
        case winter
        case summer
        /// 学期和月份都判断不出是寒假还是暑假。
        case other
    }

    let kind: Kind
    /// 离开学还有几天。只有学期还没开始时知道；学期已经结束时下学期什么时候开学不知道，为 `nil`。
    let daysUntilTerm: Int?

    var title: String {
        switch kind {
        case .winter: return "寒假ing"
        case .summer: return "暑假ing"
        case .other: return "放假ing"
        }
    }

    /// 「距开学还有 12 天」，不知道开学日期时为 `nil`。
    var countdown: String? {
        guard let days = daysUntilTerm, days > 0 else { return nil }
        return "距开学还有 \(days) 天"
    }

    /// 离学期超过这么多天，就不拿学期推寒暑假了（多半是好几个月没打开 App），改看月份。
    static let termReach = 100

    /// 寒假还是暑假。先看学期：已经结束的是秋季学期（8–10 月开学）、或者快开学的是春季学期
    ///（2–3 月开学）就是寒假，反过来是暑假。学期看不出来时看月份：12–3 月寒假、6–9 月暑假，其余只说放假。
    static func kind(termEnded: Bool, termStartMonth: Int?, distance: Int?, month: Int) -> Kind {
        if let startMonth = termStartMonth, (distance ?? 0) <= termReach {
            let autumn = (8...10).contains(startMonth)
            let spring = (2...3).contains(startMonth)
            if (termEnded && autumn) || (!termEnded && spring) { return .winter }
            if (termEnded && spring) || (!termEnded && autumn) { return .summer }
        }
        switch month {
        case 12, 1, 2, 3: return .winter
        case 6...9: return .summer
        default: return .other
        }
    }
}

/// 见 `SchedulePayload.timelinePlan(from:)`。
struct ScheduleWidgetTimelinePlan: Equatable {
    /// 每条时间线条目的时刻，从小到大，第一条是现在。
    let dates: [Date]
    /// 什么时候再来要一条新的时间线：次日零点。
    let reload: Date
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
    /// 学期第一天和最后一天（`yyyy-MM-dd`），小组件靠它认出寒暑假。旧版本 App 写的文件没有。
    var termStart: String? = nil
    var termEnd: String? = nil

    private enum CodingKeys: String, CodingKey {
        case title, generatedAt, cachedAt, semester, week, currentWeek, displayWeek, strictDate, stale, today, days, weekDays
    }

    func day(for date: String, fallbackOffset: Int) -> ScheduleDay {
        if fallbackOffset == 0, today?.date == date, let today { return today }
        if let exact = (days ?? []).first(where: { $0.date == date }) { return exact }
        if strictDate == true {
            return ScheduleDay.empty(date: date, offset: fallbackOffset)
        }
        let target = ChineseCalendarInfo.date(fromDate: date) ?? Date()
        let targetDay = ChineseCalendarInfo.gregorian.component(.weekday, from: target)
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
        if let local = localDay(for: date) { return local }
        if today?.date == date, today?.week != nil { return today }
        return nil
    }

    /// `weekDays` 之外的日子。
    func localDay(for date: String) -> ScheduleDay? {
        (localDays ?? []).first(where: { $0.date == date })
    }

    /// 今天在学期之外：寒假、暑假。学期内、或者课表没带学期起止时为 `nil`。
    func vacation(on date: String) -> ScheduleWidgetVacation? {
        guard let start = termStart, let end = termEnd, start <= end,
              let month = Int(date.dropFirst(5).prefix(2)) else { return nil }
        let startMonth = Int(start.dropFirst(5).prefix(2))
        if date < start {
            let days = ChineseCalendarInfo.dayGap(from: date, to: start)
            return ScheduleWidgetVacation(
                kind: ScheduleWidgetVacation.kind(termEnded: false, termStartMonth: startMonth, distance: days, month: month),
                daysUntilTerm: days
            )
        }
        if date > end {
            let days = ChineseCalendarInfo.dayGap(from: end, to: date)
            return ScheduleWidgetVacation(
                kind: ScheduleWidgetVacation.kind(termEnded: true, termStartMonth: startMonth, distance: days, month: month),
                daysUntilTerm: nil
            )
        }
        return nil
    }

    /// 今天不能照常列课的原因：放假了，或者课表过期（学期内、本地课表里却没有今天，多半是学期中途
    /// 换了课表、App 又一直没打开）。两种情况都不显示任何一天的课。
    func notice(now: Date) -> ScheduleWidgetNotice? {
        let date = Self.dateString(now)
        if let vacation = vacation(on: date) { return .vacation(vacation) }
        if termStart != nil, knownDay(for: date) == nil { return .stale }
        return nil
    }

    /// 今天这一天（完整的一天，包括已经下课的课）。放假、过期时是空的。
    func currentDay(now: Date) -> ScheduleDay {
        let date = Self.dateString(now)
        if notice(now: now) != nil { return .empty(date: date, offset: 0) }
        return fullDay(for: date, fallbackOffset: 0)
    }

    /// 今天还没上完的课（包括没有具体时间、没法判断的）。
    func remainingCourses(in day: ScheduleDay, now: Date) -> [ScheduleCourse] {
        let minutes = Self.minutesSinceMidnight(now)
        return day.courseList.filter {
            $0.endMinutes >= minutes || (!$0.hasUsableStartTime && $0.endMinutes <= 0)
        }
    }

    /// 今天之后三周之内第一个有课的日期；找不到、或者放假和过期时是 `nil`。
    func nextCourseDay(after now: Date) -> (day: ScheduleDay, offset: Int)? {
        guard notice(now: now) == nil else { return nil }
        for offset in 1...Self.lookaheadDays {
            let date = ChineseCalendarInfo.gregorian.date(byAdding: .day, value: offset, to: now) ?? now
            let candidate = fullDay(for: Self.dateString(date), fallbackOffset: offset)
            if !candidate.courseList.isEmpty { return (candidate, offset) }
        }
        return nil
    }

    /// 临近课程显示哪天的哪几节：今天还有课就是今天剩下的；上完了且选了「接着显示下一次课」，
    /// 换成最近有课的那一天。都没有时是今天加一个空列表，交给休息状态。
    func upcoming(
        now: Date,
        afterClass: ScheduleWidgetAfterClassStyle = .nextCourseDay
    ) -> (ScheduleDay, [ScheduleCourse]) {
        let today = currentDay(now: now)
        let remaining = remainingCourses(in: today, now: now)
        if !remaining.isEmpty || afterClass == .todayOnly {
            return (today, Array(remaining.prefix(2)))
        }
        guard let next = nextCourseDay(after: now) else { return (today, []) }
        return (next.day, Array(next.day.courseList.prefix(2)))
    }

    /// 小组件的一整条时间线：从 `now` 起画面会变的每个时刻各一条，`reload` 是次日零点。
    ///
    /// 画面只在这几种时刻变：一节课开始前一小时（倒计时出现）、一节课开始、一节课下课后一分钟
    ///（下课那一分钟里课还算没结束）、零点换日。所以一次把今天剩下的边界和零点都排好，系统按条目自己换，不用每个边界回来
    /// 要一次，一天只花一次刷新预算。明天的边界也带上：零点那次刷新被系统推迟时，明早照样换得过来。
    func timelinePlan(from now: Date) -> ScheduleWidgetTimelinePlan {
        let calendar = ChineseCalendarInfo.gregorian
        let startOfToday = calendar.startOfDay(for: now)
        let midnight = Self.startOfNextDay(after: now)
        let startOfDayAfter = Self.startOfNextDay(after: midnight)
        let today = displayChanges(on: startOfToday, until: midnight, after: now)
        let tomorrow = displayChanges(on: midnight, until: startOfDayAfter, after: midnight)
        let dates = Set([now, midnight] + today + tomorrow).sorted()
        return ScheduleWidgetTimelinePlan(dates: dates, reload: midnight)
    }

    /// 上课前多久开始显示「距上课」的倒计时。时间线在这一刻有一条条目，倒计时才出得来。
    static let countdownLeadMinutes = 60

    private func displayChanges(on startOfDay: Date, until endOfDay: Date, after moment: Date) -> [Date] {
        let day = currentDay(now: startOfDay)
        let minutes = day.courseList.flatMap { course -> [Int] in
            // 上课前一小时那一刻：「距上课」的倒计时从这里出现。
            let start = course.startMinutes.map { [$0 - Self.countdownLeadMinutes, $0] } ?? []
            let end = course.endMinutes > 0 ? [course.endMinutes + 1] : []
            return start + end
        }
        return minutes
            .map { startOfDay.addingTimeInterval(TimeInterval($0 * 60)) }
            .filter { $0 > moment && $0 < endOfDay }
    }

    /// `date` 之后的那个零点。
    static func startOfNextDay(after date: Date) -> Date {
        let calendar = ChineseCalendarInfo.gregorian
        let start = calendar.startOfDay(for: date)
        return calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(24 * 60 * 60)
    }

    static func dateString(_ date: Date) -> String {
        ChineseCalendarInfo.dateString(date)
    }

    static func minutesSinceMidnight(_ date: Date) -> Int {
        let calendar = ChineseCalendarInfo.gregorian
        return calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
    }
}

enum ScheduleWidgetError: LocalizedError {
    case unconfigured

    var errorDescription: String? {
        "请先打开 App 登录并同步一次课表"
    }
}

/// App 写的本地课表（`NativeWidgetLocalSchedule`）。App 退出登录时会删掉这份文件。
/// 小组件只读这一份，不再请求服务端；课程边界上的刷新只是重新读一遍。
enum ScheduleLocalDays {
    struct Record: Decodable {
        let semester: String?
        let days: [ScheduleDay]
        /// App 从调休表里挑出的法定放假日；旧版本 App 写的文件没有。
        let holidays: [PublishedHoliday]?
        /// 学期第一天和最后一天；旧版本 App 写的文件没有。
        let termStart: String?
        let termEnd: String?
    }

    /// 拼出小组件用的课表。今天不在学期里（假期）时给一个空的今天，照样显示假期和节假日。
    static func payload(now: Date) -> SchedulePayload? {
        guard let record = record() else {
            ChineseCalendarInfo.usePublishedHolidays([])
            return nil
        }
        // 小组件是单独的进程，得在这里把 App 带过来的放假安排换上，节日和倒计时才对。
        ChineseCalendarInfo.usePublishedHolidays(record.holidays ?? [])
        return payload(record: record, now: now)
    }

    static func payload(record: Record, now: Date) -> SchedulePayload {
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
            localDays: record.days,
            termStart: record.termStart,
            termEnd: record.termEnd
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

@available(iOS 17.0, *)
struct ScheduleEntry: TimelineEntry {
    let date: Date
    let state: ScheduleEntryState
    var configuration = ScheduleWidgetConfiguration()
    /// 刚按了放假祝福上的彩炮：这一条放烟花。
    var celebrating = false
    /// 烟花层的身份，每按一次彩炮换一个。放烟花那一条沿用按之前的，碎片才会从平时的样子动起来；
    /// 收起的那一条换成新的，整层按平时的样子重新放进来，不会倒着把烟花再放一遍。
    var fireworksRound: Double = 0

    var appURL: URL {
        guard case .loaded(let payload) = state else { return AppWidgetConfiguration.appURL }
        return AppWidgetConfiguration.appURL(
            semester: payload.semester,
            currentWeek: payload.currentWeek
        )
    }

    /// 示例课表的「今天」就是今天，不然会被当成过期的课表。
    static var placeholder: ScheduleEntry { placeholder(at: .now) }

    static func placeholder(at now: Date) -> ScheduleEntry {
        let today = ScheduleDay.empty(date: SchedulePayload.dateString(now), offset: 0)
        return ScheduleEntry(
            date: now,
            state: .loaded(
                SchedulePayload(
                    title: nil,
                    generatedAt: nil,
                    cachedAt: nil,
                    semester: "2026-2027-1",
                    week: 1,
                    currentWeek: 1,
                    displayWeek: 1,
                    strictDate: true,
                    stale: false,
                    today: ScheduleDay(
                        day: today.day,
                        label: today.label,
                        date: today.date,
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
}

/// 从 App Group 里读课表生成时间线；各个小组件的配置由 `ScheduleIntentTimelineProvider` 再套上。
///
/// 一次交出从现在到明天的整条时间线（见 `SchedulePayload.timelinePlan(from:)`），次日零点才回来要新的。
/// 以前一次只给一条、每个上下课边界回来刷一次，一个小组件一天几十次，系统给的刷新预算用光后
/// 刷新被推迟，下课了还显示「正在上」。课表在 App 里变了由 App 调 `WidgetCenter` 立刻重刷。
@available(iOS 17.0, *)
enum ScheduleTimeline {
    static func make(now: Date) -> Timeline<ScheduleEntry> {
        let payload = ScheduleLocalDays.payload(now: now)
        // 课表只解码这一次，每条条目拿的是同一份。
        let state: ScheduleEntryState = payload.map { .loaded($0) } ?? .unconfigured
        let plan = payload?.timelinePlan(from: now)
            ?? ScheduleWidgetTimelinePlan(dates: [now], reload: SchedulePayload.startOfNextDay(after: now))
        let rounds = CelebrateHolidayIntent.rounds()
        var dates = plan.dates
        let fired = CelebrateHolidayIntent.justFired(now: now)
        if fired {
            // 刚按了彩炮：第一条放烟花，散完后再来一条把彩炮放回去、换掉看不见的碎片。
            dates = Set(dates + [now.addingTimeInterval(FireworksTiming.total + 0.3)]).sorted()
        }
        let entries = dates.map { date in
            let celebrating = fired && date == now
            return ScheduleEntry(
                date: date,
                state: state,
                celebrating: celebrating,
                fireworksRound: celebrating ? rounds.previous : rounds.latest
            )
        }
        return Timeline(entries: entries, policy: .after(plan.reload))
    }
}
