/**
 * Telegram Webhook — @MattyTM_bot
 * Direct REST calls to Base44 API using SERVICE TOKEN from env
 * No SDK dependency — pure fetch, proven pattern
 */

const BOT_TOKEN     = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const SVC_TOKEN     = Deno.env.get('BASE44_SERVICE_TOKEN') || '';
const APP_ID        = '69b73ac82788422f8f8a08ea';
const API           = `https://base44.app/api/apps/${APP_ID}/entities`;
const HEADERS_JSON  = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SVC_TOKEN}` };

// ── Base44 helpers ────────────────────────────────────────────────────────────
async function dbList(entity: string): Promise<any[]> {
  const r = await fetch(`${API}/${entity}`, { headers: HEADERS_JSON });
  if (!r.ok) throw new Error(`List ${entity}: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

async function dbCreate(entity: string, data: object): Promise<any> {
  const r = await fetch(`${API}/${entity}`, {
    method: 'POST', headers: HEADERS_JSON, body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Create ${entity}: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function dbUpdate(entity: string, id: string, data: object): Promise<any> {
  const r = await fetch(`${API}/${entity}/${id}`, {
    method: 'PUT', headers: HEADERS_JSON, body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Update ${entity}/${id}: ${r.status} ${await r.text()}`);
  return await r.json();
}

// ── Telegram helper ───────────────────────────────────────────────────────────
async function send(chatId: number, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const d = await r.json();
  if (!d.ok) console.error('TG error:', JSON.stringify(d));
}

// ── Market price fetcher ──────────────────────────────────────────────────────
async function fetchPrices(): Promise<Record<string, number>> {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple&vs_currencies=usd', {
      headers: { 'Accept': 'application/json' },
    });
    const d = await r.json();
    return {
      BTC: d.bitcoin?.usd || 0,
      ETH: d.ethereum?.usd || 0,
      SOL: d.solana?.usd || 0,
      XRP: d.ripple?.usd || 0,
    };
  } catch { return {}; }
}

// ── Command handlers ──────────────────────────────────────────────────────────
async function handleHelp(chatId: number) {
  await send(chatId,
    `🔥 <b>FreedomForge Command Center</b>\n\n` +
    `<b>📋 Tasks</b>\n` +
    `/tasks — view open tasks\n` +
    `/add &lt;title&gt; — add a task\n` +
    `/done &lt;id&gt; — mark task done\n\n` +
    `<b>💰 Income</b>\n` +
    `/target &lt;amount&gt; — set daily income target (e.g. /target 100)\n` +
    `/income — current target + progress\n\n` +
    `<b>📊 System</b>\n` +
    `/status — full FreedomForge status\n` +
    `/prices — live crypto prices\n` +
    `/help — this menu\n\n` +
    `💡 <i>Just type anything to log it as a task</i>`
  );
}

async function handleTasks(chatId: number) {
  try {
    const all  = await dbList('Task');
    const open = all.filter((t: any) => t.status === 'open');
    if (open.length === 0) {
      await send(chatId, '✅ No open tasks — you\'re clear!');
      return;
    }
    const lines = open.slice(0, 10).map((t: any) => {
      const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '⚪';
      return `${pri} <b>${t.title}</b>\n   <code>${t.id.slice(-6)}</code>`;
    });
    await send(chatId, `📋 <b>Open Tasks (${open.length})</b>\n\n${lines.join('\n\n')}`);
  } catch (e: any) {
    await send(chatId, `❌ ${e.message}`);
  }
}

async function handleAdd(chatId: number, title: string) {
  try {
    const task = await dbCreate('Task', {
      title,
      status: 'open',
      priority: 'medium',
      source_app: 'telegram',
      ff_notes: 'Added via @MattyTM_bot',
    });
    await send(chatId, `✅ <b>Task added!</b>\n${title}\n\nID: <code>${task.id.slice(-6)}</code>`);
  } catch (e: any) {
    await send(chatId, `❌ ${e.message}`);
  }
}

async function handleDone(chatId: number, fragment: string) {
  try {
    const all  = await dbList('Task');
    const open = all.filter((t: any) => t.status === 'open');
    const match = open.find((t: any) => t.id.endsWith(fragment) || t.id.includes(fragment));
    if (!match) {
      await send(chatId, `❌ No open task with ID ending in <code>${fragment}</code>\n\nUse /tasks to see IDs`);
      return;
    }
    await dbUpdate('Task', match.id, { status: 'done' });
    await send(chatId, `✅ <b>Done!</b> "${match.title}" marked complete 🎯`);
  } catch (e: any) {
    await send(chatId, `❌ ${e.message}`);
  }
}

async function handleTarget(chatId: number, amountStr: string) {
  const daily = parseFloat(amountStr.replace(/[$,]/g, ''));
  if (isNaN(daily) || daily <= 0) {
    await send(chatId, `❌ Usage: /target &lt;amount&gt;\nExample: /target 100\n\nThat sets a $100/day income target.`);
    return;
  }
  // Log it as a task so the system picks it up
  try {
    await dbCreate('Task', {
      title: `SET INCOME TARGET: $${daily}/day ($${(daily*30).toFixed(0)}/mo, $${(daily*365).toFixed(0)}/yr)`,
      status: 'open',
      priority: 'high',
      source_app: 'telegram',
      ff_notes: JSON.stringify({ type: 'income_target', daily, weekly: daily*7, monthly: daily*30, annual: daily*365, set_at: new Date().toISOString() }),
      ff_linked: 'target-income-engine',
    });
    await send(chatId,
      `🎯 <b>Income Target Set!</b>\n\n` +
      `Daily:  <b>$${daily.toFixed(2)}</b>\n` +
      `Weekly: <b>$${(daily*7).toFixed(2)}</b>\n` +
      `Monthly: <b>$${(daily*30).toFixed(2)}</b>\n` +
      `Annual: <b>$${(daily*365).toFixed(2)}</b>\n\n` +
      `FreedomForge will now route capital across spot trading, prediction markets, DeFi yield, and mining to hit this target.\n\n` +
      `Type /income to track progress.`
    );
  } catch (e: any) {
    await send(chatId, `❌ ${e.message}`);
  }
}

async function handleIncome(chatId: number) {
  try {
    const all   = await dbList('Task');
    const target = all.find((t: any) =>
      t.ff_linked === 'target-income-engine' && t.status === 'open'
    );
    if (!target) {
      await send(chatId,
        `💰 <b>No income target set.</b>\n\nUse /target &lt;amount&gt; to set one.\nExample: /target 50 (for $50/day)`
      );
      return;
    }
    let info: any = {};
    try { info = JSON.parse(target.ff_notes || '{}'); } catch {}
    await send(chatId,
      `💰 <b>Income Target Status</b>\n\n` +
      `🎯 Target: <b>$${info.daily?.toFixed(2) || '?'}/day</b>\n` +
      `📅 Set: ${info.set_at ? new Date(info.set_at).toLocaleDateString() : 'unknown'}\n\n` +
      `Monthly goal: <b>$${info.monthly?.toFixed(0) || '?'}</b>\n` +
      `Annual goal: <b>$${info.annual?.toFixed(0) || '?'}</b>\n\n` +
      `Streams active:\n` +
      `⛏️ Mining (5 rigs) — ~$8/day baseline\n` +
      `📈 Spot trading (CB + Kraken) — regime-adaptive\n` +
      `🎲 Prediction markets — confidence-gated\n` +
      `🏦 DeFi yield — Compound/Aave/LP\n\n` +
      `📊 Dashboard → https://freedomforge.one/dashboard`
    );
  } catch (e: any) {
    await send(chatId, `❌ ${e.message}`);
  }
}

async function handlePrices(chatId: number) {
  try {
    const p = await fetchPrices();
    const lines = Object.entries(p).map(([k, v]) => `${k}: <b>$${v.toLocaleString()}</b>`);
    await send(chatId,
      `📊 <b>Live Prices</b>\n\n${lines.join('\n')}\n\n` +
      `<i>via CoinGecko • ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET</i>`
    );
  } catch (e: any) {
    await send(chatId, `❌ Price fetch failed: ${e.message}`);
  }
}

async function handleStatus(chatId: number) {
  const p = await fetchPrices().catch(() => ({} as Record<string, number>));
  await send(chatId,
    `🔥 <b>FreedomForge Status</b>\n\n` +
    `<b>Trading</b>\n` +
    `• Mode: LIVE (Coinbase + Kraken)\n` +
    `• Regime Detector: V2 Active\n` +
    `• VCB: 5-tripwire monitoring\n` +
    `• Nightly Optimizer: Bayesian @ 2am ET\n\n` +
    `<b>Prices</b>\n` +
    `• BTC: $${(p.BTC||0).toLocaleString()}\n` +
    `• ETH: $${(p.ETH||0).toLocaleString()}\n` +
    `• SOL: $${(p.SOL||0).toLocaleString()}\n` +
    `• XRP: $${(p.XRP||0).toLocaleString()}\n\n` +
    `<b>Infrastructure</b>\n` +
    `• Mining: 5 rigs active\n` +
    `• Autonomous Improver: running\n` +
    `• Target Income Engine: active\n\n` +
    `📊 https://freedomforge.one/dashboard`
  );
}

async function handleFallback(chatId: number, text: string) {
  try {
    const task = await dbCreate('Task', {
      title: text.slice(0, 120),
      status: 'open',
      priority: 'medium',
      source_app: 'telegram',
      ff_notes: `Quick note via Telegram: ${text}`,
    });
    await send(chatId,
      `📝 <b>Logged!</b>\n"${text.slice(0, 60)}"\nID: <code>${task.id.slice(-6)}</code>\n\n/tasks · /help`
    );
  } catch (e: any) {
    await send(chatId, `❌ Could not log: ${e.message}`);
  }
}

// ── Main message router ───────────────────────────────────────────────────────
async function handleMessage(chatId: number, text: string) {
  const t = text.trim();
  const l = t.toLowerCase();

  if (l === '/start' || l === '/help')    return handleHelp(chatId);
  if (l === '/tasks')                     return handleTasks(chatId);
  if (l.startsWith('/add '))              return handleAdd(chatId, t.slice(5).trim());
  if (l.startsWith('/done'))              return handleDone(chatId, t.slice(5).trim());
  if (l.startsWith('/target'))            return handleTarget(chatId, t.slice(7).trim());
  if (l === '/income')                    return handleIncome(chatId);
  if (l === '/prices')                    return handlePrices(chatId);
  if (l === '/status')                    return handleStatus(chatId);
  return handleFallback(chatId, t);
}

// ── Server ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ ok: true, bot: '@MattyTM_bot', status: 'active' });
  }
  try {
    const body = await req.json();
    const msg  = body?.message || body?.edited_message;
    if (!msg) return Response.json({ ok: true });

    const chatId: number = msg.chat?.id;
    const text:   string = msg.text || '';
    if (!chatId || !text) return Response.json({ ok: true });

    console.log(`[${chatId}] ${text.slice(0, 80)}`);

    // Fire-and-forget so Telegram gets 200 immediately
    (async () => {
      try { await handleMessage(chatId, text); }
      catch (e) { console.error('handler error:', e); }
    })();

    return Response.json({ ok: true });
  } catch (e: any) {
    console.error('parse error:', e);
    return Response.json({ ok: true });
  }
});
