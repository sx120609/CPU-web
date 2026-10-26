import CoreGraphics
import Foundation

// The rules for 日程 in the iOS app, kept apart from the views so
// ios_next/scripts/check-agenda.sh can run them on their own. They follow
// server/src/shared/agenda.ts, the Android and HarmonyOS ports, and the Web
// timetable's chips (web/src/views/agenda/agendaChips.ts).

/// One item as the bridge sends it. Anything missing or malformed falls back to empty.
struct NativeAgendaItem: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var kind: String
    var title: String
    /// "yyyy-MM-dd", or empty for an undated to-do.
    var date: String
    /// "HH:mm", or empty for an all-day item.
    var start: String
    var end: String
    var location: String
    var note: String
    /// Minutes before the start; -1 for no reminder.
    var remind: Int
    /// "none", "daily", "weekdays", "weekly" or "monthly".
    var repeatRule: String
    var until: String
    var done: Bool
    /// The days a repeating item was ticked off.
    var doneDates: [String]
    var createdAt: Double

    enum CodingKeys: String, CodingKey {
        case id, kind, title, date, start, end, location, note, remind
        case repeatRule = "repeat"
        case until, done, doneDates, createdAt
    }

    init(id: String, kind: String = "event", title: String, date: String = "", start: String = "", end: String = "",
         location: String = "", note: String = "", remind: Int = -1, repeatRule: String = "none", until: String = "",
         done: Bool = false, doneDates: [String] = [], createdAt: Double = 0) {
        self.id = id
        self.kind = kind
        self.title = title
        self.date = date
        self.start = start
        self.end = end
        self.location = location
        self.note = note
        self.remind = remind
        self.repeatRule = repeatRule
        self.until = until
        self.done = done
        self.doneDates = doneDates
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        func text(_ key: CodingKeys) -> String { (try? values.decodeIfPresent(String.self, forKey: key)) ?? "" }
        id = text(.id)
        kind = text(.kind) == "todo" ? "todo" : "event"
        title = text(.title)
        date = text(.date)
        start = text(.start)
        end = text(.end)
        location = text(.location)
        note = text(.note)
        remind = (try? values.decodeIfPresent(Int.self, forKey: .remind)) ?? -1
        repeatRule = text(.repeatRule)
        until = text(.until)
        done = (try? values.decodeIfPresent(Bool.self, forKey: .done)) ?? false
        doneDates = (try? values.decodeIfPresent([String].self, forKey: .doneDates)) ?? []
        createdAt = (try? values.decodeIfPresent(Double.self, forKey: .createdAt)) ?? 0
    }

    /// The item made safe to draw; nil when it lacks an id or a title.
    var sanitized: NativeAgendaItem? {
        guard !id.isEmpty, !title.isEmpty else { return nil }
        var copy = self
        if NativeAgendaRules.dayNumber(date) == nil { copy.date = "" }
        if NativeAgendaRules.minutes(start) == nil { copy.start = "" }
        if NativeAgendaRules.minutes(end) == nil { copy.end = "" }
        if NativeAgendaRules.dayNumber(until) == nil { copy.until = "" }
        if !["daily", "weekdays", "weekly", "monthly"].contains(repeatRule) { copy.repeatRule = "none" }
        copy.doneDates = doneDates.filter { NativeAgendaRules.dayNumber($0) != nil }
        return copy
    }

    var repeats: Bool { repeatRule != "none" }
}

/// An item on one day.
struct NativeAgendaOccurrence: Equatable, Identifiable {
    let item: NativeAgendaItem
    /// "yyyy-MM-dd".
    let date: String
    let done: Bool

    var id: String { item.id + "@" + date }

    /// "全天", "14:00" or "14:00–15:30".
    var timeText: String {
        guard !item.start.isEmpty else { return "全天" }
        return item.end.isEmpty ? item.start : "\(item.start)–\(item.end)"
    }
}

/// A timed item's place in a week column, in points down the column's periods.
struct NativeAgendaChip: Equatable, Identifiable {
    let entry: NativeAgendaOccurrence
    let y: CGFloat
    let height: CGFloat
    /// It meets a class: drawn as a narrow strip at the column's right edge.
    let beside: Bool

    var id: String { entry.id }

    func frame(columnWidth: CGFloat) -> CGRect {
        let width = beside ? max(14, min(columnWidth * 0.42, 30)) : max(12, columnWidth - 2)
        return CGRect(x: beside ? columnWidth - width - 1 : 1, y: y, width: width, height: height)
    }
}

