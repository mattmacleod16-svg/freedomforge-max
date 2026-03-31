/**
 * Telegram Webhook — Matty's TM Bot (@MattyTM_bot)
 * Receives messages from Telegram and routes them to timeX agent.
 * 
 * Commands:
 *   /tasks        — list open tasks
 *   /done <id>    — mark task done
 *   /add <title>  — quick-add a task
 *   /score        — get current Alpha Score
 *   /status       — FreedomForge status summary
 *   Any free text — forwarded to timeX as a message
 */

import { createClient } from 'npm:@base44/sdk@0.8.23';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const APP_ID = Deno.env.get('BASE44_APP_ID') || '';
const SERVICE_TOKEN = Deno.env.get('BASE44_SERVICE_TOKEN') || '';

const base44 = createClient({ appId: APP_ID, apiKey: SERVICE_TOKEN });

async function sendMessage(chatId: number, text: string, parseMode = 'HTML') {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
}

async function handleCommand(chatId: number, text: string) {
  const lower = text.trim().toLowerCase();

  // /tasks — list open tasks
  if (lower === '/tasks' || lower === '/start') {
    try {
      const tasks = await base44.asServiceRole.entities.Task.filter({ status: 'open' });
      if (!tasks || tasks.length === 0) {
        await sendMessage(chatId, '✅ No open tasks right now.');
        return;
      }
      const lines = tasks.slice(0, 10).map((t: any, i: number) => {
        const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '⚪';
        return `${pri} <b>${t.title}</b>\n   ID: <code>${t.id.slice(-6)}</code> | ${t.campaign || 'No campaign'}`;
      });
      await sendMessage(chatId, `📋 <b>Open Tasks (${tasks.length})</b>\n\n${lines.join('\n\n')}`);
    } catch (e: any) {
      await sendMessage(chatId, `❌ Error fetching tasks: ${e.message}`);
    }
    return;
  }

  // /add <title> — create a task
  if (lower.startsWith('/add ')) {
    const title = text.slice(5).trim();
    if (!title) { await sendMessage(chatId, '❌ Usage: /add <task title>'); return; }
    try {
      const task = await base44.asServiceRole.entities.Task.create({
        title,
        status: 'open',
        priority: 'medium',
        source_app: 'telegram',
        ff_notes: `Added via Telegram @MattyTM_bot`,
      });
      await sendMessage(chatId, `✅ Task added!\n<b>${title}</b>\nID: <code>${task.id.slice(-6)}</code>`);
    } catch (e: any) {
      await sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    return;
  }

  // /done <id> — mark task done (match last 6 chars of ID)
  if (lower.startsWith('/done')) {
    const fragment = text.slice(5).trim();
    if (!fragment) { await sendMessage(chatId, '❌ Usage: /done <task-id>'); return; }
    try {
      const all = await base44.asServiceRole.entities.Task.filter({ status: 'open' });
      const match = all.find((t: any) => t.id.endsWith(fragment) || t.id.includes(fragment));
      if (!match) { await sendMessage(chatId, `❌ No open task found with ID ending in <code>${fragment}</code>`); return; }
      await base44.asServiceRole.entities.Task.update(match.id, { status: 'done' });
      await sendMessage(chatId, `✅ Done! <b>${match.title}</b> marked complete.`);
    } catch (e: any) {
      await sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    return;
  }

  // /score — Alpha Score summary
  if (lower === '/score') {
    await sendMessage(chatId, 
      `⚡ <b>Alpha Score</b>\n\nFetch the live score at:\n<code>https://freedomforge.one/dashboard</code>\n\nOr ask timeX: "what's the current alpha score?"`
    );
    return;
  }

  // /status — FreedomForge quick status
  if (lower === '/status') {
    await sendMessage(chatId,
      `🔥 <b>FreedomForge Status</b>\n\n` +
      `• AI Trading: <b>LIVE</b> (Coinbase + Kraken)\n` +
      `• Regime Detection: V2 Active\n` +
      `• Nightly Optimizer: Bayesian (2am ET)\n` +
      `• VCB: Monitoring\n` +
      `• Mining: 5 rigs active\n\n` +
      `Full dashboard → <code>https://freedomforge.one/dashboard</code>`
    );
    return;
  }

  // /help
  if (lower === '/help') {
    await sendMessage(chatId,
      `🤖 <b>Matty's TM Bot</b>\n\n` +
      `/tasks — view open tasks\n` +
      `/add &lt;title&gt; — add a task\n` +
      `/done &lt;id&gt; — mark task done\n` +
      `/status — FreedomForge status\n` +
      `/score — Alpha Score\n` +
      `/help — this menu\n\n` +
      `You can also just type anything — I'll log it as a note.`
    );
    return;
  }

  // Fallback — log as a quick note/task
  try {
    await base44.asServiceRole.entities.Task.create({
      title: text.slice(0, 120),
      status: 'open',
      priority: 'medium',
      source_app: 'telegram',
      ff_notes: `Quick note from Telegram: ${text}`,
    });
    await sendMessage(chatId, `📝 Got it — logged as a task!\n\nType /tasks to see all open items, or /help for commands.`);
  } catch {
    await sendMessage(chatId, `📨 Received! Type /help for available commands.`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ ok: true, status: 'webhook active' });
  }

  try {
    const body = await req.json();
    const message = body?.message || body?.edited_message;
    if (!message) return Response.json({ ok: true });

    const chatId = message.chat?.id;
    const text = message.text || '';
    if (!chatId || !text) return Response.json({ ok: true });

    // Handle async (don't block webhook response)
    (async () => {
      try {
        await handleCommand(chatId, text);
      } catch (e) {
        console.error('Telegram handler error:', e);
      }
    })();

    return Response.json({ ok: true });
  } catch (e: any) {
    console.error('Webhook parse error:', e);
    return Response.json({ ok: true }); // always 200 to Telegram
  }
});
