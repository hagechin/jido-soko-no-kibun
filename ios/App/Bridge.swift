import Foundation
import UIKit
import WebKit

/// Swift → JS のイベント送信先（WebView が 1 つなので共有）
final class BridgeEvents {
    static let shared = BridgeEvents()
    weak var webView: WKWebView?

    func emit(_ event: String, payload: [String: Any]) {
        guard let webView, let json = Bridge.json(payload) else { return }
        DispatchQueue.main.async {
            webView.evaluateJavaScript("window.__native && window.__native.emit(\(Bridge.jsString(event)), \(json))", completionHandler: nil)
        }
    }
}

/// JS からの { id, method, params } を処理して { ok, result | error } を返す
final class Bridge {
    private weak var webView: WKWebView?
    private let store: StoreManager
    private let saves = SaveStore()
    private let cloud = CloudStore()

    @MainActor
    init(webView: WKWebView, store: StoreManager) {
        self.webView = webView
        self.store = store
        BridgeEvents.shared.webView = webView
        store.onEntitlementsChanged = { ids in
            BridgeEvents.shared.emit("entitlements", payload: ["ids": Array(ids).sorted()])
        }
    }

    func handle(_ body: [String: Any]) {
        guard let id = body["id"] as? Int, let method = body["method"] as? String else { return }
        let params = body["params"] as? [String: Any] ?? [:]
        Task { @MainActor in
            do {
                let result = try await dispatch(method, params)
                reply(id, ["ok": true, "result": result ?? NSNull()])
            } catch {
                reply(id, ["ok": false, "error": error.localizedDescription])
            }
        }
    }

    @MainActor
    private func dispatch(_ method: String, _ p: [String: Any]) async throws -> Any? {
        switch method {
        case "ping":
            let info = Bundle.main.infoDictionary
            return ["platform": "ios", "version": info?["CFBundleShortVersionString"] as? String ?? "0", "build": info?["CFBundleVersion"] as? String ?? "0"]
        case "save":
            guard let key = p["key"] as? String, let data = p["data"] as? String else { throw BridgeError.badParams }
            try saves.write(key: key, text: data)
            return true
        case "load":
            guard let key = p["key"] as? String else { throw BridgeError.badParams }
            return saves.read(key: key) ?? NSNull()
        case "delete":
            guard let key = p["key"] as? String else { throw BridgeError.badParams }
            saves.delete(key: key)
            return true
        case "wakeLock":
            UIApplication.shared.isIdleTimerDisabled = (p["on"] as? Bool) ?? false
            return true
        case "haptic":
            Haptics.play(kind: p["kind"] as? String ?? "light")
            return true
        case "cloudStatus":
            return ["available": cloud.available]
        case "cloudLoad":
            cloud.synchronize()
            guard let r = cloud.read() else { return NSNull() }
            return ["data": r.text, "savedAt": r.savedAt]
        case "cloudSave":
            guard let data = p["data"] as? String else { throw BridgeError.badParams }
            let savedAt = (p["savedAt"] as? Double) ?? Date().timeIntervalSince1970 * 1000
            return cloud.write(text: data, savedAt: savedAt)
        case "cloudClear":
            cloud.clear()
            return true
        case "products":
            // -storeOffline（手動確認 M12 用）: 商品を取れない状態を再現する
            if CommandLine.arguments.contains("-storeOffline") { return [] }
            return store.productInfos()
        case "purchase":
            guard let pid = p["id"] as? String else { throw BridgeError.badParams }
            let state = try await store.purchase(productID: pid)
            return ["state": state]
        case "restore":
            await store.restore()
            return ["ids": Array(store.purchased).sorted()]
        case "entitlements":
            return ["ids": Array(store.purchased).sorted()]
        default:
            throw BridgeError.unknownMethod(method)
        }
    }

    private func reply(_ id: Int, _ payload: [String: Any]) {
        guard let webView, let json = Bridge.json(payload) else { return }
        webView.evaluateJavaScript("window.__native && window.__native.reply(\(id), \(json))", completionHandler: nil)
    }

    static func json(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func jsString(_ s: String) -> String {
        json([s]).map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }
}

enum BridgeError: LocalizedError {
    case badParams
    case unknownMethod(String)
    var errorDescription: String? {
        switch self {
        case .badParams: return "パラメータが不正です"
        case .unknownMethod(let m): return "未知のメソッド: \(m)"
        }
    }
}

enum Haptics {
    static func play(kind: String) {
        switch kind {
        case "success":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning":
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        default:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
