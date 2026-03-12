import SwiftUI
import Charts

/// Main dashboard — institutional-grade system-at-a-glance with live data.
struct DashboardView: View {
    @EnvironmentObject var appState: AppState
    @State private var showingSettings = false
    @State private var chartAnimated = false
    @State private var chartRange = 30

    var body: some View {
        NavigationStack {
            ZStack {
                Color(red: 0.04, green: 0.04, blue: 0.06).ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 14) {
                        ConnectionStatusBar()

                        if let s = appState.summary {
                            // System Status Banner
                            systemBanner(s)
                                .staggered(index: 0)

                            // Hero Equity Chart
                            if let snapshots = appState.capital?.treasury?.dailySnapshots, snapshots.count >= 2 {
                                equityCurveChart(snapshots)
                                    .staggered(index: 1)
                            }

                            // Hero KPIs
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                KPICard("Total Equity", value: FF.usd(s.equity?.current), trend: nil, color: FFDesign.accent, icon: "dollarsign.circle.fill")
                                    .staggered(index: 2)
                                KPICard("Daily P&L", value: FF.pnl(s.pnl?.daily), trend: pnlTrend(s.pnl?.daily), color: FF.pnlColor(s.pnl?.daily), icon: "chart.line.uptrend.xyaxis")
                                    .staggered(index: 3)
                            }

                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                KPICard("30d P&L", value: FF.pnl(s.pnl?.total30d), trend: pnlTrend(s.pnl?.total30d), color: FF.pnlColor(s.pnl?.total30d), icon: "calendar")
                                    .staggered(index: 4)
                                KPICard("Drawdown", value: FF.pct(s.equity?.drawdownPct), color: drawdownColor(s.equity?.drawdownPct), icon: "arrow.down.right")
                                    .staggered(index: 5)
                            }

                            // Trading Performance
                            SectionHeader(title: "Trading", icon: "arrow.left.arrow.right.circle")
                                .staggered(index: 6)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Win Rate", value: FF.pct(s.trading?.winRate), color: (s.trading?.winRate ?? 0) >= 50 ? FFDesign.positive : FFDesign.warning, icon: "target")
                                    .staggered(index: 7)
                                MetricCard("Sharpe", value: FF.ratio(s.trading?.sharpe), color: (s.trading?.sharpe ?? 0) >= 1 ? FFDesign.positive : FFDesign.warning, icon: "waveform")
                                    .staggered(index: 8)
                                MetricCard("Trades", value: FF.num(s.trading?.totalTrades30d), subtitle: "\(FF.num(s.trading?.openTrades)) open", icon: "number")
                                    .staggered(index: 9)
                            }

                            // Risk & Exposure
                            SectionHeader(title: "Risk", icon: "shield.lefthalf.filled")
                                .staggered(index: 10)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Exposure", value: FF.usd(s.risk?.exposure), subtitle: "of \(FF.usd(s.risk?.maxExposure))", color: FFDesign.accent, icon: "chart.bar.fill")
                                    .staggered(index: 11)
                                MetricCard("Utilization", value: FF.pct(s.risk?.utilizationPct), color: utilizationColor(s.risk?.utilizationPct), icon: "gauge.with.needle")
                                    .staggered(index: 12)
                            }
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Positions", value: FF.num(s.risk?.positions), color: FFDesign.accent, icon: "tray.full.fill")
                                    .staggered(index: 13)
                                killSwitchCard(s.risk?.killSwitch)
                                    .staggered(index: 14)
                            }

                            // Capital & Brain Intelligence
                            SectionHeader(title: "Capital & Brain", icon: "brain.head.profile")
                                .staggered(index: 15)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Mode", value: (s.capital?.mode ?? "unknown").uppercased(), color: FF.modeColor(s.capital?.mode), icon: "speedometer")
                                    .staggered(index: 16)
                                MetricCard("ROI", value: FF.pct(s.capital?.roi), color: FF.pnlColor(s.capital?.roi), icon: "percent")
                                    .staggered(index: 17)
                                MetricCard("Brain Gen", value: FF.num(s.brain?.generation), subtitle: "Cal: \(FF.ratio(s.brain?.calibration))", icon: "dna")
                                    .staggered(index: 18)
                            }

                            // Margin Health
                            SectionHeader(title: "Margin", icon: "chart.bar.xaxis")
                                .staggered(index: 19)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                marginSummaryCard("Coinbase", margin: s.margin?.coinbase, icon: "building.columns.fill")
                                    .staggered(index: 20)
                                marginSummaryCard("Kraken", margin: s.margin?.kraken, icon: "water.waves")
                                    .staggered(index: 21)
                            }

                            // Signals
                            SectionHeader(title: "Signals", icon: "antenna.radiowaves.left.and.right")
                                .staggered(index: 22)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Active", value: FF.num(s.signals?.total), color: FFDesign.premium, icon: "dot.radiowaves.left.and.right")
                                    .staggered(index: 23)
                                MetricCard("Types", value: FF.num(s.signals?.types), color: FFDesign.premium, icon: "list.bullet")
                                    .staggered(index: 24)
                            }

                        } else if let err = appState.lastError {
                            ConnectionErrorView(error: err) { appState.refreshAll() }
                        } else {
                            // Skeleton loading
                            VStack(spacing: 14) {
                                SkeletonCard(height: 60)
                                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                    SkeletonCard(height: 100)
                                    SkeletonCard(height: 100)
                                }
                                SkeletonCard(height: 180)
                                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                    SkeletonCard(height: 80)
                                    SkeletonCard(height: 80)
                                    SkeletonCard(height: 80)
                                }
                            }
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

    // MARK: - Hero Equity Curve Chart

    @ViewBuilder
    private func equityCurveChart(_ allSnapshots: [CapitalData.DailySnapshot]) -> some View {
        let snapshots = filteredSnapshots(allSnapshots)
        let lastCapital = snapshots.last?.capital
        let dailyPnl = appState.summary?.pnl?.daily

        PremiumCard(highlighted: true) {
            VStack(alignment: .leading, spacing: 12) {
                // Header: equity value + daily P&L badge
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("PORTFOLIO VALUE")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(FFDesign.textTertiary)
                            .tracking(0.8)
                        Text(FF.usd(lastCapital))
                            .font(.system(size: 32, weight: .bold, design: .monospaced))
                            .foregroundColor(FFDesign.textPrimary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                    }
                    Spacer()
                    if let pnl = dailyPnl {
                        let isPositive = pnl >= 0
                        HStack(spacing: 4) {
                            Image(systemName: isPositive ? "arrow.up.right" : "arrow.down.right")
                                .font(.system(size: 10, weight: .bold))
                            Text(FF.pnl(pnl))
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(isPositive ? FFDesign.positive : FFDesign.negative)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            (isPositive ? FFDesign.positive : FFDesign.negative).opacity(0.12)
                        )
                        .clipShape(Capsule())
                    }
                }

                // Chart
                if snapshots.count >= 2 {
                    let capitalValues = snapshots.compactMap { $0.capital }
                    let minVal = (capitalValues.min() ?? 0) * 0.998
                    let maxVal = (capitalValues.max() ?? 0) * 1.002
                    let firstDate = snapshots.first?.date ?? ""
                    let lastDate = snapshots.last?.date ?? ""

                    Chart {
                        ForEach(Array(snapshots.enumerated()), id: \.offset) { index, snap in
                            let xVal = index
                            let yVal = snap.capital ?? 0

                            AreaMark(
                                x: .value("Day", xVal),
                                yStart: .value("Base", minVal),
                                yEnd: .value("Capital", yVal)
                            )
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [FFDesign.accent.opacity(0.3), FFDesign.accent.opacity(0.05), Color.clear],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                            .interpolationMethod(.catmullRom)

                            LineMark(
                                x: .value("Day", xVal),
                                y: .value("Capital", yVal)
                            )
                            .foregroundStyle(FFDesign.accent)
                            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                            .interpolationMethod(.catmullRom)
                        }
                    }
                    .chartXScale(domain: 0 ... max(snapshots.count - 1, 1))
                    .chartYScale(domain: minVal ... maxVal)
                    .chartXAxis {
                        AxisMarks(values: [0, max(snapshots.count - 1, 1)]) { value in
                            AxisValueLabel {
                                if let idx = value.as(Int.self) {
                                    Text(idx == 0 ? formatDateLabel(firstDate) : formatDateLabel(lastDate))
                                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                                        .foregroundColor(FFDesign.textTertiary)
                                }
                            }
                        }
                    }
                    .chartYAxis(.hidden)
                    .chartLegend(.hidden)
                    .frame(height: 160)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .mask(
                        Rectangle()
                            .scaleEffect(x: chartAnimated ? 1 : 0, anchor: .leading)
                    )
                    .onAppear {
                        withAnimation(.easeOut(duration: 1.0).delay(0.3)) {
                            chartAnimated = true
                        }
                    }
                }

                // Time range selector pills
                HStack(spacing: 8) {
                    chartRangePill("7D", days: 7)
                    chartRangePill("30D", days: 30)
                    chartRangePill("ALL", days: 0)
                    Spacer()
                    Text("\(filteredSnapshots(allSnapshots).count) days")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(FFDesign.textTertiary)
                }
            }
        }
    }

    @ViewBuilder
    private func chartRangePill(_ label: String, days: Int) -> some View {
        let isSelected = chartRange == days
        Button {
            withAnimation(.easeInOut(duration: 0.25)) {
                chartRange = days
                // Reset chart animation for new range
                chartAnimated = false
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                withAnimation(.easeOut(duration: 0.8)) {
                    chartAnimated = true
                }
            }
        } label: {
            Text(label)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(0.5)
                .foregroundColor(isSelected ? FFDesign.accent : FFDesign.textTertiary)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(
                    isSelected
                        ? FFDesign.accent.opacity(0.12)
                        : Color.white.opacity(0.04)
                )
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(isSelected ? FFDesign.accent.opacity(0.3) : Color.clear, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func filteredSnapshots(_ snapshots: [CapitalData.DailySnapshot]) -> [CapitalData.DailySnapshot] {
        guard chartRange > 0 else { return snapshots }
        return Array(snapshots.suffix(chartRange))
    }

    private func formatDateLabel(_ dateStr: String) -> String {
        // Parse "YYYY-MM-DD" and return "MMM DD"
        let parts = dateStr.split(separator: "-")
        guard parts.count >= 3 else { return dateStr }
        let months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        let monthIdx = Int(parts[1]) ?? 0
        let day = String(parts[2])
        if monthIdx > 0 && monthIdx <= 12 {
            return "\(months[monthIdx]) \(day)"
        }
        return dateStr
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
