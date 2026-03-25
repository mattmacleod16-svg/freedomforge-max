/**
 * LiquidityTree — Binary Segment Tree for LP Accounting
 * ═══════════════════════════════════════════════════════
 *
 * TypeScript port of the Azuro Protocol LiquidityTree (Solidity).
 *
 * Design:
 *  - Binary segment tree stored as a flat Map (1-indexed, root = 1).
 *  - Node N has children 2N (left) and 2N+1 (right).
 *  - Leaves hold LP deposit amounts; internal nodes hold subtree sums.
 *  - Lazy propagation: PnL deltas are stored at nodes and pushed down on demand.
 *
 * Node fields:
 *  - `amount`:  Aggregate deposit sum for the subtree (excludes lazy PnL).
 *  - `lazy`:    Accumulated PnL to distribute down to children (signed bigint).
 *  - `updateId`: Monotonic counter stamp for the last update at this node.
 *
 * Fairness guarantee:
 *   distributePnl(amount, snapshotLeaf) only touches leaves [1..snapshotLeaf],
 *   so deposits made after a position is opened never receive pre-existing PnL.
 *
 * Complexity: O(log n) for all public operations, n = LEAF_COUNT = 2^20.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TreeNode {
  /**
   * Sum of base deposit amounts in this subtree (does NOT include lazy PnL
   * that has not yet been pushed to children).
   */
  amount: bigint;
  /**
   * Lazy PnL delta awaiting propagation to children.
   * For leaves this is zero after pushToLeaf; for internal nodes it
   * accumulates until someone needs to read/write a descendant.
   */
  lazy: bigint;
  /**
   * Monotonic counter stamp from the last distributePnl that touched this
   * node.  NOT a timestamp — purely an ordering mechanism.
   */
  updateId: number;
}

export interface LiquidityTreeStats {
  totalLiquidity: bigint;
  activeLeaves: number;
  treeDepth: number;
  nextLeaf: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Total leaf count: 2^20 = 1 048 576 */
const LEAF_COUNT = 1_048_576 as const;

// ── LiquidityTree ─────────────────────────────────────────────────────────────

export class LiquidityTree {
  /** Number of leaf slots (2^20). */
  readonly NODES: number = LEAF_COUNT;

  /**
   * Sparse node storage.  Only nodes that have been written are stored,
   * keeping memory proportional to actual deposits rather than tree size.
   */
  readonly nodes: Map<number, TreeNode> = new Map();

  /** Index of the next free leaf (1-based). */
  nextLeaf: number = 1;

  /** Monotonically increasing counter for lazy update ordering. */
  updateCounter: number = 0;

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Returns the tree-wide index for leaf number `leaf` (1-based). */
  private leafIndex(leaf: number): number {
    return LEAF_COUNT + leaf - 1;
  }

  /** Return existing node or a zero-initialised default. */
  private getNode(index: number): TreeNode {
    return this.nodes.get(index) ?? { amount: 0n, lazy: 0n, updateId: 0 };
  }

  /** Write a node to storage. */
  private setNode(index: number, node: TreeNode): void {
    this.nodes.set(index, node);
  }

  /**
   * Push the lazy PnL stored on `index` down to its two children.
   *
   * Distributes the lazy amount proportionally to each child's `amount`.
   * After the push the children's `lazy` fields accumulate the share and
   * the parent's `lazy` is reset to zero.
   *
   * The parent's `amount` field is the BASE (deposit) sum; the real
   * balance of a subtree is `amount + lazy`.  We push lazily to avoid
   * O(n) traversals.
   */
  private pushDown(index: number): void {
    const node = this.getNode(index);
    if (node.lazy === 0n) return;

    const leftIdx = index << 1;
    const rightIdx = (index << 1) | 1;
    const left = this.getNode(leftIdx);
    const right = this.getNode(rightIdx);

    const childBaseSum = left.amount + right.amount;
    if (childBaseSum === 0n) {
      // Nothing to distribute — clear lazy to avoid drift
      this.setNode(index, { ...node, lazy: 0n });
      return;
    }

    // Each child gets a proportional share of the lazy delta
    const leftShare = (node.lazy * left.amount) / childBaseSum;
    const rightShare = node.lazy - leftShare; // absorb rounding remainder

    this.setNode(leftIdx, { ...left, lazy: left.lazy + leftShare });
    this.setNode(rightIdx, { ...right, lazy: right.lazy + rightShare });
    this.setNode(index, { ...node, lazy: 0n });
  }

  /**
   * Walk from root down to `leafIdx`, pushing lazy deltas at each level
   * so the leaf's `amount + lazy` is accurate when we arrive.
   */
  private pushToLeaf(leafIdx: number): void {
    const depth = 20; // log2(LEAF_COUNT)
    // Collect path from root to leaf (parent indices, top-down)
    const path: number[] = [];
    let idx = leafIdx;
    while (idx > 1) {
      idx >>= 1;
      path.push(idx);
    }
    // Push from root (last in path) down to leaf parent (first in path)
    for (let i = path.length - 1; i >= 0; i--) {
      this.pushDown(path[i]);
    }
    void depth; // suppress unused warning
  }

