import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedTab = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $selectedTab) {
                DashboardView()
                    .tag(0)
                    .tabItem {
                        Image(systemName: selectedTab == 0 ? "gauge.open.with.lines.needle.33percent.and.arrowtriangle" : "gauge.open.with.lines.needle.33percent.and.arrowtriangle")
                        Text("Dashboard")
                    }

                PortfolioView()
                    .tag(1)
                    .tabItem {
                        Image(systemName: "chart.pie.fill")
                        Text("Portfolio")
                    }

                TradesView()
                    .tag(2)
                    .tabItem {
                        Image(systemName: "arrow.left.arrow.right.circle.fill")
                        Text("Trades")
                    }

                RiskView()
                    .tag(3)
                    .tabItem {
                        Image(systemName: "shield.lefthalf.filled")
                        Text("Risk")
                    }

                BrainView()
                    .tag(4)
                    .tabItem {
                        Image(systemName: "brain.head.profile")
                        Text("Brain")
                    }

                SignalsView()
                    .tag(5)
                    .tabItem {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                        Text("Signals")
                    }

                InfrastructureView()
                    .tag(6)
                    .tabItem {
                        Image(systemName: "server.rack")
                        Text("Infra")
                    }

                SettingsView()
                    .tag(7)
                    .tabItem {
                        Image(systemName: "gearshape.fill")
                        Text("Settings")
                    }
            }
            .tint(FFDesign.accent)
        }
    }
}
