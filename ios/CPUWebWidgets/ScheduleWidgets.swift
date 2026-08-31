import SwiftUI
import WidgetKit

@main
struct CPUWebWidgetBundle: WidgetBundle {
    var body: some Widget {
        UpcomingScheduleWidget()
        TodayScheduleWidget()
        TwoDayScheduleWidget()
    }
}

private struct UpcomingScheduleWidget: Widget {
    let kind = "cn.lizmt.cpuweb.widget.upcoming"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleTimelineProvider()) { entry in
            ScheduleWidgetRoot(entry: entry) { payload in
                UpcomingScheduleView(payload: payload)
            }
        }
        .configurationDisplayName("临近课程")
        .description("显示当前课程和接下来一节课。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct TodayScheduleWidget: Widget {
    let kind = "cn.lizmt.cpuweb.widget.today"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleTimelineProvider()) { entry in
            ScheduleWidgetRoot(entry: entry) { payload in
                TodayScheduleView(payload: payload)
            }
        }
        .configurationDisplayName("今日课表")
        .description("查看今天的完整课程安排。")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private struct TwoDayScheduleWidget: Widget {
    let kind = "cn.lizmt.cpuweb.widget.twoday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleTimelineProvider()) { entry in
            ScheduleWidgetRoot(entry: entry) { payload in
                TwoDayScheduleView(payload: payload)
            }
        }
        .configurationDisplayName("两日课表")
        .description("并排显示今天和明天的课程。")
        .supportedFamilies([.systemLarge])
    }
}

private struct ScheduleWidgetRoot<Content: View>: View {
    let entry: ScheduleEntry
    @ViewBuilder let content: (SchedulePayload) -> Content

    var body: some View {
        Group {
            switch entry.state {
            case .loaded(let payload):
                content(payload)
            case .unconfigured:
                WidgetMessageView(
                    symbol: "rectangle.stack.badge.plus",
                    title: "尚未配置课表",
                    detail: "打开 App，在课表“更多”中添加 iOS 小组件"
                )
            case .failed(let message):
                WidgetMessageView(
                    symbol: "exclamationmark.arrow.triangle.2.circlepath",
                    title: "课表读取失败",
                    detail: message
                )
            }
        }
        .widgetURL(AppWidgetConfiguration.appURL)
        .containerBackground(for: .widget) {
            Color(red: 248 / 255, green: 251 / 255, blue: 1)
        }
    }
}

private struct WidgetMessageView: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.indigo)
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(WidgetPalette.primary)
            Text(detail)
                .font(.system(size: 11))
                .foregroundStyle(WidgetPalette.secondary)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(2)
    }
}

private struct UpcomingScheduleView: View {
    let payload: SchedulePayload
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let selection = payload.upcoming()
        VStack(alignment: .leading, spacing: 0) {
            WidgetDateHeader(day: selection.0)
            Spacer(minLength: 8)

            if selection.1.isEmpty {
                EmptyCoursesView(message: "近期没有课程")
            } else if family == .systemMedium {
                HStack(alignment: .top, spacing: 14) {
                    UpcomingColumn(label: "当前", course: selection.1.first)
                    Divider()
                    UpcomingColumn(label: "接下来", course: selection.1.count > 1 ? selection.1[1] : nil)
                }
            } else if let course = selection.1.first {
                CourseSummary(course: course, roomy: true)
                if selection.1.count > 1 {
                    Spacer(minLength: 7)
                    Text("接下来")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(WidgetPalette.muted)
                    CompactNextCourse(course: selection.1[1])
                }
            }
        }
    }
}

