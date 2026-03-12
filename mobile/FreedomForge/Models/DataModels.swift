import Foundation

// MARK: - System Summary (GET /api/summary)

struct SystemSummary: Codable {
    let ts: String?
    let system: SystemInfo?
    let equity: EquityInfo?
    let pnl: PnLInfo?
    let trading: TradingInfo?
    let risk: RiskInfo?
    let brain: BrainInfo?
    let signals: SignalInfo?
    let margin: MarginInfo?
    let capital: CapitalInfo?

    struct SystemInfo: Codable {
        let status: String?
        let uptime: Int?
        let capitalMode: String?
    }
    struct EquityInfo: Codable {
        let current: Double?
        let peak: Double?
        let drawdownPct: Double?
    }
    struct PnLInfo: Codable {
        let daily: Double?
        let total30d: Double?
    }
    struct TradingInfo: Codable {
        let openTrades: Int?
        let winRate: Double?
        let profitFactor: Double?
        let sharpe: Double?
        let totalTrades30d: Int?
    }
    struct RiskInfo: Codable {
        let killSwitch: Bool?
        let exposure: Double?
        let maxExposure: Double?
        let utilizationPct: Double?
        let positions: Int?
    }
    struct BrainInfo: Codable {
        let generation: Int?
        let calibration: Double?
        let streak: Int?
    }
    struct SignalInfo: Codable {
        let total: Int?
        let types: Int?
    }
    struct MarginInfo: Codable {
        let coinbase: VenueMarginBrief?
        let kraken: VenueMarginBrief?
    }
    struct VenueMarginBrief: Codable {
        let marginPct: Double?
        let healthy: Bool?
    }
    struct CapitalInfo: Codable {
        let mode: String?
        let initial: Double?
        let hwm: Double?
        let roi: Double?
    }
}

// MARK: - Portfolio (GET /api/portfolio)

struct PortfolioData: Codable {
    let ts: String?
    let exposure: ExposureData?
    let correlation: CorrelationData?

    struct ExposureData: Codable {
        let totalExposure: Double?
        let netExposure: Double?
        let totalLong: Double?
        let totalShort: Double?
        let assetExposure: [String: Double]?
        let venueExposure: [String: Double]?
    }
    struct CorrelationData: Codable {
        let diversificationScore: Double?
        let alerts: [CorrelationAlert]?
    }
    struct CorrelationAlert: Codable {
        let type: String?
        let severity: String?
        let message: String?
    }
}

// MARK: - Trades (GET /api/trades)

struct TradesData: Codable {
    let ts: String?
    let trades: [Trade]?
    let stats: TradeStats?
}

struct Trade: Codable, Identifiable {
    let id: String?
    let venue: String?
    let asset: String?
    let side: String?
    let entryPrice: Double?
    let usdSize: Double?
    let exitPrice: Double?
    let pnl: Double?
    let pnlPercent: Double?
    let fees: Double?
    let dryRun: Bool?
    let entryAt: String?
    let entryTs: Double?
    let closedAt: String?
    let signal: TradeSignal?

    var displayId: String { id ?? UUID().uuidString }

    struct TradeSignal: Codable {
        let side: String?
        let confidence: Double?
        let edge: Double?
        let compositeScore: Double?
    }
}

struct TradeStats: Codable {
    let totalTrades: Int?
    let closedTrades: Int?
    let openTrades: Int?
    let winRate: Double?
    let profitFactor: Double?
    let totalPnl: Double?
    let totalFees: Double?
    let totalVolume: Double?
    let avgWin: Double?
    let avgLoss: Double?
    let sharpeRatio: Double?
    let maxDrawdown: Double?
}

// MARK: - Risk (GET /api/risk)

struct RiskData: Codable {
    let ts: String?
    let health: RiskHealth?
    let exposure: PortfolioData.ExposureData?
    let killSwitch: KillSwitchInfo?
    let riskEvents: [RiskEvent]?

    struct RiskHealth: Codable {
        let killSwitchActive: Bool?
        let healthy: Bool?
        let currentEquity: Double?
        let peakEquity: Double?
        let drawdownPct: Double?
        let maxDrawdownPct: Double?
        let dailyPnl: Double?
        let maxDailyLoss: Double?
        let totalExposure: Double?
        let maxExposure: Double?
        let utilizationPct: Double?
        let positionCount: Int?
    }
    struct KillSwitchInfo: Codable {
        let active: Bool?
        let reason: String?
    }
    struct RiskEvent: Codable {
        let type: String?
        let reason: String?
        let ts: Double?
    }
}

