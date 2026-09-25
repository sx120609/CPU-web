import Foundation

// 农历日期、传统节日与法定节假日。
//
// App 与小组件扩展共用：放在 WidgetCore 里，两个 target 都会编译。全部离线计算，
// 农历换算直接用 Foundation 的 `Calendar(identifier: .chinese)`（系统自带的天文历
// 表，比手写的农历查表可靠），节日与放假区间在此之上推导。

/// 一天的农历日期。
nonisolated struct LunarDate: Equatable, Sendable {
    /// 农历月 1...12（11 为冬月、12 为腊月）。
    let month: Int
    /// 农历日 1...30。
    let day: Int
    let isLeapMonth: Bool
    /// 六十甲子中的序号 1...60。
    let cyclicalYear: Int

    private static let monthNames = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"]
    private static let dayPrefixes = ["初", "十", "廿", "卅"]
    private static let dayDigits = ["十", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
    private static let heavenlyStems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
    private static let earthlyBranches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]
    private static let zodiacs = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"]

    /// 「正月」「闰四月」「腊月」。
    var monthLabel: String {
        let index = min(max(month, 1), 12) - 1
        return (isLeapMonth ? "闰" : "") + Self.monthNames[index] + "月"
    }

    /// 「初一」「十五」「廿三」「三十」。
    var dayLabel: String {
        let value = min(max(day, 1), 30)
        if value == 10 { return "初十" }
        if value == 20 { return "二十" }
        if value == 30 { return "三十" }
        let prefix = Self.dayPrefixes[min((value - 1) / 10, 3)]
        return prefix + Self.dayDigits[value % 10]
    }

    /// 日历格里显示的农历文字：初一显示月名，其余显示日名。
    var shortLabel: String { day == 1 ? monthLabel : dayLabel }

    /// 「正月初一」。
    var fullLabel: String { monthLabel + dayLabel }

    /// 「丙午」。
    var ganZhi: String {
        let index = (min(max(cyclicalYear, 1), 60) - 1)
        return Self.heavenlyStems[index % 10] + Self.earthlyBranches[index % 12]
    }

    /// 生肖：「马」。
    var zodiac: String {
        let index = (min(max(cyclicalYear, 1), 60) - 1)
        return Self.zodiacs[index % 12]
    }

    /// 「丙午马年」。
    var yearLabel: String { ganZhi + zodiac + "年" }
}

/// 一段法定假期（只含《全国年节及纪念日放假办法》规定的法定假日，不含各年度国务院
/// 通知里的调休连休安排）。
nonisolated struct ChineseHolidayWindow: Equatable, Sendable {
    let name: String
    /// `yyyy-MM-dd`
    let start: String
    /// `yyyy-MM-dd`
    let end: String

    func contains(_ date: String) -> Bool { date >= start && date <= end }

    /// 这段假期一共放几天（含首尾）。
    var dayCount: Int {
        guard let gap = ChineseCalendarInfo.dayGap(from: start, to: end) else { return 1 }
        return max(1, gap + 1)
    }
}

/// 「还有几天放假」的文案。分成三段是为了让中间的天数在界面上能单独加粗、上色。
nonisolated struct ChineseHolidayCountdown: Equatable, Sendable {
    let window: ChineseHolidayWindow
    /// 距离假期第一天还有几天；0 表示今天就在假期里。
    let daysAway: Int

    /// 「距中秋节还有」「今天是中秋节」。
    var leading: String {
        switch daysAway {
        case 0: return "今天是\(window.name)"
        default: return "距\(window.name)还有"
        }
    }

    /// 假期到来前统一显示剩余天数。
    var amount: String? { daysAway > 0 ? String(daysAway) : nil }

    var trailing: String { amount == nil ? "" : "天" }

    /// 拼成一句完整的话。
    var phrase: String {
        guard let amount else { return leading }
        return "\(leading) \(amount) \(trailing)"
    }

    /// 「9.25 周五」，连休则是「10.1 - 10.3 · 休 3 天」。
    var dateLabel: String {
        let start = ChineseCalendarInfo.monthDayLabel(window.start)
        guard window.end != window.start else {
            guard let weekday = ChineseCalendarInfo.weekdayLabel(window.start) else { return start }
            return "\(start) \(weekday)"
        }
        return "\(start) - \(ChineseCalendarInfo.monthDayLabel(window.end)) · 休 \(window.dayCount) 天"
    }
}

