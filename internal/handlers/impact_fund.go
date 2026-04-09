package handlers

import (
	"github.com/gofiber/fiber/v3"
)

// ImpactFundState summarises the impact fund allocation state.
type ImpactFundState struct {
	Status            string  `json:"status"`
	TotalAllocatedUSD float64 `json:"total_allocated_usd"`
	ActiveProjects    int     `json:"active_projects"`
	ImpactScore       float64 `json:"impact_score"`
}

// ImpactFundStatus returns the current state of the FreedomForge impact fund.
func ImpactFundStatus(c fiber.Ctx) error {
	return c.JSON(ImpactFundState{
		Status:            "active",
		TotalAllocatedUSD: 0.0,
		ActiveProjects:    0,
		ImpactScore:       0.0,
	})
}
