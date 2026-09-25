import AppIntents
import SwiftUI
import WidgetKit

/// 长按小组件 →「编辑小组件」里的选项。每个小组件各存各的，所以同一种小组件
/// 放两个也可以一个看明天、一个看假期。
struct ScheduleWidgetConfiguration: Sendable {
    /// `nil` 只出现在占位图里，此时沿用 App 里旧的全局设置。
    var afterClass: ScheduleWidgetAfterClassStyle?
    /// 小号「临近课程」显示几节课。默认值和原来的样子一致：当前和下一节。
    var upcomingCourseCount = 2
    var twoDayStart: TwoDayStartOption = .nextCourseDay
}

enum AfterClassOption: String, AppEnum {
    case none
    case tomorrow
    case holiday
    case nextCourseDay

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "今天的课上完后"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .none: "今天没有课程",
        .tomorrow: "明天的课程",
        .holiday: "最近的节假日",
        .nextCourseDay: "最近有课的一天",
    ]

    var style: ScheduleWidgetAfterClassStyle { ScheduleWidgetAfterClassStyle(rawValue: rawValue) ?? .tomorrow }
}

enum UpcomingCourseCountOption: Int, AppEnum {
    case one = 1
    case two = 2

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "显示几节课"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .one: "只显示一节",
        .two: "当前和下一节",
    ]
}

enum TwoDayStartOption: String, AppEnum {
    /// 固定今天和明天。
    case today
    /// 今天还有课就从今天起，否则从最近一个有课的日期起，连着两天。
    case nextCourseDay

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "显示哪两天"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .today: "今天和明天",
        .nextCourseDay: "从最近有课的一天起",
    ]
}

protocol ScheduleWidgetIntent: WidgetConfigurationIntent {
    var configuration: ScheduleWidgetConfiguration { get }
}

struct TodayScheduleWidgetIntent: ScheduleWidgetIntent {
    static let title: LocalizedStringResource = "今日课表"
    static let description = IntentDescription("选择今天的课上完后小组件显示什么。")

    @Parameter(title: "今天的课上完后", default: .tomorrow)
    var afterClass: AfterClassOption

    var configuration: ScheduleWidgetConfiguration {
        ScheduleWidgetConfiguration(afterClass: afterClass.style)
    }
}

struct UpcomingScheduleWidgetIntent: ScheduleWidgetIntent {
    static let title: LocalizedStringResource = "临近课程"
    static let description = IntentDescription("选择今天的课上完后显示什么，以及小号显示几节课。")

    // 默认值保持原来的行为：今天上完就换到最近有课的一天，小号显示当前和下一节。
    @Parameter(title: "今天的课上完后", default: .nextCourseDay)
    var afterClass: AfterClassOption

    @Parameter(title: "显示几节课", default: .two)
    var courseCount: UpcomingCourseCountOption

    /// 中号本来就是「当前 / 接下来」两栏，锁屏也只放得下一节，节数只在小号上给选。
    static var parameterSummary: some ParameterSummary {
        When(widgetFamily: .equalTo, .systemSmall) {
            Summary {
                \.$afterClass
                \.$courseCount
            }
        } otherwise: {
            Summary {
                \.$afterClass
            }
        }
    }

    var configuration: ScheduleWidgetConfiguration {
        ScheduleWidgetConfiguration(afterClass: afterClass.style, upcomingCourseCount: courseCount.rawValue)
    }
}

struct TwoDayScheduleWidgetIntent: ScheduleWidgetIntent {
    static let title: LocalizedStringResource = "两日课表"
    static let description = IntentDescription("选择两日课表显示哪两天。")

    // 默认值保持原来的行为：今天上完就从最近有课的一天起。
    @Parameter(title: "显示哪两天", default: .nextCourseDay)
    var start: TwoDayStartOption

    var configuration: ScheduleWidgetConfiguration {
        ScheduleWidgetConfiguration(twoDayStart: start)
    }
}

/// 三个小组件共用同一条时间线，只是各自带上自己的配置。
struct ScheduleIntentTimelineProvider<Configuration: ScheduleWidgetIntent>: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry { .placeholder }

    func snapshot(for configuration: Configuration, in context: Context) async -> ScheduleEntry {
        var entry = ScheduleEntry.placeholder
        entry.configuration = configuration.configuration
        return entry
    }

    func timeline(for configuration: Configuration, in context: Context) async -> Timeline<ScheduleEntry> {
        let timeline = await ScheduleTimeline.make(now: .now)
        return Timeline(
            entries: timeline.entries.map { entry in
                var entry = entry
                entry.configuration = configuration.configuration
                return entry
            },
            policy: timeline.policy
        )
    }
}

private struct ScheduleWidgetConfigurationEnvironmentKey: EnvironmentKey {
    static let defaultValue = ScheduleWidgetConfiguration()
}

extension EnvironmentValues {
    var scheduleWidgetConfiguration: ScheduleWidgetConfiguration {
        get { self[ScheduleWidgetConfigurationEnvironmentKey.self] }
        set { self[ScheduleWidgetConfigurationEnvironmentKey.self] = newValue }
    }
}