/// 一天的农历 / 节日信息。
nonisolated struct ChineseCalendarDay: Equatable, Sendable {
    /// `yyyy-MM-dd`
    let date: String
    let lunar: LunarDate
    /// 当天的节日，按优先级排列（农历节日在前）。
    let festivals: [String]
    /// 目前只计算清明，其余节气不在本表内。
    let solarTerm: String?
    /// 当天属于哪个法定假期；`nil` 表示不放假。
    let holiday: String?

    var isStatutoryHoliday: Bool { holiday != nil }

    /// 小组件与日历格里那一行小字：法定假日 > 节日 > 节气 > 农历日期。
    var displayLabel: String { badge ?? lunar.shortLabel }

    /// 只有节日/假期时才有值，用来决定要不要显示提示徽标。
    var badge: String? { holiday ?? festivals.first ?? solarTerm }
}

nonisolated enum ChineseCalendarInfo {
    static let timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current

    // MARK: 查询

    static func info(for date: Date) -> ChineseCalendarDay {
        info(forDate: dateString(date)) ?? fallback(for: date)
    }

    static func info(forDate date: String) -> ChineseCalendarDay? {
        guard let year = gregorianYear(of: date) else { return nil }
        return cache.year(year).days[date]
    }

    static func holidays(inYear year: Int) -> [ChineseHolidayWindow] {
        cache.year(year).holidays
    }

    /// 下一段法定假期的倒计时文案。
    static func countdown(from date: Date, withinDays limit: Int = 60) -> ChineseHolidayCountdown? {
        guard let next = nextHoliday(from: date, withinDays: limit) else { return nil }
        return ChineseHolidayCountdown(window: next.window, daysAway: next.daysAway)
    }

    /// 今天不上课时那句问候：法定假日说「中秋快乐～」，周末说「周末快乐～」。
    /// 普通工作日返回 `nil`，调用方改说「今天的课程全部结束了～」。
    ///
    /// `hasCourses` 是今天排没排课。调休把周六当工作日用的时候照样道「周末快乐」
    /// 就成了反话，所以周六日一旦排了课就不道贺，交给调用方说「今天的课上完啦～」。
    static func restGreeting(for date: Date = .now, hasCourses: Bool = false) -> String? {
        restGreeting(forDate: dateString(date), hasCourses: hasCourses)
    }

    static func restGreeting(forDate date: String, hasCourses: Bool = false) -> String? {
        if let holiday = info(forDate: date)?.holiday {
            return holidayGreetings[holiday] ?? "\(holiday)快乐～"
        }
        guard !hasCourses, let value = self.date(fromDate: date) else { return nil }
        let weekday = gregorian.component(.weekday, from: value)
        return weekday == 1 || weekday == 7 ? "周末快乐～" : nil
    }

    /// 逐个写出来而不是机械地去掉「节」字：「劳动快乐」不成话；清明、端午按习惯
    /// 道安康而不是快乐。都控制在五六个字，好放进小组件里的一行。
    private static let holidayGreetings: [String: String] = [
        "元旦": "元旦快乐～",
        "春节": "春节快乐～",
        "清明节": "清明安康～",
        "劳动节": "劳动节快乐～",
        "端午节": "端午安康～",
        "中秋节": "中秋快乐～",
        "国庆节": "国庆快乐～",
    ]

    /// 「9.25」。
    static func monthDayLabel(_ date: String) -> String {
        let pieces = date.split(separator: "-")
        guard pieces.count == 3, let month = Int(pieces[1]), let day = Int(pieces[2]) else { return date }
        return "\(month).\(day)"
    }

    /// 「周五」。
    static func weekdayLabel(_ date: String) -> String? {
        guard let value = self.date(fromDate: date) else { return nil }
        let labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
        let weekday = gregorian.component(.weekday, from: value)
        return labels.indices.contains(weekday - 1) ? labels[weekday - 1] : nil
    }

    /// 下一段法定假期（含今天开始的假期），用于「距国庆节 12 天」这类提示。
    static func nextHoliday(from date: Date, withinDays limit: Int = 60) -> (window: ChineseHolidayWindow, daysAway: Int)? {
        let today = dateString(date)
        guard let year = gregorianYear(of: today) else { return nil }
        let windows = cache.year(year).holidays + cache.year(year + 1).holidays
        guard let next = windows.first(where: { $0.end >= today }) else { return nil }
        let start = max(next.start, today)
        guard let days = dayGap(from: today, to: start), days <= limit else { return nil }
        return (next, days)
    }

    // MARK: 日期工具

    static func dateString(_ date: Date) -> String {
        let components = gregorian.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    static func date(fromDate value: String) -> Date? {
        let pieces = value.split(separator: "-")
        guard pieces.count == 3, let year = Int(pieces[0]), let month = Int(pieces[1]), let day = Int(pieces[2]) else {
            return nil
        }
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        return gregorian.date(from: components)
    }

    static func dayGap(from start: String, to end: String) -> Int? {
        guard let from = date(fromDate: start), let to = date(fromDate: end) else { return nil }
        return gregorian.dateComponents([.day], from: gregorian.startOfDay(for: from), to: gregorian.startOfDay(for: to)).day
    }

    // MARK: 内部实现

    static var gregorian: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.firstWeekday = 2
        return calendar
    }()

    private static var chinese: Calendar = {
        var calendar = Calendar(identifier: .chinese)
        calendar.timeZone = timeZone
        return calendar
    }()

    private static let cache = YearCache()

    private static func gregorianYear(of date: String) -> Int? {
        Int(date.prefix(4))
    }

    private static func fallback(for date: Date) -> ChineseCalendarDay {
        ChineseCalendarDay(
            date: dateString(date),
            lunar: lunarDate(for: date),
            festivals: [],
            solarTerm: nil,
            holiday: nil
        )
    }

    fileprivate static func lunarDate(for date: Date) -> LunarDate {
        let components = chinese.dateComponents([.year, .month, .day, .isLeapMonth], from: date)
        return LunarDate(
            month: components.month ?? 1,
            day: components.day ?? 1,
            isLeapMonth: components.isLeapMonth ?? false,
            cyclicalYear: components.year ?? 1
        )
    }

    /// 清明在 21 世纪前中段按四年一轮的 4/4、4/4、4/5、4/5 排列。这里只用于
    /// 2020—2043，之后交由天文历重新校正（超出范围时退回 4 月 5 日一侧）。
    fileprivate static func qingmingDay(year: Int) -> Int {
        let remainder = ((year % 4) + 4) % 4
        return remainder <= 1 ? 4 : 5
    }

    /// 农历节日：(月, 日, 名称)。闰月不算节日。
    fileprivate static let lunarFestivals: [(month: Int, day: Int, name: String)] = [
        (1, 1, "春节"), (1, 15, "元宵节"), (2, 2, "龙抬头"),
        (5, 5, "端午节"), (7, 7, "七夕"), (7, 15, "中元节"),
        (8, 15, "中秋节"), (9, 9, "重阳节"),
        (12, 8, "腊八节"), (12, 23, "小年"),
    ]

    /// 公历节日：(月, 日, 名称)。
    fileprivate static let solarFestivals: [(month: Int, day: Int, name: String)] = [
        (1, 1, "元旦"), (3, 8, "妇女节"), (3, 12, "植树节"),
        (5, 1, "劳动节"), (5, 4, "青年节"), (6, 1, "儿童节"),
        (7, 1, "建党节"), (8, 1, "建军节"), (9, 10, "教师节"),
        (10, 1, "国庆节"), (12, 25, "圣诞节"),
    ]
}

