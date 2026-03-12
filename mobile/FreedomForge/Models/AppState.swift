import SwiftUI
import Combine

/// Central app state manager — drives all views via published properties.
@MainActor
class AppState: ObservableObject {
    // ── Connection ────────────────────────────────────────────────────────
    @Published var isConnected = false
    @Published var lastError: String?
    @Published var lastUpdate: Date?

    // ── Data ──────────────────────────────────────────────────────────────
    @Published var summary: SystemSummary?
    @Published var portfolio: PortfolioData?
    @Published var trades: TradesData?
    @Published var risk: RiskData?
    @Published var capital: CapitalData?
    @Published var brain: BrainData?
    @Published var ml: MLData?
    @Published var signals: SignalsData?
    @Published var strategies: StrategiesData?
    @Published var margin: MarginData?
    @Published var infrastructure: InfrastructureData?
    @Published var recentEvents: [LogEvent] = []

    // ── Settings ──────────────────────────────────────────────────────────
    @AppStorage("serverURL") var serverURL = "http://150.136.245.31:9091"
    @AppStorage("apiToken") var apiToken = "iZ_oTe3rKgxDn4-SOLyndXAWodvg6eixYOSirRzxtzY"
    @AppStorage("pollInterval") var pollInterval: Double = 5.0
    @AppStorage("enableNotifications") var enableNotifications = true

    // ── Internal ──────────────────────────────────────────────────────────
    private var pollTimer: Timer?
    private var sseTask: Task<Void, Never>?
    private let api = APIClient.shared

    // ── Polling ───────────────────────────────────────────────────────────

    func startPolling() {
        stopPolling()
        api.configure(baseURL: serverURL, token: apiToken)
        refresh()
        pollTimer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }
        connectSSE()
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
        sseTask?.cancel()
        sseTask = nil
    }

    func refresh() {
        Task {
            do {
                let s: SystemSummary = try await api.get("/api/summary")
                self.summary = s
                self.isConnected = true
                self.lastUpdate = Date()
                self.lastError = nil
            } catch {
                self.isConnected = false
                self.lastError = error.localizedDescription
            }
        }
    }

    func refreshAll() {
        refresh()
        Task { self.portfolio = try? await api.get("/api/portfolio") }
        Task { self.trades = try? await api.get("/api/trades?limit=50&days=30") }
        Task { self.risk = try? await api.get("/api/risk") }
        Task { self.capital = try? await api.get("/api/capital") }
        Task { self.brain = try? await api.get("/api/brain") }
        Task { self.ml = try? await api.get("/api/ml") }
        Task { self.signals = try? await api.get("/api/signals") }
        Task { self.strategies = try? await api.get("/api/strategies") }
        Task { self.margin = try? await api.get("/api/margin") }
        Task { self.infrastructure = try? await api.get("/api/infrastructure") }
        Task {
            if let events: RecentEventsResponse = try? await api.get("/api/events/recent?limit=50") {
                self.recentEvents = events.events
            }
        }
    }

    // ── SSE ───────────────────────────────────────────────────────────────

    private func connectSSE() {
        sseTask?.cancel()
        sseTask = Task { [weak self] in
            guard let self = self else { return }
            let stream = api.sseStream("/api/events/stream")
            for await event in stream {
                if Task.isCancelled { break }
                await MainActor.run {
                    switch event.event {
                    case "summary":
                        if let data = event.data.data(using: .utf8),
                           let s = try? JSONDecoder.ff.decode(SystemSummary.self, from: data) {
                            self.summary = s
                            self.isConnected = true
                            self.lastUpdate = Date()
                        }
                    case "event":
                        if let data = event.data.data(using: .utf8),
                           let evt = try? JSONDecoder.ff.decode(LogEvent.self, from: data) {
                            self.recentEvents.insert(evt, at: 0)
                            if self.recentEvents.count > 200 {
                                self.recentEvents = Array(self.recentEvents.prefix(200))
                            }
                            // Trigger notification for critical events
                            if self.enableNotifications && (evt.level == "error" || evt.level == "fatal") {
                                NotificationManager.shared.sendAlert(
                                    title: "FreedomForge Alert",
                                    body: "\(evt.agent ?? "system"): \(evt.msg ?? "Unknown event")",
                                    level: evt.level ?? "error"
                                )
                            }
                        }
                    default:
                        break
                    }
                }
            }
        }
    }

    func reconfigure() {
        api.configure(baseURL: serverURL, token: apiToken)
        startPolling()
    }
}
