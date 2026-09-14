# VP-Overwatch Waze Relay — Kali Linux

Implements Waze alert polling on Kali's datacenter IP with multi-tier bypass strategies for Waze's bot detection.

## Problem

Waze blocks datacenter IPs (returns 403). The Windows box (100.80.115.26) works because it has a residential IP. Kali needs alternative approaches.

## Solutions Implemented

### 1. Direct Mode with Anti-Fingerprinting (`relay-kali.mjs`)

**Features:**
- Rotating Chrome User-Agents (6 variants across Win/Mac, Chrome 128-131)
- Exponential backoff on 403 (1s → 3s → 7s → 15s → 30s)
- Auto-switch to Playwright mode after 5 consecutive 403s
- Tailscale proxy mode (routes via Windows box when online)

**Run modes:**
```bash
# Continuous polling (every 10 minutes)
node relay-kali.mjs

# Single poll then exit (for systemd/cron)
node relay-kali.mjs --once

# Force Playwright mode (real Chrome browser)
node relay-kali.mjs --playwright

# Route via Windows Tailscale IP (when Windows box is online)
node relay-kali.mjs --tailscale
```

### 2. Systemd Service

Install for automatic operation:

```bash
# Copy service file
sudo cp waze-relay.service /etc/systemd/system/

# Enable and start
sudo systemctl enable waze-relay.service
sudo systemctl start waze-relay.service

# Check status
sudo systemctl status waze-relay.service

# View logs
journalctl -u waze-relay.service -f
```

### 3. Cron Alternative (10-minute interval)

```bash
# Add to crontab
*/10 * * * * cd /home/cyrus/Documents/vp_overwatch/tools/waze-relay && /usr/bin/node relay-kali.mjs --once >> /var/log/waze-relay.log 2>&1
```

## Configuration

Copy `.env.kali.example` to `.env` (or use existing `.env`):

```bash
API_URL=http://100.94.31.125:3100
RELAY_SECRET=your-relay-secret-here
POLL_SECONDS=600
```

## Bypass Strategies

### Current Behavior

1. **Direct fetch** starts with rotating UAs
2. **403 detection** triggers exponential backoff
3. **Auto-fallback** to Playwright after 5 consecutive 403s
4. **Tailscale proxy** available when Windows box is reachable

### Playwright Mode

Uses real Chrome (`/usr/bin/google-chrome`) with:
- Full browser context (not just fetch)
- Anti-detection headers and timing
- NetworkIdle wait for complete responses

### When Windows Box is Online

Use `--tailscale` mode to route requests through the Windows box's residential IP:
```bash
node relay-kali.mjs --once --tailscale
```

This provides the same residential IP benefit as running directly on Windows.

## Installation

```bash
# Install Playwright dependency
cd /home/cyrus/Documents/vp_overwatch/tools/waze-relay
npm install playwright --save

# Test direct mode
node relay-kali.mjs --once

# Test Playwright mode
node relay-kali.mjs --once --playwright

# Test Tailscale mode (when Windows box is online)
node relay-kali.mjs --once --tailscale
```

## Troubleshooting

### All tiles fail with 403
- Normal for datacenter IP. Relay will auto-switch to Playwright mode.
- Check if Windows box is online for Tailscale proxy option.

### Playwright mode returns HTML responses
- Waze WAF is detecting headless browser.
- Ensure Chrome is at `/usr/bin/google-chrome`.
- Consider running during different hours (WAF patterns may vary).

### Tailscale mode shows "unreachable"
- Windows box must be logged in (Ollama and services start after login).
- Verify Tailscale connectivity: `ping -c 3 100.80.115.26`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Kali relay-kali.mjs                      │
├─────────────────────────────────────────────────────────────┤
│  Direct Mode (default)                                       │
│  ├─ Rotating Chrome User-Agents                             │
│  ├─ Exponential backoff on 403                              │
│  └─ Auto-switch to Playwright after 5 consecutive 403s      │
│                                                              │
│  Playwright Mode (--playwright)                              │
│  ├─ Real Chrome browser (/usr/bin/google-chrome)            │
│  ├─ Full browser context with anti-detection                │
│  └─ NetworkIdle waits for complete responses                │
│                                                              │
│  Tailscale Proxy Mode (--tailscale)                          │
│  └─ Routes via Windows box (100.80.115.26) residential IP   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │  Waze GeoRSS API     │
              │  (6 Victoria tiles)  │
              └──────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │  VP-Overwatch App    │
              │  POST /api/waze/ingest│
              └──────────────────────┘
```

## Notes

- **Datacenter IP block**: Kali's IP is flagged by Waze (403 responses).
- **Residential IP advantage**: Windows box (100.80.115.26) has residential IP that bypasses Waze bot detection.
- **Tailscale integration**: When Windows box is online, `--tailscale` mode provides residential IP routing.
- **Auto-recovery**: Relay automatically adapts to network conditions with mode switching and backoff.