import SwiftUI
import Charts

/// Main dashboard — institutional-grade system-at-a-glance with live data.
struct DashboardView: View {
    @EnvironmentObject var appState: AppState
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 14) {
                        ConnectionStatusBar()

                        if let s = appState.summary {
                            // System Status Banner
                            systemBanner(s)

                            // Hero KPIs
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                KPICard("Total Equity", value: FF.usd(s.equity?.current), trend: nil, color: FFDesign.accent, icon: "dollarsign.circle.fill")
                                KPICard("Daily P&L", value: FF.pnl(s.pnl?.daily), trend: pnlTrend(s.pnl?.daily), color: FF.pnlColor(s.pnl?.daily), icon: "chart.line.uptrend.xyaxis")
                            }

                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                KPICard("30d P&L", value: FF.pnl(s.pnl?.total30d), trend: pnlTrend(s.pnl?.total30d), color: FF.pnlColor(s.pnl?.total30d), icon: "calendar")
                                KPICard("Drawdown", value: FF.pct(s.equity?.drawdownPct), color: drawdownColor(s.equity?.drawdownPct), icon: "arrow.down.right")
                            }

                            // Trading Performance
                            SectionHeader(title: "Trading", icon: "arrow.left.arrow.right.circle")
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Win Rate", value: FF.pct(s.trading?.winRate), color: (s.trading?.winRate ?? 0) >= 50 ? FFDesign.positive : FFDesign.warning, icon: "target")
                                MetricCard("Sharpe", value: FF.ratio(s.trading?.sharpe), color: (s.trading?.sharpe ?? 0) >= 1 ? FFDesign.positive : FFDesign.warning, icon: "waveform")
                                MetricCard("Trades", value: FF.num(s.trading?.totalTrades30d), subtitle: "\(FF.num(s.trading?.openTrades)) open", icon: "number")
                            }

                            // Risk & Exposure
                            SectionHeader(title: "Risk", icon: "shield.lefthalf.filled")
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Exposure", value: FF.usd(s.risk?.exposure), subtitle: "of \(FF.usd(s.risk?.maxExposure))", color: FFDesign.accent, icon: "chart.bar.fill")
                                MetricCard("Utilization", value: FF.pct(s.risk?.utilizationPct), color: utilizationColor(s.risk?.utilizationPct), icon: "gauge.with.needle")
                            }
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Positions", value: FF.num(s.risk?.positions), color: FFDesign.accent, icon: "tray.full.fill")
                                killSwitchCard(s.risk?.killSwitch)
                            }

                            // Capital & Brain Intelligence
                            SectionHeader(title: "Capital & Brain", icon: "brain.head.profile")
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Mode", value: (s.capital?.mode ?? "unknown").uppercased(), color: FF.modeColor(s.capital?.mode), icon: "speedometer")
                                MetricCard("ROI", value: FF.pct(s.capital?.roi), color: FF.pnlColor(s.capital?.roi), icon: "percent")
                                MetricCard("Brain Gen", value: FF.num(s.brain?.generation), subtitle: "Cal: \(FF.ratio(s.brain?.calibration))", icon: "dna")
                            }

                            // Margin Health
                            SectionHeader(title: "Margin", icon: "chart.bar.xaxis")
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                marginSummaryCard("Coinbase", margin: s.margin?.coinbase, icon: "building.columns.fill")
                                marginSummaryCard("Kraken", margin: s.margin?.kraken, icon: "water.waves")
                            }

                            // Signals
                            SectionHeader(title: "Signals", icon: "antenna.radiowaves.left.and.right")
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Active", value: FF.num(s.signals?.total), color: FFDesign.premium, icon: "dot.radiowaves.left.and.right")
                                MetricCard("Types", value: FF.num(s.signals?.types), color: FFDesign.premium, icon: "list.bullet")
                            }

                        } else if let err = appState.lastError {
                            EmptyState(icon: "wifi.slash", message: "Connection error: \(err)")
                        } else {
                            VStack(spacing: 16) {
                                ProgressView()
                                    .tint(FFDesign.accent)
                                    .scaleEffect(1.5)
                                Text("CONNECTING")
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .foregroundColor(FFDesign.textTertiary)
                                    .tracking(2)
                            }
                            .padding(.top, 80)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("FreedomForge")
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    HStack(spacing: 12) {
                        Button(action: { appState.refreshAll() }) {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        .tint(FFDesign.accent)

                        Button(action: { showingSettings = true }) {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        .tint(FFDesign.accent)
                    }
                }
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
                    .environmentObject(appState)
            }
            .refreshable {
                appState.refreshAll()
            }
            .onAppear {
                appState.refresh()
            }
        }
    }

    // MARK: - System Banner

    @ViewBuilder
    private func systemBanner(_ s: SystemSummary) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    LiveDot(color: FF.statusColor(s.system?.status))
                    Text(s.system?.status ?? "UNKNOWN")
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .foregroundColor(FF.statusColor(s.system?.status))
                        .tracking(0.5)
                }
                Text("Uptime: \(FF.uptime(s.system?.uptime))")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(FFDesign.textTertiary)
            }
            Spacer()
            StatusBadge(text: (s.capital?.mode ?? "unknown").uppercased(), color: FF.modeColor(s.capital?.mode))
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(FF.statusColor(s.system?.status).opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(FF.statusColor(s.system?.status).opacity(0.2), lineWidth: 1)
                )
        )
    }

    // MARK: - Kill Switch Card

    @ViewBuilder
    private func killSwitchCard(_ active: Bool?) -> some View {
        let isActive = active ?? false
        MetricCard("Kill Switch",
                    value: isActive ? "ACTIVE" : "OFF",
                    color: isActive ? FFDesign.negative : FFDesign.positive,
                    icon: "power")
    }

    // MARK: - Margin Summary Card

    @ViewBuilder
    private func marginSummaryCard(_ venue: String, margin: SystemSummary.VenueMarginBrief?, icon: String) -> some View {
        let healthy = margin?.healthy ?? true
        let pct = margin?.marginPct ?? 0
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(healthy ? FFDesign.positive.opacity(0.6) : FFDesign.negative.opacity(0.6))
                Text(venue.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(FFDesign.textTertiary)
                    .tracking(0.8)
            }
            HStack(spacing: 6) {
                Text(FF.pct(pct))
                    .font(.system(size: 22, weight: .bold, design: .monospaced))
                    .foregroundColor(healthy ? FFDesign.positive : FFDesign.negative)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Circle()
                    .fill(healthy ? FFDesign.positive : FFDesign.negative)
                    .frame(width: 8, height: 8)
            }
            HorizontalBar(value: pct, maxValue: 100, color: healthy ? FFDesign.positive : FFDesign.negative, height: 4)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(FFDesign.cardGradient)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(FFDesign.border, lineWidth: 1)
                )
        )
    }

    // MARK: - Helpers

    private func pnlTrend(_ value: Double?) -> String? {
        guard let v = value else { return nil }
        if v > 0 { return "+\(String(format: "%.1f%%", v))" }
        if v < 0 { return "\(String(format: "%.1f%%", v))" }
        return nil
    }

    private func drawdownColor(_ pct: Double?) -> Color {
        guard let p = pct else { return .secondary }
        if p > 15 { return FFDesign.negative }
        if p > 10 { return FFDesign.warning }
        return FFDesign.accent
    }

    private func utilizationColor(_ pct: Double?) -> Color {
        guard let p = pct else { return .secondary }
        if p > 80 { return FFDesign.negative }
        if p > 60 { return FFDesign.warning }
        return FFDesign.accent
    }
}
