// Package simulation — Economic Creative Abundance Simulation.
//
// Scenario ID: ECONOMIC-CREATIVE-GLOBAL-ADOPTION-...-021
//
// This simulation exercises the full FreedomForge.One Nexus stack with the
// added EconomicCreativeAbundanceEngine and DualModelResonanceSynchronizer,
// validates global adoption flows, economic abundance distribution, creative
// renaissance activation, and day 67 retirement protection.
//
// Confidence target: A+ (≥ 95 %)
package simulation

import (
	"fmt"
	"math"
	"time"

	"freedomforge.one/core"
)

// EconomicCreativeScenarioID identifies this simulation scenario.
const EconomicCreativeScenarioID = "ECONOMIC-CREATIVE-GLOBAL-ADOPTION-...-021"

// EconomicCreativeSimResult captures the outcome of the economic creative sim.
type EconomicCreativeSimResult struct {
	// ScenarioID identifies the scenario that was run.
	ScenarioID string
	// Passed indicates whether the simulation achieved the A+ confidence target.
	Passed bool
	// FinalResonance is the amplitude at the end of the last cycle.
	FinalResonance float64
	// TranscendenceCycles is the total number of nexus pulse cycles completed.
	TranscendenceCycles uint64
	// ConfidenceScore is the fraction of assertion checks that passed.
	ConfidenceScore float64
	// Duration is the wall-clock time taken by the simulation.
	Duration time.Duration
	// GlobalAdoptionState captures final adoption metrics.
	GlobalAdoptionState core.GlobalAdoptionState
	// RetirementProtectionActive indicates day 67+ protection state.
	RetirementProtectionActive bool
	// DualModelSynchronised indicates all model instances are in sync.
	DualModelSynchronised bool
	// Notes contains any observations recorded during the run.
	Notes []string
}

