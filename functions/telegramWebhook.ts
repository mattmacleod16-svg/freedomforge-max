/**
 * Telegram Webhook — Matty's TM Bot (@MattyTM_bot)
 */

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';

async function sendMessage(chatId: number, text: string, parseMode = 'HTML') {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
  const data = await res.json();
  if (!data.ok) console.error('Telegram send error:', JSON.stringify(data));
}

async function fetchTasks(status = 'open') {
  const APP_ID = Deno.env.get('BASE44_APP_ID') || '';
  const res = await fetch(`https://api.base44.com/api/apps/${APP_ID}/entities/Task/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-role': 'true',
    },
    body: JSON.stringify({ filter: { status } }),
  });
  if (!res.ok) throw new Error(`Task fetch failed: ${res.status}`);
  return await res.json();
}

async function createTask(data: object) {
  const APP_ID = Deno.env.get('BASE44_APP_ID') || '';
  const res = await fetch(`https://api.base44.com/api/apps/${APP_ID}/entities/Task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-role': 'true',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Task create failed: ${res.status}`);
  return await res.json();
}

async function updateTask(id: string, data: object) {
  const APP_ID = Deno.env.get('BASE44_APP_ID') || '';
  const res = await fetch(`https://api.base44.com/api/apps/${APP_ID}/entities/Task/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-service-role': 'true',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Task update failed: ${res.status}`);
  return await res.json();
}

async function handleMessage(chatId: number, text: string) {
  const lower = text.trim().toLowerCase();

  if (lower === '/start' || lower === '/help') {
    await sendMessage(chatId,
      `🤖 <b>Matty's TM Bot</b>\n\n` +
      `/tasks — view open tasks\n` +
      `/add &lt;title&gt; — add a task\n` +
      `/done &lt;id&gt; — mark task done\n` +
      `/status — FreedomForge status\n` +
      `/help — this menu\n\n` +
      `Or just type anything to log it as a quick task.`
    );
    return;
  }

  if (lower === '/tasks') {
    try {
      const tasks = await fetchTasks('open');
      if (!tasks || tasks.length === 0) {
        await sendMessage(chatId, '✅ No open tasks right now.');
        return;
      }
      const lines = tasks.slice(0, 10).map((t: any) => {
        const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '⚪';
        return `${pri} <b>${t.title}</b>\n   ID: <code>${t.id.slice(-6)}</code>`;
      });
      await sendMessage(chatId, `📋 <b>Open Tasks (${tasks.length})</b>\n\n${lines.join('\n\n')}`);
    } catch (e: any) {
      await sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    return;
  }

  if (lower.startsWith('/add ')) {
    const title = text.slice(5).trim();
    if (!title) { await sendMessage(chatId, '❌ Usage: /add &lt;task title&gt;'); return; }
    try {
      const task = await createTask({
        title,
        status: 'open',
        priority: 'medium',
        source_app: 'telegram',
        ff_notes: 'Added via @MattyTM_bot',
      });
      await sendMessage(chatId, `✅ Task added!\n<b>${title}</b>\nID: <code>${task.id.slice(-6)}</code>`);
    } catch (e: any) {
      await sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    return;
  }

  if (lower.startsWith('/done')) {
    const fragment = text.slice(5).trim();
    if (!fragment) { await sendMessage(chatId, '❌ Usage: /done &lt;id&gt;'); return; }
    try {
      const tasks = await fetchTasks('open');
      const match = tasks.find((t: any) => t.id.endsWith(fragment) || t.id.includes(fragment));
      if (!match) { await sendMessage(chatId, `❌ No open task found with ID <code>${fragment}</code>`); return; }
      await updateTask(match.id, { status: 'done' });
      await sendMessage(chatId, `✅ Done! <b>${match.title}</b> marked complete.`);
    } catch (e: any) {
      await sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    return;
  }

  if (lower === '/status') {
    await sendMessage(chatId,
      `🔥 <b>FreedomForge Status</b>\n\n` +
      `• AI Trading: <b>LIVE</b> (Coinbase + Kraken)\n` +
      `• Regime Detection: V2 Active\n` +
      `• Nightly Optimizer: Bayesian @ 2am ET\n` +
      `• VCB: Monitoring\n` +
      `• Mining Fleet: 5 rigs active\n\n` +
      `Dashboard → https://freedomforge.one/dashboard`
    );
    return;
  }

  // Anything else — log as task
  try {
    await createTask({
      title: text.slice(0, 120),
      status: 'open',
      priority: 'medium',
      source_app: 'telegram',
      ff_notes: `Quick note via Telegram: ${text}`,
    });
    await sendMessage(chatId, `📝 Logged as a task! Type /tasks to see all open items.`);
  } catch {
    await sendMessage(chatId, `📨 Got it! Type /help for available commands.`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ ok: true, status: 'webhook active', bot: '@MattyTM_bot' });
  }

  try {
    const body = await req.json();
    const message = body?.message || body?.edited_message;
    if (!message) return Response.json({ ok: true });

    const chatId = message.chat?.id;
    const text = message.text || '';
    if (!chatId || !text) return Response.json({ ok: true });

    console.log(`Message from ${chatId}: ${text}`);

    // Fire and forget — always return 200 fast
    (async () => {
      try {
        await handleMessage(chatId, text);
      } catch (e) {
        console.error('Handler error:', e);
      }
    })();

    return Response.json({ ok: true });
  } catch (e: any) {
    console.error('Parse error:', e);
    return Response.json({ ok: true });
  }
});
