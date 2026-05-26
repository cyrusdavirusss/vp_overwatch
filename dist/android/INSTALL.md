# VP-Overwatch — Android Setup

## Option 1: PWA (Recommended)
1. Open Chrome on your Android device
2. Navigate to your VP-Overwatch server (e.g., http://YOUR_SERVER_IP:3000)
3. Tap the three-dot menu → "Add to Home screen"
4. The app will install as a PWA with full-screen support

## Option 2: Run Locally via Termux
1. Install Termux from F-Droid (not Play Store)
2. Run the following commands:
```bash
pkg update && pkg upgrade
pkg install nodejs-lts git
git clone https://github.com/cyrusdavirusss/vp_overwatch.git
cd vp_overwatch/Tactical
chmod +x install.sh start.sh
./install.sh
./start.sh
```
3. Open http://localhost:3000 in your browser

## Environment Variables (optional)
- `WAZE_RELAY_SECRET` — secret for Waze relay ingestion (default: `dev-secret`)
- `GPS_RELAY_SECRET` — secret for GPS relay (default: `gps-dev`)
- `PORT` — server port (default: 3000)
