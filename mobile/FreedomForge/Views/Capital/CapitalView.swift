import SwiftUI

/// Capital & Treasury view — mandate stats, capital breakdown, lifetime ledger, daily history.
struct CapitalView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedTab = 0

    var body: some View {
        NavigationStack {
            ZStack {
                FFDesign.background.ignoresSafeArea()

                VStack(spacing: 0) {
                    ConnectionStatusBar()

                    Picker("View", selection: $selectedTab) {
                        Text("Overview").tag(0)
                        Text("Treasury").tag(1)
                        Text("History").tag(2)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)

                    ScrollView {
                        switch selectedTab {
                        case 0: overviewTab
                        case 1: treasuryTab
                        case 2: historyTab
                        default: EmptyView()
                        }
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: selectedTab)
            }
            .navigationTitle("Capital")
            .refreshable {
                appState.capital = try? await APIClient.shared.get("/api/capital")
            }
            .onAppear {
                if appState.capital == nil {
                    Task { appState.capital = try? await APIClient.shared.get("/api/capital") }
                }
            }
        }
    }

    // MARK: - Overview Tab

    var overviewTab: some View {
        VStack(spacing: 14) {
            if let c = appState.capital {
                // Hero: Total Capital + Mode
                if let cap = c.capital {
                    PremiumCard(highlighted: true) {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("TOTAL CAPITAL")
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundColor(FFDesign.textTertiary)
                                        .tracking(0.8)
                                    Text(FF.usd(cap.total))
                                        .font(.system(size: 34, weight: .bold, design: .monospaced))
                                        .foregroundColor(FFDesign.textPrimary)
                                        .contentTransition(.numericText())
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.5)
                                }
                                Spacer()
                                if let mode = c.mandate?.mode {
                                    StatusBadge(text: mode.uppercased(), color: FF.modeColor(mode))
                                }
                            }
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                                venueCapCard("Coinbase", amount: cap.coinbase, icon: "building.columns.fill")
                                venueCapCard("Kraken", amount: cap.kraken, icon: "water.waves")
                            }
                        }
                    }
                }

                // Mandate KPIs
                if let m = c.mandate {
                    SectionHeader(title: "Mandate", icon: "doc.text.fill")

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        KPICard("ROI", value: FF.pct(m.roiPct), trend: nil,
                                color: FF.pnlColor(m.roiPct), icon: "percent")
                        KPICard("High-Water Mark", value: FF.usd(m.highWaterMark), trend: nil,
                                color: FFDesign.gold, icon: "arrow.up.to.line")
                    }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        MetricCard("Initial Capital", value: FF.usd(m.initialCapital), icon: "banknote")
                        MetricCard("Low-Water Mark", value: FF.usd(m.lowWaterMark), color: FFDesign.warning, icon: "arrow.down.to.line")
                    }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        MetricCard("Days Active", value: FF.num(m.totalDaysActive), icon: "calendar")
                        MetricCard("Win Days", value: FF.num(m.consecutiveWinDays), color: FFDesign.positive, icon: "flame.fill")
                        MetricCard("Loss Days", value: FF.num(m.consecutiveLossDays), color: FFDesign.negative, icon: "minus.circle")
                    }

                    if (m.tradeDenials ?? 0) > 0 || (m.capitalHaltEvents ?? 0) > 0 || (m.survivalModeEntries ?? 0) > 0 {
                        SectionHeader(title: "Guardrail Events", icon: "exclamationmark.triangle")
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                            MetricCard("Trade Denials", value: FF.num(m.tradeDenials), color: FFDesign.warning, icon: "hand.raised.fill")
                            MetricCard("Capital Halts", value: FF.num(m.capitalHaltEvents), color: FFDesign.negative, icon: "pause.circle.fill")
                            MetricCard("Survival Mode", value: FF.num(m.survivalModeEntries), color: FFDesign.warning, icon: "lifepreserver.fill")
                        }
                    }
                }

            } else {
                SkeletonCard(height: 120)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    SkeletonCard(height: 90)
                    SkeletonCard(height: 90)
                }
                SkeletonCard(height: 80)
                SkeletonCard(height: 80)
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 20)
    }

    // MARK: - Treasury Tab

    var treasuryTab: some View {
        VStack(spacing: 14) {
            if let t = appState.capital?.treasury {
                // Lifetime P&L hero
                PremiumCard(highlighted: true, highlightColor: FF.pnlColor(t.lifetimePnl)) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("LIFETIME P&L")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(FFDesign.textTertiary)
                            .tracking(0.8)
                        Text(FF.pnl(t.lifetimePnl))
                            .font(.system(size: 34, weight: .bold, design: .monospaced))
                            .foregroundColor(FF.pnlColor(t.lifetimePnl))
                            .contentTransition(.numericText())

                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            ledgerRow("Gross Profit", value: FF.usd(t.lifetimeGrossProfit), color: FFDesign.positive)
                            ledgerRow("Gross Loss", value: FF.usd(t.lifetimeGrossLoss), color: FFDesign.negative)
                        }
                    }
                }

                // Trade counts
                SectionHeader(title: "Trade Record", icon: "arrow.left.arrow.right")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    MetricCard("Lifetime Trades", value: FF.num(t.lifetimeTrades), icon: "number")
                    MetricCard("Wins", value: FF.num(t.lifetimeWins), color: FFDesign.positive, icon: "checkmark.circle.fill")
                    MetricCard("Losses", value: FF.num(t.lifetimeLosses), color: FFDesign.negative, icon: "xmark.circle.fill")
                }

                if let wins = t.lifetimeWins, let losses = t.lifetimeLosses, (wins + losses) > 0 {
                    let winRate = Double(wins) / Double(wins + losses) * 100
                    MetricCard("All-Time Win Rate", value: FF.pct(winRate),
                               color: winRate >= 50 ? FFDesign.positive : FFDesign.negative,
                               icon: "target")
                }

                // Capital stats
                SectionHeader(title: "Capital Stats", icon: "chart.bar.fill")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    MetricCard("Current Capital", value: FF.usd(t.currentCapital), color: FFDesign.accent, icon: "dollarsign.circle.fill")
                    MetricCard("Peak Capital", value: FF.usd(t.peakCapital), color: FFDesign.gold, icon: "crown.fill")
                }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    MetricCard("Max Drawdown", value: FF.pct(t.maxDrawdownPct), color: FFDesign.negative, icon: "arrow.down.right")
                    MetricCard("Compounded", value: FF.usd(t.lifetimeCompounded), color: FFDesign.positive, icon: "arrow.up.right.circle.fill")
                }

                if (t.lifetimePayouts ?? 0) > 0 {
                    MetricCard("Lifetime Payouts", value: FF.usd(t.lifetimePayouts), color: FFDesign.gold, icon: "banknote.fill")
                }

            } else {
                EmptyState(icon: "chart.bar.fill", message: "Pull to refresh capital data")
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 20)
    }

    // MARK: - History Tab

    var historyTab: some View {
        VStack(spacing: 14) {
            if let snapshots = appState.capital?.treasury?.dailySnapshots, !snapshots.isEmpty {
                let sorted = snapshots.sorted(by: { ($0.date ?? "") > ($1.date ?? "") })

                SectionHeader(title: "\(snapshots.count) Daily Snapshots", icon: "calendar.badge.clock")

                ForEach(sorted.indices, id: \.self) { i in
                    let snap = sorted[i]
                    PremiumCard(
                        highlighted: (snap.pnl ?? 0) != 0,
                        highlightColor: (snap.pnl ?? 0) >= 0 ? FFDesign.positive : FFDesign.negative
                    ) {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(snap.date ?? "--")
                                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                                    .foregroundColor(FFDesign.textPrimary)
                                HStack(spacing: 8) {
                                    if let trades = snap.trades {
                                        Label("\(trades) trades", systemImage: "arrow.left.arrow.right")
                                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                                            .foregroundColor(FFDesign.textTertiary)
                                    }
                                    if let wins = snap.wins, let trades = snap.trades, trades > 0 {
                                        let wr = Double(wins) / Double(trades) * 100
                                        Text(FF.pct(wr))
                                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                                            .foregroundColor(wr >= 50 ? FFDesign.positive : FFDesign.negative)
                                    }
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 3) {
                                Text(FF.pnl(snap.pnl))
                                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                                    .foregroundColor(FF.pnlColor(snap.pnl))
                                    .contentTransition(.numericText())
                                Text(FF.usd(snap.capital))
                                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                                    .foregroundColor(FFDesign.textTertiary)
                            }
                        }
                    }
                }

            } else {
                EmptyState(icon: "calendar", message: "No daily snapshot history")
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 20)
    }

    // MARK: - Helpers

    @ViewBuilder
    private func venueCapCard(_ venue: String, amount: Double?, icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(FFDesign.accent.opacity(0.6))
            VStack(alignment: .leading, spacing: 1) {
                Text(venue.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(FFDesign.textTertiary)
                    .tracking(0.7)
                Text(FF.usd(amount))
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundColor(FFDesign.textPrimary)
                    .contentTransition(.numericText())
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FFDesign.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    @ViewBuilder
    private func ledgerRow(_ label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(FFDesign.textTertiary)
                .tracking(0.7)
            Text(value)
                .font(.system(size: 15, weight: .bold, design: .monospaced))
                .foregroundColor(color)
                .contentTransition(.numericText())
        }
    }
}

#Preview {
    CapitalView()
        .environmentObject(AppState())
}
