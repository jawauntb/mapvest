#!/usr/bin/env bash
# Runs the vision-identify integration tests with real OpenRouter creds
# injected by Doppler. See apps/api/tests/fixtures/README.md.
#
# Usage:
#   apps/api/scripts/run-integration.sh              # download real fixtures
#   MOCK_FIXTURES=1 apps/api/scripts/run-integration.sh   # stub the images (CI)
set -euo pipefail

INTEGRATION=1 doppler run --project mapvest --config dev -- bun test apps/api/tests/integration/**
