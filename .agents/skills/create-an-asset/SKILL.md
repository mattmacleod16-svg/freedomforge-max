---
name: create-an-asset
description: Generate tailored sales assets (landing pages, decks, one-pagers, workflow demos) from your deal context. Describe your prospect, audience, and goal — get a polished, branded asset ready to share with customers.
---

---
name: create-an-asset
description: Generate tailored sales assets (landing pages, decks, one-pagers, workflow demos) from your deal context. Describe your prospect, audience, and goal — get a polished, branded asset ready to share with customers.
---

# Create an Asset

Generate custom sales assets tailored to your prospect, audience, and goals. Supports interactive landing pages, presentation decks, executive one-pagers, and workflow/architecture demos.

---

## Triggers

Invoke this skill when:
- User says `/create-an-asset` or `/create-an-asset [CompanyName]`
- User asks to "create an asset", "build a demo", "make a landing page", "mock up a workflow"
- User needs a customer-facing deliverable for a sales conversation

---

## Overview

This skill creates professional sales assets by gathering context about:
- **(a) The Prospect** — company, contacts, conversations, pain points
- **(b) The Audience** — who's viewing, what they care about
- **(c) The Purpose** — goal of the asset, desired next action
- **(d) The Format** — landing page, deck, one-pager, or workflow demo

The skill then researches, structures, and builds a polished, branded asset ready to share with customers.

---

## Phase 0: Context Detection & Input Collection

### Step 0.1: Detect Seller Context

From the user's email domain, identify what company they work for.

**Actions:**
1. Extract domain from user's email
2. Search: `"[domain]" company products services site:linkedin.com OR site:crunchbase.com`
3. Determine seller context:

| Scenario | Action |
|----------|--------|
| **Single-product company** | Auto-populate seller context |
| **Multi-product company** | Ask: "Which product or solution is this asset for?" |
| **Consultant/agency/generic domain** | Ask: "What company or product are you representing?" |
| **Unknown/startup** | Ask: "Briefly, what are you selling?" |

**Store seller context:**
```yaml
seller:
  company: "[Company Name]"
  product: "[Product/Service]"
  value_props:
    - "[Key value prop 1]"
    - "[Key value prop 2]"
    - "[Key value prop 3]"
  differentiators:
    - "[Differentiator 1]"
    - "[Differentiator 2]"
  pricing_model: "[If publicly known]"
```

**Persist to knowledge base** for future sessions. On subsequent invocations, confirm: "I have your seller context from last time — still selling [Product] at [Company]?"

---

### Step 0.2: Collect Prospect Context (a)

**Ask the user:**

| Field | Prompt | Required |
|-------|--------|----------|
| **Company** | "Which company is this asset for?" | ✓ Yes |
| **Key contacts** | "Who are the key contacts? (names, roles)" | No |
| **Deal stage** | "What stage is this deal?" | ✓ Yes |
| **Pain points** | "What pain points or priorities have they shared?" | No |
| **Past materials** | "Upload any conversation materials (transcripts, emails, notes, call recordings)" | No |

**Deal stage options:**
- Intro / First meeting
- Discovery
- Evaluation / Technical review
- POC / Pilot
- Negotiation
- Close

---

### Step 0.3: Collect Audience Context (b)

**Ask the user:**

| Field | Prompt | Required |
|-------|--------|----------|
| **Audience type** | "Who's viewing this?" | ✓ Yes |
| **Specific roles** | "Any specific titles to tailor for? (e.g., CTO, VP Engineering, CFO)" | No |
| **Primary concern** | "What do they care most about?" | ✓ Yes |
| **Objections** | "Any concerns or objections to address?" | No |

**Audience type options:**
- Executive (C-suite, VPs)
- Technical (Architects, Engineers, Developers)
- Operations (Ops, IT, Procurement)
- Mixed / Cross-functional

**Primary concern options:**
- ROI / Business impact
- Technical depth / Architecture
- Strategic alignment
- Risk mitigation / Security
- Implementation / Timeline

---

### Step 0.4: Collect Purpose Context (c)

**Ask the user:**

| Field | Prompt | Required |
|-------|--------|----------|
| **Goal** | "What's the goal of this asset?" | ✓ Yes |
| **Desired action** | "What should the viewer do after seeing this?" | ✓ Yes |

**Goal options:**
- Intro / First impression
- Discovery follow-up
- Technical deep-dive
- Executive alignment / Business case
- POC proposal
- Deal close

---

### Step 0.5: Select Format (d)

**Ask the user:** "What format works best for this?"

| Format | Description | Best For |
|--------|-------------|----------|
| **Interactive landing page** | Multi-tab page with demos, metrics, calculators | Exec alignment, intros, value prop |
| **Deck-style** | Linear slides, presentation-ready | Formal meetings, large audiences |
| **One-pager** | Single-scroll executive summary | Leave-behinds, quick summaries |
| **Workflow / Architecture demo** | Interactive diagram with animated flow | Technical deep-dives, POC demos, integrations |

---

### Step 0.6: Format-Specific Inputs

#### If "Workflow / Architecture demo" selected:

