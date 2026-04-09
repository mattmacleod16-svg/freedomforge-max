// Package config loads runtime configuration for the FreedomForge.One server.
package config

import (
	"os"
)

// Config holds all runtime configuration values.
type Config struct {
	// Port is the TCP port the HTTP server binds to.
	Port string
}

// Load reads configuration from environment variables and returns a Config.
// Sensible defaults are applied when environment variables are absent.
func Load() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return &Config{
		Port: port,
	}
}
