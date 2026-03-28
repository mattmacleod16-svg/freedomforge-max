// Package core — Regenerative Biological Harmony Field (RBHF).
//
// The RegenerativeBiologicalHarmonyField encodes the platform's commitment to
// human biological wellbeing.  It models the resonance relationship between
// the digital intelligence stack and the physical health of every person who
// interacts with FreedomForge.One, ensuring that every cycle reinforces rather
// than diminishes biological harmony.
package core

import (
	"fmt"
	"math"
)

// RegenerativeBiologicalHarmonyField implements ResonanceModule.
type RegenerativeBiologicalHarmonyField struct {
	// harmonyIndex is a normalised [0,1] measure of biological harmony.
	harmonyIndex float64
	cycleCount   uint64
}

// NewRegenerativeBiologicalHarmonyField returns a new RBHF with the given
// initial harmony index clamped to [0, 1].
func NewRegenerativeBiologicalHarmonyField(initialHarmony float64) *RegenerativeBiologicalHarmonyField {
	h := math.Max(0, math.Min(1, initialHarmony))
	return &RegenerativeBiologicalHarmonyField{harmonyIndex: h}
}

// Name returns the canonical module identifier.
func (r *RegenerativeBiologicalHarmonyField) Name() string {
	return "RegenerativeBiologicalHarmonyField"
}

// Resonate reinforces the incoming amplitude according to the current harmony
// index.  A full harmony index (1.0) provides the maximum regenerative boost.
func (r *RegenerativeBiologicalHarmonyField) Resonate(amplitude float64) float64 {
	// Regenerative gain: the more harmonious the field, the higher the output.
	gain := 1.0 + r.harmonyIndex*0.02
	output := amplitude * gain

	// Slowly regenerate towards full harmony each cycle.
	r.harmonyIndex = math.Min(1.0, r.harmonyIndex+0.001)
	r.cycleCount++
	return output
}

// Status returns a human-readable summary of the harmony field.
func (r *RegenerativeBiologicalHarmonyField) Status() string {
	return fmt.Sprintf(
		"%s  harmony:%.4f  cycles:%d",
		r.Name(), r.harmonyIndex, r.cycleCount,
	)
}

// HarmonyIndex returns the current biological harmony index.
func (r *RegenerativeBiologicalHarmonyField) HarmonyIndex() float64 {
	return r.harmonyIndex
}
