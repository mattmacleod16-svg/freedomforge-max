# Fix: "Unable to Generate Response" Error in Agent Command Panel

## Problem
The Agent Command panel shows "Unable to generate response" when sending prompts (e.g., typing "hello").

## Root Causes

### 1. **Missing or Invalid API Keys**
- `OPENROUTER_API_KEY` not set in `.env.local`
- Other model providers (OpenAI, Anthropic, Google) not configured
- API key quota exhausted or rate limited

### 2. **Authentication Issues**
- User not logged in (session cookie missing)
- Session expired or invalid

### 3. **Server/API Issues**
- Next.js dev server not running (`npm run dev`)
- `/api/chat` endpoint returning errors
- Synthesis orchestrator failing to load

### 4. **Network Issues**
- API connectivity problems
- CORS misconfiguration
- Firewall/proxy blocking requests

---

## Solution Steps

### Step 1: Run Agent Diagnostics
Use the new diagnostic panel to identify the exact issue:

```bash
# In your browser console or add to a page:
import AgentDiagnosticPanel from '@/app/components/AgentDiagnosticPanel';

// Or visit a diagnostic route you create (see below)
```

### Step 2: Check API Keys
```bash
# Show configured keys (safely, without exposing secrets):
grep -E 'OPENROUTER|ANTHROPIC|OPENAI' .env.local | cut -d= -f1

# Should output:
# OPENROUTER_API_KEY
# (at minimum)
```

If missing, add them:
```bash
# .env.local
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxx
```

### Step 3: Verify Authentication
```bash
# Check if logged in:
curl -s -b 'ff_session=<your-session-cookie>' https://freedomforge.one/api/auth/session

# Should return: {"authenticated": true, "user": "admin"}
```

If not authenticated → visit `/login` and enter credentials.

### Step 4: Test Chat Endpoint Directly
```bash
# Via curl:
curl -X POST https://freedomforge.one/api/chat \
  -H 'Content-Type: application/json' \
  -b 'ff_session=<cookie>' \
  -d '{"message":"hello"}'

# Via browser fetch:
fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ message: 'hello' })
}).then(r => r.json()).then(d => console.log(d))
```

---

## Integration: Using the Fixed Components

### Option 1: Use AgentCommandPanel (Recommended)
Replaces your existing agent command interface with improved error handling:

```tsx
// app/page.tsx or your dashboard
import AgentCommandPanel from '@/app/components/AgentCommandPanel';

export default function Home() {
  return (
    <div>
      <AgentCommandPanel />
    </div>
  );
}
```

**Features:**
- ✅ Descriptive error messages (not generic "Unable to generate response")
- ✅ Shows attempted models and failure reasons
- ✅ Retry logic (up to 3 attempts)
- ✅ Troubleshooting suggestions inline
- ✅ Success metadata (models used, reasoning)

### Option 2: Add Diagnostic Panel to Dashboard
Show users a diagnostic tool to self-diagnose issues:

```tsx
// app/dashboard/page.tsx
import AgentDiagnosticPanel from '@/app/components/AgentDiagnosticPanel';

export default function Dashboard() {
  return (
    <div className="flex gap-6">
      <div>
        {/* Your existing dashboard content */}
      </div>
      <aside className="w-96">
        <AgentDiagnosticPanel />
      </aside>
    </div>
  );
}
```

**Features:**
- ✅ One-click diagnostics
- ✅ Checks: Auth, Health, Chat API, Synthesis, API Keys
- ✅ Shows specific error details
- ✅ Troubleshooting guide

### Option 3: Custom Route for Diagnostics
Create a page dedicated to agent diagnostics:

```tsx
// app/diagnose/page.tsx
'use client';

import AgentDiagnosticPanel from '@/app/components/AgentDiagnosticPanel';

export default function DiagnosticsPage() {
  return (
    <div className="min-h-screen bg-gray-950 p-8">
      <h1 className="text-3xl font-bold text-white mb-8">Agent Command Diagnostics</h1>
      <AgentDiagnosticPanel />
    </div>
  );
}
```

