function hasFulfillmentDelta(x: unknown): x is { fulfillmentDelta: number } {
  return (
    typeof x === 'object' &&
    x !== null &&
    'fulfillmentDelta' in x &&
    typeof (x as any).fulfillmentDelta === 'number'
  );
}

async watchAndProtect(signals: unknown): Promise<void> {
  const { bciAdapter }     = await import('@/lib/deviceforge/hybrid-bci-adapter');
  const { happinessForge } = await import('@/lib/happinessforge/happiness-engine');

  const decoded = await bciAdapter.decodeIntent(
    signals as import('@/lib/types').RawBCIData
  );

  if (hasFulfillmentDelta(decoded) && decoded.fulfillmentDelta < 0) {
    await happinessForge.giftFulfillment({ userId: this.config.id });
  }
}