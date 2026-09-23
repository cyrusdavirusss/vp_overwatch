# VP-Overwatch — Windows Setup

## Prerequisites
- Node.js 18+ (https://nodejs.org)

## Quick Start
1. Open PowerShell or Command Prompt in this folder
2. Run: `install.bat`
3. Run: `start.bat`
4. Open http://localhost:3000 in your browser

## Manual Setup
```
npm install
npx next build
npx next start
```

## Environment Variables (optional)
- `WAZE_RELAY_SECRET` — secret for Waze relay ingestion (required; set a long
  random value, there is no default)
- `GPS_RELAY_SECRET` — secret for the GPS relay (required; set a long random
  value, there is no default)
- `PORT` — server port (default: 3000)
