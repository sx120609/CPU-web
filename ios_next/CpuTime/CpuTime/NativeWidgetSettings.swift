import Combine
import Foundation
import WidgetKit

enum NextWidgetConfiguration {
    static let appGroup = "group.cn.cputime.mobile"
    static let widgetEndpointKey = "scheduleWidgetEndpoint"
    static let widgetEndpointFileName = "schedule-widget-endpoint.txt"
    static let widgetThemeKey = "scheduleWidgetTheme"
    static func normalizedWidgetTheme(_ value: String?) -> String? {
        guard let theme = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              ["green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate", "color-glass"]
                .contains(theme) else {
            return nil
        }
        return theme
    }

}

@MainActor
final class NativeWidgetSettings: ObservableObject {
    @Published var status: String?
    var isConfigured: Bool {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: NextWidgetConfiguration.appGroup),
              let endpoint = try? String(contentsOf: container.appendingPathComponent(NextWidgetConfiguration.widgetEndpointFileName), encoding: .utf8) else { return false }
        return !endpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @discardableResult
    func installScheduleWidget(payload: String?) -> Bool {
        guard let endpoint = Self.widgetEndpoint(from: payload) else {
            showMessage(title: "配置失败", message: "小组件配置无效，请重新添加。")
            return false
        }
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: NextWidgetConfiguration.appGroup
        ), let defaults = UserDefaults(suiteName: NextWidgetConfiguration.appGroup) else {
            showMessage(
                title: "配置失败",
                message: "App Group 不可用。请使用正常签名的客户端，并确认 App 与小组件使用同一个 App Group。"
            )
            return false
        }

        let normalizedEndpoint = Self.normalizeEndpoint(endpoint)
        let theme = Self.widgetTheme(from: payload)
        let endpointFile = containerURL.appendingPathComponent(NextWidgetConfiguration.widgetEndpointFileName)
        do {
            defaults.set(normalizedEndpoint, forKey: NextWidgetConfiguration.widgetEndpointKey)
            if let theme {
                defaults.set(theme, forKey: NextWidgetConfiguration.widgetThemeKey)
            }
            defaults.synchronize()
            try normalizedEndpoint.write(to: endpointFile, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: endpointFile.path
            )
        } catch {
            defaults.removeObject(forKey: NextWidgetConfiguration.widgetEndpointKey)
            showMessage(title: "配置失败", message: "无法写入小组件共享配置，请检查签名和 App Group 设置。")
            return false
        }

        WidgetCenter.shared.reloadAllTimelines()
        showMessage(
            title: "小组件配置已保存",
            message: "请长按主屏幕，点左上角“+”，搜索“药大拾间”并选择课表样式。"
        )
        return true
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

    private func showMessage(title: String, message: String) {
        status = title + "：" + message
    }

    private static func widgetEndpoint(from payload: String?) -> String? {
        let rawValue = payload?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if rawValue.hasPrefix("https://") || rawValue.hasPrefix("http://") {
            return rawValue
        }
        guard let data = rawValue.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let endpoint = object["endpoint"] as? String,
              !endpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func widgetTheme(from payload: String?) -> String? {
        guard let rawValue = payload?.trimmingCharacters(in: .whitespacesAndNewlines),
              let data = rawValue.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return NextWidgetConfiguration.normalizedWidgetTheme(object["theme"] as? String)
    }

    private static func normalizeEndpoint(_ value: String) -> String {
        guard var components = URLComponents(string: value),
              let host = components.host?.lowercased(),
              host == "cputime.cn" || host == "cpu.lizmt.cn" else {
            return value
        }
        components.scheme = "https"
        components.host = "cputime.cn"
        return components.string ?? value
    }

}
