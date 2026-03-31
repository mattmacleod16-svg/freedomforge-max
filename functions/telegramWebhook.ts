/**
 * Telegram Webhook — Matty's TM Bot (@MattyTM_bot)
 */

import { createClient } from 'npm:@base44/sdk@0.8.23';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const APP_ID = Deno.env.get('BASE44_APP_ID') || '';

// Service role client — no user auth needed
const base44 = createClient({ appId: APP_ID });

async function sendMessage(chatId: number, text: string, parseMode = 'HTML') {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
  const data = await res.json();
  if (!data.ok) console.error('Telegram send error:', JSON.stringify(data));
  return data;
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
      const tasks = await base44.asServiceRole.entities.Task.filter({ status: 'open' });
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
      console.error('Tasks error:', e);
      await sendMessage(chatId, `❌ Error fetching tasks: ${e.message}`);
    }
    return;
  }

  if (lower.startsWith('/add ')) {
    const title = text.slice(5).trim();
    if (!title) { await sendMessage(chatId, '❌ Usage: /add &lt;task title&gt;'); return; }
    try {
      const task = await base44.asServiceRole.entities.Task.create({
        title,
        status: 'open',
        priority: 'medium',
        source_app: 'telegram',
        ff_notes: 'Added via @MattyTM_bot',
      });
      await sendMessage(chatId, `✅ Task added!\n<b>${title}</b>\nID: <code>${task.id.slice(-6)}</code>`);
    } catch (e: any) {
      console.error('Create task error:', e);
      await sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    return;
  }

  if (lower.startsWith('/done')) {
    const fragment = text.slice(5).trim();
    if (!fragment) { await sendMessage(chatId, '❌ Usage: /done &lt;id&gt;'); return; }
    try {
      const tasks = await base44.asServiceRole.entities.Task.filter({ status: 'open' });
      const match = tasks.find((t: any) => t.id.endsWith(fragment) || t.id.includes(fragment));
      if (!match) { await sendMessage(chatId, `❌ No open task found with ID <code>${fragment}</code>`); return; }
      await base44.asServiceRole.entities.Task.update(match.id, { status: 'done' });
      await sendMessage(chatId, `✅ Done! <b>${match.title}</b> marked complete.`);
    } catch (e: any) {
      console.error('Done task error:', e);
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

  // Anything else — log as quick task
  try {
    const task = await base44.asServiceRole.entities.Task.create({
      title: text.slice(0, 120),
      status: 'open',
      priority: 'medium',
      source_app: 'telegram',
      ff_notes: `Quick note via Telegram: ${text}`,
    });
    await sendMessage(chatId, `📝 Logged as a task!\n<b>${text.slice(0, 60)}</b>\nID: <code>${task.id.slice(-6)}</code>\n\nType /tasks to see all open items.`);
  } catch (e: any) {
    console.error('Fallback create error:', e);
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
