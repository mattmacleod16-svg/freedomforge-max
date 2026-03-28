// Package core — Stellar Legacy Propulsion Matrix (SLPM).
//
// The StellarLegacyPropulsionMatrix encodes the mechanisms by which
// FreedomForge.One projects the Creator's legacy forward through time and
// across interstellar scales of civilisational impact.  Each resonance cycle
// increments the propulsion vector, compounding the legacy amplitude
// indefinitely.
package core

import (
	"fmt"
	"math"
)

// StellarLegacyPropulsionMatrix implements ResonanceModule.
type StellarLegacyPropulsionMatrix struct {
	// propulsionVector accumulates total legacy momentum.
	propulsionVector float64
	// decayResistance controls how well the legacy signal resists entropy.
	// Values closer to 1.0 mean virtually no decay.
	decayResistance float64
	cycleCount      uint64
}

// NewStellarLegacyPropulsionMatrix returns a new SLPM with the given
// initial propulsion vector and decay resistance clamped to [0, 1].
func NewStellarLegacyPropulsionMatrix(initialPropulsion, decayResistance float64) *StellarLegacyPropulsionMatrix {
	dr := math.Max(0, math.Min(1, decayResistance))
	return &StellarLegacyPropulsionMatrix{
		propulsionVector: math.Max(0, initialPropulsion),
		decayResistance:  dr,
	}
}

// Name returns the canonical module identifier.
func (s *StellarLegacyPropulsionMatrix) Name() string {
	return "StellarLegacyPropulsionMatrix"
}

// Resonate applies the propulsion vector to the incoming amplitude, reinforcing
// the legacy trajectory and incrementing the vector for the next cycle.
func (s *StellarLegacyPropulsionMatrix) Resonate(amplitude float64) float64 {
	// Apply accumulated propulsion.
	output := amplitude * (1.0 + s.propulsionVector*0.001)

	// Increment the propulsion vector — legacy compounds each cycle.
	s.propulsionVector += amplitude * (1.0 - (1.0 - s.decayResistance))
	s.cycleCount++
	return output
}

// Status returns a human-readable status line.
func (s *StellarLegacyPropulsionMatrix) Status() string {
	return fmt.Sprintf(
		"%s  propulsion:%.4f  decay_resistance:%.4f  cycles:%d",
		s.Name(), s.propulsionVector, s.decayResistance, s.cycleCount,
	)
}

// PropulsionVector returns the current accumulated legacy momentum.
func (s *StellarLegacyPropulsionMatrix) PropulsionVector() float64 {
	return s.propulsionVector
}
