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
                    LinearGradient(
                        colors: [Color.green.opacity(0.32), Color.black.opacity(0.18)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
        }
        .configurationDisplayName("下一节课")
        .description("在智能叠放或表盘上查看下一节要上的课程。")
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
            let entry = NextCourseWidgetEntry(date: now, state: .awaitingSync, timezone: TimeZone.current.identifier)
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
            return NextCourseWidgetEntry(date: date, state: .awaitingSync, timezone: TimeZone.current.identifier)
        }
        guard let occurrence = snapshot.nextCourseOccurrence(at: date) else {
            return NextCourseWidgetEntry(date: date, state: .empty, timezone: snapshot.timezone)
        }
        return NextCourseWidgetEntry(date: date, state: .course(occurrence), timezone: snapshot.timezone)
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
        timezone: "Asia/Shanghai"
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
            Label(
                "\(occurrence.course.startTime) \(occurrence.course.name)\(roomSuffix(occurrence.course))",
                systemImage: "book.closed.fill"
            )
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
                VStack(spacing: 0) {
                    Text(occurrence.course.startTime)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                    Text(occurrence.course.name)
                        .font(.system(size: 8, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
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
                    Image(systemName: "book.closed.fill")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.green)
                        .widgetAccentable()
                    Text("下一节")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 2)
                    Text(dayLabel(occurrence.date, relativeTo: entry.date))
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                Text(occurrence.course.name)
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                HStack(spacing: 5) {
                    Label(occurrence.course.startTime, systemImage: "clock")
                    if let room = occurrence.course.room, !room.isEmpty {
                        Label(room, systemImage: "location")
                            .lineLimit(1)
                    }
                }
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        case .empty:
            messageView(symbol: "calendar.badge.checkmark", title: "近期没有课程", detail: "可以安心安排时间")
        case .awaitingSync:
            messageView(symbol: "iphone.and.arrow.forward", title: "等待课表同步", detail: "请打开手表课表或 iPhone App")
        }
    }

    private func messageView(symbol: String, title: String, detail: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.green)
                .widgetAccentable()
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .bold))
                Text(detail).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private func roomSuffix(_ course: WatchCourse) -> String {
        guard let room = course.room, !room.isEmpty else { return "" }
        return " · \(room)"
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
