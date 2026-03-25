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
      tree.addLiquidity(BigInt(1000));
      const stats = tree.getStats();
      expect(stats.totalLiquidity).toBe(BigInt(1000));
      expect(stats.activeLeaves).toBe(1);
      expect(stats.nextLeaf).toBe(2);
    });

    it('accumulates multiple deposits in total', () => {
      tree.addLiquidity(BigInt(500));
      tree.addLiquidity(BigInt(300));
      tree.addLiquidity(BigInt(200));
      expect(tree.getStats().totalLiquidity).toBe(BigInt(1000));
    });

    it('assigns sequential leaf numbers', () => {
      const leaf1 = tree.addLiquidity(BigInt(100));
      const leaf2 = tree.addLiquidity(BigInt(200));
      const leaf3 = tree.addLiquidity(BigInt(300));
      expect(leaf1).toBe(1);
      expect(leaf2).toBe(2);
      expect(leaf3).toBe(3);
    });

    it('throws for non-positive amount', () => {
      expect(() => tree.addLiquidity(BigInt(0))).toThrow(RangeError);
      expect(() => tree.addLiquidity(BigInt(-1))).toThrow(RangeError);
    });
  });

  // ── distributePnl ───────────────────────────────────────────────────────────

  describe('distributePnl', () => {
    it('distributes gains proportionally among snapshot leaves', () => {
      const leaf1 = tree.addLiquidity(BigInt(1000));
      const leaf2 = tree.addLiquidity(BigInt(1000));

      // Snapshot covers both leaves
      tree.distributePnl(BigInt(200), 2);

      // Each leaf had equal share → each gains 100
      expect(tree.getBalance(leaf1)).toBe(BigInt(1100));
      expect(tree.getBalance(leaf2)).toBe(BigInt(1100));
    });

    it('excludes leaves deposited after snapshotLeaf', () => {
      const leaf1 = tree.addLiquidity(BigInt(1000));

      // Take snapshot at leaf 1 — only leaf1 is included
      const snapshotLeaf = 1;

      // Deposit AFTER snapshot — should not receive the PnL
      const leaf2 = tree.addLiquidity(BigInt(1000));

      tree.distributePnl(BigInt(500), snapshotLeaf);

      // leaf1 should gain 500 (it's the only eligible leaf)
      expect(tree.getBalance(leaf1)).toBe(BigInt(1500));
      // leaf2 should be unchanged — fairness guarantee
      expect(tree.getBalance(leaf2)).toBe(BigInt(1000));
    });

    it('distributes losses (negative PnL) correctly', () => {
      const leaf1 = tree.addLiquidity(BigInt(2000));
      const leaf2 = tree.addLiquidity(BigInt(2000));

      tree.distributePnl(BigInt(-400), 2);

      // Each loses 200
      expect(tree.getBalance(leaf1)).toBe(BigInt(1800));
      expect(tree.getBalance(leaf2)).toBe(BigInt(1800));
    });

    it('handles proportional distribution with unequal deposits', () => {
      const leaf1 = tree.addLiquidity(BigInt(3000));
      const leaf2 = tree.addLiquidity(BigInt(1000));

      tree.distributePnl(BigInt(400), 2);

      // leaf1 gets 75% = 300, leaf2 gets 25% = 100
      expect(tree.getBalance(leaf1)).toBe(BigInt(3300));
      expect(tree.getBalance(leaf2)).toBe(BigInt(1100));
    });

    it('is a no-op when snapshotLeaf is 0 (no eligible leaves)', () => {
      const leaf1 = tree.addLiquidity(BigInt(1000));
      tree.distributePnl(BigInt(500), 0);
      expect(tree.getBalance(leaf1)).toBe(BigInt(1000));
    });
  });

  // ── withdraw ────────────────────────────────────────────────────────────────

  describe('withdraw', () => {
    it('returns the original deposit when no PnL', () => {
      const leaf = tree.addLiquidity(BigInt(500));
      const withdrawn = tree.withdraw(leaf);
      expect(withdrawn).toBe(BigInt(500));
    });

    it('returns correct balance after PnL distribution', () => {
      const leaf1 = tree.addLiquidity(BigInt(1000));
      const leaf2 = tree.addLiquidity(BigInt(1000));

      tree.distributePnl(BigInt(1000), 2);

      // Each leaf should now hold 1500
      const withdrawn1 = tree.withdraw(leaf1);
      expect(withdrawn1).toBe(BigInt(1500));

      const withdrawn2 = tree.withdraw(leaf2);
      expect(withdrawn2).toBe(BigInt(1500));
    });

    it('zeroes the leaf after withdrawal', () => {
      const leaf = tree.addLiquidity(BigInt(1000));
      tree.withdraw(leaf);
      expect(tree.getBalance(leaf)).toBe(BigInt(0));
    });

    it('updates the tree total after withdrawal', () => {
      tree.addLiquidity(BigInt(500));
      const leaf2 = tree.addLiquidity(BigInt(300));

      tree.withdraw(leaf2);

      expect(tree.getStats().totalLiquidity).toBe(BigInt(500));
    });

    it('throws for an invalid leaf index', () => {
      tree.addLiquidity(BigInt(100));
      expect(() => tree.withdraw(0)).toThrow(RangeError);
      expect(() => tree.withdraw(99)).toThrow(RangeError);
    });
  });

  // ── getBalance ──────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('accounts for lazy PnL deltas without modifying tree state', () => {
      const leaf1 = tree.addLiquidity(BigInt(1000));
      const leaf2 = tree.addLiquidity(BigInt(1000));

      tree.distributePnl(BigInt(500), 2);

      // Read balances twice — should be identical and must not mutate state
      const bal1a = tree.getBalance(leaf1);
      const bal1b = tree.getBalance(leaf1);
      expect(bal1a).toBe(bal1b);
      expect(bal1a).toBe(BigInt(1250));

      const bal2a = tree.getBalance(leaf2);
      const bal2b = tree.getBalance(leaf2);
      expect(bal2a).toBe(bal2b);
      expect(bal2a).toBe(BigInt(1250));
    });

    it('returns 0 for a leaf that has never been used', () => {
      // No deposits yet
      expect(tree.getBalance(1)).toBe(BigInt(0));
    });

    it('returns 0 after a withdrawn leaf', () => {
      const leaf = tree.addLiquidity(BigInt(500));
      tree.withdraw(leaf);
      expect(tree.getBalance(leaf)).toBe(BigInt(0));
    });
  });

  // ── getStats ────────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns NODES = 1048576', () => {
      expect(tree.NODES).toBe(1_048_576);
    });

    it('returns correct treeDepth of 20', () => {
      tree.addLiquidity(BigInt(1));
      expect(tree.getStats().treeDepth).toBe(20);
    });

    it('tracks active leaves correctly after deposit and withdrawal', () => {
      const leaf1 = tree.addLiquidity(BigInt(100));
      tree.addLiquidity(BigInt(200));
      expect(tree.getStats().activeLeaves).toBe(2);

      tree.withdraw(leaf1);
      expect(tree.getStats().activeLeaves).toBe(1);
    });
  });
});
