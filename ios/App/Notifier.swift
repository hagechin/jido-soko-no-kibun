import Foundation
import UserNotifications

/// お知らせの通知（1.2、SPEC-1.2 §5）。端末内のローカル通知だけで、サーバーは使わない。
/// 文面は Web 側（アプリの言語の辞書）が作って渡す。予約は毎回まるごと入れ替え、繰り返しは使わない。
/// デリゲートを置いていないので、アプリが前面にいる間に時刻が来た通知は OS が出さない。
enum Notifier {
    /// "notDetermined" / "denied" / "authorized"
    static func status() async -> String {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        default: return "authorized"
        }
    }

    /// 許可を求める（初回は OS のダイアログ。断られていれば何も出ずに false）
    static func request() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
    }

    /// 予約と、出し終えて通知センターに残っているものを消す
    static func cancelAll() {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    /// 予約を入れ替える。items: [{ id, title, body, inSec }]。入れた件数を返す
    static func schedule(items: [[String: Any]]) async -> Int {
        let center = UNUserNotificationCenter.current()
        cancelAll()
        var count = 0
        for item in items {
            guard let id = item["id"] as? String,
                  let title = item["title"] as? String,
                  let body = item["body"] as? String,
                  let inSec = (item["inSec"] as? NSNumber)?.doubleValue, inSec >= 1
            else { continue }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: inSec, repeats: false)
            do {
                try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
                count += 1
            } catch {
                continue
            }
        }
        return count
    }
}