/// 一年的农历/节日/假期数据。按公历年整体算一次再缓存：一次扫描 365 天，之后每个
/// 日期都是字典查询，小组件时间线也不会重复计算。
private final class YearCache: @unchecked Sendable {
    struct YearData {
        var days: [String: ChineseCalendarDay] = [:]
        var holidays: [ChineseHolidayWindow] = []
    }

    private let lock = NSLock()
    private var storage: [Int: YearData] = [:]

    func year(_ year: Int) -> YearData {
        lock.lock()
        if let cached = storage[year] {
            lock.unlock()
            return cached
        }
        lock.unlock()

        let built = Self.build(year: year)

        lock.lock()
        storage[year] = built
        // 翻年浏览日历不该把内存留在旧年份上。
        if storage.count > 8, let oldest = storage.keys.sorted(by: { abs($0 - year) > abs($1 - year) }).first {
            storage.removeValue(forKey: oldest)
        }
        lock.unlock()
        return built
    }

    private static func build(year: Int) -> YearData {
        let calendar = ChineseCalendarInfo.gregorian
        var components = DateComponents()
        components.year = year
        components.month = 1
        components.day = 1
        components.hour = 12
        guard let start = calendar.date(from: components) else { return YearData() }

        var lunarByDate: [String: LunarDate] = [:]
        var festivalsByDate: [String: [String]] = [:]
        var solarTermByDate: [String: String] = [:]
        var dates: [String] = []

        var cursor = start
        while calendar.component(.year, from: cursor) == year {
            let key = ChineseCalendarInfo.dateString(cursor)
            let lunar = ChineseCalendarInfo.lunarDate(for: cursor)
            lunarByDate[key] = lunar
            dates.append(key)

            if !lunar.isLeapMonth,
               let festival = ChineseCalendarInfo.lunarFestivals
                .first(where: { $0.month == lunar.month && $0.day == lunar.day })?.name {
                festivalsByDate[key, default: []].append(festival)
            }
            let month = calendar.component(.month, from: cursor)
            let day = calendar.component(.day, from: cursor)
            if let festival = ChineseCalendarInfo.solarFestivals
                .first(where: { $0.month == month && $0.day == day })?.name {
                festivalsByDate[key, default: []].append(festival)
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }

        let qingming = String(format: "%04d-04-%02d", year, ChineseCalendarInfo.qingmingDay(year: year))
        solarTermByDate[qingming] = "清明"

        // 除夕是正月初一的前一天，长短月都对：腊月可能只有廿九天。
        let springFestival = dates.first { lunarByDate[$0].map { !$0.isLeapMonth && $0.month == 1 && $0.day == 1 } ?? false }
        var newYearEve: String?
        if let springFestival,
           let index = dates.firstIndex(of: springFestival), index > 0 {
            newYearEve = dates[index - 1]
            festivalsByDate[dates[index - 1], default: []].insert("除夕", at: 0)
        }

        func lunarDate(month: Int, day: Int) -> String? {
            dates.first { key in
                guard let lunar = lunarByDate[key] else { return false }
                return !lunar.isLeapMonth && lunar.month == month && lunar.day == day
            }
        }

        var holidays: [ChineseHolidayWindow] = [
            ChineseHolidayWindow(name: "元旦", start: "\(year)-01-01", end: "\(year)-01-01")
        ]
        if let springFestival {
            // 2024 年修订后的《全国年节及纪念日放假办法》：春节自除夕起放假 4 天。
            let start = newYearEve ?? springFestival
            let end = lunarDate(month: 1, day: 3) ?? springFestival
            holidays.append(ChineseHolidayWindow(name: "春节", start: start, end: end))
        }
        holidays.append(ChineseHolidayWindow(name: "清明节", start: qingming, end: qingming))
        holidays.append(ChineseHolidayWindow(name: "劳动节", start: "\(year)-05-01", end: "\(year)-05-02"))
        if let dragonBoat = lunarDate(month: 5, day: 5) {
            holidays.append(ChineseHolidayWindow(name: "端午节", start: dragonBoat, end: dragonBoat))
        }
        if let midAutumn = lunarDate(month: 8, day: 15) {
            holidays.append(ChineseHolidayWindow(name: "中秋节", start: midAutumn, end: midAutumn))
        }
        holidays.append(ChineseHolidayWindow(name: "国庆节", start: "\(year)-10-01", end: "\(year)-10-03"))
        holidays.sort { $0.start < $1.start }

        var holidayByDate: [String: String] = [:]
        for window in holidays {
            var cursor = window.start
            while cursor <= window.end {
                if holidayByDate[cursor] == nil { holidayByDate[cursor] = window.name }
                guard let date = ChineseCalendarInfo.date(fromDate: cursor),
                      let next = calendar.date(byAdding: .day, value: 1, to: date) else { break }
                cursor = ChineseCalendarInfo.dateString(next)
            }
        }

        var data = YearData()
        data.holidays = holidays
        for key in dates {
            guard let lunar = lunarByDate[key] else { continue }
            data.days[key] = ChineseCalendarDay(
                date: key,
                lunar: lunar,
                festivals: festivalsByDate[key] ?? [],
                solarTerm: solarTermByDate[key],
                holiday: holidayByDate[key]
            )
        }
        return data
    }
}
