import SwiftUI

// MARK: - Splash View

/// Cinematic launch screen shown once on cold start.
/// Auto-dismisses after ~2 seconds, driving a binding that the
/// parent uses to cross-fade into the main content.
struct SplashView: View {

    @Binding var isPresented: Bool

    // MARK: Animation State

    @State private var iconScale: CGFloat     = 0.5
    @State private var wordmarkOpacity: Double = 0.0
    @State private var wordmarkScale: CGFloat  = 0.8
    @State private var glowOpacity: Double     = 0.0
    @State private var glowScale: CGFloat      = 0.85
    @State private var footerOpacity: Double   = 0.0

    @State private var statusPhase: StatusPhase = .initializing
    @State private var activeDot: Int = 0

    // Timer that drives the loading-dot animation.
    private let dotTimer = Timer.publish(every: 0.3, on: .main, in: .common).autoconnect()

    // MARK: Body

    var body: some View {
        ZStack {
            // -- Full-bleed background
            FFDesign.background.ignoresSafeArea()

            // -- Radial accent glow (breathes behind the logo)
            RadialGradient(
                colors: [
                    FFDesign.accent.opacity(0.25),
                    FFDesign.accent.opacity(0.08),
                    Color.clear
                ],
                center: .center,
                startRadius: 0,
                endRadius: 180
            )
            .scaleEffect(glowScale)
            .opacity(glowOpacity)
            .ignoresSafeArea()

            // -- Centered content stack
            VStack(spacing: 0) {
                Spacer()

                logoGroup
                statusGroup

                Spacer()

                footerLabel
            }
            .padding(.bottom, 48)
        }
        .onAppear(perform: runEntrySequence)
    }

    // MARK: - Sub-views

    /// Shield icon + wordmark.
    private var logoGroup: some View {
        VStack(spacing: 16) {
            Image(systemName: "shield.checkered")
                .font(.system(size: 56, weight: .thin))
                .foregroundStyle(
                    LinearGradient(
                        colors: [FFDesign.accent, FFDesign.accent.opacity(0.6)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .scaleEffect(iconScale)

            Text("FreedomForge")
                .font(.system(size: 34, weight: .semibold, design: .default))
                .tracking(1.5)
                .foregroundStyle(.white)
                .opacity(wordmarkOpacity)
                .scaleEffect(wordmarkScale)
        }
    }

    /// Animated status text + loading dots.
    private var statusGroup: some View {
        VStack(spacing: 12) {
            // Status line
            Text(statusPhase.label)
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundStyle(statusPhase.color)
                .contentTransition(.numericText())
                .animation(.easeInOut(duration: 0.3), value: statusPhase)
                .padding(.top, 28)

            // Loading dots
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(FFDesign.accent)
                        .frame(width: 5, height: 5)
                        .opacity(activeDot == index ? 1.0 : 0.2)
                        .scaleEffect(activeDot == index ? 1.4 : 1.0)
                        .animation(.easeInOut(duration: 0.25), value: activeDot)
                }
            }
            .opacity(statusPhase == .live ? 0 : 1)
            .animation(.easeOut(duration: 0.2), value: statusPhase)
        }
        .onReceive(dotTimer) { _ in
            guard statusPhase != .live else { return }
            activeDot = (activeDot + 1) % 3
        }
    }

    /// Dim institutional footer.
    private var footerLabel: some View {
        Text("INSTITUTIONAL TRADING PLATFORM")
            .font(.system(size: 10, weight: .regular, design: .monospaced))
            .tracking(2)
            .foregroundStyle(.white.opacity(0.18))
            .opacity(footerOpacity)
    }

    // MARK: - Animation Sequence

    private func runEntrySequence() {
        // Phase 1: Icon bounces in + glow appears (immediate)
        withAnimation(.spring(response: 0.6, dampingFraction: 0.55, blendDuration: 0)) {
            iconScale = 1.0
        }
        withAnimation(.easeOut(duration: 0.8)) {
            glowOpacity = 1.0
        }

        // Phase 2: Wordmark fades in after a short delay
        withAnimation(.spring(response: 0.5, dampingFraction: 0.7, blendDuration: 0).delay(0.3)) {
            wordmarkOpacity = 1.0
            wordmarkScale = 1.0
        }

        // Phase 2b: Footer fades in
        withAnimation(.easeIn(duration: 0.6).delay(0.5)) {
            footerOpacity = 1.0
        }

        // Phase 3: Glow breathe loop
        startGlowBreathing()

        // Phase 4: Status transitions
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            withAnimation {
                statusPhase = .connecting
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation {
                statusPhase = .live
            }
        }

        // Phase 5: Dismiss splash
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            withAnimation(.easeInOut(duration: 0.4)) {
                isPresented = false
            }
        }
    }

    private func startGlowBreathing() {
        withAnimation(
            .easeInOut(duration: 1.6)
            .repeatForever(autoreverses: true)
        ) {
            glowScale = 1.15
            glowOpacity = 0.7
        }
    }
}

// MARK: - Status Phase

private enum StatusPhase: Equatable {
    case initializing
    case connecting
    case live

    var label: String {
        switch self {
        case .initializing: return "Initializing systems..."
        case .connecting:   return "Connecting..."
        case .live:         return "LIVE"
        }
    }

    var color: Color {
        switch self {
        case .initializing: return .white.opacity(0.5)
        case .connecting:   return FFDesign.accent.opacity(0.8)
        case .live:         return FFDesign.positive
        }
    }
}

// MARK: - Preview

#Preview {
    SplashView(isPresented: .constant(true))
}
