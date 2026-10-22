import Foundation

/// The dorm timetable ("宿舍课表", docs/dorm-schedule.md) is the site page
/// `/dorm-schedule` in the shared web view: the page owns the dorm, its
/// members and the free-time maths. The shell only hands it this term's whole
/// timetable, edits included, through `window.CPUTimeNativeDorm`, and the page
/// uploads it by the Web timetable's rules. Kept free of UIKit so the checks
/// in `ios_next/tests/NativeDormChecks.swift` run with plain `swiftc`.
enum DormRules {
    static let page = "/dorm-schedule"

    /// A dorm code as typed or linked: no spaces, upper case; empty when it cannot be one.
    static func inviteCode(_ value: String) -> String {
        let code = value.filter { !$0.isWhitespace }.uppercased()
        let allowed = code.count >= 4 && code.count <= 12
            && code.unicodeScalars.allSatisfy { ("A"..."Z").contains($0) || ("0"..."9").contains($0) }
        return allowed ? code : ""
    }

    /// The page for a dorm code; the code is filled in on the page.
    static func page(code: String = "") -> String {
        let value = inviteCode(code)
        return value.isEmpty ? page : "\(page)?code=\(value)"
    }

    /// The dorm page for an in-app link to the invite (`/schedule?dorm=1&code=…`),
    /// which the native timetable would otherwise swallow with its code; nil
    /// for any other path.
    static func pagePath(_ path: String) -> String? {
        guard let components = URLComponents(string: "https://local" + path),
              components.path == "/schedule",
              let items = components.queryItems,
              items.first(where: { $0.name == "dorm" })?.value == "1" else { return nil }
        return page(code: items.first(where: { $0.name == "code" })?.value ?? "")
    }

    /// Whether `semester` is the term running now by the timetable's own list
    /// of terms. Without a list it is taken as current, as the couple upload does
    /// on Android and HarmonyOS. A past term must never replace this one on the server.
    static func isCurrentTerm(_ semester: String, terms: [(value: String, current: Bool)]) -> Bool {
        guard !semester.isEmpty else { return false }
        guard let current = terms.first(where: { $0.current })?.value, !current.isEmpty else { return true }
        return current == semester
    }

    /// The `offer` request for `CPUTimeNativeDorm`: the couple upload's body,
    /// and the account the timetable belongs to so the page can refuse it for another one.
    static func offer(body: [String: Any], account: String) -> [String: Any] {
        var request: [String: Any] = ["action": "offer", "snapshot": body]
        if !account.isEmpty { request["account"] = account }
        return request
    }
}