private struct UpcomingColumn: View {
    let label: String
    let course: ScheduleCourse?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(WidgetPalette.secondary)
            if let course {
                CourseSummary(course: course, roomy: false)
            } else {
                Text("暂无课程")
                    .font(.system(size: 11))
                    .foregroundStyle(WidgetPalette.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CourseSummary: View {
    let course: ScheduleCourse
    let roomy: Bool

    var body: some View {
        HStack(alignment: .top, spacing: roomy ? 9 : 7) {
            RoundedRectangle(cornerRadius: 3)
                .fill(WidgetPalette.accent(for: course))
                .frame(width: 5, height: roomy ? 58 : 62)
            VStack(alignment: .leading, spacing: roomy ? 3 : 2) {
                Text(course.displayName)
                    .font(.system(size: roomy ? 15 : 13, weight: .bold))
                    .foregroundStyle(WidgetPalette.primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.76)
                Text(course.metadata)
                    .font(.system(size: roomy ? 10 : 9))
                    .foregroundStyle(WidgetPalette.secondary)
                    .lineLimit(1)
                Text(course.timeRange)
                    .font(.system(size: roomy ? 11 : 10, weight: .semibold))
                    .foregroundStyle(WidgetPalette.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
        }
    }
}

private struct CompactNextCourse: View {
    let course: ScheduleCourse

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 3)
                .fill(WidgetPalette.accent(for: course))
                .frame(width: 5, height: 27)
            VStack(alignment: .leading, spacing: 1) {
                Text(course.displayName)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(WidgetPalette.primary)
                    .lineLimit(1)
                Text(course.timeRange)
                    .font(.system(size: 9))
                    .foregroundStyle(WidgetPalette.secondary)
                    .lineLimit(1)
            }
        }
    }
}

private struct TodayScheduleView: View {
    let payload: SchedulePayload
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let today = payload.fullDay(for: SchedulePayload.dateString(.now), fallbackOffset: 0)
        let limit = family == .systemLarge ? 7 : 2
        VStack(alignment: .leading, spacing: family == .systemLarge ? 8 : 7) {
            WidgetDateHeader(day: today)
            if today.courseList.isEmpty {
                EmptyCoursesView(message: "今天没有课程")
            } else {
                ForEach(Array(today.courseList.prefix(limit).enumerated()), id: \.offset) { _, course in
                    TodayCourseRow(course: course, large: family == .systemLarge)
                }
                if today.courseList.count > limit {
                    Text("还有 \(today.courseList.count - limit) 门课程")
                        .font(.system(size: 9))
                        .foregroundStyle(WidgetPalette.muted)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        }
    }
}

private struct TodayCourseRow: View {
    let course: ScheduleCourse
    let large: Bool

    var body: some View {
        HStack(spacing: large ? 9 : 6) {
            RoundedRectangle(cornerRadius: 3)
                .fill(WidgetPalette.accent(for: course))
                .frame(width: 5, height: large ? 40 : 29)
            VStack(alignment: .leading, spacing: 2) {
                Text(course.displayName)
                    .font(.system(size: large ? 13 : 11, weight: .bold))
                    .foregroundStyle(WidgetPalette.primary)
                    .lineLimit(1)
                Text(course.metadata)
                    .font(.system(size: large ? 9 : 8))
                    .foregroundStyle(WidgetPalette.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 5)
            Text(course.timeRange)
                .font(.system(size: large ? 10 : 9, weight: .semibold))
                .foregroundStyle(WidgetPalette.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, large ? 9 : 7)
        .padding(.vertical, large ? 6 : 4)
        .background(WidgetPalette.tint(for: course), in: RoundedRectangle(cornerRadius: large ? 11 : 8))
    }
}

private struct TwoDayScheduleView: View {
    let payload: SchedulePayload

    var body: some View {
        let todayDate = SchedulePayload.dateString(.now)
        let tomorrowDate = SchedulePayload.dateString(Calendar.current.date(byAdding: .day, value: 1, to: .now) ?? .now)
        let today = payload.fullDay(for: todayDate, fallbackOffset: 0)
        let tomorrow = payload.fullDay(for: tomorrowDate, fallbackOffset: 1)

        HStack(alignment: .top, spacing: 13) {
            DayColumn(day: today)
            Divider()
            DayColumn(day: tomorrow)
        }
    }
}

private struct DayColumn: View {
    let day: ScheduleDay

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            WidgetDateHeader(day: day)
            if day.courseList.isEmpty {
                EmptyCoursesView(message: "没有课程")
            } else {
                ForEach(Array(day.courseList.prefix(5).enumerated()), id: \.offset) { _, course in
                    TodayCourseRow(course: course, large: false)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WidgetDateHeader: View {
    let day: ScheduleDay

    var body: some View {
        HStack(spacing: 6) {
            Text(day.compactDate)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(WidgetPalette.primary)
            Text(day.displayLabel)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(day.displayLabel == "周六" || day.displayLabel == "周日" ? .pink : .teal)
            Spacer(minLength: 0)
            if let week = day.week, week > 0 {
                Text("第 \(week) 周")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(WidgetPalette.secondary)
            }
        }
    }
}

private struct EmptyCoursesView: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(WidgetPalette.muted)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}

private enum WidgetPalette {
    static let primary = Color(red: 23 / 255, green: 32 / 255, blue: 51 / 255)
    static let secondary = Color(red: 82 / 255, green: 96 / 255, blue: 120 / 255)
    static let muted = Color(red: 152 / 255, green: 162 / 255, blue: 179 / 255)
    private static let accents: [Color] = [
        Color(red: 232 / 255, green: 91 / 255, blue: 75 / 255),
        Color(red: 74 / 255, green: 120 / 255, blue: 242 / 255),
        Color(red: 139 / 255, green: 92 / 255, blue: 246 / 255),
        Color(red: 23 / 255, green: 166 / 255, blue: 154 / 255),
        Color(red: 224 / 255, green: 162 / 255, blue: 36 / 255),
        Color(red: 236 / 255, green: 112 / 255, blue: 161 / 255),
    ]
    private static let tints: [Color] = [
        Color(red: 253 / 255, green: 236 / 255, blue: 233 / 255),
        Color(red: 234 / 255, green: 240 / 255, blue: 1),
        Color(red: 242 / 255, green: 236 / 255, blue: 1),
        Color(red: 229 / 255, green: 248 / 255, blue: 245 / 255),
        Color(red: 1, green: 247 / 255, blue: 224 / 255),
        Color(red: 253 / 255, green: 235 / 255, blue: 244 / 255),
    ]

    static func accent(for course: ScheduleCourse) -> Color {
        accents[index(for: course)]
    }

    static func tint(for course: ScheduleCourse) -> Color {
        tints[index(for: course)]
    }

    private static func index(for course: ScheduleCourse) -> Int {
        let hash = course.displayName.unicodeScalars.reduce(0) { partial, scalar in
            (partial &* 31 &+ Int(scalar.value)) & 0x7fff_ffff
        }
        return hash % accents.count
    }
}

#Preview(as: .systemSmall) {
    UpcomingScheduleWidget()
} timeline: {
    ScheduleEntry.placeholder
}

#Preview(as: .systemMedium) {
    TodayScheduleWidget()
} timeline: {
    ScheduleEntry.placeholder
}
