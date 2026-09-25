import Foundation
import WidgetKit

/// App 里已经拿到的整学期课表，按日期展开后写进 App Group，给小组件补上服务端
/// 小组件接口没下发的日子（接口只给今天往后两周，「最近有课的一天」要看三周）。
/// 小组件仍以接口数据为准，这里只填接口没覆盖到的日期。
@MainActor
enum NativeWidgetLocalSchedule {
    static let fileName = "schedule-widget-local-days.json"
    /// 从今天往前留一天（跨零点时小组件可能还按昨天算），往后写多少天。
    static let daysAhead = 42

    /// 和小组件那边 `ScheduleDay` / `ScheduleCourse` 的字段一一对应。
    struct Day: Codable, Equatable {
        let day: Int
        let label: String
        let date: String
        let week: Int
        let courses: [Course]
    }

    struct Course: Codable, Equatable {
        let name: String
        let teacher: String?
        let location: String?
        let note: String?
        let slotNote: String?
        let startTime: String?
        let endTime: String?
        let startSlot: Int?
        let endSlot: Int?
    }

    struct Record: Codable, Equatable {
        let semester: String
        let days: [Day]
    }

    static func connect(to store: NativeScheduleStore) {
        store.onLatestSnapshotChange = { snapshot in accept(snapshot) }
        accept(store.latestSnapshot)
    }

    static func accept(_ snapshot: NativeScheduleSnapshot?) {
        guard let snapshot else {
            // 退出登录、换账号：别让下一个人的小组件看到上一个人的课。
            write(nil)
            return
        }
        // 只按周取的快照（翻到别的周、研究生课表）缺别的周的课，留着上一份整学期的。
        guard snapshot.completeSemester, snapshot.auth.authenticated, snapshot.error == nil,
              let record = record(from: snapshot) else { return }
        write(record)
    }

    static func record(from snapshot: NativeScheduleSnapshot, now: Date = .now) -> Record? {
        guard let data = snapshot.data, let calendar = snapshot.calendar else { return nil }
        let periods = snapshot.periods
        let byNumber = Dictionary(periods.map { ($0.number, $0) }, uniquingKeysWith: { first, _ in first })
        let today = dateString(now)
        let first = dateString(now.addingTimeInterval(-86_400))
        let last = dateString(now.addingTimeInterval(TimeInterval(daysAhead) * 86_400))

        var days: [Day] = []
        for week in calendar.weeks {
            for date in week.days where date >= first && date <= last {
                // 星期按日期本身算：教务的周历有的从周日排起，下标不一定是星期几。
                guard let day = weekday(of: date) else { continue }
                guard let resolved = resolvedDay(date: date, day: day, week: week.week, calendar: calendar) else {
                    // 放假：这一天明确没课。
                    days.append(Day(day: day, label: dayLabel(day), date: date, week: week.week, courses: []))
                    continue
                }
                var blocks: [NativeScheduleCourseBlockRecord] = []
                for cell in data.cells where cell.day == resolved.day {
                    for course in cell.courses where course.weekList.isEmpty || course.weekList.contains(resolved.week) {
                        let range = NativeSchedulePeriod.normalizedRange(
                            bigSlot: cell.bigSlot, startSlot: course.startSlot, endSlot: course.endSlot, periods: periods
                        )
                        blocks.append(NativeScheduleCourseBlockRecord(
                            id: course.id, course: course, bigSlot: cell.bigSlot,
                            startSlot: range.start, endSlot: range.end
                        ))
                    }
                }
                let courses = NativeScheduleCourseBlockMerger.merge(blocks).map { block -> Course in
                    let course = block.course
                    let slotNote = course.slotNote?.trimmedNonEmpty
                    return Course(
                        name: course.name,
                        teacher: course.teacher,
                        location: course.location,
                        // 和服务端一样：先节次备注，没有就写上课周次。
                        note: slotNote ?? course.weeks.trimmedNonEmpty,
                        slotNote: slotNote,
                        startTime: course.customStartTime?.trimmedNonEmpty ?? byNumber[block.startSlot]?.startTime,
                        endTime: course.customEndTime?.trimmedNonEmpty ?? byNumber[block.endSlot]?.endTime,
                        startSlot: block.startSlot,
                        endSlot: block.endSlot
                    )
                }
                .sorted { ($0.startTime ?? "", $0.name) < ($1.startTime ?? "", $1.name) }
                days.append(Day(day: day, label: dayLabel(day), date: date, week: week.week, courses: courses))
            }
        }
        guard days.contains(where: { $0.date >= today }) else { return nil }
        return Record(
            semester: data.currentSemester,
            days: days.sorted { $0.date < $1.date }
        )
    }

    /// 调休：放假返回 `nil`，补课换成被补的那一天。和实时活动的规则一样。
    private static func resolvedDay(
        date: String,
        day: Int,
        week: Int,
        calendar: NativeScheduleCalendar
    ) -> (day: Int, week: Int)? {
        guard let adjustment = calendar.adjustments.first(where: { $0.date == date }) else { return (day, week) }
        if adjustment.kind == "off" { return nil }
        if adjustment.kind == "swap" {
            guard let source = adjustment.source,
                  let sourceWeek = calendar.weeks.first(where: { $0.days.contains(source) }),
                  let sourceDay = weekday(of: source) else { return nil }
            return (sourceDay, sourceWeek.week)
        }
        return (day, week)
    }

    private static var url: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: NextWidgetConfiguration.appGroup)?
            .appendingPathComponent(fileName)
    }

    private static func write(_ record: Record?) {
        guard let url else { return }
        guard let record else {
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            try? FileManager.default.removeItem(at: url)
            WidgetCenter.shared.reloadAllTimelines()
            return
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let data = try? encoder.encode(record) else { return }
        // 内容没变就不写、不刷新，省得每次切周都去催小组件。
        if let existing = try? Data(contentsOf: url), existing == data { return }
        do {
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path
            )
        } catch {
            return
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    private static func dayLabel(_ day: Int) -> String {
        let labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        return labels.indices.contains(day - 1) ? labels[day - 1] : "周\(day)"
    }

    /// 周一为 1、周日为 7。
    private static func weekday(of date: String) -> Int? {
        guard let value = formatter.date(from: date), formatter.string(from: value) == date else { return nil }
        let weekday = formatter.calendar.component(.weekday, from: value)
        return weekday == 1 ? 7 : weekday - 1
    }

    private static func dateString(_ date: Date) -> String {
        formatter.string(from: date)
    }

    private static let formatter: DateFormatter = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter
    }()
}
