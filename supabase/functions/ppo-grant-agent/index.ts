// supabase/functions/ppo-grant-agent/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_KEY')!,
)

// ── Types ──────────────────────────────────────────────────────────────────

interface GrantApplication {
  id: string
  applicant_id: string
  amount_requested: number   // USD
  sector: string             // 'tech' | 'health' | 'edu' | 'env' | 'other'
  impact_score: number       // 0–1 estimated social impact
  track_record: number       // 0–1 applicant history score
  urgency: number            // 0–1 urgency level
}

interface PolicyEntry {
  action_probs: number[]     // [approve, partial_approve, deny]
  action: number             // sampled action index (stored for online feedback)
  value_estimate: number     // expected return
  log_probs: number[]        // log of each action probability
}

interface TrajectoryStep {
  state: number[]
  action: number
  reward: number
  value: number
  log_prob: number
}

interface PPOConfig {
  clip_epsilon: number       // PPO clipping parameter (default 0.2)
  gamma: number              // Discount factor
  lambda_gae: number         // GAE lambda
  lr: number                 // Learning rate
  epochs: number             // Update epochs per batch
  entropy_coef: number       // Entropy bonus coefficient
  value_coef: number         // Value loss coefficient
}

interface WeightSnapshot {
  policy: number[][]
  value: number[]
}

// ── PPO Grant Agent ────────────────────────────────────────────────────────

class PPOGrantAgent {
  policy: Map<string, PolicyEntry>

  private weights: number[][]      // Linear policy weights [actions × state_size]
  private valueWeights: number[]   // Linear value-function weights [state_size]
  private config: PPOConfig
  private readonly stateSize = 6   // [amount_norm, impact, track_record, urgency, sector_norm, bias]
  private readonly actionSize = 3  // approve, partial_approve, deny

  constructor(config?: Partial<PPOConfig>) {
    this.policy = new Map<string, PolicyEntry>()
    this.config = {
      clip_epsilon: 0.2,
      gamma: 0.99,
      lambda_gae: 0.95,
      lr: 3e-4,
      epochs: 4,
      entropy_coef: 0.01,
      value_coef: 0.5,
      ...config,
    }

    // Xavier-like init for linear layers
    const scale = Math.sqrt(2 / (this.stateSize + this.actionSize))
    this.weights = Array.from({ length: this.actionSize }, () =>
      Array.from({ length: this.stateSize }, () => (Math.random() - 0.5) * scale),
    )
    this.valueWeights = Array.from(
      { length: this.stateSize },
      () => (Math.random() - 0.5) * scale,
    )
  }

  // ── Feature extraction ────────────────────────────────────────────────────

  extractFeatures(app: GrantApplication): number[] {
    const SECTOR_MAP: Record<string, number> = {
      tech: 0, health: 1, edu: 2, env: 3, other: 4,
    }
    const MAX_GRANT = 1_000_000 // normalize to $1 M cap
    const maxSector = Math.max(...Object.values(SECTOR_MAP)) // avoid hardcoding max sector code
    return [
      Math.min(app.amount_requested / MAX_GRANT, 1),
      Math.max(0, Math.min(1, app.impact_score)),
      Math.max(0, Math.min(1, app.track_record)),
      Math.max(0, Math.min(1, app.urgency)),
      (SECTOR_MAP[app.sector] ?? maxSector) / maxSector,  // encode sector as 0–1
      1.0,                                                  // bias term
    ]
  }

  // ── Forward pass ─────────────────────────────────────────────────────────

  private dot(a: number[], b: number[]): number {
    return a.reduce((sum, v, i) => sum + v * b[i], 0)
  }

  private softmax(logits: number[]): number[] {
    const max = Math.max(...logits)
    const exps = logits.map(l => Math.exp(l - max))
    const total = exps.reduce((a, b) => a + b, 0)
    return exps.map(e => e / total)
  }

  private forward(state: number[]): { logits: number[]; value: number } {
    const logits = this.weights.map(w => this.dot(w, state))
    const value = this.dot(this.valueWeights, state)
    return { logits, value }
  }

  // ── Sample action from policy ─────────────────────────────────────────────

