/**
 * Simple alert helper. Sends a JSON payload to a webhook URL defined by
 * the environment variable `ALERT_WEBHOOK_URL`. The receiver can be a Slack
 * incoming webhook, Discord webhook, Zapier, or any service that accepts a
 * POST with `{ content: string }` (Discord) or `{ text: string }`.
 *
 * You can also set `ALERT_SECRET` and the library will include it in a
 * custom header for lightweight authentication.
 * If `ALERT_MENTION` is set (e.g. `<@123...>` or `<@&456...>`), Discord
 * messages will be prefixed to trigger a ping.
 */

let lastAlert: { message: string; time: number } | null = null;
let missingWebhookConfigWarned = false;

export function getLastAlert() {
  return lastAlert;
}

function isDiscordWebhook(url: string) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function formatAlertMessage(url: string, message: string) {
  const mention = (process.env.ALERT_MENTION || '').trim();
  if (!mention || !isDiscordWebhook(url)) return message;
  return `${mention} ${message}`;
}

export async function sendAlert(message: string) {
  lastAlert = { message, time: Date.now() };

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    if (!missingWebhookConfigWarned) {
      console.warn('Alert webhook not configured');
      missingWebhookConfigWarned = true;
    }
    return;
  }
  try {
    const finalMessage = formatAlertMessage(url, message);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.ALERT_SECRET) {
      headers['X-Alert-Secret'] = process.env.ALERT_SECRET;
    }
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: finalMessage, text: finalMessage }),
    });
  } catch (err) {
    console.error('Failed to send alert', err);
  }
}
