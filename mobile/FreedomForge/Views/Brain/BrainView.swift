import SwiftUI
import Charts

/// Brain view — evolution, weights, calibration, regime profiles, time patterns.
struct BrainView: View {
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
                        Text("Weights").tag(1)
                        Text("ML").tag(2)
                        Text("Strategies").tag(3)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)

                    ScrollView {
                        switch selectedTab {
                        case 0: brainOverview
                        case 1: weightsView
                        case 2: mlView
                        case 3: strategiesView
                        default: EmptyView()
                        }
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: selectedTab)
            }
            .navigationTitle("Brain & ML")
            .refreshable {
                appState.brain = try? await APIClient.shared.get("/api/brain")
                appState.ml = try? await APIClient.shared.get("/api/ml")
                appState.strategies = try? await APIClient.shared.get("/api/strategies")
            }
            .onAppear {
                if appState.brain == nil {
                    Task {
                        appState.brain = try? await APIClient.shared.get("/api/brain")
                        appState.ml = try? await APIClient.shared.get("/api/ml")
                        appState.strategies = try? await APIClient.shared.get("/api/strategies")
                    }
                }
            }
        }
    }

    // MARK: - Brain Overview

    var brainOverview: some View {
        VStack(spacing: 14) {
            if let b = appState.brain {
                // Key Metrics
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    KPICard("Generation", value: FF.num(b.insights?.totalEvolutions), color: FFDesign.accent, icon: "dna")
                    KPICard("Calibration", value: FF.ratio(b.insights?.calibrationScore), color: calibrationColor(b.insights?.calibrationScore), icon: "scope")
                    KPICard("Streak", value: "\(b.insights?.streak ?? 0)", color: (b.insights?.streak ?? 0) >= 0 ? FFDesign.positive : FFDesign.negative, icon: "flame.fill")
                }

                // Should Trade Now
                if let st = b.shouldTrade {
                    PremiumCard(highlighted: true, highlightColor: st.trade == true ? FFDesign.positive : FFDesign.negative) {
                        HStack(spacing: 12) {
                            Image(systemName: st.trade == true ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundColor(st.trade == true ? FFDesign.positive : FFDesign.negative)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(st.trade == true ? "TRADE ALLOWED" : "TRADING BLOCKED")
                                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                                    .foregroundColor(FFDesign.textPrimary)
                                    .tracking(0.5)
                                Text(st.reason ?? "")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(FFDesign.textTertiary)
                            }
                            Spacer()
                            if st.reducedSize == true {
                                StatusBadge(text: "REDUCED", color: FFDesign.warning)
                            }
                        }
                    }
                }

                // Regime Profiles
                if let regimes = b.state?.regimeProfiles, !regimes.isEmpty {
                    SectionHeader(title: "Regime Performance", icon: "chart.bar.xaxis")
                    ForEach(regimes.sorted(by: { ($0.value.wins ?? 0) > ($1.value.wins ?? 0) }), id: \.key) { regime, profile in
                        let wins = profile.wins ?? 0
                        let losses = profile.losses ?? 0
                        let total = wins + losses
                        let winRate = total > 0 ? Double(wins) / Double(total) : 0

                        PremiumCard {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(regime.replacingOccurrences(of: "_", with: " ").capitalized)
                                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                                        .foregroundColor(FFDesign.textPrimary)
                                    Text("\(wins)W / \(losses)L")
                                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                                        .foregroundColor(FFDesign.textTertiary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 4) {
                                    Text(FF.pct(winRate * 100))
                                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                                        .foregroundColor(winRate >= 0.5 ? FFDesign.positive : FFDesign.negative)
                                        .contentTransition(.numericText())
                                    HorizontalBar(value: winRate, maxValue: 1.0, color: winRate >= 0.5 ? FFDesign.positive : FFDesign.negative, height: 4)
                                        .frame(width: 60)
                                }
                            }
                        }
                    }
                }

                // Time Patterns
                if let tp = b.state?.timePatterns {
                    SectionHeader(title: "Time Patterns", icon: "clock")
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        if let best = tp.bestHours, !best.isEmpty {
                            MetricCard("Best Hours", value: best.map { "\($0):00" }.joined(separator: ", "), color: FFDesign.positive, icon: "sun.max.fill")
                        }
                        if let worst = tp.worstHours, !worst.isEmpty {
                            MetricCard("Worst Hours", value: worst.map { "\($0):00" }.joined(separator: ", "), color: FFDesign.negative, icon: "moon.fill")
                        }
                    }
                }

            } else {
                EmptyState(icon: "brain.head.profile", message: "Pull to refresh brain data")
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 20)
    }

    // MARK: - Weights

    var weightsView: some View {
        VStack(spacing: 14) {
            if let weights = appState.brain?.weights, !weights.isEmpty {
                SectionHeader(title: "Indicator Weights", icon: "slider.horizontal.3")

                let sorted = weights.sorted(by: { $0.value > $1.value })
                ForEach(sorted, id: \.key) { name, weight in
                    PremiumCard {
                        HStack {
                            Text(formatIndicatorName(name))
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundColor(FFDesign.textSecondary)
                                .frame(maxWidth: 120, alignment: .leading)

                            HorizontalBar(value: weight, maxValue: sorted.first?.value ?? 0.5, color: FFDesign.accent, height: 12)

                            Text(String(format: "%.3f", weight))
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundColor(FFDesign.accent)
                                .contentTransition(.numericText())
                                .frame(width: 55, alignment: .trailing)
                        }
                    }
                }
            } else {
                EmptyState(icon: "slider.horizontal.3", message: "No weight data")
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 20)
    }

    // MARK: - ML Pipeline

    var mlView: some View {
        VStack(spacing: 14) {
            if let ml = appState.ml {
                SectionHeader(title: "ML Model", icon: "cpu")

                if let model = ml.model {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        KPICard("Train Acc", value: FF.pct(model.trainAccuracy), color: (model.trainAccuracy ?? 0) >= 70 ? FFDesign.positive : FFDesign.warning, icon: "chart.bar.fill")
                        KPICard("Val Acc", value: FF.pct(model.valAccuracy), color: (model.valAccuracy ?? 0) >= 60 ? FFDesign.positive : FFDesign.warning, icon: "checkmark.seal.fill")
                    }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        MetricCard("Samples", value: FF.num(model.sampleCount), icon: "doc.on.doc.fill")
                        MetricCard("Stumps", value: FF.num(model.stumpCount), icon: "tree.fill")
                    }

                    MetricCard("Feature Store", value: "\(ml.featureStoreSamples ?? 0) samples", color: FFDesign.premium, icon: "tray.full.fill")
                }

                // Feature Importance
                if let fi = ml.featureImportance, !fi.isEmpty {
                    SectionHeader(title: "Feature Importance", icon: "chart.bar.fill")
                    let sorted = fi.sorted(by: { $0.value > $1.value })
                    ForEach(sorted, id: \.key) { feature, count in
                        let maxCount = sorted.first?.value ?? 1
                        PremiumCard {
                            HStack {
                                Text(feature)
                                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                    .foregroundColor(FFDesign.textSecondary)
                                    .frame(maxWidth: 120, alignment: .leading)

                                HorizontalBar(value: Double(count), maxValue: Double(maxCount), color: FFDesign.premium, height: 12)

                                Text("\(count)")
                                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                                    .foregroundColor(FFDesign.premium)
                                    .contentTransition(.numericText())
                                    .frame(width: 35, alignment: .trailing)
                            }
                        }
                    }
                }
            } else {
                EmptyState(icon: "cpu", message: "No ML data available")
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 20)
    }

    // MARK: - Strategies

    var strategiesView: some View {
        VStack(spacing: 14) {
            if let s = appState.strategies {
                if let active = s.activeStrategies, !active.isEmpty {
                    SectionHeader(title: "Active Strategies", icon: "flag.fill")
                    ForEach(active) { strategy in
                        strategyCard(strategy)
                    }
                }

                if let all = s.allStrategies, !all.isEmpty {
                    SectionHeader(title: "All Strategies", icon: "list.bullet")
                    ForEach(all) { strategy in
                        strategyCard(strategy)
                    }
                }
            } else {
                EmptyState(icon: "flag.fill", message: "No strategy data")
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 20)
    }

    // MARK: - Strategy Card

    @ViewBuilder
    func strategyCard(_ strategy: StrategiesData.Strategy) -> some View {
        PremiumCard(highlighted: strategy.status?.uppercased() == "LIVE_FULL", highlightColor: FFDesign.positive) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(strategy.name ?? "Unknown")
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundColor(FFDesign.textPrimary)
                    Spacer()
                    StatusBadge(text: strategy.status ?? "?", color: strategyStatusColor(strategy.status))
                }

                if let perf = strategy.performance {
                    HStack(spacing: 14) {
                        if let wr = perf.winRate {
                            HStack(spacing: 4) {
                                Image(systemName: "target")
                                    .font(.system(size: 10))
                                    .foregroundColor(wr >= 50 ? FFDesign.positive : FFDesign.negative)
                                Text(FF.pct(wr))
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .foregroundColor(wr >= 50 ? FFDesign.positive : FFDesign.negative)
                                    .contentTransition(.numericText())
                            }
                        }
                        if let sharpe = perf.sharpe {
                            HStack(spacing: 4) {
                                Image(systemName: "waveform")
                                    .font(.system(size: 10))
                                    .foregroundColor(sharpe >= 1 ? FFDesign.positive : FFDesign.warning)
                                Text(FF.ratio(sharpe))
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .foregroundColor(sharpe >= 1 ? FFDesign.positive : FFDesign.warning)
                                    .contentTransition(.numericText())
                            }
                        }
                        if let trades = perf.trades {
                            HStack(spacing: 4) {
                                Image(systemName: "number")
                                    .font(.system(size: 10))
                                    .foregroundColor(FFDesign.textTertiary)
                                Text("\(trades)")
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundColor(FFDesign.textSecondary)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func calibrationColor(_ score: Double?) -> Color {
        guard let s = score else { return .secondary }
        if s > 0.7 { return FFDesign.positive }
        if s > 0.5 { return FFDesign.warning }
        return FFDesign.negative
    }

    func strategyStatusColor(_ status: String?) -> Color {
        switch status?.uppercased() {
        case "LIVE_FULL": return FFDesign.positive
        case "LIVE_SMALL": return FFDesign.accent
        case "PAPER": return FFDesign.warning
        case "CANDIDATE": return FFDesign.premium
        case "RETIRED": return Color.gray
        default: return .secondary
        }
    }

    func formatIndicatorName(_ name: String) -> String {
        name.replacingOccurrences(of: "([A-Z])", with: " $1", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
            .capitalized
    }
}
