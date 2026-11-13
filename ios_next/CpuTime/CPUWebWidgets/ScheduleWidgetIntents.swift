import AppIntents
import SwiftUI
import WidgetKit

/// 长按小组件 →「编辑小组件」里的选项。每个小组件各存各的，所以同一种小组件
/// 放两个也可以一个看明天、一个看假期。
@available(iOS 17.0, *)
struct ScheduleWidgetConfiguration: Sendable {
    var afterClass: ScheduleWidgetAfterClassStyle = .nextCourseDay
    /// 小号「临近课程」显示几节课。默认值和原来的样子一致：当前和下一节。
    var upcomingCourseCount = 2
    var twoDayStart: TwoDayStartOption = .nextCourseDay
    /// 大号今日课表和两日课表的课怎么排。
    var layout: ScheduleWidgetLayoutStyle = .timeline
    /// 这一个小组件自己的文字大小；不选就跟着 App 里「iPhone 小组件」的设置。
    var textSize: ScheduleWidgetTextSize? = nil
}

/// 「编辑小组件」里的文字大小。默认跟随 App 里的设置，同一种小组件放两个可以一大一小。
@available(iOS 17.0, *)
enum TextSizeOption: String, AppEnum {
    case follow, auto, small, standard, large

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "文字大小"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .follow: "跟随 App 设置",
        .auto: "自适应",
        .small: "小",
        .standard: "标准",
        .large: "大",
    ]

    var size: ScheduleWidgetTextSize? {
        switch self {
        case .follow: return nil
        case .auto: return .auto
        case .small: return .small
        case .standard: return .standard
        case .large: return .large
        }
    }
}

/// 大号上的课怎么排。中号、小号放不下时间线，一律是列表。
enum ScheduleWidgetLayoutStyle: String, Sendable {
    /// 左边一列起止时间，卡片和课间按时长分高度，把组件的高度用满。
    case timeline
    /// 一门课一张卡片，按顺序往下排。
    case list
}

@available(iOS 17.0, *)
enum LayoutOption: String, AppEnum {
    case timeline
    case list

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "显示方式"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .timeline: "时间线",
        .list: "列表",
    ]

    var style: ScheduleWidgetLayoutStyle {
        switch self {
        case .timeline: return .timeline
        case .list: return .list
        }
    }
}

@available(iOS 17.0, *)
enum AfterClassOption: String, AppEnum {
    case nextCourseDay
    /// rawValue 沿用旧的「今天没有课程」，原来选它的小组件不用重新设置；
    /// 旧的「明天的课程」「最近的节假日」解不出来，落回默认的下一次课。
    case todayOnly = "none"

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "今天的课上完后"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .nextCourseDay: "接着显示下一次课",
        .todayOnly: "只看今天",
    ]

    var style: ScheduleWidgetAfterClassStyle {
        switch self {
        case .nextCourseDay: return .nextCourseDay
        case .todayOnly: return .todayOnly
        }
    }
}

@available(iOS 17.0, *)
enum UpcomingCourseCountOption: Int, AppEnum {
    case one = 1
    case two = 2

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "显示几节课"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .one: "只显示一节",
        .two: "当前和下一节",
    ]
}

@available(iOS 17.0, *)
enum TwoDayStartOption: String, AppEnum {
    /// 固定今天和明天。
    case today
    /// 左边照旧是今天，右边是今天之后最近一个有课的日期（三周之内，没有就是明天）。
    /// rawValue 沿用旧名，已经放好的小组件不用重新设置。
    case nextCourseDay

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "显示哪两天"
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .today: "今天和明天",
        .nextCourseDay: "今天和最近有课的一天",
    ]
}

/// 放假当天祝福上方的彩炮按钮。记下按的时间，系统随即刷新小组件，这一刷看到刚按过就放一次烟花，
/// 几秒后的下一条时间线再收起来（见 `ScheduleTimeline.make`）。
@available(iOS 17.0, *)
struct CelebrateHolidayIntent: AppIntent {
    static let title: LocalizedStringResource = "放礼花"
    static let isDiscoverable = false

    static let firedAtKey = "cputime.holidayFireworksFiredAt"
    static let previousFiredAtKey = "cputime.holidayFireworksPreviousFiredAt"

    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: AppWidgetConfiguration.appGroup)
        defaults?.set(defaults?.object(forKey: Self.firedAtKey), forKey: Self.previousFiredAtKey)
        defaults?.set(Date(), forKey: Self.firedAtKey)
        return .result()
    }

    /// 上上次和上一次按的时间，给烟花层当身份用（见 `ScheduleEntry.fireworksRound`）。没按过是 0。
    static func rounds() -> (previous: Double, latest: Double) {
        let defaults = UserDefaults(suiteName: AppWidgetConfiguration.appGroup)
        func stamp(_ key: String) -> Double {
            (defaults?.object(forKey: key) as? Date)?.timeIntervalSince1970 ?? 0
        }
        return (stamp(previousFiredAtKey), stamp(firedAtKey))
    }

    /// 按下后多久之内刷新出来的时间线算「刚按过」。
    static func justFired(now: Date) -> Bool {
        guard let firedAt = UserDefaults(suiteName: AppWidgetConfiguration.appGroup)?.object(forKey: firedAtKey) as? Date else {
            return false
        }
        let elapsed = now.timeIntervalSince(firedAt)
        return elapsed >= 0 && elapsed < 5
    }
}

@available(iOS 17.0, *)
protocol ScheduleWidgetIntent: WidgetConfigurationIntent {
    var configuration: ScheduleWidgetConfiguration { get }
}

