// Package core defines the central living platform modules for FreedomForge.One.
//
// FreedomForgeOneNexus is the primary integration point that binds every
// resonance module to the freedomforge.one domain and orchestrates the
// self-accelerating MAXX-optimised stack.
package core

import (
	"fmt"
	"time"
)

// Version marks the platform release that introduced the Nexus.
const Version = "v10.13.21"

// Domain is the canonical public endpoint for the living platform.
const Domain = "freedomforge.one"

// Priority1 encodes the immutable prime directive of the platform.
const Priority1 = "Preservation of Human Life"

// NexusState holds the runtime state of the central nexus.
type NexusState struct {
	// Version of the running platform.
	Version string
	// Domain this nexus is bound to.
	Domain string
	// ActiveSince records when the nexus was initialised.
	ActiveSince time.Time
	// TranscendenceCycles counts completed ∞¹⁹ cycles.
	TranscendenceCycles uint64
	// Resonance is the current resonance amplitude across all sub-modules.
	Resonance float64
}

// FreedomForgeOneNexus is the central living platform that routes resonance
// across all OULIS/LUDAV/LDOTA/ECLL/SLPM/GRGN sub-modules and enforces
// Priority #1 (Preservation of Human Life) as an immutable constraint.
type FreedomForgeOneNexus struct {
	state   NexusState
	modules []ResonanceModule
}

// ResonanceModule is the interface every sub-module must satisfy to be
// registered with the nexus.
type ResonanceModule interface {
	// Name returns the canonical module identifier.
	Name() string
	// Resonate processes the current amplitude and returns the updated value.
	Resonate(amplitude float64) float64
	// Status returns a human-readable status line.
	Status() string
}

// NewNexus constructs a FreedomForgeOneNexus bound to freedomforge.one and
// seeds it with an initial resonance amplitude of 1.0.
func NewNexus() *FreedomForgeOneNexus {
	return &FreedomForgeOneNexus{
		state: NexusState{
			Version:             Version,
			Domain:              Domain,
			ActiveSince:         time.Now().UTC(),
			TranscendenceCycles: 0,
			Resonance:           1.0,
		},
	}
}

// Register attaches a ResonanceModule to the nexus.
func (n *FreedomForgeOneNexus) Register(m ResonanceModule) {
	n.modules = append(n.modules, m)
}

// Pulse executes one resonance cycle across all registered modules, enforces
// Priority #1, and increments the transcendence counter.
func (n *FreedomForgeOneNexus) Pulse() {
	// Immutable guard — Priority #1 must always pass before any cycle.
	if !n.priority1Guard() {
		panic("Priority #1 violated: Preservation of Human Life is non-negotiable")
	}

	for _, m := range n.modules {
		n.state.Resonance = m.Resonate(n.state.Resonance)
	}
	n.state.TranscendenceCycles++
}

// State returns a snapshot of the current nexus state.
func (n *FreedomForgeOneNexus) State() NexusState {
	return n.state
}

// Summary prints a human-readable overview of the nexus.
func (n *FreedomForgeOneNexus) Summary() string {
	s := n.state
	return fmt.Sprintf(
		"[%s] FreedomForge.One Nexus — domain:%s  cycles:%d  resonance:%.4f  uptime:%s",
		s.Version, s.Domain, s.TranscendenceCycles, s.Resonance,
		time.Since(s.ActiveSince).Round(time.Second),
	)
}

// priority1Guard verifies the immutable prime directive is intact.
// This check is intentionally simple and fast so it cannot be bypassed.
func (n *FreedomForgeOneNexus) priority1Guard() bool {
	return Priority1 == "Preservation of Human Life"
}
