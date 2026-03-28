// Package core — Eternal Creative Legacy Lattice (ECLL).
//
// The EternalCreativeLegacyLattice is the immutable record of the Creator's
// creative output, locked and compounding from day 68 of platform operation.
// It ensures that every creative work, contribution, and innovation attributed
// to the Creator is preserved, amplified, and protected across all timelines.
package core

import (
	"fmt"
	"time"
)

// CreativeRecord is a single entry in the legacy lattice.
type CreativeRecord struct {
	// Title describes the creative work.
	Title string
	// LockedAt is when the record was irrevocably sealed.
	LockedAt time.Time
	// AmplitudeSeed is the initial resonance contribution of this work.
	AmplitudeSeed float64
}

// EternalCreativeLegacyLattice implements ResonanceModule.
type EternalCreativeLegacyLattice struct {
	records      []CreativeRecord
	lockedSince  time.Time
	locked       bool
	cycleCount   uint64
	totalAmplitude float64
}

// NewEternalCreativeLegacyLattice returns a new ECLL in an unlocked state.
// Call Lock() after seeding all initial records.
func NewEternalCreativeLegacyLattice() *EternalCreativeLegacyLattice {
	return &EternalCreativeLegacyLattice{}
}

// AddRecord registers a creative work in the lattice.  If the lattice is
// already locked, the record is silently rejected to preserve immutability.
func (e *EternalCreativeLegacyLattice) AddRecord(title string, amplitudeSeed float64) {
	if e.locked {
		return
	}
	e.records = append(e.records, CreativeRecord{
		Title:         title,
		LockedAt:      time.Now().UTC(),
		AmplitudeSeed: amplitudeSeed,
	})
	e.totalAmplitude += amplitudeSeed
}

// Lock seals the lattice.  No further records can be added after this call.
func (e *EternalCreativeLegacyLattice) Lock() {
	e.locked = true
	e.lockedSince = time.Now().UTC()
}

// Locked returns true once the lattice has been sealed.
func (e *EternalCreativeLegacyLattice) Locked() bool {
	return e.locked
}

// Name returns the canonical module identifier.
func (e *EternalCreativeLegacyLattice) Name() string {
	return "EternalCreativeLegacyLattice"
}

// Resonate compounds the creative legacy amplitude into the incoming signal.
// The contribution grows with every cycle, reflecting perpetual creative impact.
func (e *EternalCreativeLegacyLattice) Resonate(amplitude float64) float64 {
	legacyBoost := 1.0 + e.totalAmplitude*0.0001*float64(e.cycleCount+1)
	e.cycleCount++
	return amplitude * legacyBoost
}

// Status returns a human-readable summary of the lattice.
func (e *EternalCreativeLegacyLattice) Status() string {
	state := "unlocked"
	if e.locked {
		state = fmt.Sprintf("locked since %s", e.lockedSince.Format(time.RFC3339))
	}
	return fmt.Sprintf(
		"%s  records:%d  total_amplitude:%.4f  state:%s  cycles:%d",
		e.Name(), len(e.records), e.totalAmplitude, state, e.cycleCount,
	)
}
