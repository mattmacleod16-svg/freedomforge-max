import SwiftUI

/// FreedomForge — Native iOS + macOS monitoring app.
///
/// Setup:
///   1. Open Xcode → File → New → Project → Multiplatform App
///   2. Name it "FreedomForge", select SwiftUI lifecycle
///   3. Replace the generated files with ALL files from this directory
///   4. Add Charts framework: Target → General → Frameworks → add Charts
///   5. Set minimum deployments: iOS 17.0, macOS 14.0
///   6. Build and run
///
/// Backend:
///   Run `node scripts/dashboard-api.js` on your Oracle VM.
///   Set DASHBOARD_PORT=9091 and ALERT_SECRET in .env
///
/// App config:
///   On first launch, go to Settings tab and enter your server URL + API token.

@main
struct FreedomForgeApp: App {
    @StateObject private var appState = AppState()
    @State private var showSplash = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                if !showSplash {
                    ContentView()
                        .environmentObject(appState)
                        .transition(.opacity)
                        .onAppear {
                            appState.startPolling()
                            appState.refreshAll()
                        }
                }

                if showSplash {
                    SplashView(isPresented: $showSplash)
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.4), value: showSplash)
            .preferredColorScheme(.dark)
        }
        #if os(macOS)
        .defaultSize(width: 1200, height: 800)
        #endif
    }
}
