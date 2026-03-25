#!/bin/bash
# Redis setup for Railway deployment
# This script initializes the Redis add-on and exports connection info

set -e

echo "[redis-init] Checking Redis configuration..."

# Railway auto-injects REDIS_URL, but may need explicit creation
if [ -z "$REDIS_URL" ]; then
  echo "[redis-init] REDIS_URL not set. For Railway:"
  echo "  1. Go to your Railway project"
  echo "  2. Click 'Add Service' → 'Redis'"
  echo "  3. REDIS_URL will be auto-injected"
  echo ""
  echo "[redis-init] For local development, start Redis:"
  echo "  docker run -d -p 6379:6379 redis:7"
  echo ""
  echo "[redis-init] Or set REDIS_URL explicitly:"
  echo "  export REDIS_URL='redis://localhost:6379'"
  exit 1
fi

echo "[redis-init] Redis URL configured: $REDIS_URL"

# Test connection
echo "[redis-init] Testing Redis connection..."
if command -v redis-cli &> /dev/null; then
  redis-cli -u "$REDIS_URL" PING || {
    echo "[redis-init] ERROR: Failed to ping Redis at $REDIS_URL"
    exit 1
  }
  echo "[redis-init] Redis connection successful"
else
  echo "[redis-init] redis-cli not available, skipping connection test"
fi

echo "[redis-init] Setup complete"
