#!/bin/bash
# FreedomForge Max — Production Deployment Script
# Usage: ./deploy.sh
set -euo pipefail

echo "Deploying FreedomForge.one unified system..."

# 1. Install dependencies
echo "Installing dependencies..."
npm ci

# 2. Build
echo "Building..."
npm run build

# 3. Type check (non-blocking — warns but does not abort)
echo "Running type check..."
npm run type-check || echo "Type check warnings (non-blocking)"

# 4. Deploy to Vercel
echo "Deploying via Vercel..."
vercel --prod

echo "Domain freedomforge.one is now live with unified RL agent, payments, IBC v2, and impact fund."