@available(iOS 17.0, *)
struct TodayScheduleWidgetIntent: ScheduleWidgetIntent {
    static let title: LocalizedStringResource = "今日课表"
    static let description = IntentDescription("选择今天的课上完后小组件显示什么、文字大小，以及大号的显示方式。")

    @Parameter(title: "今天的课上完后", default: .nextCourseDay)
    var afterClass: AfterClassOption

    @Parameter(title: "显示方式", default: .timeline)
    var layout: LayoutOption

    @Parameter(title: "文字大小", default: .follow)
    var textSize: TextSizeOption

    /// 小号、中号和锁屏只放得下几门课，没有时间线可选。
    static var parameterSummary: some ParameterSummary {
        When(widgetFamily: .equalTo, .systemLarge) {
            Summary {
                \.$afterClass
                \.$layout
                \.$textSize
            }
        } otherwise: {
            Summary {
                \.$afterClass
                \.$textSize
            }
        }
    }

    var configuration: ScheduleWidgetConfiguration {
        ScheduleWidgetConfiguration(afterClass: afterClass.style, layout: layout.style, textSize: textSize.size)
    }
}

@available(iOS 17.0, *)
struct UpcomingScheduleWidgetIntent: ScheduleWidgetIntent {
    static let title: LocalizedStringResource = "临近课程"
    static let description = IntentDescription("选择今天的课上完后显示什么、小号显示几节课、文字大小，以及大号的显示方式。")

    // 默认：今天上完就换到最近有课的一天，小号显示当前和下一节。
    @Parameter(title: "今天的课上完后", default: .nextCourseDay)
    var afterClass: AfterClassOption

    @Parameter(title: "显示几节课", default: .two)
    var courseCount: UpcomingCourseCountOption

    @Parameter(title: "显示方式", default: .timeline)
    var layout: LayoutOption

    @Parameter(title: "文字大小", default: .follow)
    var textSize: TextSizeOption

    /// 中号本来就是「当前 / 接下来」两栏，锁屏也只放得下一节，节数只在小号上给选；
    /// 大号放的是今天的完整课表，可以选时间线或列表。
    static var parameterSummary: some ParameterSummary {
        When(widgetFamily: .equalTo, .systemSmall) {
            Summary {
                \.$afterClass
                \.$courseCount
                \.$textSize
            }
        } otherwise: {
            When(widgetFamily: .equalTo, .systemLarge) {
                Summary {
                    \.$afterClass
                    \.$layout
                    \.$textSize
                }
            } otherwise: {
                Summary {
                    \.$afterClass
                    \.$textSize
                }
            }
        }
    }

    var configuration: ScheduleWidgetConfiguration {
        ScheduleWidgetConfiguration(
            afterClass: afterClass.style,
            upcomingCourseCount: courseCount.rawValue,
            layout: layout.style,
            textSize: textSize.size
        )
    }
}

@available(iOS 17.0, *)
struct TwoDayScheduleWidgetIntent: ScheduleWidgetIntent {
    static let title: LocalizedStringResource = "两日课表"
    static let description = IntentDescription("选择两日课表显示哪两天、文字大小，以及大号的显示方式。")

    // 默认值：右边是最近有课的一天。
    @Parameter(title: "显示哪两天", default: .nextCourseDay)
    var start: TwoDayStartOption

    /// 默认是列表：它原来就是列表，已经放好的两日课表不会因为更新变了样。
    @Parameter(title: "显示方式", default: .list)
    var layout: LayoutOption

    @Parameter(title: "文字大小", default: .follow)
    var textSize: TextSizeOption

    static var parameterSummary: some ParameterSummary {
        When(widgetFamily: .equalTo, .systemLarge) {
            Summary {
                \.$start
                \.$layout
                \.$textSize
            }
        } otherwise: {
            Summary {
                \.$start
                \.$textSize
            }
        }
    }

    var configuration: ScheduleWidgetConfiguration {
        ScheduleWidgetConfiguration(twoDayStart: start, layout: layout.style, textSize: textSize.size)
    }
}

/// 三个小组件共用同一条时间线，只是各自带上自己的配置。
@available(iOS 17.0, *)
struct ScheduleIntentTimelineProvider<Configuration: ScheduleWidgetIntent>: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry { .placeholder }

    /// 小组件库里的预览用示例课表；桌面上的快照（比如编辑小组件时）用真实课表，和时间线第一条一样。
    func snapshot(for configuration: Configuration, in context: Context) async -> ScheduleEntry {
        var entry = context.isPreview
            ? ScheduleEntry.placeholder
            : ScheduleTimeline.make(now: .now).entries.first ?? .placeholder
        entry.configuration = configuration.configuration
        return entry
    }

    func timeline(for configuration: Configuration, in context: Context) async -> Timeline<ScheduleEntry> {
        let timeline = ScheduleTimeline.make(now: .now)
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

@available(iOS 17.0, *)
private struct ScheduleWidgetConfigurationEnvironmentKey: EnvironmentKey {
    static let defaultValue = ScheduleWidgetConfiguration()
}

private struct ScheduleWidgetCelebratingEnvironmentKey: EnvironmentKey {
    static let defaultValue = false
}

@available(iOS 17.0, *)
extension EnvironmentValues {
    var scheduleWidgetConfiguration: ScheduleWidgetConfiguration {
        get { self[ScheduleWidgetConfigurationEnvironmentKey.self] }
        set { self[ScheduleWidgetConfigurationEnvironmentKey.self] = newValue }
    }

    /// 刚按了彩炮，这一条时间线在放烟花。
    var scheduleWidgetCelebrating: Bool {
        get { self[ScheduleWidgetCelebratingEnvironmentKey.self] }
        set { self[ScheduleWidgetCelebratingEnvironmentKey.self] = newValue }
    }
}
