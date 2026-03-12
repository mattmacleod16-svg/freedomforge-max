import Foundation
import UserNotifications

/// Manages local push notifications for critical alerts.
class NotificationManager {
    static let shared = NotificationManager()

    private init() {}

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                print("Notification permission error: \(error)")
            }
        }
    }

    func sendAlert(title: String, body: String, level: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = level == "fatal" ? .defaultCritical : .default

        // Category for actionable notifications
        if level == "fatal" || level == "error" {
            content.interruptionLevel = .critical
        } else {
            content.interruptionLevel = .timeSensitive
        }

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: trigger
        )

        UNUserNotificationCenter.current().add(request)
    }
}
