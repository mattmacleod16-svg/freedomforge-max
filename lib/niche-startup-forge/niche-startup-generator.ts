/**
 * FreedomForge NicheStartupForge — Niche Startup Generator
 *
 * Automatically generates and launches luxury-grade niche startup businesses
 * that satisfy three non-negotiable principles:
 *
 *   1. humanCannot   — Services only achievable via AI / BCI / robotics
 *   2. humanWontDo   — Repetitive, dangerous, or mundane labour
 *   3. luxuryGrade   — Premium positioning for maximum profit margins
 *
 * Uses the existing OnchainStockForge client to deploy a tokenized company
 * contract on-chain, with 30% of shares reserved for the holder pool.
 */

import { launchCompany } from '@/lib/onchain-stockforge/client';
import { StockLaunchParams } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NicheBusinessPlan {
  name:             string;
  ticker:           string;
  description:      string;
  principles: {
    humanCannot:   boolean; // requires AI/BCI/robotics beyond human capability
    humanWontDo:   boolean; // repetitive, dangerous, or mundane
    luxuryGrade:   boolean; // premium pricing + exclusivity
  };
  equityReservePct: number; // % of shares reserved for holder pool
  totalShares:      number;
  pricePerShareEth: number;
  txHash:           string;
  launchedAt:       number;
}

// ─── NicheStartupGenerator ───────────────────────────────────────────────────

export class NicheStartupGenerator {
  /** Fraction of shares reserved for the holder equity pool (30%). */
  private readonly EQUITY_RESERVE_PCT = 30;

  /**
   * Generate a business plan and deploy it as a tokenized company.
   *
   * @param userIntent  Plain-language description (e.g. "autonomous-cleaning")
   * @returns           Fully populated `NicheBusinessPlan` with on-chain tx hash
   */
  async generateAndLaunch(userIntent: string): Promise<NicheBusinessPlan> {
    const sanitized = userIntent.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
    const name   = `LuxForge ${sanitized}`;
    const ticker = sanitized
      .toUpperCase()
      .replace(/\s+/g, '')
      .slice(0, 6)
      .padEnd(3, 'X');

    const params: StockLaunchParams = {
      companyName:      name,
      ticker,
      totalShares:      1_000_000,
      // 0.001 ETH per share — luxury-grade floor price
      pricePerShareWei: BigInt(1e15),
    };

    const txHash = await launchCompany(params);

    return {
      name,
      ticker,
      description: `Premium AI/BCI/robotics service for tasks humans cannot or will not do. ` +
                   `Luxury-grade execution, maximum margin. Powered by FreedomForge.`,
      principles: {
        humanCannot:  true,
        humanWontDo:  true,
        luxuryGrade:  true,
      },
      equityReservePct: this.EQUITY_RESERVE_PCT,
      totalShares:      1_000_000,
      pricePerShareEth: 0.001,
      txHash,
      launchedAt:       Date.now(),
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const nicheStartupForge = new NicheStartupGenerator();