struct NativeAgendaReminder: Equatable {
    let id: String
    let date: String
    let at: Date
    let title: String
    let text: String
}

enum NativeAgendaRules {
    private static let dayMilliseconds: Double = 86_400_000
    private static let chinaOffset: Double = 8 * 3_600_000
    /// An item without an end takes this long on the grid, so it can be read and tapped.
    private static let untimedSpan = 45

    /// Days since 1970-01-01 for a valid "yyyy-MM-dd".
    static func dayNumber(_ date: String) -> Int? {
        let parts = date.split(separator: "-", omittingEmptySubsequences: false)
        guard date.count == 10, parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              (1...12).contains(month) else { return nil }
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
        let lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        guard (1...lengths[month - 1]).contains(day) else { return nil }
        // Days from the civil date (Howard Hinnant's algorithm).
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yearOfEra = y - era * 400
        let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    static func date(ofDay number: Int) -> String {
        let z = number + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let dayOfEra = z - era * 146_097
        let yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146_096) / 365
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let mp = (5 * dayOfYear + 2) / 153
        let day = dayOfYear - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        let year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0)
        func pad(_ value: Int, _ width: Int) -> String {
            let text = String(value)
            return String(repeating: "0", count: max(0, width - text.count)) + text
        }
        return "\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2))"
    }

    /// 1 = Monday … 7 = Sunday.
    static func weekday(_ date: String) -> Int? {
        guard let day = dayNumber(date) else { return nil }
        // 1970-01-01 was a Thursday.
        return ((day % 7 + 7) % 7 + 3) % 7 + 1
    }

    /// "08:05" → 485.
    static func minutes(_ value: String) -> Int? {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard value.count == 5, parts.count == 2, let hours = Int(parts[0]), let minutes = Int(parts[1]),
              (0...23).contains(hours), (0...59).contains(minutes) else { return nil }
        return hours * 60 + minutes
    }

    /// What is still to do: past to-dos left unticked (oldest first), then the ones without a day,
    /// in the order they were added (Web `agendaOpen`).
    static func openTodos(_ items: [NativeAgendaItem], today: String) -> [NativeAgendaItem] {
        let candidates = items.filter { !$0.repeats && !$0.done }
        let base = dayNumber(today) ?? 0
        let overdue = candidates.filter { $0.start.isEmpty && (dayNumber($0.date).map { $0 < base } ?? false) }.sorted { $0.date < $1.date }
        return overdue + candidates.filter { $0.date.isEmpty }.sorted { $0.createdAt < $1.createdAt }
    }

    /// Today in China time.
    static func today(_ now: Date = Date()) -> String { chinaParts(now).date }

    static func occurs(_ item: NativeAgendaItem, on date: String) -> Bool {
        guard let first = dayNumber(item.date), let day = dayNumber(date), day >= first else { return false }
        if let until = dayNumber(item.until), day > until { return false }
        switch item.repeatRule {
        case "daily": return true
        case "weekdays": return (weekday(date) ?? 7) <= 5
        case "weekly": return weekday(date) == weekday(item.date)
        case "monthly": return date.suffix(2) == item.date.suffix(2)
        default: return day == first
        }
    }

    static func isDone(_ item: NativeAgendaItem, on date: String) -> Bool {
        item.repeats ? item.doneDates.contains(date) : item.done
    }

    /// Everything on a day: all-day items first, then by start time, then in the order they were added.
    static func on(_ items: [NativeAgendaItem], date: String) -> [NativeAgendaOccurrence] {
        guard dayNumber(date) != nil else { return [] }
        return items.filter { occurs($0, on: date) }
            .sorted { a, b in
                if a.start.isEmpty != b.start.isEmpty { return a.start.isEmpty }
                if a.start != b.start { return a.start < b.start }
                return a.createdAt < b.createdAt
            }
            .map { NativeAgendaOccurrence(item: $0, date: date, done: isDone($0, on: date)) }
    }

    /// A day with all-day items or to-dos still open: a dot in the week header.
    static func headerDot(_ items: [NativeAgendaItem], date: String) -> Bool {
        on(items, date: date).contains { $0.item.start.isEmpty && !$0.done }
    }

    /// Where a clock time falls down a grid of `rowHeight` periods `gap` apart: inside a period in
    /// proportion, across a break in proportion, clamped before the first and after the last period.
    static func gridOffset(_ minutes: Int, rows: [NativeSchedulePeriod], rowHeight: CGFloat, gap: CGFloat) -> CGFloat {
        let step = rowHeight + gap
        var previousEnd: Int?
        for (index, period) in rows.enumerated() {
            guard let start = Self.minutes(period.startTime), let end = Self.minutes(period.endTime) else { return 0 }
            if minutes < start {
                if index == 0 { return 0 }
                let breakStart = previousEnd ?? start
                let length = max(1, start - breakStart)
                return CGFloat(index) * step - gap + gap * CGFloat(min(length, max(0, minutes - breakStart))) / CGFloat(length)
            }
            if minutes <= end {
                return CGFloat(index) * step + rowHeight * CGFloat(minutes - start) / CGFloat(max(1, end - start))
            }
            previousEnd = end
        }
        return max(0, CGFloat(rows.count) * step - gap)
    }

    /// The timed items of a day for a week column. `courses` are the periods its classes take.
    static func chips(_ items: [NativeAgendaItem], date: String, rows: [NativeSchedulePeriod], rowHeight: CGFloat,
                      gap: CGFloat, courses: [ClosedRange<Int>]) -> [NativeAgendaChip] {
        let bottom = max(0, CGFloat(rows.count) * (rowHeight + gap) - gap)
        return on(items, date: date).compactMap { entry in
            guard let start = minutes(entry.item.start) else { return nil }
            let end = minutes(entry.item.end).flatMap { $0 > start ? $0 : nil } ?? start + untimedSpan
            let y = min(gridOffset(start, rows: rows, rowHeight: rowHeight, gap: gap), max(0, bottom - 20))
            let height = max(20, min(gridOffset(end, rows: rows, rowHeight: rowHeight, gap: gap) - y, max(20, bottom - y)))
            // Where each course is drawn, as the Web grid decides: an item pinned onto a class (one
            // before the first period, say) keeps beside it too.
            let step = rowHeight + gap
            let beside = courses.contains { range in
                CGFloat(range.lowerBound - 1) * step < y + height && y < CGFloat(range.upperBound) * step - gap
            }
            return NativeAgendaChip(entry: entry, y: y, height: height, beside: beside)
        }
    }

    private static func chinaParts(_ date: Date) -> (date: String, minutes: Int) {
        let shifted = date.timeIntervalSince1970 * 1000 + chinaOffset
        let day = Int(floor(shifted / dayMilliseconds))
        return (Self.date(ofDay: day), Int((shifted - Double(day) * dayMilliseconds) / 60_000))
    }

    /// The reminders due in (from, until], earliest first; an occurrence already ticked off is skipped.
    static func reminders(_ items: [NativeAgendaItem], from: Date, until: Date, limit: Int) -> [NativeAgendaReminder] {
        guard let today = dayNumber(chinaParts(from).date),
              let lastDay = dayNumber(chinaParts(until.addingTimeInterval(7 * 86_400)).date) else { return [] }
        var result: [NativeAgendaReminder] = []
        for item in items where item.remind >= 0 {
            guard let first = dayNumber(item.date) else { continue }
            var day = max(first, today - 1)
            while day <= lastDay {
                let date = Self.date(ofDay: day)
                if occurs(item, on: date), !isDone(item, on: date) {
                    let clock = minutes(item.start).map { $0 - item.remind } ?? 8 * 60 - (item.remind >= 1440 ? 1440 : 0)
                    let at = Date(timeIntervalSince1970: (Double(day) * dayMilliseconds + Double(clock) * 60_000 - chinaOffset) / 1000)
                    if at > from, at <= until {
                        var when: [String] = []
                        if day != today {
                            when.append(day == today + 1 ? "明天" : "\(Int(date.dropFirst(5).prefix(2)) ?? 0)月\(Int(date.suffix(2)) ?? 0)日")
                        }
                        if !item.start.isEmpty { when.append(item.end.isEmpty ? item.start : "\(item.start)–\(item.end)") }
                        if !item.location.isEmpty { when.append(item.location) }
                        result.append(NativeAgendaReminder(id: item.id, date: date, at: at,
                                                           title: String("日程提醒 · \(item.title)".prefix(60)),
                                                           text: when.joined(separator: " · ")))
                    }
                }
                if !item.repeats { break }
                day += 1
            }
        }
        return Array(result.sorted { $0.at < $1.at }.prefix(limit))
    }
}
