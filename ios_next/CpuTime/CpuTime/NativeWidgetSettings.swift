import Combine
import Foundation
import WidgetKit

enum NextWidgetConfiguration {
    static var appGroup: String { AppGroupIdentifier.resolved() }
    /// 旧版小组件请求服务端时用的地址和缓存，现在只在启动时清掉。
    static let legacyWidgetEndpointKey = "scheduleWidgetEndpoint"
    static let legacyWidgetFileNames = ["schedule-widget-endpoint.txt", "schedule-widget-cache.json"]
    static let widgetThemeKey = "scheduleWidgetTheme"
    static let widgetDisplayOptionsKey = "scheduleWidgetDisplayOptions"
    /// 小组件风格：`follow`（跟随课表风格，默认）、`minimal`、`table`、`paper`、`board`。
    static let widgetStyleKey = "scheduleWidgetStyle"
    static let widgetStyles: [(value: String, title: String)] = [
        ("follow", "跟随课表风格"), ("minimal", "简约"), ("table", "表格"), ("paper", "素笺"), ("board", "站牌"),
    ]
    static func normalizedWidgetTheme(_ value: String?) -> String? {
        guard let theme = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              ["green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate", "color-glass"]
                .contains(theme) else {
            return nil
        }
        return theme
    }

}

/// The fields shown by both the iPhone and Apple Watch schedule widgets.
/// Stored as a small JSON value so the two extensions can share it through the
/// App Group without linking either extension into the app target.
struct WidgetDisplayOptions: Codable, Equatable {
    var showCourseName: Bool
    var showRoom: Bool
    var showTeacher: Bool
    var showTime: Bool
    /// 日期栏里的农历日期。只有 iPhone 小组件用，手表读这份 JSON 时会忽略。
    var showLunarDate: Bool
    /// 节日徽标与休息时的假期倒计时。
    var showHoliday: Bool
    /// 最近的节假日常驻在日期栏右侧（「距国庆节还有 5 天」），而不是只在休息时才出现。
    var holidayAlwaysVisible: Bool
    /// 桌面小组件的文字大小：`auto`（自适应）、`small`、`standard`、`large`，
    /// 和扩展里的 `ScheduleWidgetTextSize` 一一对应。从这里往下都只有 iPhone 小组件用。
    var textSize: String
    /// 日期栏右边的「第 N 周」。
    var showWeek: Bool
    /// 时间线上长课间的「休息 2 小时」。
    var showBreaks: Bool
    /// 正在上的课的实时进度，和「距下课」「距上课」的倒计时。
    var showProgress: Bool
    /// 今天已经上完的课不再灰着留在列表里。
    var hideCompleted: Bool

    static let textSizes: [(value: String, title: String)] = [
        ("auto", "自适应"), ("small", "小"), ("standard", "标准"), ("large", "大"),
    ]

    static let `default` = WidgetDisplayOptions(
        showCourseName: true,
        showRoom: true,
        showTeacher: true,
        showTime: true
    )

    init(
        showCourseName: Bool,
        showRoom: Bool,
        showTeacher: Bool,
        showTime: Bool,
        showLunarDate: Bool = true,
        showHoliday: Bool = true,
        holidayAlwaysVisible: Bool = true,
        textSize: String = "standard",
        showWeek: Bool = true,
        showBreaks: Bool = true,
        showProgress: Bool = true,
        hideCompleted: Bool = false
    ) {
        self.showCourseName = showCourseName
        self.showRoom = showRoom
        self.showTeacher = showTeacher
        self.showTime = showTime
        self.showLunarDate = showLunarDate
        self.showHoliday = showHoliday
        self.holidayAlwaysVisible = holidayAlwaysVisible
        self.textSize = Self.textSizes.contains { $0.value == textSize } ? textSize : "standard"
        self.showWeek = showWeek
        self.showBreaks = showBreaks
        self.showProgress = showProgress
        self.hideCompleted = hideCompleted
    }

    /// 旧版本存的 JSON 没有后来加的字段（农历、节假日、常驻、文字大小、进度……；中间有几版去掉过常驻）。
    /// 缺字段时按默认值补齐，否则整份设置解码失败，已经关掉的开关又会被打开。
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        func flag(_ key: CodingKeys, _ fallback: Bool) throws -> Bool {
            try values.decodeIfPresent(Bool.self, forKey: key) ?? fallback
        }
        self.init(
            showCourseName: try flag(.showCourseName, true),
            showRoom: try flag(.showRoom, true),
            showTeacher: try flag(.showTeacher, true),
            showTime: try flag(.showTime, true),
            showLunarDate: try flag(.showLunarDate, true),
            showHoliday: try flag(.showHoliday, true),
            holidayAlwaysVisible: try flag(.holidayAlwaysVisible, true),
            textSize: try values.decodeIfPresent(String.self, forKey: .textSize) ?? "standard",
            showWeek: try flag(.showWeek, true),
            showBreaks: try flag(.showBreaks, true),
            showProgress: try flag(.showProgress, true),
            hideCompleted: try flag(.hideCompleted, false)
        )
    }

    static func load(defaults: UserDefaults? = UserDefaults(suiteName: NextWidgetConfiguration.appGroup)) -> Self {
        guard let data = defaults?.data(forKey: NextWidgetConfiguration.widgetDisplayOptionsKey),
              let value = try? JSONDecoder().decode(Self.self, from: data) else {
            return .default
        }
        return value
    }
}

@MainActor
@available(iOS 17.0, *)
final class NativeWidgetSettings: ObservableObject {
    /// App 已经给小组件写过本地课表。小组件不再请求服务端，有这份文件就能显示。
    var isConfigured: Bool {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: NextWidgetConfiguration.appGroup) else { return false }
        return FileManager.default.fileExists(atPath: container.appendingPathComponent(NativeWidgetLocalSchedule.fileName).path)
    }

    func setScheduleWidgetTheme(_ value: String?) {
        guard let theme = NextWidgetConfiguration.normalizedWidgetTheme(value),
              let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup) else {
            return
        }
        defaults.set(theme, forKey: NextWidgetConfiguration.widgetThemeKey)
        defaults.synchronize()
        WidgetCenter.shared.reloadAllTimelines()
    }

    func setScheduleWidgetStyle(_ value: String) {
        guard NextWidgetConfiguration.widgetStyles.contains(where: { $0.value == value }),
              let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup) else { return }
        defaults.set(value, forKey: NextWidgetConfiguration.widgetStyleKey)
        WidgetCenter.shared.reloadAllTimelines()
    }

    func setScheduleWidgetDisplayOptions(_ value: WidgetDisplayOptions) {
        guard let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup),
              let data = try? JSONEncoder().encode(value) else { return }
        defaults.set(data, forKey: NextWidgetConfiguration.widgetDisplayOptionsKey)
        defaults.synchronize()
        WidgetCenter.shared.reloadAllTimelines()
    }

}
