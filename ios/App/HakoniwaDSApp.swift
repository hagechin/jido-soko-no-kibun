import SwiftUI
import AVFoundation

@main
struct HakoniwaDSApp: App {
    @StateObject private var store = StoreManager()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // 他アプリの音楽を止めない。ゲームの効果音はミックスで鳴らす
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        // iCloud キー値ストア: 他の端末からセーブが届いたら JS に知らせる（JS 側が「読み込みますか？」を出す）
        NotificationCenter.default.addObserver(forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: NSUbiquitousKeyValueStore.default, queue: .main) { _ in
            let savedAt = NSUbiquitousKeyValueStore.default.double(forKey: CloudStore.savedAtKey)
            BridgeEvents.shared.emit("cloudChanged", payload: ["savedAt": savedAt])
        }
        NSUbiquitousKeyValueStore.default.synchronize()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .background: BridgeEvents.shared.emit("background", payload: [:])
                    case .active: BridgeEvents.shared.emit("foreground", payload: [:])
                    default: break
                    }
                }
        }
    }
}