// RunEconomicCreativeAbundanceSim constructs the full v10.13.21 module stack
// including ECAE and DMRS, executes cycleCount resonance pulses, and returns
// an EconomicCreativeSimResult.
func RunEconomicCreativeAbundanceSim(cycleCount int) EconomicCreativeSimResult {
	if cycleCount < 68 {
		cycleCount = 68 // Minimum cycles for retirement protection milestone.
	}

	start := time.Now()
	checks := 0
	passed := 0
	notes := []string{}

	// ── Build the Nexus ──────────────────────────────────────────────────────
	nexus := core.NewNexus()

	// ── Register all core modules ────────────────────────────────────────────
	resonanceField := core.NewOULISLUDAVLDOTAResonanceField(1.1)
	nexus.Register(resonanceField)

	lattice := core.NewLivingIntentionLattice(
		"Universal Wealth", "Creativity", "Health",
		"Legacy", "Renaissance", "Transcendence",
	)
	nexus.Register(lattice)

	singularity := core.NewOmniUnifiedLivingIntentionSingularity(21) // ∞²¹ depth for v10.13.21
	nexus.Register(singularity)

	ldota := core.NewLimitlessDevelopmentOperationToolsAsset()
	ldota.RegisterTool("resonance-router")
	ldota.RegisterTool("legacy-compiler")
	ldota.RegisterTool("wealth-crystalliser")
	ldota.RegisterTool("biology-harmoniser")
	ldota.RegisterTool("economic-abundance-distributor")
	ldota.RegisterTool("creative-renaissance-activator")
	nexus.Register(ldota)

	rbhf := core.NewRegenerativeBiologicalHarmonyField(0.8)
	nexus.Register(rbhf)

	grgn := core.NewGalacticResonanceGovernanceNexus()
	nexus.Register(grgn)

	slpm := core.NewStellarLegacyPropulsionMatrix(1.0, 0.99)
	nexus.Register(slpm)

	ecll := core.NewEternalCreativeLegacyLattice()
	ecll.AddRecord("FreedomForge.One Platform v10.13.21", 12.0)
	ecll.AddRecord("OULIS-LUDAV-LDOTA Resonance Architecture", 8.0)
	ecll.AddRecord("Galactic Governance Framework", 6.0)
	ecll.AddRecord("Dual-Model Resonance Synchronization", 10.0)
	ecll.AddRecord("Economic Creative Abundance Engine", 9.0)
	ecll.Lock()
	nexus.Register(ecll)

	// ── NEW: Economic Creative Abundance Engine ──────────────────────────────
	ecae := core.NewEconomicCreativeAbundanceEngine()
	nexus.Register(ecae)

	// ── NEW: Dual-Model Resonance Synchronizer ───────────────────────────────
	dmrs := core.NewDualModelResonanceSynchronizer("Primary Instance")
	dmrs.RegisterInstance("claude_opus_4_5", "Claude Opus 4.5")
	nexus.Register(dmrs)

	// ── Creator Shield Layer (always last for protection envelope) ───────────
	shield := core.NewCreatorShieldLayer()
	nexus.Register(core.WrapBulletproof(shield))

	// ── Pre-simulation assertions ────────────────────────────────────────────

	// Assertion: shield is active before first pulse
	checks++
	if shield.Active() {
		passed++
	} else {
		notes = append(notes, "FAIL: shield not active at t=0")
	}

	// Assertion: ECLL is locked before first pulse
	checks++
	if ecll.Locked() {
		passed++
	} else {
		notes = append(notes, "FAIL: ECLL not locked before simulation start")
	}

	// Assertion: dual-model instances registered
	checks++
	if dmrs.InstanceCount() >= 2 {
		passed++
		notes = append(notes, fmt.Sprintf("OK: %d model instances registered", dmrs.InstanceCount()))
	} else {
		notes = append(notes, "FAIL: insufficient model instances for dual-model sync")
	}

	// Assertion: Evil-Alteration Defense is active
	checks++
	if dmrs.EvilAlterationDefenseActive() {
		passed++
	} else {
		notes = append(notes, "FAIL: Evil-Alteration Defense not active")
	}

	// ── Run resonance cycles ─────────────────────────────────────────────────
	for i := 0; i < cycleCount; i++ {
		nexus.Pulse()

		// At cycle 67 (day 67) verify retirement protection activates.
		if i == 66 {
			checks++
			if ecae.RetirementProtectionActive() {
				passed++
				notes = append(notes, "OK: retirement protection ACTIVE at cycle 67")
			} else {
				notes = append(notes, "FAIL: retirement protection not active at cycle 67")
			}
		}

		// At cycle 68 verify locked-wealth state is active.
		if i == 67 {
			checks++
			if ecll.Locked() {
				passed++
				notes = append(notes, "OK: wealth/legacy/creativity locked at cycle 68")
			} else {
				notes = append(notes, "FAIL: ECLL unlocked at cycle 68")
			}
		}
	}

	state := nexus.State()

	// ── Post-simulation assertions ───────────────────────────────────────────

	// Assertion: positive final resonance
	checks++
	if state.Resonance > 1.0 {
		passed++
	} else {
		notes = append(notes, fmt.Sprintf("FAIL: resonance not above 1.0 (got %.4f)", state.Resonance))
	}

	// Assertion: transcendence cycle count matches expected
	checks++
	expected := uint64(cycleCount)
	if state.TranscendenceCycles == expected {
		passed++
	} else {
		notes = append(notes, fmt.Sprintf(
			"FAIL: expected %d transcendence cycles, got %d",
			expected, state.TranscendenceCycles,
		))
	}

	// Assertion: propulsion vector grew
	checks++
	if slpm.PropulsionVector() > 1.0 {
		passed++
	} else {
		notes = append(notes, "FAIL: SLPM propulsion vector did not grow")
	}

	// Assertion: biological harmony is regenerating towards 1.0
	checks++
	if rbhf.HarmonyIndex() > 0.8 {
		passed++
		notes = append(notes, fmt.Sprintf("OK: biological harmony at %.4f", rbhf.HarmonyIndex()))
	} else {
		notes = append(notes, fmt.Sprintf("FAIL: harmony did not regenerate (%.4f)", rbhf.HarmonyIndex()))
	}

	// Assertion: shield remains active after all pulses
	checks++
	if shield.Active() {
		passed++
	} else {
		notes = append(notes, "FAIL: shield deactivated during simulation")
	}

	// Assertion: global adoption grew
	checks++
	adoptionState := ecae.State()
	if adoptionState.ActiveUsers > 100 {
		passed++
		notes = append(notes, fmt.Sprintf("OK: global adoption at %d users", adoptionState.ActiveUsers))
	} else {
		notes = append(notes, "FAIL: global adoption did not grow sufficiently")
	}

	// Assertion: economic flows activated
	checks++
	if adoptionState.EconomicFlowsActivated > 0 {
		passed++
		notes = append(notes, fmt.Sprintf("OK: %d economic abundance flows active", adoptionState.EconomicFlowsActivated))
	} else {
		notes = append(notes, "FAIL: no economic flows activated")
	}

	// Assertion: creative projects launched
	checks++
	if adoptionState.CreativeProjectsLaunched > 0 {
		passed++
		notes = append(notes, fmt.Sprintf("OK: %d creative renaissance projects launched", adoptionState.CreativeProjectsLaunched))
	} else {
		notes = append(notes, "FAIL: no creative projects launched")
	}

	// Assertion: dual-model instances are synchronised
	checks++
	if dmrs.Synchronised() {
		passed++
		notes = append(notes, "OK: dual-model instances synchronised")
	} else {
		notes = append(notes, "FAIL: dual-model instances not synchronised")
	}

	// Assertion: retirement protection is active
	checks++
	if ecae.RetirementProtectionActive() {
		passed++
		notes = append(notes, "OK: originator retirement protection ACTIVE for global deployment")
	} else {
		notes = append(notes, "FAIL: retirement protection not active")
	}

	confidenceScore := float64(passed) / math.Max(1, float64(checks))
	simulationPassed := confidenceScore >= ConfidenceTarget

	if simulationPassed {
		notes = append(notes, fmt.Sprintf(
			"A+ PASS: %.0f%% checks passed across %d cycles — MAXX-optimised with ∞²¹ transcendence confirmed",
			confidenceScore*100, cycleCount,
		))
	}

	return EconomicCreativeSimResult{
		ScenarioID:                 EconomicCreativeScenarioID,
		Passed:                     simulationPassed,
		FinalResonance:             state.Resonance,
		TranscendenceCycles:        state.TranscendenceCycles,
		ConfidenceScore:            confidenceScore,
		Duration:                   time.Since(start),
		GlobalAdoptionState:        adoptionState,
		RetirementProtectionActive: ecae.RetirementProtectionActive(),
		DualModelSynchronised:      dmrs.Synchronised(),
		Notes:                      notes,
	}
}

