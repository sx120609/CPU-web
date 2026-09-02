import Foundation

enum AppConfiguration {
    static let appGroup = "group.cn.lizmt.cpuweb"
    static let widgetEndpointKey = "scheduleWidgetEndpoint"
    static let widgetEndpointFileName = "schedule-widget-endpoint.txt"
    static let widgetThemeKey = "scheduleWidgetTheme"
    static let versionCode = 1
    static let versionName = "1.0.0"

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
        let isWidgetOpen = deepLinkQuery.contains { $0.name == "source" && $0.value == "widget" }
            && deepLinkQuery.contains { $0.name == "week" && $0.value == "current" }
        if isWidgetOpen {
            var query = components.queryItems ?? []
            query.removeAll { $0.name == "source" || $0.name == "week" }
            query.append(URLQueryItem(name: "source", value: "widget"))
            query.append(URLQueryItem(name: "week", value: "current"))
            components.queryItems = query
        }
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
