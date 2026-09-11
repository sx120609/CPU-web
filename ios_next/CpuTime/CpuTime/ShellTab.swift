import Foundation

enum ShellTab: String, CaseIterable, Hashable {
    case home
    case academic
    case schedule
    case services
    case profile

    var label: String {
        switch self {
        case .home: return "首页"
        case .academic: return "教务"
        case .schedule: return "课表"
        case .services: return "服务"
        case .profile: return "我的"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house"
        case .academic: return "book.closed"
        case .schedule: return "calendar"
        case .services: return "square.grid.2x2"
        case .profile: return "person.crop.circle"
        }
    }

    var defaultPath: String {
        switch self {
        case .home: return "/home"
        case .academic: return "/jwxt"
        case .schedule: return "/schedule"
        case .services: return "/services"
        case .profile: return "/profile"
        }
    }

    static func isSchedulePath(_ path: String) -> Bool {
        let normalized = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? path
        return normalized == "/schedule" || normalized.hasPrefix("/schedule/")
    }

    /// Pages the Web login/register flow owns. They are the only destinations
    /// the login gate is allowed to show.
    static func isLoginPath(_ path: String) -> Bool {
        let pathname = pathname(of: path)
        return pathname == "/login" || pathname.hasPrefix("/login/")
            || pathname == "/register" || pathname.hasPrefix("/register/")
    }

    /// Paths that stay reachable while the native login gate is up: the login
    /// and registration pages plus the authentication API. Anything else is
    /// bounced back to the gate.
    static func isAuthPath(_ path: String) -> Bool {
        let pathname = pathname(of: path)
        return isLoginPath(pathname) || pathname == "/api" || pathname.hasPrefix("/api/")
    }

    private static func pathname(of path: String) -> String {
        let withoutQuery = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? path
        return withoutQuery.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? withoutQuery
    }

    static func from(path: String) -> ShellTab? {
        if isSchedulePath(path) { return .schedule }
        let pathname = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? path
        let hashless = pathname.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? pathname

        if hashless == "/home" || hashless == "/" || hashless.hasPrefix("/forum") || hashless.hasPrefix("/market") || hashless.hasPrefix("/search") || hashless.hasPrefix("/post") {
            return .home
        }
        if hashless == "/jwxt" || hashless.hasPrefix("/jwxt/") {
            return .academic
        }
        if hashless == "/services" || hashless.hasPrefix("/services/") {
            return .services
        }
        if hashless == "/profile"
            || hashless.hasPrefix("/profile/")
            || hashless == "/vip"
            || hashless.hasPrefix("/vip/")
            || hashless == "/sponsor"
            || hashless.hasPrefix("/sponsor/")
            || hashless == "/sponsor-wall"
            || hashless.hasPrefix("/messages")
            || hashless.hasPrefix("/admin")
            || hashless.hasPrefix("/u/")
            || hashless == "/login"
            || hashless == "/register" {
            return .profile
        }
        return nil
    }
}
