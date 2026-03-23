#!/usr/bin/env bash
# ============================================================================
# FreedomForge Max — Distribution Packaging Script
# Creates a clean zip of the project for distribution, excluding sensitive
# data, build artifacts, and development-only files.
# ============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Navigate to project root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_NAME="freedomforge-max"
DATE_STAMP=$(date +"%Y-%m-%d")
ZIP_NAME="${PROJECT_NAME}-${DATE_STAMP}.zip"
ZIP_PATH="${PROJECT_ROOT}/${ZIP_NAME}"

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║            🔥 FreedomForge Max — Package Builder 🔥         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${YELLOW}▸ Project root:${NC} ${PROJECT_ROOT}"
echo -e "${YELLOW}▸ Output file:${NC}  ${ZIP_NAME}"
echo ""

# Remove previous zip with same name if it exists
if [ -f "$ZIP_PATH" ]; then
    echo -e "${YELLOW}▸ Removing existing ${ZIP_NAME}...${NC}"
    rm -f "$ZIP_PATH"
fi

# Build the zip from the project root's parent directory
cd "$(dirname "$PROJECT_ROOT")"

echo -e "${CYAN}▸ Packaging (this may take a moment)...${NC}"

zip -r "$ZIP_PATH" "$PROJECT_NAME" \
    -x "${PROJECT_NAME}/node_modules/*" \
    -x "${PROJECT_NAME}/.next/*" \
    -x "${PROJECT_NAME}/.env.local" \
    -x "${PROJECT_NAME}/.env.local.*" \
    -x "${PROJECT_NAME}/.env" \
    -x "${PROJECT_NAME}/.env.vercel.*" \
    -x "${PROJECT_NAME}/.git/*" \
    -x "${PROJECT_NAME}/.claude/*" \
    -x "${PROJECT_NAME}/.vercel/*" \
    -x "${PROJECT_NAME}/data/*" \
    -x "${PROJECT_NAME}/logs/*" \
    -x "${PROJECT_NAME}/*.log" \
    -x "${PROJECT_NAME}/**/*.log" \
    -x "${PROJECT_NAME}/.DS_Store" \
    -x "${PROJECT_NAME}/**/.DS_Store" \
    -x "${PROJECT_NAME}/__pycache__/*" \
    -x "${PROJECT_NAME}/**/__pycache__/*" \
    -x "${PROJECT_NAME}/.vscode/*" \
    -x "${PROJECT_NAME}/tsconfig.tsbuildinfo" \
    > /dev/null 2>&1

# Verify the zip was created
if [ ! -f "$ZIP_PATH" ]; then
    echo -e "${RED}✗ Failed to create zip file.${NC}"
    exit 1
fi

# Stats
ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1 | xargs)
FILE_COUNT=$(zipinfo -1 "$ZIP_PATH" 2>/dev/null | wc -l | xargs)

echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ Package created successfully!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}File:${NC}   ${ZIP_PATH}"
echo -e "  ${BOLD}Size:${NC}   ${ZIP_SIZE}"
echo -e "  ${BOLD}Files:${NC}  ${FILE_COUNT} files included"
echo ""
echo -e "${CYAN}${BOLD}  Next Steps:${NC}"
echo -e "  1. Share the zip with the recipient"
echo -e "  2. Recipient extracts and runs: ${BOLD}cp .env.example .env.local${NC}"
echo -e "  3. Configure API keys in .env.local"
echo -e "  4. Run: ${BOLD}npm ci && npm run dev${NC}"
echo -e "  5. See WELCOME.md for the full onboarding guide"
echo ""
echo -e "${YELLOW}  🔥 Forged for freedom.${NC}"
echo ""
