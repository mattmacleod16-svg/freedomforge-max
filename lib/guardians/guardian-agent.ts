function hasFulfillmentDelta(x: unknown): x is { fulfillmentDelta: number } {
  return (
    typeof x === 'object' &&
    x !== null &&
    'fulfillmentDelta' in x &&
    typeof (x as any).fulfillmentDelta === 'number'
  );
}

export class GuardianAgent {
  constructor(private config: { id: string }) {}

  /**
   * Watch a raw BCI signal and trigger a happiness gift if the intent
   * carries a negative fulfillment delta.
   * Uses dynamic imports to avoid circular module resolution at load time.
   */
  async watchAndProtect(signals: unknown): Promise<void> {
    const { bciAdapter } = await import('@/lib/deviceforge/hybrid-bci-adapter');
    const { happinessForge } = await import('@/lib/happinessforge/happiness-engine');

    const decoded = await bciAdapter.decodeIntent(
      signals as import('@/lib/types').RawBCIData
    );

    if (hasFulfillmentDelta(decoded) && decoded.fulfillmentDelta < 0) {
      await happinessForge.giftFulfillment({ userId: this.config.id });
    }
  }
}
