/*
 * Subscribe to Alchemy mined transactions over WebSocket and forward events
 * to a webhook for alerting/automation.
 *
 * Usage:
 *   npm run subscribe:mined
 *
 * Required env:
 *   ALCHEMY_API_KEY
 *
 * Optional env:
 *   ALCHEMY_NETWORK=eth-mainnet
 *   ALCHEMY_MINED_ADDRESSES_JSON=[{"to":"0x...","from":"0x..."},{"to":"0x..."}]
 *   ALCHEMY_HASHES_ONLY=true
 *   ALCHEMY_INCLUDE_REMOVED=false
 *   ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
 *   ALERT_MENTION=<@123...> or <@&456...>
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function resolveWsUrl() {
  const explicit = process.env.ALCHEMY_WSS_URL;
  if (explicit) return explicit;

  const apiKey = process.env.ALCHEMY_API_KEY;
  const network = process.env.ALCHEMY_NETWORK || 'eth-mainnet';
  return `wss://${network}.g.alchemy.com/v2/${apiKey}`;
}

function parseAddressesFilter() {
  const raw = process.env.ALCHEMY_MINED_ADDRESSES_JSON;
  if (!raw) {
    console.error('Missing ALCHEMY_MINED_ADDRESSES_JSON.');
    console.error('Example: ALCHEMY_MINED_ADDRESSES_JSON=[{"to":"0x...","from":"0x..."},{"to":"0x..."}]');
    process.exit(1);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('must be a non-empty JSON array');
    }
    return parsed;
  } catch (error) {
    console.error('Invalid ALCHEMY_MINED_ADDRESSES_JSON:', error.message || error);
    process.exit(1);
  }
}

async function sendWebhook(payload) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const mention = (process.env.ALERT_MENTION || '').trim();
  const shouldMention = /discord(?:app)?\.com\/api\/webhooks\//i.test(url) && mention;
  const baseMessage = payload?.content || payload?.text || '';
  const finalMessage = shouldMention ? `${mention} ${baseMessage}` : baseMessage;

  const normalizedPayload = {
    ...payload,
    content: finalMessage,
    text: finalMessage,
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedPayload),
    });
  } catch (error) {
    console.error('Webhook send failed:', error.message || error);
  }
}

async function main() {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    console.error('Missing ALCHEMY_API_KEY');
    process.exit(1);
  }

  const network = process.env.ALCHEMY_NETWORK || 'eth-mainnet';
  const wsUrl = resolveWsUrl();
  const addresses = parseAddressesFilter();
  const hashesOnly = parseBoolean(process.env.ALCHEMY_HASHES_ONLY, true);
  const includeRemoved = parseBoolean(process.env.ALCHEMY_INCLUDE_REMOVED, false);

  console.log('Starting Alchemy mined tx subscription...');
  console.log('Network:', network);
  console.log('WS URL:', wsUrl.replace(apiKey, '***'));
  console.log('Hashes only:', hashesOnly);
  console.log('Include removed:', includeRemoved);
  console.log('Address filters:', JSON.stringify(addresses));

  const socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_subscribe',
      params: [
        'alchemy_minedTransactions',
        {
          addresses,
          includeRemoved,
          hashesOnly,
        },
      ],
    };

    socket.send(JSON.stringify(payload));
  });

  socket.addEventListener('message', async (raw) => {
    try {
      const message = JSON.parse(String(raw.data));

      if (message?.error) {
        console.error('Subscription error:', message.error);
        return;
      }

      if (message?.result && !message?.method) {
        console.log('Subscribed with id:', message.result);
        return;
      }

      if (message?.method === 'eth_subscription') {
        const event = message?.params?.result;
        const timestamp = new Date().toISOString();
        const txHash = event?.transaction?.hash || event?.hash || null;

        console.log(`[${timestamp}] matched tx`, txHash || JSON.stringify(event));

        await sendWebhook({
          text: txHash
            ? `⛏️ Mined tx matched filter: ${txHash}`
            : '⛏️ Mined tx matched filter',
          source: 'alchemy-subscribe',
          network,
          event,
        });
      }
    } catch (error) {
      console.error('Failed to parse ws message:', error.message || error);
    }
  });

  socket.addEventListener('error', (error) => {
    console.error('WebSocket error:', error.message || error);
  });

  socket.addEventListener('close', (evt) => {
    console.log(`WebSocket closed (code=${evt.code}, reason=${evt.reason || 'none'})`);
  });

  process.on('SIGINT', () => {
    console.log('\nStopping subscription...');
    socket.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nStopping subscription...');
    socket.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Subscription crashed:', error.message || error);
  process.exit(1);
});
