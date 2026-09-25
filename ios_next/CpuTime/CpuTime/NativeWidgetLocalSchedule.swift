import Foundation
import WidgetKit

/// App 里拿到的课表按日期展开后写进 App Group，iPhone 小组件只读这一份，不再请求服务端。
/// 整学期的快照整份覆盖；只按周取的快照（翻到别的周、研究生课表）只替换那一周的日子。
@MainActor
enum NativeWidgetLocalSchedule {
    static let fileName = "schedule-widget-local-days.json"

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
        removeLegacyEndpoint()
        store.onLatestSnapshotChange = { snapshot in accept(snapshot) }
        accept(store.latestSnapshot)
    }

    static func accept(_ snapshot: NativeScheduleSnapshot?) {
        guard let snapshot else {
            // 退出登录、换账号：别让下一个人的小组件看到上一个人的课。
            write(nil)
            return
        }
        guard snapshot.auth.authenticated, snapshot.error == nil,
              let record = record(from: snapshot, merging: read()) else { return }
        write(record)
    }

    /// `existing` 是上一次写的那份：只按周取的快照缺别的周的课，同一学期时保留那些日子。
    static func record(from snapshot: NativeScheduleSnapshot, merging existing: Record? = nil) -> Record? {
        guard let data = snapshot.data, let calendar = snapshot.calendar,
              !data.currentSemester.isEmpty else { return nil }
        let coveredWeeks: Set<Int>
        if snapshot.completeSemester {
            coveredWeeks = Set(calendar.weeks.map(\.week))
        } else if let week = Int(data.currentWeek) {
            coveredWeeks = [week]
        } else {
            return nil
        }
        let periods = snapshot.periods
        let byNumber = Dictionary(periods.map { ($0.number, $0) }, uniquingKeysWith: { first, _ in first })

        var days: [Day] = []
        for week in calendar.weeks where coveredWeeks.contains(week.week) {
            for date in week.days {
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
        guard !days.isEmpty else { return nil }
        var byDate = Dictionary(days.map { ($0.date, $0) }, uniquingKeysWith: { first, _ in first })
        if !snapshot.completeSemester, let existing, existing.semester == data.currentSemester {
            for day in existing.days where byDate[day.date] == nil { byDate[day.date] = day }
        }
        return Record(
            semester: data.currentSemester,
            days: byDate.values.sorted { $0.date < $1.date }
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

    private static func read() -> Record? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Record.self, from: data)
    }

    /// 以前小组件自己请求服务端，App 会写一份带 token 的接口地址；现在用不上了，别留在共享容器里。
    private static func removeLegacyEndpoint() {
        UserDefaults(suiteName: NextWidgetConfiguration.appGroup)?
            .removeObject(forKey: NextWidgetConfiguration.legacyWidgetEndpointKey)
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: NextWidgetConfiguration.appGroup
        ) else { return }
        for name in NextWidgetConfiguration.legacyWidgetFileNames {
            try? FileManager.default.removeItem(at: container.appendingPathComponent(name))
        }
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
