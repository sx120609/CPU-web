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
    /// 节日与法定假期提示。
    var showHoliday: Bool
    /// 最近的节假日常驻在日期栏右侧，而不是只在今天课上完之后才出现。
    var holidayAlwaysVisible: Bool

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
        holidayAlwaysVisible: Bool = true
    ) {
        self.showCourseName = showCourseName
        self.showRoom = showRoom
        self.showTeacher = showTeacher
        self.showTime = showTime
        self.showLunarDate = showLunarDate
        self.showHoliday = showHoliday
        self.holidayAlwaysVisible = holidayAlwaysVisible
    }

    /// 旧版本存的 JSON 没有农历和节假日字段。缺字段时按默认值补齐，否则整份设置
    /// 解码失败，已经关掉的开关又会被打开。
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            showCourseName: try values.decodeIfPresent(Bool.self, forKey: .showCourseName) ?? true,
            showRoom: try values.decodeIfPresent(Bool.self, forKey: .showRoom) ?? true,
            showTeacher: try values.decodeIfPresent(Bool.self, forKey: .showTeacher) ?? true,
            showTime: try values.decodeIfPresent(Bool.self, forKey: .showTime) ?? true,
            showLunarDate: try values.decodeIfPresent(Bool.self, forKey: .showLunarDate) ?? true,
            showHoliday: try values.decodeIfPresent(Bool.self, forKey: .showHoliday) ?? true,
            holidayAlwaysVisible: try values.decodeIfPresent(Bool.self, forKey: .holidayAlwaysVisible) ?? true
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

    func setScheduleWidgetDisplayOptions(_ value: WidgetDisplayOptions) {
        guard let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup),
              let data = try? JSONEncoder().encode(value) else { return }
        defaults.set(data, forKey: NextWidgetConfiguration.widgetDisplayOptionsKey)
        defaults.synchronize()
        WidgetCenter.shared.reloadAllTimelines()
    }

}
