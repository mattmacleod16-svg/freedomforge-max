// Stub — implement exchange integration when needed

const configured =
  !!(process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET);

export const krakenClient = {
  isConfigured: () => configured,

  async placeOrder(order: { symbol: string; side: string; type: string; amount: number; price?: number }) {
    if (!configured) throw new Error('Kraken not configured — set KRAKEN_API_KEY and KRAKEN_API_SECRET');
    throw new Error('Kraken placeOrder stub — not implemented');
  },

  async getBalance(): Promise<Record<string, string>> {
    if (!configured) throw new Error('Kraken not configured — set KRAKEN_API_KEY and KRAKEN_API_SECRET');
    throw new Error('Kraken getBalance stub — not implemented');
  },
};
