import SwiftUI
import WebKit

/// 同梱した Web 版（Web/）を独自スキーム hakoniwa://app/ で配信し、JS ブリッジを受け付ける WKWebView
struct WebView: UIViewRepresentable {
    let store: StoreManager

    func makeCoordinator() -> Coordinator { Coordinator(store: store) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "native")
        // 起動前に「ネイティブあり」を知らせる
        let boot = """
        window.__nativeInfo = { platform: 'ios', version: '\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0")', build: '\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0")' };
        """
        config.userContentController.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x1d / 255, green: 0x27 / 255, blue: 0x33 / 255, alpha: 1)
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        webView.isInspectable = true
        #endif
        context.coordinator.attach(webView)
        webView.load(URLRequest(url: URL(string: "\(AppSchemeHandler.scheme)://app/index.html")!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        private var bridge: Bridge?
        private let store: StoreManager

        init(store: StoreManager) { self.store = store }

        @MainActor
        func attach(_ webView: WKWebView) {
            bridge = Bridge(webView: webView, store: store)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "native", let body = message.body as? [String: Any] else { return }
            bridge?.handle(body)
        }

        // 外部リンクは開かない（同梱ファイルだけ）
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = navigationAction.request.url, url.scheme == AppSchemeHandler.scheme {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }
    }
}

/// hakoniwa://app/<path> → アプリに同梱した Web/<path>
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "hakoniwa"

    private static let mime: [String: String] = [
        "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "json": "application/json",
        "webmanifest": "application/manifest+json", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "webp": "image/webp", "ico": "image/x-icon", "woff": "font/woff", "woff2": "font/woff2", "wasm": "application/wasm", "txt": "text/plain", "map": "application/json",
    ]

    /// 拡張子 → Content-Type（テスト用に公開）
    static func mimeType(forExtension ext: String) -> String {
        mime[ext.lowercased()] ?? "application/octet-stream"
    }

    /// 要求パス → 同梱ファイルの URL（テスト用に公開）。"/" は index.html
    static func fileURL(forPath path: String, webRoot: URL) -> URL {
        var p = path
        if p.isEmpty || p == "/" { p = "/index.html" }
        return webRoot.appendingPathComponent(String(p.dropFirst()))
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        let path = url.path
        guard let webRoot = Bundle.main.url(forResource: "Web", withExtension: nil) else {
            urlSchemeTask.didFailWithError(NSError(domain: "HakoniwaDS", code: 404, userInfo: [NSLocalizedDescriptionKey: "Web folder missing (run ios/sync-web.sh)"]))
            return
        }
        let fileURL = Self.fileURL(forPath: path, webRoot: webRoot)
        guard let data = try? Data(contentsOf: fileURL) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(Data("not found".utf8))
            urlSchemeTask.didFinish()
            return
        }
        let type = Self.mimeType(forExtension: fileURL.pathExtension)
        let headers = ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
