import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: StoreManager
    /// 起動画像（フォトモードで「起動画面にする」とした写真）。WebView が動き出すまで出しておき、ready で消す
    @State private var startupImage: UIImage? = StartupImage.load()
    @State private var webReady = false

    var body: some View {
        ZStack {
            Color(red: 0x1d / 255, green: 0x27 / 255, blue: 0x33 / 255).ignoresSafeArea()
            WebView(store: store)
                .ignoresSafeArea()
            if let img = startupImage, !webReady {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .ignoresSafeArea()
                    .transition(.opacity)
            }
        }
        .statusBarHidden(false)
        .onReceive(NotificationCenter.default.publisher(for: .hakoniwaWebReady)) { _ in
            withAnimation(.easeOut(duration: 0.35)) { webReady = true }
        }
    }
}

/// 起動画像の読み込み: JS が localStorage と Documents の両方に data URL を保存している（SaveStore の save キー `jido-soko-no-kibun:startup-photo`）
enum StartupImage {
    static func load() -> UIImage? {
        guard let text = SaveStore().read(key: "jido-soko-no-kibun:startup-photo") else { return nil }
        return Bridge.decodeDataUrl(text)
    }
}