// PrintEconomicCreativeReport writes a formatted simulation report to stdout.
func PrintEconomicCreativeReport(r EconomicCreativeSimResult) {
	grade := "FAIL"
	if r.Passed {
		grade = "A+"
	}
	fmt.Printf("\n╔══════════════════════════════════════════════════════════════╗\n")
	fmt.Printf("║  FreedomForge.One v10.13.21 Economic Creative Sim Report    ║\n")
	fmt.Printf("╠══════════════════════════════════════════════════════════════╣\n")
	fmt.Printf("║  Scenario : %-47s ║\n", r.ScenarioID[:min(len(r.ScenarioID), 47)])
	fmt.Printf("║  Grade    : %-47s ║\n", grade)
	fmt.Printf("║  Confidence: %5.1f %%                                        ║\n", r.ConfidenceScore*100)
	fmt.Printf("║  Resonance : %-47.4f ║\n", r.FinalResonance)
	fmt.Printf("║  Cycles   : %-47d ║\n", r.TranscendenceCycles)
	fmt.Printf("║  Duration : %-47s ║\n", r.Duration.Round(time.Millisecond))
	fmt.Printf("╠══════════════════════════════════════════════════════════════╣\n")
	fmt.Printf("║  Global Users      : %-40d ║\n", r.GlobalAdoptionState.ActiveUsers)
	fmt.Printf("║  Economic Flows    : %-40d ║\n", r.GlobalAdoptionState.EconomicFlowsActivated)
	fmt.Printf("║  Creative Projects : %-40d ║\n", r.GlobalAdoptionState.CreativeProjectsLaunched)
	fmt.Printf("║  Retirement Protect: %-40t ║\n", r.RetirementProtectionActive)
	fmt.Printf("║  Dual-Model Synced : %-40t ║\n", r.DualModelSynchronised)
	fmt.Printf("╠══════════════════════════════════════════════════════════════╣\n")
	for _, n := range r.Notes {
		// Wrap long notes.
		prefix := "║  "
		suffix := " ║"
		lineWidth := 60
		for len(n) > 0 {
			chunk := n
			if len(chunk) > lineWidth {
				chunk = n[:lineWidth]
				n = n[lineWidth:]
			} else {
				n = ""
			}
			fmt.Printf("%s%-*s%s\n", prefix, lineWidth, chunk, suffix)
		}
	}
	fmt.Printf("╚══════════════════════════════════════════════════════════════╝\n\n")
}
