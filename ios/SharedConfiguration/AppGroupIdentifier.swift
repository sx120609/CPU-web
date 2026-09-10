import Foundation

public nonisolated enum AppGroupIdentifier {
    public static let fallback = "group.cn.lizmt.cpuweb"

    public static func resolved(in bundle: Bundle = .main) -> String {
        let configured = bundle.object(forInfoDictionaryKey: "CPUAppGroupIdentifier") as? String
        let value = configured?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value! : fallback
    }
}