// MARK: - Capital (GET /api/capital)

struct CapitalData: Codable {
    let ts: String?
    let mandate: MandateSummary?
    let capital: CapitalBreakdown?
    let treasury: TreasuryLedger?

    struct MandateSummary: Codable {
        let mode: String?
        let initialCapital: Double?
        let highWaterMark: Double?
        let lowWaterMark: Double?
        let roiPct: Double?
        let totalDaysActive: Int?
        let consecutiveWinDays: Int?
        let consecutiveLossDays: Int?
        let tradeDenials: Int?
        let capitalHaltEvents: Int?
        let survivalModeEntries: Int?
    }
    struct CapitalBreakdown: Codable {
        let total: Double?
        let coinbase: Double?
        let kraken: Double?
    }
    struct TreasuryLedger: Codable {
        let lifetimePnl: Double?
        let lifetimeGrossProfit: Double?
        let lifetimeGrossLoss: Double?
        let lifetimeTrades: Int?
        let lifetimeWins: Int?
        let lifetimeLosses: Int?
        let lifetimePayouts: Double?
        let lifetimeCompounded: Double?
        let currentCapital: Double?
        let peakCapital: Double?
        let maxDrawdownPct: Double?
        let dailySnapshots: [DailySnapshot]?
    }
    struct DailySnapshot: Codable {
        let date: String?
        let pnl: Double?
        let trades: Int?
        let wins: Int?
        let capital: Double?
        let cumulativePnl: Double?
    }
}

// MARK: - Brain (GET /api/brain)

struct BrainData: Codable {
    let ts: String?
    let insights: BrainInsights?
    let weights: [String: Double]?
    let thresholds: [String: AnyCodable]?
    let shouldTrade: ShouldTrade?
    let state: BrainState?

    struct BrainInsights: Codable {
        let totalEvolutions: Int?
        let calibrationScore: Double?
        let streak: Int?
        let lastEvolution: String?
    }
    struct ShouldTrade: Codable {
        let trade: Bool?
        let reason: String?
        let reducedSize: Bool?
    }
    struct BrainState: Codable {
        let generation: Int?
        let regimeProfiles: [String: RegimeProfile]?
        let timePatterns: TimePatterns?
        let calibration: Calibration?
    }
    struct RegimeProfile: Codable {
        let wins: Int?
        let losses: Int?
    }
    struct TimePatterns: Codable {
        let bestHours: [Int]?
        let worstHours: [Int]?
        let bestDays: [Int]?
        let worstDays: [Int]?
    }
    struct Calibration: Codable {
        let calibrationScore: Double?
    }
}

// MARK: - ML (GET /api/ml)

struct MLData: Codable {
    let ts: String?
    let model: MLModel?
    let featureImportance: [String: Int]?
    let featureStoreSamples: Int?

    struct MLModel: Codable {
        let trainAccuracy: Double?
        let valAccuracy: Double?
        let sampleCount: Int?
        let stumpCount: Int?
        let featureNames: [String]?
        let lastTrainedAt: String?
    }
}

// MARK: - Signals (GET /api/signals)

struct SignalsData: Codable {
    let ts: String?
    let summary: SignalSummary?
    let signals: [Signal]?

    struct SignalSummary: Codable {
        let totalSignals: Int?
        let types: [String: SignalTypeInfo]?
    }
    struct SignalTypeInfo: Codable {
        let count: Int?
        let avgConfidence: Double?
        let sources: [String]?
    }
}

struct Signal: Codable, Identifiable {
    let id: String?
    let type: String?
    let source: String?
    let confidence: Double?
    let publishedAt: Double?
    let ttlMs: Double?
}

// MARK: - Strategies (GET /api/strategies)

struct StrategiesData: Codable {
    let ts: String?
    let activeStrategies: [Strategy]?
    let allStrategies: [Strategy]?

    struct Strategy: Codable, Identifiable {
        let name: String?
        let status: String?
        let author: String?
        let createdAt: String?
        let performance: StrategyPerformance?

        var id: String { name ?? UUID().uuidString }
    }
    struct StrategyPerformance: Codable {
        let winRate: Double?
        let sharpe: Double?
        let trades: Int?
        let avgPnl: Double?
    }
}

