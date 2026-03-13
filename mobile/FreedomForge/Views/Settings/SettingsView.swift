import SwiftUI

/// Settings view — server config, notifications, about — premium dark design.
struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var tempURL: String = ""
    @State private var tempToken: String = ""
    @State private var showingToken = false
    @State private var testResult: String?
    @State private var isTesting = false

    var body: some View {
        NavigationStack {
            ZStack {
                FFDesign.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        // Server Configuration
                        SectionHeader(title: "Server Connection", icon: "network")

                        PremiumCard {
                            VStack(alignment: .leading, spacing: 14) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("DASHBOARD API URL")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundColor(FFDesign.textTertiary)
                                        .tracking(0.8)
                                    TextField("http://your-vm-ip:9091", text: $tempURL)
                                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                                        .foregroundColor(FFDesign.textPrimary)
                                        .textContentType(.URL)
                                        #if os(iOS)
                                        .autocapitalization(.none)
                                        #endif
                                        .disableAutocorrection(true)
                                        .padding(10)
                                        .background(
                                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                .fill(FFDesign.surface)
                                                .overlay(
                                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                        .stroke(FFDesign.border, lineWidth: 1)
                                                )
                                        )
                                }

                                VStack(alignment: .leading, spacing: 6) {
                                    Text("API TOKEN (ALERT_SECRET)")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundColor(FFDesign.textTertiary)
                                        .tracking(0.8)
                                    HStack {
                                        if showingToken {
                                            TextField("Token", text: $tempToken)
                                                .font(.system(size: 14, weight: .medium, design: .monospaced))
                                                .foregroundColor(FFDesign.textPrimary)
                                                #if os(iOS)
                                                .autocapitalization(.none)
                                                #endif
                                                .disableAutocorrection(true)
                                        } else {
                                            SecureField("Token", text: $tempToken)
                                                .font(.system(size: 14, weight: .medium, design: .monospaced))
                                                .foregroundColor(FFDesign.textPrimary)
                                        }
                                        Button(action: { showingToken.toggle() }) {
                                            Image(systemName: showingToken ? "eye.slash.fill" : "eye.fill")
                                                .font(.system(size: 14))
                                                .foregroundColor(FFDesign.textTertiary)
                                        }
                                    }
                                    .padding(10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .fill(FFDesign.surface)
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                    .stroke(FFDesign.border, lineWidth: 1)
                                            )
                                    )
                                }

                                HStack(spacing: 10) {
                                    Button(action: saveAndConnect) {
                                        HStack(spacing: 6) {
                                            Image(systemName: "arrow.triangle.2.circlepath")
                                                .font(.system(size: 12, weight: .semibold))
                                            Text("SAVE & CONNECT")
                                                .font(.system(size: 11, weight: .bold))
                                                .tracking(0.5)
                                        }
                                        .frame(maxWidth: .infinity)
                                        .padding(10)
                                        .background(FFDesign.accentGradient)
                                        .foregroundColor(.white)
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    }

                                    Button(action: testConnection) {
                                        HStack(spacing: 6) {
                                            if isTesting {
                                                ProgressView()
                                                    .scaleEffect(0.7)
                                                    .tint(.white)
                                            } else {
                                                Image(systemName: "antenna.radiowaves.left.and.right")
                                                    .font(.system(size: 12, weight: .semibold))
                                            }
                                            Text("TEST")
                                                .font(.system(size: 11, weight: .bold))
                                                .tracking(0.5)
                                        }
                                        .padding(10)
                                        .background(FFDesign.surfaceElevated)
                                        .foregroundColor(FFDesign.accent)
                                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                .stroke(FFDesign.accent.opacity(0.3), lineWidth: 1)
                                        )
                                    }
                                    .disabled(isTesting)
                                }

                                if let result = testResult {
                                    HStack(spacing: 6) {
                                        Image(systemName: result.contains("OK") ? "checkmark.circle.fill" : "xmark.circle.fill")
                                            .font(.system(size: 14))
                                            .foregroundColor(result.contains("OK") ? FFDesign.positive : FFDesign.negative)
                                        Text(result)
                                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                                            .foregroundColor(result.contains("OK") ? FFDesign.positive : FFDesign.negative)
                                    }
                                    .padding(10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .fill((result.contains("OK") ? FFDesign.positive : FFDesign.negative).opacity(0.08))
                                    )
                                }
                            }
                        }

                        // Polling
                        SectionHeader(title: "Data Refresh", icon: "arrow.clockwise")
                        PremiumCard {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("POLL INTERVAL")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(FFDesign.textTertiary)
                                    .tracking(0.8)
                                Picker("", selection: $appState.pollInterval) {
                                    Text("2s").tag(2.0)
                                    Text("5s").tag(5.0)
                                    Text("10s").tag(10.0)
                                    Text("30s").tag(30.0)
                                    Text("60s").tag(60.0)
                                }
                                .pickerStyle(.segmented)
                            }
                        }

                        // Notifications
                        SectionHeader(title: "Notifications", icon: "bell.badge")
                        PremiumCard {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text("Enable Alerts")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(FFDesign.textPrimary)
                                    Spacer()
                                    Toggle("", isOn: $appState.enableNotifications)
                                        .labelsHidden()
                                        .tint(FFDesign.accent)
                                        .onChange(of: appState.enableNotifications) { _, newValue in
                                            if newValue {
                                                NotificationManager.shared.requestPermission()
                                            }
                                        }
                                }
                                Text("Critical alerts (kill switch, emergency closes, fatal errors) will push a notification.")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(FFDesign.textTertiary)
                            }
                        }

                        // Connection Status
                        SectionHeader(title: "Status", icon: "wifi")
                        PremiumCard(highlighted: true, highlightColor: appState.isConnected ? FFDesign.positive : FFDesign.negative) {
                            VStack(spacing: 10) {
                                HStack {
                                    LiveDot(color: appState.isConnected ? FFDesign.positive : FFDesign.negative)
                                    Text(appState.isConnected ? "CONNECTED" : "DISCONNECTED")
                                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                                        .foregroundColor(appState.isConnected ? FFDesign.positive : FFDesign.negative)
                                        .tracking(0.5)
                                    Spacer()
                                }

                                if let lastUpdate = appState.lastUpdate {
                                    HStack {
                                        Text("LAST UPDATE")
                                            .font(.system(size: 10, weight: .bold))
                                            .foregroundColor(FFDesign.textTertiary)
                                            .tracking(0.8)
                                        Spacer()
                                        Text(lastUpdate, style: .relative)
                                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                                            .foregroundColor(FFDesign.textSecondary)
                                    }
                                }

                                if let error = appState.lastError {
                                    HStack(spacing: 6) {
                                        Image(systemName: "exclamationmark.triangle.fill")
                                            .font(.system(size: 12))
                                            .foregroundColor(FFDesign.negative)
                                        Text(error)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundColor(FFDesign.negative)
                                            .lineLimit(2)
                                    }
                                }
                            }
                        }

                        // About
                        SectionHeader(title: "About", icon: "info.circle")
                        PremiumCard {
                            VStack(spacing: 10) {
                                aboutRow("App", value: "FreedomForge Monitor v1.0")
                                Divider().background(FFDesign.border)
                                aboutRow("Backend", value: "Dashboard API v1.0")
                                Divider().background(FFDesign.border)
                                aboutRow("System", value: "FreedomForge Max", color: FFDesign.accent)
                            }
                        }

                        // Actions
                        SectionHeader(title: "Actions", icon: "bolt.circle")
                        Button(action: {
                            HapticManager.medium()
                            appState.refreshAll()
                        }) {
                            HStack(spacing: 8) {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 14, weight: .semibold))
                                Text("FORCE REFRESH ALL DATA")
                                    .font(.system(size: 12, weight: .bold))
                                    .tracking(0.5)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(14)
                            .background(FFDesign.surfaceElevated)
                            .foregroundColor(FFDesign.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(FFDesign.accent.opacity(0.2), lineWidth: 1)
                            )
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 30)
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                tempURL = appState.serverURL
                tempToken = appState.apiToken
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func aboutRow(_ label: String, value: String, color: Color = FFDesign.textSecondary) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(FFDesign.textTertiary)
            Spacer()
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(color)
        }
    }

    func saveAndConnect() {
        HapticManager.medium()
        appState.serverURL = tempURL
        appState.apiToken = tempToken
        appState.reconfigure()
    }

    func testConnection() {
        isTesting = true
        testResult = nil

        Task {
            do {
                let api = APIClient.shared
                api.configure(baseURL: tempURL, token: tempToken)

                struct HealthResponse: Codable {
                    let status: String?
                    let uptime: Int?
                    let version: String?
                }

                let health: HealthResponse = try await api.get("/api/health")
                testResult = "OK — \(health.status ?? "up"), uptime: \(FF.uptime(health.uptime))"
            } catch {
                testResult = "FAILED: \(error.localizedDescription)"
            }
            isTesting = false
        }
    }
}
