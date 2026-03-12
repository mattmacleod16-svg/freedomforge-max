import SwiftUI

/// Trades view — journal, stats, recent activity — institutional dark design.
struct TradesView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedTab = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                VStack(spacing: 0) {
                    ConnectionStatusBar()

                    // Segmented Control
                    Picker("View", selection: $selectedTab) {
                        Text("Recent").tag(0)
                        Text("Stats").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)

                    if selectedTab == 0 {
                        recentTradesView
                    } else {
                        statsView
                    }
                }
            }
            .navigationTitle("Trades")
            .refreshable {
                appState.trades = try? await APIClient.shared.get("/api/trades?limit=50&days=30")
            }
            .onAppear {
                if appState.trades == nil {
                    Task { appState.trades = try? await APIClient.shared.get("/api/trades?limit=50&days=30") }
                }
            }
        }
    }

    // MARK: - Recent Trades

    var recentTradesView: some View {
        ScrollView {
            if let trades = appState.trades?.trades, !trades.isEmpty {
                LazyVStack(spacing: 8) {
                    ForEach(trades, id: \.displayId) { trade in
                        TradeRow(trade: trade)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 20)
            } else {
                EmptyState(icon: "tray", message: "No trades found")
            }
        }
    }

    // MARK: - Statistics

    var statsView: some View {
        ScrollView {
            if let stats = appState.trades?.stats {
                VStack(spacing: 14) {
                    // Performance Hero
                    SectionHeader(title: "Performance", icon: "chart.bar")
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        KPICard("Win Rate", value: FF.pct(stats.winRate), color: (stats.winRate ?? 0) >= 50 ? FFDesign.positive : FFDesign.negative, icon: "target")
                        KPICard("Profit Factor", value: FF.ratio(stats.profitFactor), color: (stats.profitFactor ?? 0) >= 1 ? FFDesign.positive : FFDesign.negative, icon: "divide")
                    }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        MetricCard("Sharpe", value: FF.ratio(stats.sharpeRatio), color: (stats.sharpeRatio ?? 0) >= 1 ? FFDesign.positive : FFDesign.warning, icon: "waveform")
                        MetricCard("Max Drawdown", value: FF.usd(stats.maxDrawdown), color: FFDesign.negative, icon: "arrow.down.to.line")
                    }

                    // Volume
                    SectionHeader(title: "Volume", icon: "arrow.up.arrow.down")
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        MetricCard("Total", value: FF.num(stats.totalTrades), icon: "number")
                        MetricCard("Closed", value: FF.num(stats.closedTrades), icon: "checkmark.circle")
                        MetricCard("Open", value: FF.num(stats.openTrades), color: FFDesign.accent, icon: "clock")
                    }

                    // P&L Breakdown
                    SectionHeader(title: "P&L Breakdown", icon: "dollarsign.circle")
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        KPICard("Total P&L", value: FF.pnl(stats.totalPnl), color: FF.pnlColor(stats.totalPnl), icon: "dollarsign.circle.fill")
                        MetricCard("Total Fees", value: FF.usd(stats.totalFees), color: FFDesign.warning, icon: "banknote")
                    }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        MetricCard("Avg Win", value: FF.usd(stats.avgWin), color: FFDesign.positive, icon: "arrow.up.right")
                        MetricCard("Avg Loss", value: FF.usd(stats.avgLoss), color: FFDesign.negative, icon: "arrow.down.right")
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 20)
            } else {
                EmptyState(icon: "chart.bar", message: "No stats available")
            }
        }
    }
}

// MARK: - Trade Row

struct TradeRow: View {
    let trade: Trade

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header: Side + Asset + P&L
            HStack {
                HStack(spacing: 8) {
                    StatusBadge(text: (trade.side ?? "?").uppercased(), color: FF.sideColor(trade.side))
                    Text(trade.asset ?? "Unknown")
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                        .foregroundColor(FFDesign.textPrimary)
                }

                Spacer()

                if trade.closedAt != nil {
                    Text(FF.pnl(trade.pnl))
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                        .foregroundColor(FF.pnlColor(trade.pnl))
                } else {
                    StatusBadge(text: "OPEN", color: FFDesign.accent)
                }
            }

            // Entry details
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: venueIcon(trade.venue))
                        .font(.system(size: 9))
                        .foregroundColor(FFDesign.textTertiary)
                    Text(trade.venue ?? "?")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(FFDesign.textTertiary)
                }

                Spacer()

                Text("Entry: \(String(format: "$%.2f", trade.entryPrice ?? 0))")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(FFDesign.textSecondary)

                if let conf = trade.signal?.confidence {
                    Text("\(String(format: "%.0f%%", conf * 100))")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(FFDesign.accent.opacity(0.12))
                        .foregroundColor(FFDesign.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                }
            }

            // Size + Dry Run + Time
            HStack {
                Text("Size: \(FF.usd(trade.usdSize))")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(FFDesign.textTertiary)

                if trade.dryRun == true {
                    StatusBadge(text: "DRY RUN", color: FFDesign.premium)
                }

                Spacer()

                Text(FF.timeAgo(trade.entryTs))
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(FFDesign.textTertiary)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(FFDesign.cardGradient)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(tradeRowBorder, lineWidth: 1)
                )
        )
    }

    private var tradeRowBorder: Color {
        if trade.closedAt != nil {
            if let pnl = trade.pnl {
                return pnl > 0 ? FFDesign.positive.opacity(0.15) : FFDesign.negative.opacity(0.15)
            }
        }
        return FFDesign.border
    }

    private func venueIcon(_ venue: String?) -> String {
        switch venue?.lowercased() {
        case "coinbase": return "building.columns.fill"
        case "kraken": return "water.waves"
        case "alpaca": return "chart.line.uptrend.xyaxis"
        default: return "building.2"
        }
    }
}
