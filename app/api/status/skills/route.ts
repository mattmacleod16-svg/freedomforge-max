/**
 * GET /api/status/skills — Skills matrix summary + knowledge base stats.
 * POST /api/status/skills — Register a skill or record an outcome.
 * PUT /api/status/skills — Ingest knowledge document.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';
import {
  registerSkill,
  recordOutcome,
  autoDiscoverSkill,
  getMatrixSummary,
  getSkillGaps,
  bootstrapCoreSkills,
  getKBSummary,
  ingestKnowledge,
  searchKnowledge,
} from '@/lib/intelligence/skillsMatrix';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action === 'gaps') {
    return NextResponse.json({ gaps: getSkillGaps() });
  }

  if (action === 'search') {
    const q = url.searchParams.get('q') || '';
    const domain = url.searchParams.get('domain') || undefined;
    return NextResponse.json({ results: searchKnowledge(q, domain) });
  }

  if (action === 'bootstrap') {
    bootstrapCoreSkills();
    return NextResponse.json({ status: 'bootstrapped', matrix: getMatrixSummary() });
  }

  return NextResponse.json({
    matrix: getMatrixSummary(),
    knowledgeBase: getKBSummary(),
  });
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const body = await req.json();
  const { action } = body;

  if (action === 'register') {
    const skill = registerSkill(body);
    return NextResponse.json({ status: 'registered', skill });
  }

  if (action === 'outcome') {
    const { skillId, success, difficulty } = body;
    const skill = recordOutcome(skillId, success, difficulty);
    if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    return NextResponse.json({ status: 'recorded', skill });
  }

  if (action === 'discover') {
    const { query, domain, modelUsed } = body;
    const skill = autoDiscoverSkill(query, domain, modelUsed);
    return NextResponse.json({ status: 'discovered', skill });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function PUT(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const body = await req.json();
  const { title, content, domain, skillIds, source, qualityScore, ttlDays } = body;

  if (!title || !content || !domain || !source) {
    return NextResponse.json({ error: 'Missing title, content, domain, or source' }, { status: 400 });
  }

  const doc = ingestKnowledge({ title, content, domain, skillIds, source, qualityScore, ttlDays });
  return NextResponse.json({ status: 'ingested', document: { id: doc.id, title: doc.title, domain: doc.domain } });
}
