import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: StoreManager

    var body: some View {
        ZStack {
            Color(red: 0x1d / 255, green: 0x27 / 255, blue: 0x33 / 255).ignoresSafeArea()
            WebView(store: store)
                .ignoresSafeArea()
        }
        .statusBarHidden(false)
    }
}