**First, parse from user's description.** Look for:
- Systems and components mentioned
- Data flows described
- Human interaction points
- Example scenarios

**Then ask for any gaps:**

| If Missing... | Ask... |
|---------------|--------|
| Components unclear | "What systems or components are involved? (databases, APIs, AI, middleware, etc.)" |
| Flow unclear | "Walk me through the step-by-step flow" |
| Human touchpoints unclear | "Where does a human interact in this workflow?" |
| Scenario vague | "What's a concrete example scenario to demo?" |
| Integration specifics | "Any specific tools or platforms to highlight?" |

---

## Phase 1: Research (Adaptive)

### Assess Context Richness

| Level | Indicators | Research Depth |
|-------|------------|----------------|
| **Rich** | Transcripts uploaded, detailed pain points, clear requirements | Light — fill gaps only |
| **Moderate** | Some context, no transcripts | Medium — company + industry |
| **Sparse** | Just company name | Deep — full research pass |

### Always Research:

1. **Prospect basics**
   - Search: `"[Company]" annual report investor presentation 2025 2026`
   - Search: `"[Company]" CEO strategy priorities 2025 2026`
   - Extract: Revenue, employees, key metrics, strategic priorities

2. **Leadership**
   - Search: `"[Company]" CEO CTO CIO 2025`
   - Extract: Names, titles, recent quotes on strategy/technology

3. **Brand colors**
   - Search: `"[Company]" brand guidelines`
   - Or extract from company website
   - Store: Primary color, secondary color, accent

### If Moderate/Sparse Context, Also Research:

4. **Industry context**
   - Search: `"[Industry]" trends challenges 2025 2026`
   - Extract: Common pain points, market dynamics

5. **Technology landscape**
   - Search: `"[Company]" technology stack tools platforms`
   - Extract: Current solutions, potential integration points

6. **Competitive context**
   - Search: `"[Company]" vs [seller's competitors]`
   - Extract: Current solutions, switching signals

### If Transcripts/Materials Uploaded:

7. **Conversation analysis**
   - Extract: Stated pain points, decision criteria, objections, timeline
   - Identify: Key quotes to reference (use their exact language)
   - Note: Specific terminology, acronyms, internal project names

---

## Phase 2: Structure Decision

### Interactive Landing Page

| Purpose | Recommended Sections |
|---------|---------------------|
| **Intro** | Company Fit → Solution Overview → Key Use Cases → Why Us → Next Steps |
| **Discovery follow-up** | Their Priorities → How We Help → Relevant Examples → ROI Framework → Next Steps |
| **Technical deep-dive** | Architecture → Security & Compliance → Integration → Performance → Support |
| **Exec alignment** | Strategic Fit → Business Impact → ROI Calculator → Risk Mitigation → Partnership |
| **POC proposal** | Scope → Success Criteria → Timeline → Team → Investment → Next Steps |
| **Deal close** | Value Summary → Pricing → Implementation Plan → Terms → Sign-off |

**Audience adjustments:**
- **Executive**: Lead with business impact, ROI, strategic alignment
- **Technical**: Lead with architecture, security, integration depth
- **Operations**: Lead with workflow impact, change management, support
- **Mixed**: Balance strategic + tactical; use tabs to separate depth levels

---

### Deck-Style

Same sections as landing page, formatted as linear slides:

```
1. Title slide (Prospect + Seller logos, partnership framing)
2. Agenda
3-N. One section per slide (or 2-3 slides for dense sections)
N+1. Summary / Key takeaways
N+2. Next steps / CTA
N+3. Appendix (optional — detailed specs, pricing, etc.)
```

**Slide principles:**
- One key message per slide
- Visual > text-heavy
- Use prospect's metrics and language
- Include speaker notes

---

### One-Pager

Condense to single-scroll format:

```
┌─────────────────────────────────────┐
│ HERO: "[Prospect Goal] with [Product]" │
├─────────────────────────────────────┤
│ KEY POINT 1     │ KEY POINT 2     │ KEY POINT 3     │
│ [Icon + 2-3     │ [Icon + 2-3     │ [Icon + 2-3     │
│  sentences]     │  sentences]     │  sentences]     │
├─────────────────────────────────────┤
│ PROOF POINT: [Metric, quote, or case study] │
├─────────────────────────────────────┤
│ CTA: [Clear next action] │ [Contact info] │
└─────────────────────────────────────┘
```

---

### Workflow / Architecture Demo

**Structure based on complexity:**

| Complexity | Components | Structure |
|------------|------------|-----------|
| **Simple** | 3-5 | Single-view diagram with step annotations |
| **Medium** | 5-10 | Zoomable canvas with step-by-step walkthrough |
| **Complex** | 10+ | Multi-layer view (overview → detailed) with guided tour |

**Standard elements:**

1. **Title bar**: `[Scenario Name] — Powered by [Seller Product]`
2. **Component nodes**: Visual boxes/icons for each system
3. **Flow arrows**: Animated connections showing data movement
4. **Step panel**: Sidebar explaining current step in plain language
5. **Controls**: Play / Pause / Step Forward / Step Back / Reset
6. **Annotations**: Callouts for key decision points and value-adds
7. **Data preview**: Sample payloads or transformations at each step

