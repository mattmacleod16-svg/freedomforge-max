# $FORGE Tokenomics — FreedomForge Max

## Token Overview

| Property | Value |
|----------|-------|
| **Name** | FreedomForge |
| **Symbol** | $FORGE |
| **Standard** | ERC-20 |
| **Decimals** | 18 |
| **Max Supply** | 1,000,000,000 (1 billion) |
| **Initial Networks** | Ethereum, Base, Polygon |
| **Contract** | `contracts/FreedomForgeToken.sol` |

---

## Token Allocation

| Category | Allocation | Tokens | Vesting |
|----------|-----------|--------|---------|
| **Community & Ecosystem** | 40% | 400,000,000 | 10% at TGE, 24-month linear |
| **Treasury & Operations** | 20% | 200,000,000 | 6-month cliff, 36-month linear |
| **Team & Advisors** | 15% | 150,000,000 | 12-month cliff, 24-month linear |
| **Liquidity Provision** | 10% | 100,000,000 | Unlocked at TGE |
| **Staking Rewards** | 10% | 100,000,000 | Released over 48 months |
| **Strategic Partners** | 5% | 50,000,000 | 6-month cliff, 18-month linear |

### Allocation Rationale

- **Community (40%)**: Largest allocation ensures decentralized governance and broad distribution. Includes airdrops to early users, knowledge base contributors, and prediction market participants.
- **Treasury (20%)**: Funds autonomous trading operations, model inference costs, infrastructure, and growth initiatives. Managed by the Autonomy Director with governance oversight.
- **Team (15%)**: Aligns long-term incentives with 12-month cliff preventing early dumps.
- **Liquidity (10%)**: Immediate DEX liquidity on Uniswap V3 (ETH/FORGE) and Aerodrome (Base).
- **Staking (10%)**: 48-month emission schedule rewards long-term holders who stake for priority routing.
- **Partners (5%)**: Strategic integrations with prediction markets, DeFi protocols, and AI infrastructure providers.

---

## Utility Model

### 1. Premium AI Access
- **Base tier** (free): Standard multi-model consensus (3 models)
- **$FORGE holders**: Extended consensus (5+ models), frontier reasoning mode, max intelligence ensembles
- **Stakers**: Priority queue routing, dedicated inference capacity

### 2. Revenue Sharing
- 20% of autonomous trading profits distributed to $FORGE stakers weekly
- Revenue from the existing distribution system (`distributeRevenue()`) allocates to staker pool
- Pro-rata based on staked amount and duration

### 3. Governance
- 1 FORGE = 1 vote on:
  - Model routing priorities (which AI models get preference)
  - Risk parameter tuning (circuit breakers, drawdown limits)
  - Treasury allocation (how operational funds are deployed)
  - New chain/protocol integrations
  - Fee structure changes
- Quadratic voting for major protocol upgrades

### 4. Knowledge Base Rewards
- Contributors earn $FORGE for ingesting quality documents into the skills matrix
- Quality score determines reward multiplier (0.5x to 3x)
- Auto-discovery of new skills grants discovery bounties

### 5. Prediction Market Staking
- Stake $FORGE on forecast outcomes to earn accuracy-weighted rewards
- Brier score calibration determines reward efficiency
- Creates skin-in-the-game alignment for forecast accuracy

---

## Deflationary Mechanisms

### Burn Events
- **Query burns**: 0.1% of $FORGE used for premium queries is burned
- **Accuracy burns**: Poorly calibrated forecasts trigger small token burns
- **Quarterly burns**: Treasury performs discretionary burns based on revenue

### Supply Schedule
| Year | Circulating Supply | Notes |
|------|-------------------|-------|
| TGE | ~150M (15%) | Liquidity + Community TGE + unlocked |
| Year 1 | ~400M (40%) | Community vesting, staking rewards begin |
| Year 2 | ~650M (65%) | Team cliff ends, full community unlock |
| Year 3 | ~850M (85%) | Treasury fully unlocked |
| Year 4 | ~950M (95%) | Staking rewards tapering |
| Year 5+ | Deflationary | Burns exceed new emissions |

---

## Anti-Whale Protections

- **Max transfer**: 1% of total supply per transaction (10M FORGE)
- **Owner-adjustable**: Minimum 0.1% floor to prevent lockout
- **Exemptions**: Treasury, liquidity pools, vesting contracts
- **Pause mechanism**: Emergency pause on all transfers if exploit detected

---

## Staking Design

### Priority Routing Tiers

| Tier | Stake Required | Benefits |
|------|---------------|----------|
| **Bronze** | 1,000 FORGE | 5-model consensus, standard queue |
| **Silver** | 10,000 FORGE | 7-model consensus, priority queue |
| **Gold** | 100,000 FORGE | Full ensemble (13+ models), dedicated capacity |
| **Platinum** | 1,000,000 FORGE | Max intelligence mode, custom model routing |

### Staking Mechanics
- No lockup period (unstake anytime)
- Revenue share calculated weekly based on time-weighted average stake
- Staking rewards emitted from the 10% allocation over 48 months
- Compound staking: rewards auto-stake if not claimed within 30 days

---

## Multi-Chain Strategy

### Phase 1 (Launch)
- **Ethereum Mainnet**: Primary deployment, governance, staking
- **Base**: Low-cost trading, DEX liquidity (Aerodrome)

### Phase 2 (3 months)
- **Polygon**: High-throughput prediction market interactions
- **Arbitrum**: DeFi yield optimization integrations

### Phase 3 (6 months)
- **Solana**: SPL token bridge for Solana-native DeFi
- **MultiversX**: Existing integration expansion

---

## Revenue Model

### Revenue Sources
1. **Autonomous trading** — Prediction markets, DeFi yields, arbitrage
2. **Premium subscriptions** — $FORGE-gated AI features
3. **Knowledge base access** — API access to curated intelligence
4. **Inference fees** — Pay-per-query for non-holders

### Revenue Distribution
- 20% → $FORGE stakers (weekly)
- 30% → Treasury (operational costs, inference, gas)
- 20% → Development fund (team, infrastructure)
- 15% → Buyback & burn
- 15% → Community rewards pool

---

## Security

### Contract Security
- Self-contained OpenZeppelin patterns (Ownable, Pausable, ReentrancyGuard)
- Anti-whale transfer limits
- Emergency pause capability
- Vesting with cliff enforcement
- No mint function post-deployment (fixed supply)

### Operational Security
- HMAC-SHA256 integrity manifest on all state files
- Timing-safe authentication on all API endpoints
- Rate limiting on token-related endpoints
- Cross-device sync with vector clock conflict resolution

---

## Deployment Checklist

- [ ] Deploy to testnet (Sepolia / Base Sepolia)
- [ ] Security audit (internal review)
- [ ] Set `PAYOUT_TOKEN_ADDRESS` to deployed contract
- [ ] Add contract to `TRACKED_TOKENS` for balance monitoring
- [ ] Create Uniswap V3 pool (ETH/FORGE)
- [ ] Configure staking rewards emission schedule
- [ ] Enable governance voting contract
- [ ] Update X automation with token launch content
- [ ] Announce on all social channels
