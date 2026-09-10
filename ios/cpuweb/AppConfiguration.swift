import Foundation

enum AppConfiguration {
    static var appGroup: String { AppGroupIdentifier.resolved() }
    static let widgetEndpointKey = "scheduleWidgetEndpoint"
    static let widgetEndpointFileName = "schedule-widget-endpoint.txt"
    static let widgetThemeKey = "scheduleWidgetTheme"
    static var versionCode: Int {
        Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 1
    }
    static var versionName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
    }

    static var appURL: URL {
        let configured = Bundle.main.object(forInfoDictionaryKey: "CPUAppURL") as? String
        let rawValue = configured?.trimmingCharacters(in: .whitespacesAndNewlines)
        let baseURL = URL(string: rawValue?.isEmpty == false ? rawValue! : "https://cputime.cn")
            ?? URL(string: "https://cputime.cn")!
        return addingClientMarker(to: baseURL)
    }

    static var appHost: String {
        appURL.host?.lowercased() ?? "cputime.cn"
    }

    static func isCommerceURL(_ url: URL) -> Bool {
        let scheme = url.scheme?.lowercased() ?? ""
        if ["alipay", "alipays", "wxpay"].contains(scheme) { return true }
        let host = url.host?.lowercased() ?? ""
        if scheme == "weixin" && (host == "pay" || url.path.lowercased().hasPrefix("/pay")) { return true }
        if host == "pay.kaipay.cn" { return true }
        guard [appHost, "cputime.cn", "cpu.lizmt.cn"].contains(host) else { return false }
        let path = url.path.lowercased()
        return ["/vip", "/sponsor", "/sponsor-wall", "/api/payments", "/api/vip"].contains {
            path == $0 || path.hasPrefix($0 + "/")
        }
    }

    static func destinationURL(for deepLink: URL) -> URL? {
        guard deepLink.scheme?.lowercased() == "cpuweb" else { return nil }

        let route = deepLink.host?.lowercased()
            ?? deepLink.pathComponents.dropFirst().first?.lowercased()
        guard route == "schedule",
              var components = URLComponents(url: appURL, resolvingAgainstBaseURL: false) else {
            return nil
        }

        components.path = "/schedule"
        components.fragment = nil
        let deepLinkQuery = URLComponents(url: deepLink, resolvingAgainstBaseURL: false)?.queryItems ?? []
        var query = components.queryItems ?? []
        query.removeAll {
            ["source", "week", "widgetSemester", "widgetWeek"].contains($0.name)
        }
        query.append(URLQueryItem(name: "source", value: "widget"))
        query.append(URLQueryItem(name: "week", value: "current"))
        for name in ["widgetSemester", "widgetWeek"] {
            if let item = deepLinkQuery.first(where: { $0.name == name }),
               let value = item.value?.trimmingCharacters(in: .whitespacesAndNewlines),
               !value.isEmpty {
                query.append(URLQueryItem(name: name, value: value))
            }
        }
        components.queryItems = query
        return components.url
    }

    static func normalizedWidgetTheme(_ value: String?) -> String? {
        guard let theme = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              ["green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate", "color-glass"]
                .contains(theme) else {
            return nil
        }
        return theme
    }

    private static func addingClientMarker(to url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }
        var items = components.queryItems ?? []
        if !items.contains(where: { $0.name == "client" || $0.name == "platform" }) {
            items.append(URLQueryItem(name: "client", value: "ios-app"))
        }
        components.queryItems = items
        return components.url ?? url
    }
}
