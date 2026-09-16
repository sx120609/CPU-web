import Foundation

// The host-side controller regression uses this small ActivityKit boundary.
// Like the actual API, update/end take effect when called: their timestamp
// orders events and does not defer execution until that time.
public protocol ActivityAttributes: Codable {
    associatedtype ContentState: Codable & Hashable
}

public struct ActivityContent<State> {
    public let state: State
    public let staleDate: Date?
    public init(state: State, staleDate: Date?) {
        self.state = state
        self.staleDate = staleDate
    }
}

public enum ActivityState { case active, stale, ended, dismissed }
public enum ActivityUIDismissalPolicy { case immediate }
public enum PushType { case token }

public enum TestActivityKit {
    public static var activitiesEnabled = true
    public static var failNextRequest = false
    public static var events: [String] = []
    fileprivate static var activities: [AnyObject] = []
}

public struct ActivityAuthorizationInfo {
    public init() {}
    public var areActivitiesEnabled: Bool { TestActivityKit.activitiesEnabled }
}

public final class Activity<Attributes: ActivityAttributes> {
    public let id = UUID().uuidString
    public let attributes: Attributes
    public private(set) var content: ActivityContent<Attributes.ContentState>
    public private(set) var activityState: ActivityState = .active

    public static var activities: [Activity<Attributes>] {
        TestActivityKit.activities.compactMap { $0 as? Activity<Attributes> }
    }

    private init(attributes: Attributes, content: ActivityContent<Attributes.ContentState>) {
        self.attributes = attributes
        self.content = content
    }

    public static func request(
        attributes: Attributes,
        content: ActivityContent<Attributes.ContentState>,
        pushType: PushType?
    ) throws -> Activity<Attributes> {
        if TestActivityKit.failNextRequest {
            TestActivityKit.failNextRequest = false
            throw NSError(domain: "ActivityKit", code: 1)
        }
        let activity = Activity(attributes: attributes, content: content)
        TestActivityKit.activities.append(activity)
        TestActivityKit.events.append("request")
        return activity
    }

    public func update(_ content: ActivityContent<Attributes.ContentState>) async {
        self.content = content
        TestActivityKit.events.append("update")
    }

    public func update(_ content: ActivityContent<Attributes.ContentState>, timestamp: Date) async {
        await update(content)
    }

    public func end(_ content: ActivityContent<Attributes.ContentState>?, dismissalPolicy: ActivityUIDismissalPolicy) async {
        if let content { self.content = content }
        activityState = .ended
        TestActivityKit.events.append("end")
    }

    public func end(_ content: ActivityContent<Attributes.ContentState>?, dismissalPolicy: ActivityUIDismissalPolicy, timestamp: Date) async {
        await end(content, dismissalPolicy: dismissalPolicy)
    }
}
