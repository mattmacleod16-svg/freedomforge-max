import SwiftUI

/// Signals view — active signals, types, consensus, live event stream.
struct SignalsView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedTab = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Color(red: 0.04, green: 0.04, blue: 0.06).ignoresSafeArea()

                VStack(spacing: 0) {
                    ConnectionStatusBar()

                    Picker("View", selection: $selectedTab) {
                        Text("Signals").tag(0)
                        Text("Events").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)

                    if selectedTab == 0 {
                        signalsListView
                    } else {
                        eventsView
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: selectedTab)
            }
            .navigationTitle("Signals & Events")
            .refreshable {
                appState.signals = try? await APIClient.shared.get("/api/signals")
            }
            .onAppear {
                if appState.signals == nil {
                    Task { appState.signals = try? await APIClient.shared.get("/api/signals") }
                }
            }
        }
    }

    // MARK: - Signals List

    var signalsListView: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let s = appState.signals {
                    // Summary
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        KPICard("Active Signals", value: FF.num(s.summary?.totalSignals), color: FFDesign.premium, icon: "dot.radiowaves.left.and.right")
                        KPICard("Signal Types", value: "\(s.summary?.types?.count ?? 0)", color: FFDesign.accent, icon: "list.bullet")
                    }

                    // Type Breakdown
                    if let types = s.summary?.types, !types.isEmpty {
                        SectionHeader(title: "By Type", icon: "chart.bar")
                        ForEach(types.sorted(by: { ($0.value.count ?? 0) > ($1.value.count ?? 0) }), id: \.key) { type, info in
                            PremiumCard {
                                HStack(spacing: 10) {
                                    signalTypeIcon(type)
                                        .frame(width: 32, height: 32)
                                        .background(FFDesign.accent.opacity(0.12))
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(type.replacingOccurrences(of: "_", with: " ").capitalized)
                                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                                            .foregroundColor(FFDesign.textPrimary)
                                        if let sources = info.sources {
                                            Text(sources.joined(separator: ", "))
                                                .font(.system(size: 10, weight: .medium))
                                                .foregroundColor(FFDesign.textTertiary)
                                                .lineLimit(1)
                                        }
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 3) {
                                        Text("\(info.count ?? 0)")
                                            .font(.system(size: 16, weight: .bold, design: .monospaced))
                                            .foregroundColor(FFDesign.accent)
                                        if let conf = info.avgConfidence {
                                            Text("\(String(format: "%.0f%%", conf * 100)) avg")
                                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                                .foregroundColor(FFDesign.textTertiary)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Recent Signals
                    if let signals = s.signals, !signals.isEmpty {
                        SectionHeader(title: "Recent Signals", icon: "clock.arrow.circlepath")
                        ForEach(signals.prefix(20)) { signal in
                            signalRow(signal)
                        }
                    }
                } else {
                    EmptyState(icon: "antenna.radiowaves.left.and.right", message: "No signal data")
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 20)
        }
    }

    // MARK: - Events Stream

    var eventsView: some View {
        ScrollView {
            if appState.recentEvents.isEmpty {
                EmptyState(icon: "text.badge.star", message: "No recent events — SSE stream will populate this")
            } else {
                LazyVStack(spacing: 6) {
                    ForEach(appState.recentEvents.prefix(100)) { event in
                        PremiumCard(highlighted: event.level == "error" || event.level == "fatal", highlightColor: FFDesign.negative) {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    LiveDot(color: FF.levelColor(event.level))
                                    Text(event.level?.uppercased() ?? "?")
                                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                                        .foregroundColor(FF.levelColor(event.level))
                                        .tracking(0.5)
                                    if let agent = event.agent {
                                        Text(agent)
                                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                                            .foregroundColor(FFDesign.textTertiary)
                                    }
                                    Spacer()
                                    Text(event.timestamp)
                                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                                        .foregroundColor(FFDesign.textTertiary)
                                        .lineLimit(1)
                                }
                                Text(event.message)
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundColor(FFDesign.textSecondary)
                                    .lineLimit(3)
                            }
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 20)
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    func signalRow(_ signal: Signal) -> some View {
        PremiumCard {
            HStack(spacing: 10) {
                signalTypeIcon(signal.type ?? "")
                    .frame(width: 28, height: 28)
                    .background(FFDesign.accent.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(signal.type?.replacingOccurrences(of: "_", with: " ").capitalized ?? "Unknown")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(FFDesign.textPrimary)
                    Text("from \(signal.source ?? "?")")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(FFDesign.textTertiary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text(String(format: "%.0f%%", (signal.confidence ?? 0) * 100))
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                        .foregroundColor(FFDesign.accent)
                    Text(FF.timeAgo(signal.publishedAt))
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(FFDesign.textTertiary)
                }
            }
        }
    }

    @ViewBuilder
    func signalTypeIcon(_ type: String) -> some View {
        let icon: String = {
            switch type.lowercased() {
            case let t where t.contains("risk"): return "exclamationmark.triangle.fill"
            case let t where t.contains("market"): return "chart.line.uptrend.xyaxis"
            case let t where t.contains("alpha"): return "star.fill"
            case let t where t.contains("audit"): return "checkmark.shield.fill"
            case let t where t.contains("regime"): return "wind"
            case let t where t.contains("sentiment"): return "face.smiling"
            case let t where t.contains("geo"): return "globe"
            default: return "dot.radiowaves.left.and.right"
            }
        }()
        Image(systemName: icon)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(FFDesign.accent)
    }
}
