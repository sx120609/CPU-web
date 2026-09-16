import SwiftUI
import WidgetKit

@main
struct CPUWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        NextCourseWatchWidget()
    }
}

private struct NextCourseWatchWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: WatchScheduleWidgetConfiguration.kind,
            provider: NextCourseTimelineProvider()
        ) { entry in
            NextCourseWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    // Accessory families already provide the system watch
                    // surface. A custom gradient makes the text look muddy
                    // and breaks the monochrome watch face treatments.
                    Color.clear
                }
        }
        .configurationDisplayName("下一节课")
        .description("在表盘或智能叠放中查看下一节课、教室和时间。显示内容可在 iPhone 的设备与小组件中调整。")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

private enum NextCourseWidgetState {
    case course(ScheduleCourseOccurrence)
    case empty
    case awaitingSync
}

private struct NextCourseWidgetEntry: TimelineEntry {
    let date: Date
    let state: NextCourseWidgetState
    let timezone: String
    let displayOptions: WatchWidgetDisplayOptions
}

private struct NextCourseTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> NextCourseWidgetEntry {
        .preview
    }

    func getSnapshot(in context: Context, completion: @escaping (NextCourseWidgetEntry) -> Void) {
        completion(context.isPreview ? .preview : entry(at: .now, snapshot: loadSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextCourseWidgetEntry>) -> Void) {
        let now = Date.now
        guard let snapshot = loadSnapshot() else {
            let entry = NextCourseWidgetEntry(
                date: now,
                state: .awaitingSync,
                timezone: TimeZone.current.identifier,
                displayOptions: .load()
            )
            completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(6 * 60 * 60))))
            return
        }

        let dates = WatchScheduleWidgetConfiguration.timelineDates(for: snapshot, startingAt: now)
        let entries = dates.map { entry(at: $0, snapshot: snapshot) }
        let policy: TimelineReloadPolicy = entries.count > 1
            ? .atEnd
            : .after(now.addingTimeInterval(6 * 60 * 60))
        completion(Timeline(entries: entries, policy: policy))
    }

    private func entry(at date: Date, snapshot: ScheduleEnvelope?) -> NextCourseWidgetEntry {
        guard let snapshot else {
            return NextCourseWidgetEntry(
                date: date,
                state: .awaitingSync,
                timezone: TimeZone.current.identifier,
                displayOptions: .load()
            )
        }
        guard let occurrence = snapshot.nextCourseOccurrence(at: date) else {
            return NextCourseWidgetEntry(
                date: date,
                state: .empty,
                timezone: snapshot.timezone,
                displayOptions: .load()
            )
        }
        return NextCourseWidgetEntry(
            date: date,
            state: .course(occurrence),
            timezone: snapshot.timezone,
            displayOptions: .load()
        )
    }

    private func loadSnapshot() -> ScheduleEnvelope? {
        guard let url = WatchScheduleWidgetConfiguration.sharedCacheURL(),
              let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
              let size = values.fileSize, size <= ScheduleEnvelope.maximumBytes,
              let data = try? Data(contentsOf: url) else { return nil }
        return try? ScheduleEnvelope.decode(data)
    }
}

private extension NextCourseWidgetEntry {
    static let preview = NextCourseWidgetEntry(
        date: .now,
        state: .course(
            ScheduleCourseOccurrence(
                course: WatchCourse(
                    id: "preview-course",
                    name: "药物化学",
                    teacher: "王老师",
                    room: "教学楼 101",
                    campus: "江宁校区",
                    weekday: 3,
                    startPeriod: 3,
                    endPeriod: 4,
                    startTime: "09:55",
                    endTime: "11:35",
                    weeks: [1]
                ),
                date: .now
            )
        ),
        timezone: "Asia/Shanghai",
        displayOptions: .default
    )
}

private struct NextCourseWidgetView: View {
    let entry: NextCourseWidgetEntry
    @Environment(\.widgetFamily) private var family

    @ViewBuilder
    var body: some View {
        switch family {
        case .accessoryInline:
            inlineContent
        case .accessoryCircular:
            circularContent
        default:
            rectangularContent
        }
    }

    @ViewBuilder
    private var inlineContent: some View {
        switch entry.state {
        case .course(let occurrence):
            Text(inlineText(occurrence.course))
                .lineLimit(1)
        case .empty:
            Label("近期没有课程", systemImage: "calendar.badge.checkmark")
        case .awaitingSync:
            Label("等待课表同步", systemImage: "iphone.and.arrow.forward")
        }
    }

    @ViewBuilder
    private var circularContent: some View {
        ZStack {
            AccessoryWidgetBackground()
            switch entry.state {
            case .course(let occurrence):
                VStack(spacing: 2) {
                    if entry.displayOptions.showTime {
                        Text(occurrence.course.startTime)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                    }
                    if let primary = entry.displayOptions.primaryValue(for: occurrence.course), primary != occurrence.course.startTime {
                        Text(primary)
                            .font(.system(size: 10, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.55)
                    }
                }
                .padding(5)
            case .empty:
                Image(systemName: "calendar.badge.checkmark")
                    .font(.system(size: 18, weight: .semibold))
                    .widgetAccentable()
            case .awaitingSync:
                Image(systemName: "iphone.and.arrow.forward")
                    .font(.system(size: 17, weight: .semibold))
                    .widgetAccentable()
            }
        }
    }

    @ViewBuilder
    private var rectangularContent: some View {
        switch entry.state {
        case .course(let occurrence):
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text("下一节")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 2)
                    Text(dayLabel(occurrence.date, relativeTo: entry.date))
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                if let primary = entry.displayOptions.primaryValue(for: occurrence.course) {
                    Text(primary)
                        .font(.system(size: 15, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.68)
                }
                if let metadata = entry.displayOptions.metadata(for: occurrence.course) {
                    Text(metadata)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.76)
                }
                HStack(spacing: 6) {
                    if entry.displayOptions.showTime {
                        Label("\(occurrence.course.startTime) - \(occurrence.course.endTime)", systemImage: "clock")
                    }
                    Text(periodLabel(for: occurrence.course))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        case .empty:
            messageView(symbol: "calendar.badge.checkmark", title: "近期没有课程", detail: "可以安心安排时间")
        case .awaitingSync:
            messageView(symbol: "iphone.and.arrow.forward", title: "等待课表同步", detail: "请打开 iPhone App 的设备与小组件设置")
        }
    }

    private func messageView(symbol: String, title: String, detail: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color(red: 15 / 255, green: 143 / 255, blue: 127 / 255))
                .widgetAccentable()
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .bold))
                Text(detail).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private func inlineText(_ course: WatchCourse) -> String {
        [
            entry.displayOptions.showTime ? course.startTime : nil,
            entry.displayOptions.primaryValue(for: course),
            entry.displayOptions.metadata(for: course)
        ]
        .compactMap { $0 }
        .joined(separator: " ")
    }

    private func periodLabel(for course: WatchCourse) -> String {
        course.startPeriod == course.endPeriod
            ? "第 \(course.startPeriod) 节"
            : "第 \(course.startPeriod)-\(course.endPeriod) 节"
    }

    private func dayLabel(_ date: Date, relativeTo reference: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: entry.timezone) ?? .current
        switch WatchScheduleWidgetConfiguration.dayOffset(from: reference, to: date, calendar: calendar) {
        case 0: return "今天"
        case 1: return "明天"
        default:
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "zh_CN")
            formatter.calendar = calendar
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = "M月d日"
            return formatter.string(from: date)
        }
    }
}
