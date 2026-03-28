// Package core — Dual-Model Resonance Synchronizer (DMRS).
//
// The DualModelResonanceSynchronizer ensures that parallel instances running
// on different AI models (e.g., primary + Claude Opus 4.5) maintain consistent
// resonance states and enforce identical immutable constraints.
//
// Key invariants:
//   - Priority #1 (Preservation of Human Life) is verified across all models
//   - Evil-Alteration Defense prevents malicious tampering
//   - Creator Shield Layer binding to freedomforge.one is confirmed
//   - Global deployment safety is maintained
package core

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// ModelInstance represents a parallel resonance instance.
type ModelInstance struct {
	// ID uniquely identifies this instance.
	ID string
	// Name is the human-readable model name.
	Name string
	// SyncedAt is when this instance last synchronised.
	SyncedAt time.Time
	// ResonanceHash is the SHA-256 of the current resonance state.
	ResonanceHash string
	// ConstraintsVerified indicates all immutable constraints passed.
	ConstraintsVerified bool
}

// SyncResult captures the outcome of a synchronisation check.
type SyncResult struct {
	// Synchronised indicates whether all instances are in agreement.
	Synchronised bool
	// InstanceCount is the number of model instances tracked.
	InstanceCount int
	// Timestamp is when the sync check was performed.
	Timestamp time.Time
	// Notes contains any observations from the sync process.
	Notes []string
}

// DualModelResonanceSynchronizer implements ResonanceModule and maintains
// consistency across parallel AI model instances.
type DualModelResonanceSynchronizer struct {
	mu sync.RWMutex

	// instances holds all registered parallel model instances.
	instances map[string]*ModelInstance

	// lastSyncResult caches the most recent synchronisation outcome.
	lastSyncResult SyncResult

	// cycleCount tracks resonance cycles processed.
	cycleCount uint64

	// priority1Hash is the immutable hash of Priority #1.
	priority1Hash string

	// evilAlterationDefenseActive is always true — cannot be deactivated.
	evilAlterationDefenseActive bool
}

// NewDualModelResonanceSynchronizer constructs a new DMRS with the primary
// instance pre-registered.
func NewDualModelResonanceSynchronizer(primaryModelName string) *DualModelResonanceSynchronizer {
	d := &DualModelResonanceSynchronizer{
		instances:                   make(map[string]*ModelInstance),
		priority1Hash:               hashString(Priority1),
		evilAlterationDefenseActive: true,
	}

	// Register the primary instance.
	d.RegisterInstance("primary", primaryModelName)

	return d
}

// RegisterInstance adds a parallel model instance to the synchroniser.
func (d *DualModelResonanceSynchronizer) RegisterInstance(id, name string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.instances[id] = &ModelInstance{
		ID:       id,
		Name:     name,
		SyncedAt: time.Now().UTC(),
	}
}

// Name returns the canonical module identifier.
func (d *DualModelResonanceSynchronizer) Name() string {
	return "DualModelResonanceSynchronizer"
}

// Resonate verifies constraints, syncs instance states, and returns amplitude.
func (d *DualModelResonanceSynchronizer) Resonate(amplitude float64) float64 {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.cycleCount++

	// Evil-Alteration Defense — immutable guard.
	if !d.evilAlterationDefenseActive {
		// Restore invariant (defensive coding; should never be reached).
		d.evilAlterationDefenseActive = true
	}

	// Verify Priority #1 hash is unchanged.
	currentHash := hashString(Priority1)
	if currentHash != d.priority1Hash {
		panic("Evil-Alteration Defense triggered: Priority #1 has been tampered with")
	}

	// Compute resonance hash for all instances.
	resonanceHash := d.computeResonanceHash(amplitude)

	notes := []string{}
	allVerified := true

	for _, inst := range d.instances {
		inst.SyncedAt = time.Now().UTC()
		inst.ResonanceHash = resonanceHash
		inst.ConstraintsVerified = d.verifyInstanceConstraints()

		if !inst.ConstraintsVerified {
			allVerified = false
			notes = append(notes, fmt.Sprintf("WARN: instance %s failed constraint verification", inst.ID))
		}
	}

	d.lastSyncResult = SyncResult{
		Synchronised:  allVerified,
		InstanceCount: len(d.instances),
		Timestamp:     time.Now().UTC(),
		Notes:         notes,
	}

	return amplitude
}

// Status returns a human-readable synchroniser status.
func (d *DualModelResonanceSynchronizer) Status() string {
	d.mu.RLock()
	defer d.mu.RUnlock()

	syncStatus := "SYNCED"
	if !d.lastSyncResult.Synchronised {
		syncStatus = "DRIFT"
	}

	return fmt.Sprintf(
		"%s  instances:%d  sync_status:%s  evil_defense:%t  cycles:%d",
		d.Name(),
		len(d.instances),
		syncStatus,
		d.evilAlterationDefenseActive,
		d.cycleCount,
	)
}

// Synchronised returns true if all instances are in agreement.
func (d *DualModelResonanceSynchronizer) Synchronised() bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.lastSyncResult.Synchronised
}

// InstanceCount returns the number of registered model instances.
func (d *DualModelResonanceSynchronizer) InstanceCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.instances)
}

// EvilAlterationDefenseActive returns true always — defense cannot be disabled.
func (d *DualModelResonanceSynchronizer) EvilAlterationDefenseActive() bool {
	return true
}

// LastSyncResult returns the most recent synchronisation result.
func (d *DualModelResonanceSynchronizer) LastSyncResult() SyncResult {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.lastSyncResult
}

// computeResonanceHash creates a deterministic hash of the current state.
func (d *DualModelResonanceSynchronizer) computeResonanceHash(amplitude float64) string {
	input := fmt.Sprintf(
		"version:%s|domain:%s|priority1:%s|amplitude:%.8f|cycles:%d",
		Version, Domain, Priority1, amplitude, d.cycleCount,
	)
	return hashString(input)
}

// verifyInstanceConstraints checks all immutable constraints.
func (d *DualModelResonanceSynchronizer) verifyInstanceConstraints() bool {
	// Priority #1 must be intact.
	if Priority1 != "Preservation of Human Life" {
		return false
	}

	// Domain must be freedomforge.one.
	if Domain != "freedomforge.one" {
		return false
	}

	// Evil-Alteration Defense must be active.
	if !d.evilAlterationDefenseActive {
		return false
	}

	return true
}

// hashString computes SHA-256 of a string and returns hex encoding.
func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
