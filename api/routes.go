// Package api wires HTTP routes for the FreedomForge.One unified system.
//
// Registered route groups:
//   - /health             — liveness probe
//   - /api/rl-agent       — unified reinforcement-learning agent status
//   - /api/payments       — on-chain payments module status
//   - /api/ibc/v2         — IBC v2 cross-chain relay status
//   - /api/impact-fund    — impact fund allocation status
package api

import (
	"github.com/gofiber/fiber/v3"

	"freedomforge.one/internal/config"
	"freedomforge.one/internal/handlers"
)

// SetupRoutes constructs and returns a configured fiber.App.
func SetupRoutes(cfg *config.Config) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName: "FreedomForge.One v10.13.34",
	})

	// ── Liveness probe ───────────────────────────────────────────────────────
	app.Get("/health", handlers.HealthCheck)

	// ── Unified RL agent ─────────────────────────────────────────────────────
	app.Get("/api/rl-agent", handlers.RLAgentStatus)

	// ── Payments ─────────────────────────────────────────────────────────────
	app.Get("/api/payments", handlers.PaymentsStatus)

	// ── IBC v2 cross-chain relay ─────────────────────────────────────────────
	app.Get("/api/ibc/v2", handlers.IBCv2Status)

	// ── Impact fund ──────────────────────────────────────────────────────────
	app.Get("/api/impact-fund", handlers.ImpactFundStatus)

	return app
}
