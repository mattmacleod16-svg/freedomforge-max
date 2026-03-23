// Stub — implement exchange integration when needed

const configured =
  !!(process.env.COINBASE_API_KEY && process.env.COINBASE_API_SECRET);

export const coinbaseClient = {
  isConfigured: () => configured,

  async placeOrder(order: { symbol: string; side: string; type: string; amount: number; price?: number }) {
    if (!configured) throw new Error('Coinbase not configured — set COINBASE_API_KEY and COINBASE_API_SECRET');
    throw new Error('Coinbase placeOrder stub — not implemented');
  },

  async getAccounts(): Promise<
    { currency: string; available_balance: { value: string } }[]
  > {
    if (!configured) throw new Error('Coinbase not configured — set COINBASE_API_KEY and COINBASE_API_SECRET');
    throw new Error('Coinbase getAccounts stub — not implemented');
  },
};