  /**
   * Walk from `leafIdx` up to root, recomputing each ancestor's `amount`
   * as the sum of both children's `amount` (base deposits only).
   * Must be called AFTER leaf base amounts are final.
   */
  private updateAncestors(leafIdx: number): void {
    let idx = leafIdx >> 1;
    while (idx >= 1) {
      const left = this.getNode(idx << 1);
      const right = this.getNode((idx << 1) | 1);
      const current = this.getNode(idx);
      this.setNode(idx, {
        amount: left.amount + right.amount,
        lazy: current.lazy,
        updateId: current.updateId,
      });
      idx >>= 1;
    }
  }

  // ── Segment-tree range operations ──────────────────────────────────────────

  /**
   * Compute the sum of `amount` (base) for tree indices in [ql..qr]
   * within the subtree rooted at `node` that covers leaf indices [nl..nr].
   *
   * NOTE: ql/qr/nl/nr are in LEAF-INDEX space (1-based), not tree-index space.
   */
  private rangeBaseSum(
    ql: number,
    qr: number,
    nl: number,
    nr: number,
    node: number,
  ): bigint {
    if (ql > nr || qr < nl) return 0n;
    if (ql <= nl && nr <= qr) return this.getNode(node).amount;
    const mid = (nl + nr) >> 1;
    return (
      this.rangeBaseSum(ql, qr, nl, mid, node << 1) +
      this.rangeBaseSum(ql, qr, mid + 1, nr, (node << 1) | 1)
    );
  }

