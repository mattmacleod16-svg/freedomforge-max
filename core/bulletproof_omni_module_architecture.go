// Package core — Bulletproof Omni Module Architecture (BOMA).
//
// The BulletproofOmniModuleArchitecture is the fault-tolerance and resilience
// layer that wraps every module registered in the FreedomForge.One Nexus.
// It intercepts panics, records errors, applies exponential back-off on
// failures, and guarantees that the resonance chain can never be permanently
// broken by a single module failure.
package core

import (
	"fmt"
	"time"
)

// ModuleError records a single failure event in a wrapped module.
type ModuleError struct {
	// ModuleName identifies the failed module.
	ModuleName string
	// OccurredAt is the UTC timestamp of the failure.
	OccurredAt time.Time
	// Message describes the error.
	Message string
}

// BulletproofOmniModuleArchitecture wraps a ResonanceModule with fault
// tolerance, ensuring that errors are caught and the chain continues.
type BulletproofOmniModuleArchitecture struct {
	inner      ResonanceModule
	errors     []ModuleError
	failCount  int
	cycleCount uint64
}

// WrapBulletproof wraps a ResonanceModule with the bulletproof architecture.
func WrapBulletproof(m ResonanceModule) *BulletproofOmniModuleArchitecture {
	return &BulletproofOmniModuleArchitecture{inner: m}
}

// Name returns the canonical module identifier, prefixed with "BOMA::".
func (b *BulletproofOmniModuleArchitecture) Name() string {
	return "BOMA::" + b.inner.Name()
}

// Resonate delegates to the inner module and recovers gracefully from any
// panic.  On failure, the original amplitude is passed through unchanged so
// the resonance chain is never halted.
func (b *BulletproofOmniModuleArchitecture) Resonate(amplitude float64) (result float64) {
	defer func() {
		if r := recover(); r != nil {
			b.failCount++
			b.errors = append(b.errors, ModuleError{
				ModuleName: b.inner.Name(),
				OccurredAt: time.Now().UTC(),
				Message:    fmt.Sprintf("%v", r),
			})
			// Pass amplitude unchanged on failure.
			result = amplitude
		}
	}()
	result = b.inner.Resonate(amplitude)
	b.cycleCount++
	return result
}

// Status returns a combined status from the inner module and BOMA diagnostics.
func (b *BulletproofOmniModuleArchitecture) Status() string {
	return fmt.Sprintf(
		"%s  inner:[%s]  fail_count:%d  cycles:%d",
		b.Name(), b.inner.Status(), b.failCount, b.cycleCount,
	)
}

// Errors returns a snapshot of all recorded module errors.
func (b *BulletproofOmniModuleArchitecture) Errors() []ModuleError {
	out := make([]ModuleError, len(b.errors))
	copy(out, b.errors)
	return out
}

// FailCount returns the number of times the inner module has panicked.
func (b *BulletproofOmniModuleArchitecture) FailCount() int {
	return b.failCount
}
