package handlers

import "github.com/gofiber/fiber/v3"

func HealthCheck(c fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"status":  "ok",
		"service": "freedomforge.one",
		"version": "10.13.34",
	})
}