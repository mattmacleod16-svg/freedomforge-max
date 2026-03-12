import SwiftUI

/// Risk view — VaR, drawdown, kill switch, margin health, risk events.
struct RiskView: View {
    @EnvironmentObject var appState: AppState
    @State private var killSwitchPulseOpacity: Double = 0.3
    @State private var killSwitchIconScale: Double = 1.0

    var body: some View {
        NavigationStack {
            ZStack {
                Color(red: 0.04, green: 0.04, blue: 0.06).ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 14) {
                        ConnectionStatusBar()

                        if let r = appState.risk {
                            // Kill Switch Banner
                            if r.killSwitch?.active == true {
                                killSwitchBanner(reason: r.killSwitch?.reason)
                            }

                            // Health Overview
                            SectionHeader(title: "Risk Health", icon: "heart.text.square")
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                KPICard("Equity", value: FF.usd(r.health?.currentEquity), trend: peakTrend(r.health?.peakEquity), color: FFDesign.accent, icon: "dollarsign.circle.fill")
                                KPICard("Drawdown", value: FF.pct(r.health?.drawdownPct), color: drawdownColor(r.health?.drawdownPct), icon: "arrow.down.right")
                            }
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Daily P&L", value: FF.pnl(r.health?.dailyPnl), subtitle: "Limit: \(FF.usd(r.health?.maxDailyLoss))", color: FF.pnlColor(r.health?.dailyPnl), icon: "chart.line.uptrend.xyaxis")
                                MetricCard("Positions", value: FF.num(r.health?.positionCount), color: FFDesign.accent, icon: "tray.full.fill")
                            }

                            // Exposure
                            SectionHeader(title: "Exposure", icon: "chart.bar")
                            PremiumCard {
                                VStack(spacing: 10) {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("TOTAL EXPOSURE")
                                                .font(.system(size: 10, weight: .bold))
                                                .foregroundColor(FFDesign.textTertiary)
                                                .tracking(0.8)
                                            Text(FF.usd(r.health?.totalExposure))
                                                .font(.system(size: 20, weight: .bold, design: .monospaced))
                                                .foregroundColor(FFDesign.textPrimary)
                                        }
                                        Spacer()
                                        VStack(alignment: .trailing, spacing: 4) {
                                            Text("UTILIZATION")
                                                .font(.system(size: 10, weight: .bold))
                                                .foregroundColor(FFDesign.textTertiary)
                                                .tracking(0.8)
                                            Text(FF.pct(r.health?.utilizationPct))
                                                .font(.system(size: 20, weight: .bold, design: .monospaced))
                                                .foregroundColor(utilizationColor(r.health?.utilizationPct))
                                        }
                                    }
                                    HorizontalBar(
                                        value: r.health?.utilizationPct ?? 0,
                                        maxValue: 100,
                                        color: utilizationColor(r.health?.utilizationPct),
                                        height: 6
                                    )
                                    Text("Max: \(FF.usd(r.health?.maxExposure))")
                                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                                        .foregroundColor(FFDesign.textTertiary)
                                        .frame(maxWidth: .infinity, alignment: .trailing)
                                }
                            }

                            // Margin Health
                            SectionHeader(title: "Margin Health", icon: "gauge")

                            if let cbMargin = appState.margin?.coinbase {
                                marginCard("Coinbase", margin: cbMargin, icon: "building.columns.fill")
                            }
                            if let krMargin = appState.margin?.kraken {
                                marginCard("Kraken", margin: krMargin, icon: "water.waves")
                            }

