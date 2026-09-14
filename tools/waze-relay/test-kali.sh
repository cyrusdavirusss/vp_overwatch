#!/bin/bash
# Quick start for Waze relay on Kali
# Tests all three modes and reports status

set -e
cd "$(dirname "$0")"

echo "=== VP-Overwatch Waze Relay — Kali Quick Test ==="
echo ""

# Check dependencies
echo "1. Checking dependencies..."
if ! command -v node &>/dev/null; then
  echo "  [FAIL] Node.js not found"
  exit 1
fi
echo "  [OK] Node.js $(node --version)"

if ! command -v google-chrome &>/dev/null; then
  echo "  [WARN] Chrome not found at /usr/bin/google-chrome"
else
  echo "  [OK] Chrome available"
fi

# Check .env
if [ -f ".env" ]; then
  echo "  [OK] .env file present"
  API_URL=$(grep "^API_URL=" .env | cut -d= -f2)
  echo "       API_URL: $API_URL"
else
  echo "  [WARN] No .env file — copy .env.kali.example to .env"
fi

echo ""
echo "2. Testing direct mode (single tile)..."
timeout 30 node relay-kali.mjs --once 2>&1 | head -10 || echo "  [INFO] Direct mode tested (403 expected on datacenter IP)"

echo ""
echo "3. Testing Tailscale connectivity..."
if ping -c 2 -W 3 100.80.115.26 &>/dev/null; then
  echo "  [OK] Windows box (100.80.115.26) reachable via Tailscale"
  echo "       Use: node relay-kali.mjs --once --tailscale"
else
  echo "  [INFO] Windows box offline (login required)"
  echo "         Tailscale proxy available after Windows box is online"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Usage:"
echo "  Continuous polling:"
echo "    node relay-kali.mjs"
echo ""
echo "  Single poll (for cron):"
echo "    node relay-kali.mjs --once"
echo ""
echo "  Playwright mode (real Chrome):"
echo "    node relay-kali.mjs --once --playwright"
echo ""
echo "  Tailscale proxy (when Windows box online):"
echo "    node relay-kali.mjs --once --tailscale"
echo ""
echo "  See README-KALI.md for full documentation"