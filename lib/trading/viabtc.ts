// Stub — implement exchange integration when needed

const configured =
  !!(process.env.VIABTC_API_KEY && process.env.VIABTC_API_SECRET);

export const viabtcClient = {
  isConfigured: () => configured,

  async getMiningStats() {
    if (!configured) throw new Error('ViaBTC not configured — set VIABTC_API_KEY and VIABTC_API_SECRET');
    throw new Error('ViaBTC getMiningStats stub — not implemented');
  },
};
