import Foundation

enum AppConfiguration {
    static let appGroup = "group.cn.lizmt.cpuweb"
    static let widgetEndpointKey = "scheduleWidgetEndpoint"
    static let widgetEndpointFileName = "schedule-widget-endpoint.txt"
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
