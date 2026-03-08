#!/usr/bin/env bash
set -euo pipefail

exec bash scripts/oracle-remote-bootstrap-retry.sh "$@"
