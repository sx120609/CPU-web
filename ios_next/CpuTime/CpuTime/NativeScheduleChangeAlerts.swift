import Foundation
import UIKit
import UserNotifications

/// 调课提醒: when a quiet refresh finds that 教务 changed the timetable while the user is not
/// looking at the app, a notification says what changed. With the app open the sheet over the
/// timetable already does.
///
/// The comparison is the store's, on the phone, against the timetable the phone last saw. The
/// refresh needs the signed-in page, so this works when the app comes forward or is woken in
/// the background while still in memory; an app the system has shut down learns of a change
/// the next time it is opened.
@available(iOS 17.0, *)
@MainActor
enum NativeScheduleChangeAlerts {
    static let enabledKey = "cpu.changeAlert.on"
    /// The notices already announced, newest last, so one change is told once.
    static let toldKey = "cpu.changeAlert.told"

    /// On unless switched off. It never asks for permission by itself: with notifications not
    /// allowed it does nothing.
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
    }

    static func connect(to store: NativeScheduleStore) {
        store.onScheduleChangeNotice = { notice in announce(notice) }
    }

    static func text(_ notice: NativeScheduleChangeNotice) -> String {
        let shown = notice.details.prefix(2).joined(separator: "；")
        let more = notice.details.count - min(2, notice.details.count)
        return shown.isEmpty ? "打开课表查看 \(notice.changedCount) 处变化" : more > 0 ? "\(shown) 等 \(notice.details.count) 处" : shown
    }

    static func announce(_ notice: NativeScheduleChangeNotice) {
        guard enabled, UIApplication.shared.applicationState != .active else { return }
        var told = UserDefaults.standard.stringArray(forKey: toldKey) ?? []
        guard !told.contains(notice.id) else { return }
        told = Array((told + [notice.id]).suffix(20))
        UserDefaults.standard.set(told, forKey: toldKey)
        Task {
            guard await NativeScheduleNotifications.authorized(asking: false) else { return }
            let content = UNMutableNotificationContent()
            content.title = "教务调整了课表"
            content.body = text(notice)
            content.sound = .default
            content.threadIdentifier = "schedule-change"
            try? await UNUserNotificationCenter.current().add(UNNotificationRequest(
                identifier: NativeScheduleNotifications.changePrefix + notice.id, content: content, trigger: nil))
        }
    }
}
