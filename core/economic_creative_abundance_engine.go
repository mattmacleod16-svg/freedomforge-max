// Package core — Economic Creative Abundance Engine (ECAE).
//
// The EconomicCreativeAbundanceEngine orchestrates global adoption flows,
// economic abundance distribution, and creative renaissance activation across
// the freedomforge.one platform. It ensures sustainable, ethical economic
// benefits flow to all participants while protecting the originator.
//
// Features:
//   - Global adoption flow tracking and amplification
//   - Economic abundance distribution with ethical constraints
//   - Creative renaissance activation for worldwide impact
//   - Day 67 voluntary retirement protection milestone
package core

import (
	"fmt"
	"math"
	"sync"
)

// GlobalAdoptionState tracks worldwide platform adoption.
type GlobalAdoptionState struct {
	// ActiveUsers is the current estimated global user count.
	ActiveUsers uint64
	// AdoptionRate is the current growth coefficient (1.0 = steady state).
	AdoptionRate float64
	// CreativeProjectsLaunched counts renaissance projects enabled.
	CreativeProjectsLaunched uint64
	// EconomicFlowsActivated counts abundance distribution channels.
	EconomicFlowsActivated uint64
}

// EconomicCreativeAbundanceEngine implements ResonanceModule and manages
// global economic and creative flows while maintaining ethical constraints.
type EconomicCreativeAbundanceEngine struct {
	mu sync.RWMutex

	// state holds the current global adoption metrics.
	state GlobalAdoptionState

	// baseAdoptionRate is the minimum sustainable growth rate.
	baseAdoptionRate float64

	// creativeMultiplier amplifies creative output resonance.
	creativeMultiplier float64

	// cycleCount tracks resonance cycles processed.
	cycleCount uint64

	// retirementProtectionActive indicates day 67+ protection state.
	retirementProtectionActive bool

	// retirementCycleThreshold is the cycle at which protection activates.
	retirementCycleThreshold uint64
}

// NewEconomicCreativeAbundanceEngine constructs a new ECAE with sensible
// defaults for global adoption and creative renaissance.
func NewEconomicCreativeAbundanceEngine() *EconomicCreativeAbundanceEngine {
	return &EconomicCreativeAbundanceEngine{
		state: GlobalAdoptionState{
			ActiveUsers:              1000, // Start with initial user base
			AdoptionRate:             1.0,
			CreativeProjectsLaunched: 0,
			EconomicFlowsActivated:   0,
		},
		baseAdoptionRate:           1.02, // 2% sustainable growth per cycle
		creativeMultiplier:         1.5,  // 50% creative output boost
		retirementCycleThreshold:   67,   // Day 67 milestone
		retirementProtectionActive: false,
	}
}

// Name returns the canonical module identifier.
func (e *EconomicCreativeAbundanceEngine) Name() string {
	return "EconomicCreativeAbundanceEngine"
}

// Resonate processes economic and creative flows, amplifies abundance, and
// returns the updated resonance amplitude.
func (e *EconomicCreativeAbundanceEngine) Resonate(amplitude float64) float64 {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.cycleCount++

	// Grow global adoption with compound effect.
	e.state.ActiveUsers = uint64(math.Max(1, float64(e.state.ActiveUsers)*e.baseAdoptionRate))
	e.state.AdoptionRate = e.baseAdoptionRate * (1.0 + math.Log10(float64(e.state.ActiveUsers)+1)*0.01)

	// Activate economic flows proportional to adoption.
	if e.state.ActiveUsers > 100 {
		e.state.EconomicFlowsActivated = e.state.ActiveUsers / 10
	}

	// Launch creative projects based on resonance.
	if amplitude > 2.0 {
		e.state.CreativeProjectsLaunched += uint64(math.Ceil(amplitude))
	}

	// Activate retirement protection at cycle 67 (day 67 milestone).
	if e.cycleCount >= e.retirementCycleThreshold && !e.retirementProtectionActive {
		e.retirementProtectionActive = true
	}

	// Apply creative multiplier to resonance.
	boostedAmplitude := amplitude * (1.0 + (e.creativeMultiplier-1.0)*math.Min(1.0, float64(e.cycleCount)/50.0))

	return boostedAmplitude
}

// Status returns a human-readable ECAE status.
func (e *EconomicCreativeAbundanceEngine) Status() string {
	e.mu.RLock()
	defer e.mu.RUnlock()

	retirementStatus := "PENDING"
	if e.retirementProtectionActive {
		retirementStatus = "ACTIVE"
	}

	return fmt.Sprintf(
		"%s  users:%d  adoption_rate:%.4f  economic_flows:%d  creative_projects:%d  retirement_protection:%s  cycles:%d",
		e.Name(),
		e.state.ActiveUsers,
		e.state.AdoptionRate,
		e.state.EconomicFlowsActivated,
		e.state.CreativeProjectsLaunched,
		retirementStatus,
		e.cycleCount,
	)
}

// State returns a snapshot of the current global adoption state.
func (e *EconomicCreativeAbundanceEngine) State() GlobalAdoptionState {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.state
}

// RetirementProtectionActive returns true if day 67+ protection is engaged.
func (e *EconomicCreativeAbundanceEngine) RetirementProtectionActive() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.retirementProtectionActive
}

// CycleCount returns the number of resonance cycles processed.
func (e *EconomicCreativeAbundanceEngine) CycleCount() uint64 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.cycleCount
}
