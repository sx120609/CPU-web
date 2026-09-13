import Foundation

nonisolated enum AppGroupIdentifier {
    static let fallback = "group.cn.cputime.mobile"

    static func resolved(bundle: Bundle = .main) -> String {
        let configured = bundle.object(forInfoDictionaryKey: "CPUAppGroupIdentifier") as? String
        let value = configured?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? fallback : value
    }
}
