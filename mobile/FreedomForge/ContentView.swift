import SwiftUI

// MARK: - Tab Definition

private enum TabItem: Int, CaseIterable {
    case dashboard = 0
    case portfolio = 1
    case trades = 2
    case risk = 3
    case more = 4

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .portfolio: return "Portfolio"
        case .trades:    return "Trades"
        case .risk:      return "Risk"
        case .more:      return "More"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: return "gauge.open.with.lines.needle.33percent.and.arrowtriangle"
        case .portfolio: return "chart.pie.fill"
        case .trades:    return "arrow.left.arrow.right.circle.fill"
        case .risk:      return "shield.lefthalf.filled"
        case .more:      return "ellipsis.circle.fill"
        }
    }
}

// MARK: - Content View

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedTab = 0
    @State private var previousTab = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            FFDesign.background.ignoresSafeArea()

            // Active tab content
            Group {
                switch selectedTab {
                case 0: DashboardView()
                case 1: PortfolioView()
                case 2: TradesView()
                case 3: RiskView()
                case 4: MoreView()
                default: DashboardView()
                }
            }
            .opacity(1)
            .offset(y: 0)
            .transition(.opacity.combined(with: .offset(y: 6)))
            .animation(.easeInOut(duration: 0.2), value: selectedTab)
            .padding(.bottom, 70)

            // Custom tab bar
            customTabBar
        }
    }

    // MARK: - Custom Tab Bar

    private var customTabBar: some View {
        VStack(spacing: 0) {
            // Top gradient border (1px)
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            FFDesign.accent.opacity(0.0),
                            FFDesign.accent.opacity(0.35),
                            FFDesign.accent.opacity(0.0)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(height: 1)

            // Tab buttons
            HStack(spacing: 0) {
                ForEach(TabItem.allCases, id: \.rawValue) { tab in
                    tabButton(for: tab)
                }
            }
            .padding(.top, 8)
            .padding(.bottom, bottomPadding)
            .background(tabBarBackground)
        }
    }

    @ViewBuilder
    private func tabButton(for tab: TabItem) -> some View {
        let isSelected = selectedTab == tab.rawValue

        Button {
            guard selectedTab != tab.rawValue else { return }
            HapticManager.light()
            previousTab = selectedTab
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedTab = tab.rawValue
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 20, weight: isSelected ? .semibold : .regular))
                    .scaleEffect(isSelected ? 1.15 : 1.0)
                    .foregroundColor(isSelected ? FFDesign.accent : FFDesign.textTertiary)
                    .shadow(
                        color: isSelected ? FFDesign.accent.opacity(0.5) : .clear,
                        radius: isSelected ? 8 : 0,
                        x: 0,
                        y: 0
                    )
                    .animation(.easeInOut(duration: 0.2), value: isSelected)

                Text(tab.title)
                    .font(.system(size: 10, weight: isSelected ? .semibold : .regular))
                    .foregroundColor(isSelected ? FFDesign.accent : FFDesign.textTertiary)
                    .animation(.easeInOut(duration: 0.2), value: isSelected)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var tabBarBackground: some View {
        #if os(iOS)
        Rectangle()
            .fill(.ultraThinMaterial)
            .environment(\.colorScheme, .dark)
        #else
        Rectangle()
            .fill(Color(red: 0.08, green: 0.08, blue: 0.10))
        #endif
    }

    /// Extra bottom padding for the home indicator on iOS.
    private var bottomPadding: CGFloat {
        #if os(iOS)
        let scenes = UIApplication.shared.connectedScenes
        let windowScene = scenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
        let safeBottom = windowScene?.windows.first?.safeAreaInsets.bottom ?? 0
        return max(safeBottom, 8)
        #else
        return 8
        #endif
    }
}
