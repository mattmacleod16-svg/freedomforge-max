package main

import (
	"log"

	"freedomforge.one/internal/config"
	"freedomforge.one/api"
)

func main() {
	cfg := config.Load()

	app := api.SetupRoutes(cfg)

	log.Printf("🚀 FreedomForge.one server starting on :%s", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}