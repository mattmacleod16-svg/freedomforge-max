// Package core — Living Intention Lattice.
//
// The LivingIntentionLattice encodes creative intent as a persistent,
// self-reinforcing structure.  Every resonance pulse strengthens the lattice
// nodes, ensuring that the original intention expressed at genesis is
// amplified rather than diluted over successive cycles.
package core

import "fmt"

// LatticeNode represents a single intention encoded in the lattice.
type LatticeNode struct {
	// Intention is the text label for this node.
	Intention string
	// Strength measures how strongly this intention has been reinforced.
	Strength float64
}

// LivingIntentionLattice implements ResonanceModule.
type LivingIntentionLattice struct {
	nodes      []LatticeNode
	cycleCount uint64
}

// NewLivingIntentionLattice builds a lattice seeded with the provided
// intention labels.  Each node starts at unit strength.
func NewLivingIntentionLattice(intentions ...string) *LivingIntentionLattice {
	nodes := make([]LatticeNode, 0, len(intentions))
	for _, intent := range intentions {
		nodes = append(nodes, LatticeNode{Intention: intent, Strength: 1.0})
	}
	return &LivingIntentionLattice{nodes: nodes}
}

// Name returns the canonical module identifier.
func (l *LivingIntentionLattice) Name() string {
	return "LivingIntentionLattice"
}

// Resonate strengthens every lattice node proportionally to the incoming
// amplitude and returns an updated amplitude that reflects the accumulated
// intentional weight.
func (l *LivingIntentionLattice) Resonate(amplitude float64) float64 {
	totalStrength := 0.0
	for i := range l.nodes {
		l.nodes[i].Strength += amplitude * 0.01
		totalStrength += l.nodes[i].Strength
	}
	l.cycleCount++
	// Output amplitude is boosted by the normalised lattice weight.
	nodeCount := float64(len(l.nodes))
	if nodeCount == 0 {
		return amplitude
	}
	return amplitude * (1.0 + totalStrength/nodeCount*0.001)
}

// Status returns a human-readable summary of the lattice.
func (l *LivingIntentionLattice) Status() string {
	return fmt.Sprintf(
		"%s  nodes:%d  cycles:%d",
		l.Name(), len(l.nodes), l.cycleCount,
	)
}

// Nodes returns a snapshot of all lattice nodes for inspection.
func (l *LivingIntentionLattice) Nodes() []LatticeNode {
	out := make([]LatticeNode, len(l.nodes))
	copy(out, l.nodes)
	return out
}
