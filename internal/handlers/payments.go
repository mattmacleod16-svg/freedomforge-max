package handlers

import (
	"github.com/gofiber/fiber/v3"
)

// PaymentStatus summarises the state of the on-chain payment processor.
type PaymentStatus struct {
	Status          string `json:"status"`
	Provider        string `json:"provider"`
	SupportedTokens []string `json:"supported_tokens"`
	WebhookActive   bool   `json:"webhook_active"`
}

// PaymentsStatus returns the current status of the unified payments module.
func PaymentsStatus(c fiber.Ctx) error {
	return c.JSON(PaymentStatus{
		Status:          "active",
		Provider:        "stripe+crypto",
		SupportedTokens: []string{"ETH", "USDC", "USDT", "SOL"},
		WebhookActive:   true,
	})
}