  private sampleAction(probs: number[]): number {
    const rand = Math.random()
    let cumulative = 0
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i]
      if (rand < cumulative) return i
    }
    return probs.length - 1
  }

  selectAction(state: number[]): { action: number; probs: number[]; logProb: number; value: number } {
    const { logits, value } = this.forward(state)
    const probs = this.softmax(logits)
    const action = this.sampleAction(probs)
    const logProb = Math.log(Math.max(probs[action], 1e-8))
    return { action, probs, logProb, value }
  }

  // ── Evaluate a grant application ──────────────────────────────────────────

  evaluate(app: GrantApplication): {
    decision: 'approve' | 'partial_approve' | 'deny'
    confidence: number
    recommended_amount: number
    reasoning: string
  } {
    const state = this.extractFeatures(app)
    const { action, probs, logProb, value } = this.selectAction(state)

    const ACTIONS = ['approve', 'partial_approve', 'deny'] as const
    const decision = ACTIONS[action]
    const confidence = probs[action]

    let recommended_amount = 0
    let reasoning = ''

    if (decision === 'approve') {
      recommended_amount = app.amount_requested
      reasoning =
        `Full approval — impact ${(app.impact_score * 100).toFixed(1)}%, ` +
        `track record ${(app.track_record * 100).toFixed(1)}%`
    } else if (decision === 'partial_approve') {
      const quality = (app.impact_score + app.track_record) / 2
      recommended_amount = Math.round(app.amount_requested * quality)
      reasoning =
        `Partial approval at ${(quality * 100).toFixed(1)}% of requested — ` +
        `moderate profile, further review recommended`
    } else {
      recommended_amount = 0
      reasoning = 'Denied — insufficient evidence of impact or track record for requested funding'
    }

    // Cache policy entry for online feedback
    this.policy.set(app.id, {
      action_probs: probs,
      action,
      value_estimate: value,
      log_probs: probs.map(p => Math.log(Math.max(p, 1e-8))),
    })

    return { decision, confidence, recommended_amount, reasoning }
  }

  // ── GAE advantage estimation ──────────────────────────────────────────────

  private computeAdvantages(trajectory: TrajectoryStep[]): number[] {
    const advantages = new Array<number>(trajectory.length).fill(0)
    let gae = 0

    for (let t = trajectory.length - 1; t >= 0; t--) {
      const nextValue = t + 1 < trajectory.length ? trajectory[t + 1].value : 0
      const delta = trajectory[t].reward + this.config.gamma * nextValue - trajectory[t].value
      gae = delta + this.config.gamma * this.config.lambda_gae * gae
      advantages[t] = gae
    }

    return advantages
  }

  // ── PPO policy update ─────────────────────────────────────────────────────

  update(trajectory: TrajectoryStep[]): { policyLoss: number; valueLoss: number; entropy: number } {
    if (trajectory.length === 0) {
      return { policyLoss: 0, valueLoss: 0, entropy: 0 }
    }

    const advantages = this.computeAdvantages(trajectory)

    // Normalise advantages
    const mean = advantages.reduce((a, b) => a + b, 0) / advantages.length
    const std = Math.sqrt(
      advantages.reduce((a, b) => a + (b - mean) ** 2, 0) / advantages.length + 1e-8,
    )
    const normAdv = advantages.map(a => (a - mean) / std)

    let totalPolicyLoss = 0
    let totalValueLoss = 0
    let totalEntropy = 0

    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      for (let t = 0; t < trajectory.length; t++) {
        const { state, action, log_prob: oldLogProb, reward } = trajectory[t]
        const adv = normAdv[t]

        const { logits, value } = this.forward(state)
        const probs = this.softmax(logits)
        const newLogProb = Math.log(Math.max(probs[action], 1e-8))

        // PPO clipped surrogate objective
        const ratio = Math.exp(newLogProb - oldLogProb)
        const clipped = Math.max(
          1 - this.config.clip_epsilon,
          Math.min(1 + this.config.clip_epsilon, ratio),
        )
        const policyLoss = -Math.min(ratio * adv, clipped * adv)

        // Value loss (TD target)
        const nextValue = t + 1 < trajectory.length ? trajectory[t + 1].value : 0
        const returns = reward + this.config.gamma * nextValue
        const valueLoss = 0.5 * (value - returns) ** 2

        // Entropy bonus
        const entropy = -probs.reduce(
          (sum, p) => sum + (p > 1e-8 ? p * Math.log(p) : 0),
          0,
        )

        totalPolicyLoss += policyLoss
        totalValueLoss += valueLoss
        totalEntropy += entropy

        // Gradient ascent on the PPO clipped surrogate objective
        const effectiveRatio = ratio <= clipped ? ratio : clipped
        const gradScale = this.config.lr * effectiveRatio * adv
        for (let a = 0; a < this.actionSize; a++) {
          const indicator = a === action ? 1 - probs[a] : -probs[a]
          for (let s = 0; s < this.stateSize; s++) {
            this.weights[a][s] += gradScale * indicator * state[s]
          }
        }

        // Gradient descent on value weights
        const vGrad = this.config.lr * this.config.value_coef * (value - returns)
        for (let s = 0; s < this.stateSize; s++) {
          this.valueWeights[s] -= vGrad * state[s]
        }
      }
    }

    const n = trajectory.length * this.config.epochs
    return {
      policyLoss: totalPolicyLoss / n,
      valueLoss: totalValueLoss / n,
      entropy: totalEntropy / n,
    }
  }

  // ── Weight serialisation ──────────────────────────────────────────────────

  serializeWeights(): WeightSnapshot {
    return {
      policy: this.weights.map(row => [...row]),
      value: [...this.valueWeights],
    }
  }

  loadWeights(data: WeightSnapshot): void {
    if (
      Array.isArray(data.policy) &&
      data.policy.length === this.actionSize &&
      Array.isArray(data.value) &&
      data.value.length === this.stateSize
    ) {
      this.weights = data.policy.map(row => [...row])
      this.valueWeights = [...data.value]
    }
  }
}