                            // Emergency Stats
                            if let m = appState.margin {
                                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                    MetricCard("Emergency Closes", value: FF.num(m.emergencyCloses), color: (m.emergencyCloses ?? 0) > 0 ? FFDesign.negative : FFDesign.positive, icon: "xmark.circle.fill")
                                    MetricCard("Blocked Trades", value: FF.num(m.blockedTrades), color: (m.blockedTrades ?? 0) > 0 ? FFDesign.warning : FFDesign.positive, icon: "hand.raised.fill")
                                }
                            }

                            // Recent Risk Events
                            if let events = r.riskEvents, !events.isEmpty {
                                SectionHeader(title: "Risk Events", icon: "exclamationmark.triangle")
                                ForEach(events.suffix(10).reversed().indices, id: \.self) { i in
                                    let event = events[i]
                                    PremiumCard(highlighted: true, highlightColor: FFDesign.warning) {
                                        HStack(spacing: 10) {
                                            Image(systemName: "exclamationmark.triangle.fill")
                                                .font(.system(size: 12, weight: .semibold))
                                                .foregroundColor(FFDesign.warning)
                                                .frame(width: 28, height: 28)
                                                .background(FFDesign.warning.opacity(0.12))
                                                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(event.type ?? "Unknown")
                                                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                                                    .foregroundColor(FFDesign.textPrimary)
                                                Text(event.reason ?? "")
                                                    .font(.system(size: 11, weight: .medium))
                                                    .foregroundColor(FFDesign.textTertiary)
                                                    .lineLimit(2)
                                            }
                                            Spacer()
                                            Text(FF.timeAgo(event.ts))
                                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                                .foregroundColor(FFDesign.textTertiary)
                                        }
                                    }
                                }
                            }

                        } else {
                            // Skeleton loading placeholders
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                SkeletonCard(height: 80)
                                SkeletonCard(height: 80)
                            }
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                SkeletonCard(height: 60)
                                SkeletonCard(height: 60)
                            }
                            SkeletonCard(height: 90)
                            SkeletonCard(height: 80)
                            SkeletonCard(height: 80)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("Risk")
            .refreshable {
                appState.risk = try? await APIClient.shared.get("/api/risk")
                appState.margin = try? await APIClient.shared.get("/api/margin")
            }
            .onAppear {
                if appState.risk == nil {
                    Task {
                        appState.risk = try? await APIClient.shared.get("/api/risk")
                        appState.margin = try? await APIClient.shared.get("/api/margin")
                    }
                }
            }
        }
    }

    // MARK: - Kill Switch Banner

    @ViewBuilder
    func killSwitchBanner(reason: String?) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.octagon.fill")
                    .font(.system(size: 22, weight: .bold))
                    .scaleEffect(killSwitchIconScale)
                Text("KILL SWITCH ACTIVE")
                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                    .tracking(1)
            }
            .foregroundColor(FFDesign.negative)
            if let reason = reason {
                Text(reason)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(FFDesign.negative.opacity(0.7))
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(FFDesign.killGradient)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(FFDesign.negative.opacity(killSwitchPulseOpacity), lineWidth: 2)
                )
        )
        .onAppear {
            HapticManager.error()
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                killSwitchPulseOpacity = 0.8
                killSwitchIconScale = 1.15
            }
        }
    }

    // MARK: - Margin Card

    @ViewBuilder
    func marginCard(_ venue: String, margin: MarginData.VenueMargin, icon: String) -> some View {
        let h = margin.health
        let healthy = h?.healthy ?? true
        let marginPct = h?.marginPct ?? 0

        PremiumCard(highlighted: true, highlightColor: healthy ? FFDesign.positive : FFDesign.negative) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    HStack(spacing: 8) {
                        Image(systemName: icon)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(healthy ? FFDesign.positive : FFDesign.negative)
                            .frame(width: 28, height: 28)
                            .background((healthy ? FFDesign.positive : FFDesign.negative).opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        Text(venue)
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundColor(FFDesign.textPrimary)
                    }
                    Spacer()
                    Text(FF.pct(marginPct))
                        .font(.system(size: 18, weight: .bold, design: .monospaced))
                        .foregroundColor(marginColor(marginPct))
                }

                HorizontalBar(value: marginPct, maxValue: 100, color: marginColor(marginPct), height: 6)

                if let positions = h?.positions, !positions.isEmpty {
                    Text("\(positions.count) positions")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(FFDesign.textTertiary)
                }
            }
        }
    }

    // MARK: - Helpers

    private func peakTrend(_ peak: Double?) -> String? {
        guard let p = peak else { return nil }
        return "Peak: \(FF.usd(p))"
    }

    private func drawdownColor(_ pct: Double?) -> Color {
        guard let p = pct else { return .secondary }
        if p > 15 { return FFDesign.negative }
        if p > 10 { return FFDesign.warning }
        return FFDesign.accent
    }

    private func marginColor(_ pct: Double) -> Color {
        if pct >= 85 { return FFDesign.negative }
        if pct >= 70 { return FFDesign.warning }
        if pct >= 50 { return Color.yellow }
        return FFDesign.positive
    }

    private func utilizationColor(_ pct: Double?) -> Color {
        guard let pct = pct else { return .secondary }
        if pct >= 80 { return FFDesign.negative }
        if pct >= 60 { return FFDesign.warning }
        return FFDesign.accent
    }
}
