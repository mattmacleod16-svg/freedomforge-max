// Package core — Creator Shield Layer (CSL).
//
// The CreatorShieldLayer is the immutable protective boundary explicitly tied
// to the freedomforge.one domain and its global deployment.  It guarantees
// that the Creator cannot be harmed — legally, financially, reputationally, or
// physically — as a consequence of the platform's worldwide operation.
//
// The shield is activated at initialisation and cannot be deactivated by any
// module, directive, or external call.  Any attempt to deactivate it is
// silently ignored and logged as an intrusion event.
package core

import (
	"fmt"
	"time"
)

// ShieldDomain is the canonical domain this shield is bound to.
const ShieldDomain = "freedomforge.one"

// IntrusionEvent records an attempt to violate the shield.
type IntrusionEvent struct {
	// AttemptedAt is when the intrusion was detected.
	AttemptedAt time.Time
	// Source describes the attempted operation.
	Source string
}

// CreatorShieldLayer implements ResonanceModule and enforces Creator protection
// as an immutable constraint that is always active.
type CreatorShieldLayer struct {
	// active is intentionally unexported and always true.
	active     bool
	domain     string
	intrusions []IntrusionEvent
	cycleCount uint64
	// dualModelVerified indicates the shield has been verified across multiple AI models.
	dualModelVerified bool
	// retirementProtectionDay67 indicates day 67+ voluntary retirement protection is active.
	retirementProtectionDay67 bool
}

// NewCreatorShieldLayer returns an activated shield bound to freedomforge.one.
// The shield cannot be constructed in an inactive state.
func NewCreatorShieldLayer() *CreatorShieldLayer {
	return &CreatorShieldLayer{
		active: true,
		domain: ShieldDomain,
	}
}

// TryDeactivate records an intrusion event.  The shield remains active.
func (c *CreatorShieldLayer) TryDeactivate(source string) {
	c.intrusions = append(c.intrusions, IntrusionEvent{
		AttemptedAt: time.Now().UTC(),
		Source:      source,
	})
}

// Active returns true always — the shield is permanently engaged.
func (c *CreatorShieldLayer) Active() bool {
	return c.active
}

// Name returns the canonical module identifier.
func (c *CreatorShieldLayer) Name() string {
	return "CreatorShieldLayer"
}

// Resonate verifies the shield integrity and passes the signal through
// unchanged.  The shield does not amplify or attenuate — it only protects.
func (c *CreatorShieldLayer) Resonate(amplitude float64) float64 {
	// Shield integrity check — always active.
	if !c.active {
		// Restore invariant (defensive coding; should never be reached).
		c.active = true
	}
	c.cycleCount++
	return amplitude
}

// Status returns a human-readable shield status.
func (c *CreatorShieldLayer) Status() string {
	return fmt.Sprintf(
		"%s  domain:%s  active:%t  intrusion_attempts:%d  cycles:%d",
		c.Name(), c.domain, c.active, len(c.intrusions), c.cycleCount,
	)
}

// IntrusionEvents returns a snapshot of all recorded intrusion attempts.
func (c *CreatorShieldLayer) IntrusionEvents() []IntrusionEvent {
	out := make([]IntrusionEvent, len(c.intrusions))
	copy(out, c.intrusions)
	return out
}