  /**
   * Distribute `totalPnl` lazily to all leaves in [ql..qr] (leaf-index space).
   * The `snapshotBaseTotal` is the total base deposits in [ql..qr], used for
   * proportional allocation.
   *
   * For covered subtrees: add a proportional share to that node's `lazy`.
   * For partial overlaps: recurse into children.
   * After recursing, recompute the current node's `amount` from children
   * (base sums don't change; only `lazy` accumulates).
   */
  private rangeAddLazy(
    totalPnl: bigint,
    snapshotBaseTotal: bigint,
    ql: number,
    qr: number,
    nl: number,
    nr: number,
    node: number,
    uid: number,
  ): void {
    if (ql > nr || qr < nl) return;

    const current = this.getNode(node);
    if (current.amount === 0n) return; // No base deposits in this subtree

    if (ql <= nl && nr <= qr) {
      // This subtree is fully within the snapshot range.
      // Add a proportional PnL share to its lazy bucket.
      const share = (totalPnl * current.amount) / snapshotBaseTotal;
      this.setNode(node, { ...current, lazy: current.lazy + share, updateId: uid });
      return;
    }

    const mid = (nl + nr) >> 1;
    this.rangeAddLazy(totalPnl, snapshotBaseTotal, ql, qr, nl, mid, node << 1, uid);
    this.rangeAddLazy(totalPnl, snapshotBaseTotal, ql, qr, mid + 1, nr, (node << 1) | 1, uid);

    // Base amounts are unchanged after range PnL; only re-sync them in case
    // they diverged during earlier operations.
    const left = this.getNode(node << 1);
    const right = this.getNode((node << 1) | 1);
    this.setNode(node, { ...current, amount: left.amount + right.amount, updateId: uid });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Add `amount` liquidity to the next available leaf.
   * Returns the 1-based leaf number assigned to this deposit.
   *
   * Complexity: O(log n)
   */
  addLiquidity(amount: bigint): number {
    if (amount <= 0n) throw new RangeError('amount must be positive');
    if (this.nextLeaf > LEAF_COUNT) throw new RangeError('LiquidityTree is full');

    const leaf = this.nextLeaf++;
    const leafIdx = this.leafIndex(leaf);

    // Push any accumulated lazy PnL down to this slot before adding.
    // For a brand-new leaf this is a no-op, but if the leaf had been
    // previously withdrawn and re-used it would matter.
    this.pushToLeaf(leafIdx);

    const existing = this.getNode(leafIdx);
    this.setNode(leafIdx, {
      amount: existing.amount + amount,
      lazy: existing.lazy,
      updateId: this.updateCounter,
    });
    this.updateAncestors(leafIdx);

    return leaf;
  }

  /**
   * Distribute `amount` PnL (positive = gain, negative = loss) only to
   * leaves whose index is ≤ `snapshotLeaf`.
   *
   * Uses lazy propagation: high-level subtrees covering the snapshot range
   * receive the delta in their `lazy` field; pushes happen on-demand.
   *
   * Complexity: O(log n)
   */
  distributePnl(amount: bigint, snapshotLeaf: number): void {
    if (snapshotLeaf < 1 || snapshotLeaf >= this.nextLeaf) return;

    // Compute the base deposit total within [1..snapshotLeaf]
    // Root is node index 1, covering leaf range [1..LEAF_COUNT]
    const snapshotBaseTotal = this.rangeBaseSum(1, snapshotLeaf, 1, LEAF_COUNT, 1);
    if (snapshotBaseTotal === 0n) return;

    this.updateCounter++;
    this.rangeAddLazy(
      amount,
      snapshotBaseTotal,
      1,          // ql (leaf-space, 1-based)
      snapshotLeaf, // qr
      1,          // nl (subtree covers leaf 1)
      LEAF_COUNT, // nr (subtree covers leaf LEAF_COUNT)
      1,          // node = root of the tree (tree-index 1)
      this.updateCounter,
    );
  }

  /**
   * Withdraw the full balance from `leaf`, returning the withdrawn amount.
   * Pushes lazy deltas down to the leaf first, then zeroes it and updates
   * all ancestors.
   *
   * Complexity: O(log n)
   */
  withdraw(leaf: number): bigint {
    if (leaf < 1 || leaf >= this.nextLeaf) throw new RangeError(`Invalid leaf: ${leaf}`);

    const leafIdx = this.leafIndex(leaf);
    this.pushToLeaf(leafIdx);

    const node = this.getNode(leafIdx);
    const balance = node.amount + node.lazy;

    this.setNode(leafIdx, { amount: 0n, lazy: 0n, updateId: node.updateId });
    this.updateAncestors(leafIdx);

    return balance;
  }

  /**
   * Read the current balance for `leaf`, fully accounting for any unpushed
   * lazy PnL deltas, WITHOUT modifying tree state.
   *
   * Traverses from root to leaf, simulating pushDown at each level without
   * writing anything back to the Map.
   *
   * Complexity: O(log n)
   */
  getBalance(leaf: number): bigint {
    if (leaf < 1 || leaf >= this.nextLeaf) return 0n;

    const leafIdx = this.leafIndex(leaf);

    // Build path of internal node indices from root down to the leaf's parent
    const path: number[] = [];
    let idx = leafIdx;
    while (idx > 1) {
      idx >>= 1;
      path.push(idx);
    }
    // path is [leaf's parent, ..., root]; reverse to get top-down order
    path.reverse();

    // Simulate push-down from root to leaf, accumulating lazy without writing
    // We maintain a "virtual lazy" for each node on the path.
    // virtualLazy[i] = the lazy that would have been pushed from path[i-1] to path[i]
    const virtualLazy = new Map<number, bigint>();
    for (const nodeIdx of path) {
      virtualLazy.set(nodeIdx, 0n);
    }
    virtualLazy.set(leafIdx, 0n);

    // Also track virtual amount (base) for each node — can use actual Map values
    // since we're read-only on the actual tree.

    for (const nodeIdx of path) {
      const node = this.getNode(nodeIdx);
      const myVirtualLazy = virtualLazy.get(nodeIdx) ?? 0n;
      const effectiveLazy = node.lazy + myVirtualLazy;

      if (effectiveLazy === 0n) continue;

      const leftIdx = nodeIdx << 1;
      const rightIdx = (nodeIdx << 1) | 1;
      const left = this.getNode(leftIdx);
      const right = this.getNode(rightIdx);

      // Use virtual lazy already assigned to children (if any)
      const leftVirtual = virtualLazy.get(leftIdx) ?? 0n;
      const rightVirtual = virtualLazy.get(rightIdx) ?? 0n;

      const childBaseSum = left.amount + right.amount;
      if (childBaseSum === 0n) continue;

      const leftShare = (effectiveLazy * left.amount) / childBaseSum;
      const rightShare = effectiveLazy - leftShare;

      virtualLazy.set(leftIdx, leftVirtual + leftShare);
      virtualLazy.set(rightIdx, rightVirtual + rightShare);
    }

    const leafNode = this.getNode(leafIdx);
    const leafVirtualLazy = virtualLazy.get(leafIdx) ?? 0n;
    return leafNode.amount + leafNode.lazy + leafVirtualLazy;
  }

  /**
   * Returns summary statistics for the tree.
   * Note: `totalLiquidity` includes both base deposits and all accumulated PnL.
   */
  getStats(): LiquidityTreeStats {
    // Root internal node (index 1) holds the full base deposit sum.
    const rootInternal = this.getNode(1);

    // Total PnL distributed is accumulated in lazy fields across all nodes.
    // Rather than summing all lazies, we note that the ROOT's lazy captures
    // any PnL that covers the full tree range; partial-range PnL lives deeper.
    // For getStats we walk cheaply: sum base at root + collect all lazy values.
    let totalPnl = 0n;
    for (const [, node] of this.nodes) {
      totalPnl += node.lazy;
    }

    let activeLeaves = 0;
    for (let leaf = 1; leaf < this.nextLeaf; leaf++) {
      const balance = this.getBalance(leaf);
      if (balance > 0n) activeLeaves++;
    }

    return {
      totalLiquidity: rootInternal.amount + totalPnl,
      activeLeaves,
      treeDepth: 20,
      nextLeaf: this.nextLeaf,
    };
  }
}
