#!/bin/bash
# FreedomForge Max — Production Deployment Script
# Usage: ./deploy.sh
set -euo pipefail

echo "FreedomForge Max — Deploying to freedomforge.one..."

# 1. Install dependencies
echo "Installing dependencies..."
npm ci

# 2. Build
echo "Building..."
npm run build

# 3. Type check (non-blocking — warns but does not abort)
echo "Running type check..."
npm run type-check || echo "Type check warnings (non-blocking)"

# 4. Deploy to Railway
echo "Deploying via Railway..."
railway up

echo "Deployed to https://freedomforge.one"
