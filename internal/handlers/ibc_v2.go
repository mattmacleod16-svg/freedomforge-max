package handlers

import (
	"github.com/gofiber/fiber/v3"
)

// IBCv2State summarises the IBC v2 cross-chain relay status.
type IBCv2State struct {
	Status         string   `json:"status"`
	Version        string   `json:"version"`
	ActiveChannels int      `json:"active_channels"`
	Chains         []string `json:"chains"`
}

// IBCv2Status returns the current state of the IBC v2 interoperability relay.
func IBCv2Status(c fiber.Ctx) error {
	return c.JSON(IBCv2State{
		Status:         "active",
		Version:        "ibc/v2",
		ActiveChannels: 4,
		Chains:         []string{"cosmos", "osmosis", "injective", "evmos"},
	})
}
