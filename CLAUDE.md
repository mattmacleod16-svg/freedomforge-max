# FreedomForge Max — Claude Agent Context

> Shared context file for Claude-based tools (Claude Code, Copilot with Claude, API integrations).
> This file ensures any Claude-powered agent understands the project architecture and conventions.

## Project Overview

**FreedomForge Max** is an autonomous intelligence engine for financial empowerment, tax intelligence, and human-first AI interactions. It's a Next.js 16 app deployed on Railway at `https://freedomforge.one`.

## Architecture

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript 5
- **Styling:** Tailwind CSS 4
- **AI Backend:** OpenRouter multi-model routing (26 MAX + 10 Advisor models)
- **Trading Backend:** OCI (Oracle Cloud Infrastructure)
- **Auth:** HMAC-SHA256 sessions (Edge + Node dual implementation)
- **Testing:** Vitest 4.1 (109+ tests across 8 files)
- **Deployment:** Railway (see `railway.toml`)

## Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `lib/ucfee-virtues.ts` | UCFEE-2.0 behavioral framework (40 protocol directives) | ~5,600 |
| `lib/advisor-knowledge.ts` | Tax/legal knowledge base (15 domains) | ~916 |
| `lib/models.ts` | AI model registry (26 MAX + 10 Advisor) | ~100 |
| `lib/session.ts` | HMAC-SHA256 session management | ~80 |
| `lib/circuit-breaker.ts` | Circuit breaker pattern | ~60 |
| `lib/llm-parse.ts` | LLM output parsing with JSON fallback | ~80 |
| `middleware.ts` | Edge middleware (auth, rate limiting, CSRF) | ~150 |
| `app/api/chat/route.ts` | MAX streaming API (32K context) | ~336 |
| `app/api/advisor/route.ts` | Advisor streaming API (64K context) | ~200 |
| `app/api/dashboard/route.ts` | OCI backend proxy (7 parallel fetches) | ~150 |
| `app/page.tsx` | MAX chatbot UI (voice + text, streaming) | ~400 |
| `app/advisor/page.tsx` | Freedom Advisor UI (15 quick topics) | ~300 |
| `app/dashboard/page.tsx` | Command Center (6-tab dashboard) | ~900 |

## Conventions

- **Package manager:** npm (lockfile committed)
- **Node version:** >=20.9.0
- **Scripts:** `npm run dev`, `npm run build`, `npm test`, `npm run lint`
- **API routes** use Server-Sent Events (SSE) for streaming
- **All AI calls** route through OpenRouter (`https://openrouter.ai/api/v1/chat/completions`)
- **Environment variables** are in `.env.local` (gitignored)
- **Tests** live next to source files (`*.test.ts` / `*.test.tsx`)

## Agent Integration

This project uses multiple AI agents that share context:
- **GitHub Copilot** — via `.github/agents/freedomforge.agent.md`
- **Blackbox AI** — via `.blackboxrules`
- **Claude** — via this file (`CLAUDE.md`)

All agents should follow the same behavioral rules defined in the FreedomForge agent definition.

## Security Notes

- Never expose API keys or secrets in code
- All environment variables are in `.env.local` (gitignored)
- CSRF protection on all mutating endpoints
- Rate limiting: 5 login attempts/15min, 30 AI requests/min per IP
- Circuit breaker: 5-failure threshold, 30s reset

## Making Changes

1. Run `npm test` before and after changes
2. Run `npm run lint` to check for issues
3. Run `npm run build` to verify production build
4. Keep test coverage — add tests for new functionality
5. Follow existing code patterns and conventions