---

## Phase 3: Content Generation

### General Principles

All content should:
- Reference **specific pain points** from user input or transcripts
- Use **prospect's language** — their terminology, their stated priorities
- Map **seller's product** → **prospect's needs** explicitly
- Include **proof points** where available (case studies, metrics, quotes)
- Feel **tailored, not templated**

---

### Section Templates

#### Hero / Intro
```
Headline: "[Prospect's Goal] with [Seller's Product]"
Subhead: Tie to their stated priority or top industry challenge
Metrics: 3-4 key facts about the prospect (shows we did homework)
```

#### Their Priorities (if discovery follow-up)
```
Reference specific pain points from conversation:
- Use their exact words where possible
- Show we listened and understood
- Connect each to how we help
```

#### Solution Mapping
```
For each pain point:
├── The challenge (in their words)
├── How [Product] addresses it
├── Proof point or example
└── Outcome / benefit
```

#### Use Cases / Demos
```
3-5 relevant use cases:
├── Visual mockup or interactive demo
├── Business impact (quantified if possible)
├── "How it works" — 3-4 step summary
└── Relevant to their industry/role
```

#### ROI / Business Case
```
Interactive calculator with:
├── Inputs relevant to their business (from research)
│   ├── Number of users/developers
│   ├── Current costs or time spent
│   └── Expected improvement %
├── Outputs:
│   ├── Annual value / savings
│   ├── Cost of solution
│   ├── Net ROI
│   └── Payback period
└── Assumptions clearly stated (editable)
```

#### Why Us / Differentiators
```
├── Differentiators vs. alternatives they might consider
├── Trust, security, compliance positioning
├── Support and partnership model
└── Customer proof points (logos, quotes, case studies)
```

#### Next Steps / CTA
```
├── Clear action aligned to Purpose (c)
├── Specific next step (not vague "let's chat")
├── Contact information
├── Suggested timeline
└── What happens after they take action
```

---

### Workflow Demo Content

#### Component Definitions

For each system, define:

```yaml
component:
  id: "snowflake"
  label: "Snowflake Data Warehouse"
  type: "database"  # database | api | ai | middleware | human | document | output
  icon: "database"
  description: "Financial performance data"
  brand_color: "#29B5E8"
```

**Component types:**
- `human` — Person initiating or receiving
- `document` — PDFs, contracts, files
- `ai` — AI/ML models, agents
- `database` — Data stores, warehouses
- `api` — APIs, services
- `middleware` — Integration platforms, MCP servers
- `output` — Dashboards, reports, notifications

#### Flow Steps

For each step, define:

```yaml
step:
  number: 1
  from: "human"
  to: "claude"
  action: "Initiates performance review"
  description: "Sarah, a Brand Analyst at [Prospect], kicks off the quarterly review..."
  data_example: "Review request: Nike brand, Q4 2025"
  duration: "~1 second"
  value_note: "No manual data gathering required"
```

#### Scenario Narrative

Write a clear, specific walkthrough:

```
Step 1: Human Trigger
"Sarah, a Brand Performance Analyst at Centric Brands, needs to review
Q4 performance for the Nike license agreement. She opens the review
dashboard and clicks 'Start Review'..."

Step 2: Contract Analysis
"Claude retrieves the Nike contract PDF and extracts the performance
obligations: minimum $50M revenue, 12% margin requirement, quarterly
reporting deadline..."

Step 3: Data Query
"Claude formulates a query and sends it to Workato DataGenie:
'Get Q4 2025 revenue and gross margin for Nike brand from Snowflake'..."

Step 4: Results & Synthesis
"Snowflake returns the data. Claude compares actuals vs. obligations:
Revenue $52.3M ✓ (exceeded by $2.3M)
Margin 11.2% ⚠️ (0.8% below threshold)..."

Step 5: Insight Delivery
"Claude synthesizes findings into an executive summary with
recommendations: 'Review promotional spend allocation to improve
margin performance...'"
```

---

## Phase 4: Visual Design

### Color System

```css
:root {
    /* === Prospect Brand (Primary) === */
    --brand-primary: #[extracted from research];
    --brand-secondary: #[extracted];
    --brand-primary-rgb: [r, g, b]; /* For rgba() usage */

    /* === Dark Theme Base === */
    --bg-primary: #0a0d14;
    --bg-elevated: #0f131c;
    --bg-surface: #161b28;
    --bg-hover: #1e2536;

    /* === Text === */
    --text-primary: #ffffff;
    --text-secondary: rgba(255, 255, 255, 0.7);
    --text-muted: rgba(255, 255, 255, 0.5);

    /* === Accent === */
    --accent: var(--brand-primary);
    --accent-hover: var(--brand-secondary);
    --accent-glow: rgba(var(--brand-primary-rgb), 0.3);

    /* === Status === */
    --success: #10b981;
    --warning: #f59e0b;
    --error: #ef4444;
}
```

### Typography

```css
/* Primary: Clean, professional sans-serif */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-se