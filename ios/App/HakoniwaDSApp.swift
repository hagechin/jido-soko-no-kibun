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