// ── CORS headers ───────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// ── Singleton agent (reused across warm invocations in the same isolate) ───

const agent = new PPOGrantAgent()

// ── Supabase persistence helpers ───────────────────────────────────────────

const AGENT_ID = 'ppo-grant-agent'

async function loadAgentWeights(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('ppo_agent_state')
      .select('weights')
      .eq('agent_id', AGENT_ID)
      .single()

    if (!error && data?.weights) {
      agent.loadWeights(data.weights as WeightSnapshot)
      console.log('[ppo-grant-agent] Weights loaded from DB')
    }
  } catch (e) {
    console.warn('[ppo-grant-agent] Could not load weights:', e)
  }
}

async function saveAgentWeights(): Promise<void> {
  try {
    await supabase.from('ppo_agent_state').upsert({
      agent_id: AGENT_ID,
      weights: agent.serializeWeights(),
      updated_at: new Date().toISOString(),
    })
    console.log('[ppo-grant-agent] Weights saved to DB')
  } catch (e) {
    console.warn('[ppo-grant-agent] Could not save weights:', e)
  }
}

// ── HTTP handler ───────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/functions\/v1\/ppo-grant-agent/, '') || '/'

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })

  try {
    // ── GET / or /health ────────────────────────────────────────────────────
    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      return json({
        status: 'ok',
        agent: AGENT_ID,
        policy_cache_size: agent.policy.size,
      })
    }

    // ── POST /evaluate ──────────────────────────────────────────────────────
    // Body: { applications: GrantApplication[] }
    if (req.method === 'POST' && path === '/evaluate') {
      await loadAgentWeights()
      const { applications } = (await req.json()) as { applications: GrantApplication[] }

      if (!Array.isArray(applications) || applications.length === 0) {
        return json({ error: '"applications" must be a non-empty array' }, 400)
      }

      const results = applications.map(app => ({
        id: app.id,
        ...agent.evaluate(app),
      }))

      return json({ success: true, results })
    }

    // ── POST /train ─────────────────────────────────────────────────────────
    // Body: { trajectory: TrajectoryStep[] }
    if (req.method === 'POST' && path === '/train') {
      await loadAgentWeights()
      const { trajectory } = (await req.json()) as { trajectory: TrajectoryStep[] }

      if (!Array.isArray(trajectory) || trajectory.length === 0) {
        return json({ error: '"trajectory" must be a non-empty array' }, 400)
      }

      const metrics = agent.update(trajectory)
      await saveAgentWeights()
      return json({ success: true, metrics })
    }

    // ── POST /feedback ──────────────────────────────────────────────────────
    // Online RL: provide outcome reward for a previously evaluated application.
    // Body: { application: GrantApplication, reward: number }
    if (req.method === 'POST' && path === '/feedback') {
      await loadAgentWeights()
      const { application, reward } = (await req.json()) as {
        application: GrantApplication
        reward: number
      }

      if (!application || typeof reward !== 'number') {
        return json({ error: '"application" and numeric "reward" are required' }, 400)
      }

      const cached = agent.policy.get(application.id)
      if (!cached) {
        return json(
          { error: 'No cached policy entry for this application id — call /evaluate first' },
          404,
        )
      }

      const state = agent.extractFeatures(application)
      const step: TrajectoryStep = {
        state,
        action: cached.action,
        reward,
        value: cached.value_estimate,
        log_prob: cached.log_probs[cached.action],
      }

      const metrics = agent.update([step])
      await saveAgentWeights()
      return json({ success: true, metrics })
    }

    return json(
      {
        error: 'Not found',
        available_endpoints: [
          'GET  /health',
          'POST /evaluate  — body: { applications: GrantApplication[] }',
          'POST /train     — body: { trajectory: TrajectoryStep[] }',
          'POST /feedback  — body: { application: GrantApplication, reward: number }',
        ],
      },
      404,
    )
  } catch (err) {
    console.error('[ppo-grant-agent] Unhandled error:', err)
    return json({ error: 'Internal server error', message: (err as Error).message }, 500)
  }
})
