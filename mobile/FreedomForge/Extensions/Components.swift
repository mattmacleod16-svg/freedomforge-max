import SwiftUI

// MARK: - Design Tokens

enum FFDesign {
    // Premium color palette
    static let accent = Color(red: 0.0, green: 0.82, blue: 1.0)         // Electric cyan
    static let accentDim = Color(red: 0.0, green: 0.55, blue: 0.72)
    static let positive = Color(red: 0.16, green: 0.87, blue: 0.44)     // Emerald green
    static let negative = Color(red: 1.0, green: 0.27, blue: 0.33)      // Signal red
    static let warning = Color(red: 1.0, green: 0.72, blue: 0.0)        // Amber
    static let premium = Color(red: 0.56, green: 0.44, blue: 1.0)       // Violet
    static let surface = Color.white.opacity(0.04)
    static let surfaceElevated = Color.white.opacity(0.07)
    static let border = Color.white.opacity(0.08)
    static let borderLight = Color.white.opacity(0.12)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.55)
    static let textTertiary = Color.white.opacity(0.35)

    // Gradients
    static let accentGradient = LinearGradient(
        colors: [accent, Color(red: 0.0, green: 0.55, blue: 1.0)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    static let positiveGradient = LinearGradient(
        colors: [positive, Color(red: 0.0, green: 0.72, blue: 0.44)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    static let negativeGradient = LinearGradient(
        colors: [negative, Color(red: 0.85, green: 0.15, blue: 0.25)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    static let cardGradient = LinearGradient(
        colors: [Color.white.opacity(0.06), Color.white.opacity(0.02)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    static let killGradient = LinearGradient(
        colors: [Color.red.opacity(0.15), Color.red.opacity(0.05)],
        startPoint: .top, endPoint: .bottom
    )
}

// MARK: - Premium Card

struct PremiumCard<Content: View>: View {
    let content: Content
    var highlighted: Bool = false
    var highlightColor: Color = FFDesign.accent

    init(highlighted: Bool = false, highlightColor: Color = FFDesign.accent, @ViewBuilder content: () -> Content) {
        self.content = content()
        self.highlighted = highlighted
        self.highlightColor = highlightColor
    }

    var body: some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(FFDesign.cardGradient)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(
                                highlighted ? highlightColor.opacity(0.3) : FFDesign.border,
                                lineWidth: 1
                            )
                    )
            )
    }
}

// MARK: - Metric Card (Premium)

struct MetricCard: View {
    let title: String
    let value: String
    let subtitle: String?
    let color: Color
    let icon: String?

    init(_ title: String, value: String, subtitle: String? = nil, color: Color = .white, icon: String? = nil) {
        self.title = title
        self.value = value
        self.subtitle = subtitle
        self.color = color
        self.icon = icon
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(color.opacity(0.6))
                }
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold, design: .default))
                    .foregroundColor(FFDesign.textTertiary)
                    .tracking(0.8)
            }
            Text(value)
                .font(.system(size: 22, weight: .bold, design: .monospaced))
                .foregroundColor(color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let subtitle = subtitle {
                Text(subtitle)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(FFDesign.textTertiary)
            }
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
}

// MARK: - KPI Hero Card

struct KPICard: View {
    let title: String
    let value: String
    let trend: String?
    let color: Color
    let icon: String

    init(_ title: String, value: String, trend: String? = nil, color: Color = FFDesign.accent, icon: String) {
        self.title = title
        self.value = value
        self.trend = trend
        self.color = color
        self.icon = icon
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(color)
                    .frame(width: 30, height: 30)
                    .background(color.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Spacer()
                if let trend = trend {
                    Text(trend)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(trend.hasPrefix("+") ? FFDesign.positive : trend.hasPrefix("-") ? FFDesign.negative : FFDesign.textSecondary)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(value)
                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                    .foregroundColor(FFDesign.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(FFDesign.textTertiary)
                    .tracking(0.8)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(FFDesign.cardGradient)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(color.opacity(0.15), lineWidth: 1)
                )
        )
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .tracking(0.5)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.15))
            .foregroundColor(color)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(color.opacity(0.25), lineWidth: 1)
            )
    }
}

// MARK: - Section Header

struct SectionHeader: View {
    let title: String
    let icon: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(FFDesign.accent)
            Text(title.uppercased())
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(FFDesign.textSecondary)
                .tracking(1.0)
            Rectangle()
                .fill(FFDesign.border)
                .frame(height: 1)
        }
        .padding(.top, 12)
        .padding(.bottom, 4)
    }
}

// MARK: - Progress Ring

