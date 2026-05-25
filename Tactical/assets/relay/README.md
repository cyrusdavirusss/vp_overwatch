# Waze relay

A tiny Node script that runs on your home internet, fetches Waze's live-map
alerts for Victoria, and forwards them to the tracker so police pins, road
closures, accidents, and hazards appear directly on the map.

**Why this exists:** Waze's edge firewall blocks all datacenter IPs (Google
Cloud, AWS, Azure). The tracker itself can't talk to Waze, so this relay
runs on a real residential IP and bridges the gap.

## Requirements

- Node 18 or newer
- A device on home internet that stays on (laptop, Raspberry Pi, old phone
  in Termux, mini PC, anything)

## Setup

1. Copy this `tools/waze-relay/` folder onto the device.
2. `cp .env.example .env`
3. Edit `.env`:
   - `API_URL` — your tracker URL (e.g. `https://your-tracker.replit.app`).
   - `RELAY_SECRET` — exactly the same value you set as `WAZE_RELAY_SECRET`
     in Replit Secrets.
4. Run it:

   ```bash
   node relay.mjs
   ```

You should see something like:

```
Waze relay starting → https://your-tracker.replit.app, every 60s
[tick] 87/91 ingested (raw 142) in 1834ms
```

If you see `HTTP 403` from Waze, your IP is blocked (very rare on home
connections). Try another network.

## Keep it running

### macOS / Linux (systemd)

```
[Unit]
Description=Waze relay
After=network-online.target

[Service]
WorkingDirectory=/home/you/waze-relay
ExecStart=/usr/bin/node relay.mjs
Restart=always
RestartSec=10
User=you

[Install]
WantedBy=multi-user.target
```

Save as `/etc/systemd/system/waze-relay.service`, then:

```
sudo systemctl enable --now waze-relay
sudo journalctl -u waze-relay -f
```

### Anything else

Use [pm2](https://pm2.keymetrics.io/): `pm2 start relay.mjs --name waze-relay`.

### Phone (Android / Termux)

```
pkg install nodejs
cd waze-relay
node relay.mjs
```

Use Termux:Boot to autostart on reboot.

## What happens on the server

The tracker exposes:
- `POST /api/waze/ingest` — auth'd with `x-relay-secret`, accepts an array
  of Waze alerts and upserts them by `uuid` with a 30-min TTL.
- `GET  /api/waze/alerts`  — public, returns the currently-active alerts
  that the map polls every 30s.
- `GET  /api/waze/status`  — shows last relay tick + whether the relay
  appears connected.

If the relay stops, alerts age out within 30 minutes and the map clears.