Visit `/diagnose` to run diagnostics.

---

## Debugging Guide

### For Developers

#### 1. Check Server Logs
```bash
# Terminal where npm run dev is running
# Look for:
# - 💬 Processing: <message>
# - ⚠️ synthesizeAnswer returned fallback
# - Chat API error
```

#### 2. Check API Response Status
```typescript
// In AgentCommandPanel.tsx, the sendCommand function logs:
console.error('Agent command failed:', {
  status: response.status,
  error: data.error,
  reasoning: data.metadata?.reasoning,
  attemptedModels: data.metadata?.models_attempted,
});
```

#### 3. Verify synthesizeAnswer Function
```bash
# Check lib/synthesis/orchestrator.ts
# Ensure:
# - All model routes are defined
# - Fallback response is SYNTHESIS_FALLBACK_RESPONSE
# - Error handling returns structured response
```

#### 4. Test Individual Models
```bash
# Test OpenRouter API manually
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4",
    "messages": [{"role":"user","content":"hello"}]
  }'
```

### For Users

1. **Check Agent Component Status:** Open browser DevTools (F12) → Console
2. **Run Self-Diagnostics:** Visit `/diagnose` or click diagnostic button
3. **Check Error Details:** Look at error message, models attempted, reasoning
4. **Follow Suggested Fixes:** Component shows specific troubleshooting steps

---

## Error Response Examples

### ✅ Success Response
```json
{
  "reply": "Your prompt response here...",
  "sources": ["source1", "source2"],
  "metadata": {
    "models_used": ["gpt-4-turbo"],
    "search_results": 5,
    "reasoning": "Routed to OpenAI for complex reasoning task"
  }
}
```

### ❌ Error Response (Missing API Key)
```json
{
  "error": "Missing OpenRouter API key",
  "reply": "Max encountered an issue. Please try again or ensure your API keys are configured.",
  "metadata": {
    "models_attempted": ["openai/gpt-4", "anthropic/claude-3"],
    "reasoning": "All model paths failed: OPENROUTER_API_KEY not found"
  }
}
```

### ❌ Error Response (Rate Limited)
```json
{
  "error": "Rate limit exceeded",
  "reply": "Max encountered an issue. Please try again or ensure your API keys are configured.",
  "metadata": {
    "models_attempted": ["openai/gpt-4"],
    "reasoning": "HTTP 429: Rate limit exceeded on OpenRouter. Retry after 60 seconds."
  }
}
```

---

## Env Variables Required

### Minimum (One Required)
```bash
OPENROUTER_API_KEY=sk-or-v1-xxxxx  # Primary provider
```

### Optional (Fallbacks)
```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx
GOOGLE_API_KEY=AIza_xxxxx
```

### Session/Auth
```bash
DASHBOARD_SESSION_SECRET=your-secret-here  # For session signing
```

---

## Testing

### Manual Test
```bash
# 1. Start dev server
npm run dev

# 2. Log in
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}' \
  -c cookies.txt

# 3. Test agent command
curl -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"message":"What is 2+2?"}'
```

### Automated Test
```bash
npm run test  # Includes agent command tests
```

---

## Files Created/Modified

| File | Purpose |
|------|---------|
| `app/components/AgentCommandPanel.tsx` | ✨ NEW - Improved agent command UI with error handling |
| `app/components/AgentDiagnosticPanel.tsx` | ✨ NEW - Self-diagnostics tool |
| `app/api/chat/route.ts` | Modified - Enhanced error responses |

---

## Next Steps

1. **Integrate AgentCommandPanel** into your dashboard/main page
2. **Test with diagnostic panel** to identify your specific issue
3. **Follow the suggested fixes** from the diagnostic output
4. **Monitor server logs** as you test

For issues with API keys or configuration, check `.env.local` first!