struct ProgressRing: View {
    let progress: Double
    let color: Color
    let size: CGFloat
    var label: String?

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.12), lineWidth: size * 0.1)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1.0))
                .stroke(
                    AngularGradient(
                        colors: [color.opacity(0.4), color],
                        center: .center,
                        startAngle: .degrees(0),
                        endAngle: .degrees(360 * min(max(progress, 0), 1.0))
                    ),
                    style: StrokeStyle(lineWidth: size * 0.1, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.8), value: progress)
            VStack(spacing: 1) {
                Text("\(Int(min(max(progress, 0), 1.0) * 100))%")
                    .font(.system(size: size * 0.22, weight: .bold, design: .monospaced))
                    .foregroundColor(color)
                if let label = label {
                    Text(label)
                        .font(.system(size: size * 0.11, weight: .medium))
                        .foregroundColor(FFDesign.textTertiary)
                }
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Live Pulse Dot

struct LiveDot: View {
    let color: Color
    @State private var isPulsing = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .overlay(
                Circle()
                    .stroke(color.opacity(0.5), lineWidth: 2)
                    .scaleEffect(isPulsing ? 2.0 : 1.0)
                    .opacity(isPulsing ? 0 : 0.6)
            )
            .onAppear {
                withAnimation(.easeOut(duration: 1.5).repeatForever(autoreverses: false)) {
                    isPulsing = true
                }
            }
    }
}

// MARK: - Horizontal Bar

struct HorizontalBar: View {
    let value: Double
    let maxValue: Double
    let color: Color
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: height / 2, style: .continuous)
                    .fill(color.opacity(0.1))
                RoundedRectangle(cornerRadius: height / 2, style: .continuous)
                    .fill(color)
                    .frame(width: maxValue > 0 ? geo.size.width * min(value / maxValue, 1.0) : 0)
                    .animation(.easeInOut(duration: 0.6), value: value)
            }
        }
        .frame(height: height)
    }
}

// MARK: - Formatters

struct FF {
    static func usd(_ value: Double?) -> String {
        guard let v = value else { return "$--" }
        if abs(v) >= 1_000_000 { return String(format: "$%.2fM", v / 1_000_000) }
        if abs(v) >= 1000 { return String(format: "$%.0f", v) }
        return String(format: "$%.2f", v)
    }

    static func pct(_ value: Double?) -> String {
        guard let v = value else { return "--%"}
        return String(format: "%.1f%%", v)
    }

    static func pnl(_ value: Double?) -> String {
        guard let v = value else { return "$--" }
        let sign = v >= 0 ? "+" : ""
        return sign + String(format: "$%.2f", v)
    }

    static func pnlColor(_ value: Double?) -> Color {
        guard let v = value else { return .secondary }
        if v > 0 { return FFDesign.positive }
        if v < 0 { return FFDesign.negative }
        return .secondary
    }

    static func ratio(_ value: Double?) -> String {
        guard let v = value else { return "--" }
        return String(format: "%.2f", v)
    }

    static func num(_ value: Int?) -> String {
        guard let v = value else { return "--" }
        return "\(v)"
    }

    static func statusColor(_ status: String?) -> Color {
        switch status?.uppercased() {
        case "OPERATIONAL": return FFDesign.positive
        case "DEGRADED": return FFDesign.warning
        case "KILL_SWITCH": return FFDesign.negative
        default: return .secondary
        }
    }

    static func modeColor(_ mode: String?) -> Color {
        switch mode?.lowercased() {
        case "growth": return FFDesign.positive
        case "normal": return FFDesign.accent
        case "survival": return FFDesign.warning
        case "capital_halt": return FFDesign.negative
        default: return .secondary
        }
    }

    static func levelColor(_ level: String?) -> Color {
        switch level?.lowercased() {
        case "fatal": return FFDesign.negative
        case "error": return FFDesign.negative
        case "warn": return FFDesign.warning
        case "info": return FFDesign.accent
        case "debug": return Color.gray
        default: return .secondary
        }
    }

    static func sideColor(_ side: String?) -> Color {
        switch side?.lowercased() {
        case "buy", "long": return FFDesign.positive
        case "sell", "short": return FFDesign.negative
        default: return .secondary
        }
    }

    static func timeAgo(_ ts: Double?) -> String {
        guard let ts = ts, ts > 0 else { return "--" }
        let seconds = (Date().timeIntervalSince1970 * 1000 - ts) / 1000
        if seconds < 60 { return "\(Int(seconds))s ago" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
        return "\(Int(seconds / 86400))d ago"
    }

    static func uptime(_ seconds: Int?) -> String {
        guard let s = seconds else { return "--" }
        let d = s / 86400
        let h = (s % 86400) / 3600
        let m = (s % 3600) / 60
        if d > 0 { return "\(d)d \(h)h" }
        if h > 0 { return "\(h)h \(m)m" }
        return "\(m)m"
    }
}

// MARK: - Connection Bar

struct ConnectionStatusBar: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 8) {
            if appState.isConnected {
                LiveDot(color: FFDesign.positive)
            } else {
                Circle()
                    .fill(FFDesign.negative)
                    .frame(width: 8, height: 8)
            }
            Text(appState.isConnected ? "LIVE" : "DISCONNECTED")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(appState.isConnected ? FFDesign.positive : FFDesign.negative)
                .tracking(0.5)
            Spacer()
            if let lastUpdate = appState.lastUpdate {
                Text(lastUpdate, style: .relative)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(FFDesign.textTertiary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(FFDesign.surface)
    }
}

// MARK: - Empty State

struct EmptyState: View {
    let icon: String
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 40, weight: .light))
                .foregroundColor(FFDesign.textTertiary)
            Text(message)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(FFDesign.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}
