/**
 * LiquidityTree — Unit Tests
 * ══════════════════════════
 *
 * Vitest tests for the Azuro-inspired binary segment tree LP accounting.
 *
 * Run: npx vitest run lib/liquidity/liquidityTree.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LiquidityTree } from './liquidityTree';

// ── Test suite ────────────────────────────────────────────────────────────────

describe('LiquidityTree', () => {
  let tree: LiquidityTree;

  beforeEach(() => {
    tree = new LiquidityTree();
  });

  // ── addLiquidity ────────────────────────────────────────────────────────────

  describe('addLiquidity', () => {
    it('increases tree total after a deposit', () => {
      tree.addLiquidity(1000n);
      const stats = tree.getStats();
      expect(stats.totalLiquidity).toBe(1000n);
      expect(stats.activeLeaves).toBe(1);
      expect(stats.nextLeaf).toBe(2);
    });

    it('accumulates multiple deposits in total', () => {
      tree.addLiquidity(500n);
      tree.addLiquidity(300n);
      tree.addLiquidity(200n);
      expect(tree.getStats().totalLiquidity).toBe(1000n);
    });

    it('assigns sequential leaf numbers', () => {
      const leaf1 = tree.addLiquidity(100n);
      const leaf2 = tree.addLiquidity(200n);
      const leaf3 = tree.addLiquidity(300n);
      expect(leaf1).toBe(1);
      expect(leaf2).toBe(2);
      expect(leaf3).toBe(3);
    });

    it('throws for non-positive amount', () => {
      expect(() => tree.addLiquidity(0n)).toThrow(RangeError);
      expect(() => tree.addLiquidity(-1n)).toThrow(RangeError);
    });
  });

  // ── distributePnl ───────────────────────────────────────────────────────────

  describe('distributePnl', () => {
    it('distributes gains proportionally among snapshot leaves', () => {
      const leaf1 = tree.addLiquidity(1000n);
      const leaf2 = tree.addLiquidity(1000n);

      // Snapshot covers both leaves
      tree.distributePnl(200n, 2);

      // Each leaf had equal share → each gains 100
      expect(tree.getBalance(leaf1)).toBe(1100n);
      expect(tree.getBalance(leaf2)).toBe(1100n);
    });

    it('excludes leaves deposited after snapshotLeaf', () => {
      const leaf1 = tree.addLiquidity(1000n);

      // Take snapshot at leaf 1 — only leaf1 is included
      const snapshotLeaf = 1;

      // Deposit AFTER snapshot — should not receive the PnL
      const leaf2 = tree.addLiquidity(1000n);

      tree.distributePnl(500n, snapshotLeaf);

      // leaf1 should gain 500 (it's the only eligible leaf)
      expect(tree.getBalance(leaf1)).toBe(1500n);
      // leaf2 should be unchanged — fairness guarantee
      expect(tree.getBalance(leaf2)).toBe(1000n);
    });

    it('distributes losses (negative PnL) correctly', () => {
      const leaf1 = tree.addLiquidity(2000n);
      const leaf2 = tree.addLiquidity(2000n);

      tree.distributePnl(-400n, 2);

      // Each loses 200
      expect(tree.getBalance(leaf1)).toBe(1800n);
      expect(tree.getBalance(leaf2)).toBe(1800n);
    });

    it('handles proportional distribution with unequal deposits', () => {
      const leaf1 = tree.addLiquidity(3000n);
      const leaf2 = tree.addLiquidity(1000n);

      tree.distributePnl(400n, 2);

      // leaf1 gets 75% = 300, leaf2 gets 25% = 100
      expect(tree.getBalance(leaf1)).toBe(3300n);
      expect(tree.getBalance(leaf2)).toBe(1100n);
    });

    it('is a no-op when snapshotLeaf is 0 (no eligible leaves)', () => {
      const leaf1 = tree.addLiquidity(1000n);
      tree.distributePnl(500n, 0);
      expect(tree.getBalance(leaf1)).toBe(1000n);
    });
  });

  // ── withdraw ────────────────────────────────────────────────────────────────

  describe('withdraw', () => {
    it('returns the original deposit when no PnL', () => {
      const leaf = tree.addLiquidity(500n);
      const withdrawn = tree.withdraw(leaf);
      expect(withdrawn).toBe(500n);
    });

    it('returns correct balance after PnL distribution', () => {
      const leaf1 = tree.addLiquidity(1000n);
      const leaf2 = tree.addLiquidity(1000n);

      tree.distributePnl(1000n, 2);

      // Each leaf should now hold 1500
      const withdrawn1 = tree.withdraw(leaf1);
      expect(withdrawn1).toBe(1500n);

      const withdrawn2 = tree.withdraw(leaf2);
      expect(withdrawn2).toBe(1500n);
    });

    it('zeroes the leaf after withdrawal', () => {
      const leaf = tree.addLiquidity(1000n);
      tree.withdraw(leaf);
      expect(tree.getBalance(leaf)).toBe(0n);
    });

    it('updates the tree total after withdrawal', () => {
      tree.addLiquidity(500n);
      const leaf2 = tree.addLiquidity(300n);

      tree.withdraw(leaf2);

      expect(tree.getStats().totalLiquidity).toBe(500n);
    });

    it('throws for an invalid leaf index', () => {
      tree.addLiquidity(100n);
      expect(() => tree.withdraw(0)).toThrow(RangeError);
      expect(() => tree.withdraw(99)).toThrow(RangeError);
    });
  });

  // ── getBalance ──────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('accounts for lazy PnL deltas without modifying tree state', () => {
      const leaf1 = tree.addLiquidity(1000n);
      const leaf2 = tree.addLiquidity(1000n);

      tree.distributePnl(500n, 2);

      // Read balances twice — should be identical and must not mutate state
      const bal1a = tree.getBalance(leaf1);
      const bal1b = tree.getBalance(leaf1);
      expect(bal1a).toBe(bal1b);
      expect(bal1a).toBe(1250n);

      const bal2a = tree.getBalance(leaf2);
      const bal2b = tree.getBalance(leaf2);
      expect(bal2a).toBe(bal2b);
      expect(bal2a).toBe(1250n);
    });

    it('returns 0 for a leaf that has never been used', () => {
      // No deposits yet
      expect(tree.getBalance(1)).toBe(0n);
    });

    it('returns 0 after a withdrawn leaf', () => {
      const leaf = tree.addLiquidity(500n);
      tree.withdraw(leaf);
      expect(tree.getBalance(leaf)).toBe(0n);
    });
  });

  // ── getStats ────────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns NODES = 1048576', () => {
      expect(tree.NODES).toBe(1_048_576);
    });

    it('returns correct treeDepth of 20', () => {
      tree.addLiquidity(1n);
      expect(tree.getStats().treeDepth).toBe(20);
    });

    it('tracks active leaves correctly after deposit and withdrawal', () => {
      const leaf1 = tree.addLiquidity(100n);
      tree.addLiquidity(200n);
      expect(tree.getStats().activeLeaves).toBe(2);

      tree.withdraw(leaf1);
      expect(tree.getStats().activeLeaves).toBe(1);
    });
  });
});
