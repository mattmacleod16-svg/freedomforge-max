function isSafeIntent(intent: unknown): intent is { fulfillmentDelta: number | null } {
    return typeof intent === 'object' && intent !== null && 'fulfillmentDelta' in intent;
}

if (isSafeIntent(intent)) {
    const { fulfillmentDelta } = intent;
    if (fulfillmentDelta !== null) {
        happinessForge.giftFulfillment();
    }
}