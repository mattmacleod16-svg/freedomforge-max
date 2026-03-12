import SwiftUI

// MARK: - More Menu Item

private struct MoreMenuItem: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let destination: MoreDestination
}

private enum MoreDestination {
    case brain
    case signals
    case infrastructure
    case settings
}

// MARK: - More View

struct MoreView: View {
    @EnvironmentObject var appState: AppState

    private let menuItems: [MoreMenuItem] = [
        MoreMenuItem(
            title: "Brain & ML",
            subtitle: "Neural predictions, model performance, and live inference",
            icon: "brain.head.profile",
            color: FFDesign.premium,
            destination: .brain
        ),
        MoreMenuItem(
            title: "Signals & Events",
            subtitle: "Real-time signal bus, event stream, and agent messages",
            icon: "antenna.radiowaves.left.and.right",
            color: FFDesign.accent,
            destination: .signals
        ),
        MoreMenuItem(
            title: "Infrastructure",
            subtitle: "Server health, uptime, service status, and latency",
            icon: "server.rack",
            color: FFDesign.positive,
            destination: .infrastructure
        ),
        MoreMenuItem(
            title: "Settings",
            subtitle: "Server connection, notifications, and app preferences",
            icon: "gearshape.fill",
            color: FFDesign.textSecondary,
            destination: .settings
        )
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(menuItems) { item in
                        NavigationLink {
                            destinationView(for: item.destination)
                        } label: {
                            moreRow(item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 32)
            }
            .background(FFDesign.background.ignoresSafeArea())
            .navigationTitle("More")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    // MARK: - Row

    @ViewBuilder
    private func moreRow(_ item: MoreMenuItem) -> some View {
        PremiumCard {
            HStack(spacing: 14) {
                // Icon badge
                Image(systemName: item.icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(item.color)
                    .frame(width: 40, height: 40)
                    .background(item.color.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                // Title and subtitle
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(FFDesign.textPrimary)

                    Text(item.subtitle)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundColor(FFDesign.textTertiary)
                        .lineLimit(2)
                }

                Spacer(minLength: 4)

                // Chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(FFDesign.textTertiary)
            }
        }
    }

    // MARK: - Destination Router

    @ViewBuilder
    private func destinationView(for destination: MoreDestination) -> some View {
        switch destination {
        case .brain:
            BrainView()
        case .signals:
            SignalsView()
        case .infrastructure:
            InfrastructureView()
        case .settings:
            SettingsView()
        }
    }
}
