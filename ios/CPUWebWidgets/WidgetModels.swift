import Foundation
import WidgetKit

enum AppWidgetConfiguration {
    static let appGroup = "group.cn.lizmt.cpuweb"
    static let endpointKey = "scheduleWidgetEndpoint"
    static let endpointFileName = "schedule-widget-endpoint.txt"
    static let themeKey = "scheduleWidgetTheme"
    static let appURL = URL(string: "cpuweb://schedule")!

    static var scheduleTheme: ScheduleWidgetTheme {
        let value = UserDefaults(suiteName: appGroup)?.string(forKey: themeKey)
        return ScheduleWidgetTheme(rawValue: value ?? "") ?? .colorGlass
    }
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
    var displayLabel: String { label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }

    var compactDate: String {
        guard let date, date.count >= 10 else { return "课表" }
        let month = Int(date.dropFirst(5).prefix(2)) ?? 0
        let day = Int(date.dropFirst(8).prefix(2)) ?? 0
        return month > 0 && day > 0 ? "\(month).\(day)" : String(date.dropFirst(5)).replacingOccurrences(of: "-", with: ".")
    }
}

struct SchedulePayload: Decodable {
    let title: String?
    let generatedAt: String?
    let cachedAt: String?
    let week: Int?
    let displayWeek: Int?
    let strictDate: Bool?
    let stale: Bool?
    let today: ScheduleDay?
    let days: [ScheduleDay]?
    let weekDays: [ScheduleDay]?

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
        return day(for: date, fallbackOffset: fallbackOffset)
    }

    func upcoming(now: Date = .now) -> (ScheduleDay, [ScheduleCourse]) {
        let minutes = Calendar.current.component(.hour, from: now) * 60
            + Calendar.current.component(.minute, from: now)
        let today = day(for: Self.dateString(now), fallbackOffset: 0)
        let hasRemaining = today.courseList.contains {
            $0.endMinutes >= minutes || (!$0.hasUsableStartTime && $0.endMinutes <= 0)
        }
        let useTomorrow = minutes >= 22 * 60 || (!today.courseList.isEmpty && !hasRemaining)
        let selected = useTomorrow
            ? day(for: Self.dateString(Calendar.current.date(byAdding: .day, value: 1, to: now) ?? now), fallbackOffset: 1)
            : today
        let courses = useTomorrow
            ? Array(selected.courseList.prefix(2))
            : Array(selected.courseList.filter {
                $0.endMinutes >= minutes || (!$0.hasUsableStartTime && $0.endMinutes <= 0)
            }.prefix(2))
        if !courses.isEmpty || useTomorrow { return (selected, courses) }
        let tomorrow = day(
            for: Self.dateString(Calendar.current.date(byAdding: .day, value: 1, to: now) ?? now),
            fallbackOffset: 1
        )
        return (tomorrow, Array(tomorrow.courseList.prefix(2)))
    }

    static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
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

private struct ScheduleResponse: Decodable {
    let code: Int
    let message: String?
    let data: SchedulePayload?
}

enum ScheduleWidgetError: LocalizedError {
    case unconfigured
    case unauthorized(String)
    case server(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unconfigured:
            return "请先打开 App 配置课表小组件"
        case .unauthorized(let message):
            return message.isEmpty ? "教务授权已失效，请打开 App 重新登录" : message
        case .server(let message):
            return message.isEmpty ? "课表服务暂时不可用" : message
        case .invalidResponse:
            return "课表数据无法读取"
        }
    }
}

enum ScheduleWidgetClient {
    static func load() async throws -> SchedulePayload {
        guard let stored = storedEndpoint(), !stored.isEmpty else {
            throw ScheduleWidgetError.unconfigured
        }

        var lastError: Error = ScheduleWidgetError.invalidResponse
        for endpoint in candidates(stored) {
            do {
                return try await fetch(endpoint)
            } catch let error as ScheduleWidgetError {
                if case .unauthorized = error { throw error }
                lastError = error
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private static func storedEndpoint() -> String? {
        if let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: AppWidgetConfiguration.appGroup
        ) {
            let endpointFile = containerURL.appendingPathComponent(AppWidgetConfiguration.endpointFileName)
            if let value = try? String(contentsOf: endpointFile, encoding: .utf8) {
                let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !normalized.isEmpty { return normalized }
            }
        }

        let value = UserDefaults(suiteName: AppWidgetConfiguration.appGroup)?
            .string(forKey: AppWidgetConfiguration.endpointKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }

    private static func fetch(_ endpoint: URL) async throws -> SchedulePayload {
        guard var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false) else {
            throw ScheduleWidgetError.invalidResponse
        }
        var query = components.queryItems ?? []
        query.append(URLQueryItem(name: "_widgetRefresh", value: String(Int(Date.now.timeIntervalSince1970 * 1000))))
        components.queryItems = query
        guard let url = components.url else { throw ScheduleWidgetError.invalidResponse }

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ScheduleWidgetError.invalidResponse }
        let wrapper = try JSONDecoder().decode(ScheduleResponse.self, from: data)
        if http.statusCode == 401 || http.statusCode == 403 || wrapper.code == 401 {
            throw ScheduleWidgetError.unauthorized(wrapper.message ?? "")
        }
        guard (200..<300).contains(http.statusCode), wrapper.code == 0, let payload = wrapper.data else {
            throw ScheduleWidgetError.server(wrapper.message ?? "")
        }
        return payload
    }

    private static func candidates(_ value: String) -> [URL] {
        guard var components = URLComponents(string: value), let host = components.host?.lowercased() else {
            return URL(string: value).map { [$0] } ?? []
        }
        guard host == "cputime.cn" || host == "cpu.lizmt.cn" else {
            return components.url.map { [$0] } ?? []
        }
        components.scheme = "https"
        components.host = "cputime.cn"
        var urls = components.url.map { [$0] } ?? []
        components.host = "cpu.lizmt.cn"
        if let legacy = components.url, !urls.contains(legacy) { urls.append(legacy) }
        return urls
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

    static let placeholder = ScheduleEntry(
        date: .now,
        state: .loaded(
            SchedulePayload(
                title: "药大课表",
                generatedAt: nil,
                cachedAt: nil,
                week: 1,
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

struct ScheduleTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        completion(.placeholder)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        Task {
            let entry: ScheduleEntry
            do {
                entry = ScheduleEntry(date: .now, state: .loaded(try await ScheduleWidgetClient.load()))
            } catch ScheduleWidgetError.unconfigured {
                entry = ScheduleEntry(date: .now, state: .unconfigured)
            } catch {
                entry = ScheduleEntry(date: .now, state: .failed(error.localizedDescription))
            }
            let refresh = Calendar.current.date(byAdding: .minute, value: 30, to: .now) ?? .now.addingTimeInterval(1800)
            completion(Timeline(entries: [entry], policy: .after(refresh)))
        }
    }
}
