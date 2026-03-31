/**
 * Telegram Webhook — Matty's TM Bot (@MattyTM_bot)
 * Uses direct Base44 REST API with service token (confirmed working pattern)
 */

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const SERVICE_TOKEN = Deno.env.get('BASE44_SERVICE_TOKEN') || '';
const APP_ID = '69b73ac82788422f8f8a08ea';
const API_BASE = `https://base44.app/api/apps/${APP_ID}/entities`;

async function apiGet(entity: string, params = '') {
  const res = await fetch(`${API_BASE}/${entity}${params}`, {
    headers: { 'Authorization': `Bearer ${SERVICE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`GET ${entity} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function apiPost(entity: string, data: object) {
  const res = await fetch(`${API_BASE}/${entity}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_TOKEN}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`POST ${entity} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function apiPut(entity: string, id: string, data: object) {
  const res = await fetch(`${API_BASE}/${entity}/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_TOKEN}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PUT ${entity}/${id} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function sendTG(chatId: number, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const d = await res.json();
  if (!d.ok) console.error('TG send error:', JSON.stringify(d));
}

async function handleMessage(chatId: number, text: string) {
  const lower = text.trim().toLowerCase();

  // /start or /help
  if (lower === '/start' || lower === '/help') {
    await sendTG(chatId,
      `🤖 <b>Matty's TM Bot</b>\n\n` +
      `/tasks — view open tasks\n` +
      `/add &lt;title&gt; — add a task\n` +
      `/done &lt;id&gt; — mark task done\n` +
      `/status — FreedomForge status\n` +
      `/help — this menu\n\n` +
      `Just type anything to log it as a quick task ⚡`
    );
    return;
  }

  // /tasks
  if (lower === '/tasks') {
    try {
      const tasks = await apiGet('Task', '?status=open');
      const open = Array.isArray(tasks) ? tasks.filter((t: any) => t.status === 'open') : [];
      if (open.length === 0) {
        await sendTG(chatId, '✅ No open tasks right now. You\'re clear!');
        return;
      }
      const lines = open.slice(0, 10).map((t: any) => {
        const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '⚪';
        return `${pri} <b>${t.title}</b>\n   ID: <code>${t.id.slice(-6)}</code>`;
      });
      await sendTG(chatId, `📋 <b>Open Tasks (${open.length})</b>\n\n${lines.join('\n\n')}`);
    } catch (e: any) {
      console.error('tasks error:', e);
      await sendTG(chatId, `❌ ${e.message}`);
    }
    return;
  }

  // /add <title>
  if (lower.startsWith('/add ')) {
    const title = text.slice(5).trim();
    if (!title) { await sendTG(chatId, '❌ Usage: /add &lt;task title&gt;'); return; }
    try {
      const task = await apiPost('Task', {
        title,
        status: 'open',
        priority: 'medium',
        source_app: 'telegram',
        ff_notes: 'Added via @MattyTM_bot',
      });
      await sendTG(chatId, `✅ <b>Task added!</b>\n${title}\nID: <code>${task.id.slice(-6)}</code>`);
    } catch (e: any) {
      console.error('add error:', e);
      await sendTG(chatId, `❌ ${e.message}`);
    }
    return;
  }

  // /done <id>
  if (lower.startsWith('/done')) {
    const fragment = text.slice(5).trim();
    if (!fragment) { await sendTG(chatId, '❌ Usage: /done &lt;id&gt;'); return; }
    try {
      const tasks = await apiGet('Task');
      const all = Array.isArray(tasks) ? tasks : [];
      const match = all.find((t: any) => t.status === 'open' && (t.id.endsWith(fragment) || t.id.includes(fragment)));
      if (!match) { await sendTG(chatId, `❌ No open task with ID ending in <code>${fragment}</code>`); return; }
      await apiPut('Task', match.id, { status: 'done' });
      await sendTG(chatId, `✅ Done! <b>${match.title}</b> marked complete 🎯`);
    } catch (e: any) {
      console.error('done error:', e);
      await sendTG(chatId, `❌ ${e.message}`);
    }
    return;
  }

  // /status
  if (lower === '/status') {
    await sendTG(chatId,
      `🔥 <b>FreedomForge Status</b>\n\n` +
      `• AI Trading: <b>LIVE</b> (Coinbase + Kraken)\n` +
      `• Regime Detector: V2 Active\n` +
      `• Nightly Optimizer: Bayesian @ 2am ET\n` +
      `• VCB: 5-tripwire monitoring\n` +
      `• Mining Fleet: 5 rigs active\n\n` +
      `📊 Dashboard → https://freedomforge.one/dashboard`
    );
    return;
  }

  // Anything else → log as quick task
  try {
    const task = await apiPost('Task', {
      title: text.slice(0, 120),
      status: 'open',
      priority: 'medium',
      source_app: 'telegram',
      ff_notes: `Quick note via Telegram: ${text}`,
    });
    await sendTG(chatId,
      `📝 <b>Logged as task!</b>\n${text.slice(0, 80)}\nID: <code>${task.id.slice(-6)}</code>\n\n/tasks to see all open items`
    );
  } catch (e: any) {
    console.error('fallback error:', e);
    await sendTG(chatId, `❌ Couldn't log task: ${e.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ ok: true, bot: '@MattyTM_bot', status: 'webhook active' });
  }
  try {
    const body = await req.json();
    const msg = body?.message || body?.edited_message;
    if (!msg) return Response.json({ ok: true });

    const chatId: number = msg.chat?.id;
    const text: string = msg.text || '';
    if (!chatId || !text) return Response.json({ ok: true });

    console.log(`[${chatId}] ${text}`);

    (async () => {
      try { await handleMessage(chatId, text); }
      catch (e) { console.error('unhandled:', e); }
    })();

    return Response.json({ ok: true });
  } catch (e: any) {
    console.error('parse error:', e);
    return Response.json({ ok: true });
  }
});