// MARK: - Margin (GET /api/margin)

struct MarginData: Codable {
    let ts: String?
    let coinbase: VenueMargin?
    let kraken: VenueMargin?
    let emergencyCloses: Int?
    let blockedTrades: Int?
    let lastCheck: Double?
    let recentActions: [MarginAction]?

    struct VenueMargin: Codable {
        let health: VenueHealth?
        let state: VenueState?
    }
    struct VenueHealth: Codable {
        let marginPct: Double?
        let liquidationBuffer: Double?
        let totalBalance: Double?
        let futuresBalance: Double?
        let spotBalance: Double?
        let initialMargin: Double?
        let unrealizedPnl: Double?
        let positions: [Position]?
        let healthy: Bool?
        let equity: Double?
        let marginUsed: Double?
        let freeMargin: Double?
        let marginLevel: Double?
    }
    struct VenueState: Codable {
        let marginPct: Double?
        let healthy: Bool?
    }
    struct Position: Codable {
        let productId: String?
        let side: String?
        let contracts: Int?
        let currentPrice: Double?
        let unrealizedPnl: Double?
        let pair: String?
        let type: String?
        let volume: Double?
        let pnl: Double?
    }
    struct MarginAction: Codable {
        let venue: String?
        let action: String?
        let ts: Double?
        let closed: Bool?
    }
}

// MARK: - Infrastructure (GET /api/infrastructure)

struct InfrastructureData: Codable {
    let ts: String?
    let system: SystemDetail?
    let cpu: CPUInfo?
    let memory: MemoryInfo?
    let disk: DiskInfo?
    let node: NodeInfo?
    let watchdog: WatchdogInfo?
    let agents: [String: AgentInfo]?
    let circuits: [CircuitInfo]?
    let venuePerformance: [String: VenuePerf]?

    struct SystemDetail: Codable {
        let hostname: String?
        let platform: String?
        let arch: String?
        let nodeVersion: String?
        let uptime: Int?
        let osUptime: Int?
    }
    struct CPUInfo: Codable {
        let usagePct: Double?
        let cores: Int?
    }
    struct MemoryInfo: Codable {
        let usagePct: Double?
        let totalMB: Int?
        let usedMB: Int?
        let freeMB: Int?
    }
    struct DiskInfo: Codable {
        let usagePct: Double?
    }
    struct NodeInfo: Codable {
        let rss: Int?
        let heapTotal: Int?
        let heapUsed: Int?
    }
    struct WatchdogInfo: Codable {
        let running: Bool?
    }
    struct AgentInfo: Codable {
        let alive: Bool?
        let lastSeen: Double?
        let staleSec: Double?
    }
    struct CircuitInfo: Codable, Identifiable {
        let name: String?
        let status: String?
        let failures: Int?
        var id: String { name ?? UUID().uuidString }
    }
    struct VenuePerf: Codable {
        let attempts: Int?
        let successes: Int?
        let placed: Int?
        let errors: Int?
        let consecutiveErrors: Int?
    }
}

// MARK: - Log Events

struct LogEvent: Codable, Identifiable {
    let ts: String?
    let time: String?
    let level: String?
    let msg: String?
    let agent: String?
    let type: String?

    var id: String { (ts ?? time ?? "") + (msg ?? "") + (agent ?? "") }
    var timestamp: String { ts ?? time ?? "" }
    var message: String { msg ?? type ?? "Unknown" }
}

struct RecentEventsResponse: Codable {
    let ts: String?
    let events: [LogEvent]
}

// MARK: - SSE Event

struct SSEEvent {
    let event: String
    let data: String
    let id: String?
}

// MARK: - Flexible JSON Decoding

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Double.self) { value = v }
        else if let v = try? container.decode(Int.self) { value = v }
        else if let v = try? container.decode(String.self) { value = v }
        else if let v = try? container.decode(Bool.self) { value = v }
        else if let v = try? container.decode([String: AnyCodable].self) { value = v }
        else if let v = try? container.decode([AnyCodable].self) { value = v }
        else { value = "null" }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let v = value as? Double { try container.encode(v) }
        else if let v = value as? Int { try container.encode(v) }
        else if let v = value as? String { try container.encode(v) }
        else if let v = value as? Bool { try container.encode(v) }
        else { try container.encode("null") }
    }
}
