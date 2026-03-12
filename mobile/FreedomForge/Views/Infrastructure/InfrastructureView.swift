import SwiftUI

/// Infrastructure view — system health, CPU, memory, disk, agents, circuits.
struct InfrastructureView: View {
    @EnvironmentObject var appState: AppState
    @State private var gaugeProgress: Double = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Color(red: 0.04, green: 0.04, blue: 0.06).ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 14) {
                        ConnectionStatusBar()

                        if let infra = appState.infrastructure {
                            // System Info
                            SectionHeader(title: "System", icon: "desktopcomputer")
                            PremiumCard(highlighted: true, highlightColor: FFDesign.accent) {
                                HStack(spacing: 16) {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(infra.system?.hostname ?? "Unknown")
                                            .font(.system(size: 15, weight: .bold, design: .monospaced))
                                            .foregroundColor(FFDesign.textPrimary)
                                        HStack(spacing: 6) {
                                            Text("\(infra.system?.platform ?? "?") / \(infra.system?.arch ?? "?")")
                                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                                .foregroundColor(FFDesign.textTertiary)
                                            Text("Node \(infra.system?.nodeVersion ?? "?")")
                                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                                .foregroundColor(FFDesign.textTertiary)
                                        }
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 4) {
                                        Text("UPTIME")
                                            .font(.system(size: 10, weight: .semibold))
                                            .foregroundColor(FFDesign.textTertiary)
                                            .tracking(0.8)
                                        Text(FF.uptime(infra.system?.uptime))
                                            .font(.system(size: 18, weight: .bold, design: .monospaced))
                                            .foregroundColor(FFDesign.accent)
                                            .contentTransition(.numericText())
                                    }
                                }
                            }

                            // Resource Gauges
                            SectionHeader(title: "Resources", icon: "gauge")
                            HStack(spacing: 14) {
                                resourceGauge("CPU", value: (infra.cpu?.usagePct ?? 0) * gaugeProgress)
                                resourceGauge("Memory", value: (infra.memory?.usagePct ?? 0) * gaugeProgress)
                                if let disk = infra.disk?.usagePct {
                                    resourceGauge("Disk", value: disk * gaugeProgress)
                                }
                            }
                            .padding(.vertical, 8)
                            .onAppear {
                                withAnimation(.easeOut(duration: 1.0)) {
                                    gaugeProgress = 1.0
                                }
                            }

                            // Memory Detail
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("Used", value: "\(infra.memory?.usedMB ?? 0) MB", color: FFDesign.accent, icon: "memorychip")
                                MetricCard("Free", value: "\(infra.memory?.freeMB ?? 0) MB", color: FFDesign.positive, icon: "memorychip")
                                MetricCard("Total", value: "\(infra.memory?.totalMB ?? 0) MB", icon: "memorychip")
                            }

                            // Node.js Process
                            SectionHeader(title: "Node.js Process", icon: "cpu")
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                MetricCard("RSS", value: "\(infra.node?.rss ?? 0) MB", color: FFDesign.accent, icon: "square.stack.3d.up")
                                MetricCard("Heap", value: "\(infra.node?.heapUsed ?? 0) MB", subtitle: "of \(infra.node?.heapTotal ?? 0) MB", icon: "square.stack")
                            }

                            // Watchdog
                            SectionHeader(title: "Watchdog", icon: "eye")
                            PremiumCard(highlighted: true, highlightColor: infra.watchdog?.running == true ? FFDesign.positive : FFDesign.negative) {
                                HStack(spacing: 10) {
                                    LiveDot(color: infra.watchdog?.running == true ? FFDesign.positive : FFDesign.negative)
                                    Text(infra.watchdog?.running == true ? "RUNNING" : "STOPPED")
                                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                                        .foregroundColor(infra.watchdog?.running == true ? FFDesign.positive : FFDesign.negative)
                                        .tracking(0.5)
                                    Spacer()
                                    Image(systemName: infra.watchdog?.running == true ? "checkmark.shield.fill" : "xmark.shield.fill")
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundColor(infra.watchdog?.running == true ? FFDesign.positive : FFDesign.negative)
                                }
                            }

                            // Agent Health
                            if let agents = infra.agents, !agents.isEmpty {
                                SectionHeader(title: "Agents", icon: "person.3")
                                let sortedAgents = agents.sorted(by: { $0.key < $1.key })
                                ForEach(sortedAgents, id: \.key) { name, info in
                                    PremiumCard {
                                        HStack(spacing: 10) {
                                            Circle()
                                                .fill(info.alive == true ? FFDesign.positive : FFDesign.negative)
                                                .frame(width: 8, height: 8)
                                            Text(name)
                                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                                .foregroundColor(FFDesign.textPrimary)
                                            Spacer()
                                            if info.alive == true {
                                                Text("ALIVE")
                                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                                    .foregroundColor(FFDesign.positive)
                                                    .tracking(0.5)
                                            } else {
                                                Text("DEAD")
                                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                                    .foregroundColor(FFDesign.negative)
                                                    .tracking(0.5)
                                            }
                                        }
                                    }
                                }
                            }

                            // Circuit Breakers
                            if let circuits = infra.circuits, !circuits.isEmpty {
                                SectionHeader(title: "Circuit Breakers", icon: "bolt.circle")
                                ForEach(circuits) { circuit in
                                    PremiumCard(highlighted: circuit.status?.uppercased() == "OPEN", highlightColor: FFDesign.negative) {
                                        HStack(spacing: 10) {
                                            Circle()
                                                .fill(circuitColor(circuit.status))
                                                .frame(width: 8, height: 8)
                                            Text(circuit.name ?? "?")
                                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                                .foregroundColor(FFDesign.textPrimary)
                                            Spacer()
                                            StatusBadge(text: circuit.status ?? "?", color: circuitColor(circuit.status))
                                            if (circuit.failures ?? 0) > 0 {
                                                Text("\(circuit.failures ?? 0)")
                                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                                    .foregroundColor(FFDesign.negative)
                                                    .contentTransition(.numericText())
                                            }
                                        }
                                    }
                                }
                            }

                            // Venue Performance
                            if let venues = infra.venuePerformance, !venues.isEmpty {
                                SectionHeader(title: "Venue Performance", icon: "building.2")
                                ForEach(venues.sorted(by: { $0.key < $1.key }), id: \.key) { venue, perf in
                                    PremiumCard {
                                        HStack {
                                            Text(venue.capitalized)
                                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                                .foregroundColor(FFDesign.textPrimary)
                                            Spacer()
                                            HStack(spacing: 10) {
                                                HStack(spacing: 3) {
                                                    Image(systemName: "checkmark.circle.fill")
                                                        .font(.system(size: 10))
                                                        .foregroundColor(FFDesign.positive)
                                                    Text("\(perf.successes ?? 0)/\(perf.attempts ?? 0)")
                                                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                                                        .foregroundColor(FFDesign.positive)
                                                        .contentTransition(.numericText())
                                                }
                                                if (perf.errors ?? 0) > 0 {
                                                    HStack(spacing: 3) {
                                                        Image(systemName: "xmark.circle.fill")
                                                            .font(.system(size: 10))
                                                            .foregroundColor(FFDesign.negative)
                                                        Text("\(perf.errors ?? 0)")
                                                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                                                            .foregroundColor(FFDesign.negative)
                                                            .contentTransition(.numericText())
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                        } else {
                            // Skeleton loading placeholders
                            SkeletonCard(height: 80)
                            HStack(spacing: 14) {
                                SkeletonCard(height: 90)
                                SkeletonCard(height: 90)
                                SkeletonCard(height: 90)
                            }
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                SkeletonCard(height: 60)
                                SkeletonCard(height: 60)
                                SkeletonCard(height: 60)
                            }
                            SkeletonCard(height: 60)
                            SkeletonCard(height: 50)
                            SkeletonCard(height: 50)
                            SkeletonCard(height: 50)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("Infrastructure")
            .refreshable {
                appState.infrastructure = try? await APIClient.shared.get("/api/infrastructure")
            }
            .onAppear {
                if appState.infrastructure == nil {
                    Task { appState.infrastructure = try? await APIClient.shared.get("/api/infrastructure") }
                }
            }
        }
    }

    // MARK: - Resource Gauge

    @ViewBuilder
    func resourceGauge(_ label: String, value: Double) -> some View {
        VStack(spacing: 8) {
            ProgressRing(
                progress: value / 100.0,
                color: gaugeColor(value),
                size: 72,
                label: label
            )
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Helpers

    func gaugeColor(_ value: Double) -> Color {
        if value >= 90 { return FFDesign.negative }
        if value >= 70 { return FFDesign.warning }
        if value >= 50 { return Color.yellow }
        return FFDesign.positive
    }

    func circuitColor(_ status: String?) -> Color {
        switch status?.uppercased() {
        case "CLOSED": return FFDesign.positive
        case "HALF_OPEN": return FFDesign.warning
        case "OPEN": return FFDesign.negative
        default: return .secondary
        }
    }
}
