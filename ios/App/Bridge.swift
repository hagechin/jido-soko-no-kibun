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
        case "ready":
            // Web 側の最初の描画が済んだ → 起動画像のオーバーレイを消してよい
            NotificationCenter.default.post(name: .hakoniwaWebReady, object: nil)
            return true
        case "sharePhoto":
            // フォトモードの写真を共有シートへ（写真に保存・AirDrop・メールなど）
            guard let dataUrl = p["data"] as? String, let image = Bridge.decodeDataUrl(dataUrl) else { throw BridgeError.badParams }
            let name = (p["name"] as? String) ?? "hakoniwa.jpg"
            Bridge.share(image: image, name: name, from: webView)
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

    /// data:image/jpeg;base64,... → UIImage
    static func decodeDataUrl(_ s: String) -> UIImage? {
        guard let comma = s.firstIndex(of: ",") else { return nil }
        let b64 = String(s[s.index(after: comma)...])
        guard let data = Data(base64Encoded: b64, options: [.ignoreUnknownCharacters]) else { return nil }
        return UIImage(data: data)
    }

    /// 共有シート。iPad はポップオーバーの起点が要る
    @MainActor
    static func share(image: UIImage, name: String, from webView: WKWebView?) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        if let jpg = image.jpegData(compressionQuality: 0.92) { try? jpg.write(to: tmp) }
        let items: [Any] = FileManager.default.fileExists(atPath: tmp.path) ? [tmp] : [image]
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        guard var top = webView?.window?.rootViewController else { return }
        while let presented = top.presentedViewController { top = presented }
        if let pop = vc.popoverPresentationController, let view = webView {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 80, width: 1, height: 1)
        }
        top.present(vc, animated: true)
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

extension Notification.Name {
    /// Web 側（JS）の最初の描画が済んだ
    static let hakoniwaWebReady = Notification.Name("HakoniwaWebReady")
}
