import SwiftUI

/// Portfolio view — positions, exposure breakdown, VaR, correlation.
struct PortfolioView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 14) {
                        ConnectionStatusBar()

                        if let p = appState.portfolio {
                            // Exposure Hero
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                KPICard("Total Exposure", value: FF.usd(p.exposure?.totalExposure), color: FFDesign.accent, icon: "chart.pie.fill")
                                KPICard("Net Exposure", value: FF.usd(p.exposure?.netExposure), trend: netTrend(p.exposure?.netExposure), color: FF.pnlColor(p.exposure?.netExposure), icon: "arrow.up.arrow.down")
                            }

                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Long", value: FF.usd(p.exposure?.totalLong), color: FFDesign.positive, icon: "arrow.up.right")
                                MetricCard("Short", value: FF.usd(p.exposure?.totalShort), color: FFDesign.negative, icon: "arrow.down.right")
                            }

                            // Per-Asset Exposure
                            if let assets = p.exposure?.assetExposure, !assets.isEmpty {
                                SectionHeader(title: "By Asset", icon: "bitcoinsign.circle")
                                ForEach(assets.sorted(by: { abs($0.value) > abs($1.value) }), id: \.key) { asset, exposure in
                                    PremiumCard {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(asset)
                                                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                                                    .foregroundColor(FFDesign.textPrimary)
                                                HorizontalBar(
                                                    value: abs(exposure),
                                                    maxValue: abs(p.exposure?.totalExposure ?? 1),
                                                    color: exposure >= 0 ? FFDesign.positive : FFDesign.negative,
                                                    height: 4
                                                )
                                            }
                                            Spacer()
                                            Text(FF.usd(exposure))
                                                .font(.system(size: 15, weight: .bold, design: .monospaced))
                                                .foregroundColor(exposure >= 0 ? FFDesign.positive : FFDesign.negative)
                                        }
                                    }
                                }
                            }

                            // Per-Venue Exposure
                            if let venues = p.exposure?.venueExposure, !venues.isEmpty {
                                SectionHeader(title: "By Venue", icon: "building.2")
                                ForEach(venues.sorted(by: { $0.value > $1.value }), id: \.key) { venue, exposure in
                                    PremiumCard {
                                        HStack {
                                            HStack(spacing: 8) {
                                                Image(systemName: venueIcon(venue))
                                                    .font(.system(size: 12, weight: .semibold))
                                                    .foregroundColor(FFDesign.accent)
                                                    .frame(width: 28, height: 28)
                                                    .background(FFDesign.accent.opacity(0.12))
                                                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                                                Text(venue.capitalized)
                                                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                                    .foregroundColor(FFDesign.textPrimary)
                                            }
                                            Spacer()
                                            Text(FF.usd(exposure))
                                                .font(.system(size: 15, weight: .bold, design: .monospaced))
                                                .foregroundColor(FFDesign.accent)
                                        }
                                    }
                                }
                            }

                            // Diversification Score
                            SectionHeader(title: "Diversification", icon: "circle.grid.cross")
                            PremiumCard(highlighted: true, highlightColor: diversColor(p.correlation?.diversificationScore)) {
                                HStack(spacing: 16) {
                                    ProgressRing(
                                        progress: (p.correlation?.diversificationScore ?? 0) / 100.0,
                                        color: diversColor(p.correlation?.diversificationScore),
                                        size: 80,
                                        label: "Score"
                                    )
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("DIVERSIFICATION")
                                            .font(.system(size: 10, weight: .bold))
                                            .foregroundColor(FFDesign.textTertiary)
                                            .tracking(1)
                                        Text("\(Int(p.correlation?.diversificationScore ?? 0)) / 100")
                                            .font(.system(size: 24, weight: .bold, design: .monospaced))
                                            .foregroundColor(diversColor(p.correlation?.diversificationScore))
                                        Text(diversLabel(p.correlation?.diversificationScore))
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundColor(FFDesign.textSecondary)
                                    }
                                    Spacer()
                                }
                            }

                            // Correlation Alerts
                            if let alerts = p.correlation?.alerts, !alerts.isEmpty {
                                SectionHeader(title: "Correlation Alerts", icon: "exclamationmark.triangle")
                                ForEach(alerts.indices, id: \.self) { i in
                                    let alert = alerts[i]
                                    PremiumCard(highlighted: true, highlightColor: alert.severity == "critical" ? FFDesign.negative : FFDesign.warning) {
                                        HStack(spacing: 10) {
                                            Image(systemName: "exclamationmark.triangle.fill")
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundColor(alert.severity == "critical" ? FFDesign.negative : FFDesign.warning)
                                            Text(alert.message ?? "Unknown alert")
                                                .font(.system(size: 12, weight: .medium))
                                                .foregroundColor(FFDesign.textSecondary)
                                            Spacer()
                                        }
                                    }
                                }
                            }

                        } else {
                            EmptyState(icon: "chart.pie", message: "Pull to refresh portfolio data")
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("Portfolio")
            .refreshable {
                appState.portfolio = try? await APIClient.shared.get("/api/portfolio")
            }
            .onAppear {
                if appState.portfolio == nil {
                    Task { appState.portfolio = try? await APIClient.shared.get("/api/portfolio") }
                }
            }
        }
    }

    // MARK: - Helpers

    private func netTrend(_ value: Double?) -> String? {
        guard let v = value else { return nil }
        if v > 0 { return "+\(FF.usd(v))" }
        if v < 0 { return FF.usd(v) }
        return nil
    }

    private func diversColor(_ score: Double?) -> Color {
        guard let s = score else { return .secondary }
        if s > 70 { return FFDesign.positive }
        if s > 40 { return FFDesign.warning }
        return FFDesign.negative
    }

    private func diversLabel(_ score: Double?) -> String {
        guard let s = score else { return "No data" }
        if s > 70 { return "Well diversified" }
        if s > 40 { return "Moderate concentration" }
        return "High concentration risk"
    }

    private func venueIcon(_ venue: String) -> String {
        switch venue.lowercased() {
        case "coinbase": return "building.columns.fill"
        case "kraken": return "water.waves"
        case "alpaca": return "chart.line.uptrend.xyaxis"
        default: return "building.2"
        }
    }
}
