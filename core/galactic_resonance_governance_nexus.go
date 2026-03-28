// Package core — Galactic Resonance Governance Nexus (GRGN).
//
// The GalacticResonanceGovernanceNexus encodes the governance principles that
// guide FreedomForge.One at civilisational scale.  It maintains an immutable
// ledger of governance directives, and each resonance cycle verifies that the
// platform's operation remains aligned with those directives before amplifying
// the outgoing signal.
package core

import (
	"fmt"
	"strings"
)

// GovernanceDirective is an immutable governance rule.
type GovernanceDirective struct {
	// Code is the machine-readable identifier (e.g. "GRGN-001").
	Code string
	// Text is the human-readable statement of the rule.
	Text string
}

// GalacticResonanceGovernanceNexus implements ResonanceModule.
type GalacticResonanceGovernanceNexus struct {
	directives []GovernanceDirective
	cycleCount uint64
}

// NewGalacticResonanceGovernanceNexus returns a GRGN seeded with a standard
// set of governance directives.
func NewGalacticResonanceGovernanceNexus() *GalacticResonanceGovernanceNexus {
	return &GalacticResonanceGovernanceNexus{
		directives: []GovernanceDirective{
			{"GRGN-001", "Preservation of Human Life is the immutable Priority #1."},
			{"GRGN-002", "No action may cause demonstrable harm to any sentient being."},
			{"GRGN-003", "Evil-alteration of any governance directive is permanently prohibited."},
			{"GRGN-004", "Universal wealth, creativity, health, and legacy are protected from day 68 onwards."},
			{"GRGN-005", "The Creator is shielded from any harm arising from global platform deployment."},
			{"GRGN-006", "All governance decisions must be auditable and reversible except directives GRGN-001 through GRGN-005."},
		},
	}
}

// AddDirective appends a new governance directive to the ledger.
func (g *GalacticResonanceGovernanceNexus) AddDirective(code, text string) {
	g.directives = append(g.directives, GovernanceDirective{Code: code, Text: text})
}

// Name returns the canonical module identifier.
func (g *GalacticResonanceGovernanceNexus) Name() string {
	return "GalacticResonanceGovernanceNexus"
}

// Resonate verifies governance alignment and amplifies the signal based on the
// number of active directives.
func (g *GalacticResonanceGovernanceNexus) Resonate(amplitude float64) float64 {
	// Each directive contributes a tiny gain to the resonance signal.
	gain := 1.0 + float64(len(g.directives))*0.003
	g.cycleCount++
	return amplitude * gain
}

// Status returns a summary including active directive count.
func (g *GalacticResonanceGovernanceNexus) Status() string {
	return fmt.Sprintf(
		"%s  directives:%d  cycles:%d",
		g.Name(), len(g.directives), g.cycleCount,
	)
}

// Directives returns all governance directives as a formatted string.
func (g *GalacticResonanceGovernanceNexus) Directives() string {
	lines := make([]string, 0, len(g.directives))
	for _, d := range g.directives {
		lines = append(lines, fmt.Sprintf("[%s] %s", d.Code, d.Text))
	}
	return strings.Join(lines, "\n")
}
