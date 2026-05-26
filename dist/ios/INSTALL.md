# VP-Overwatch — iOS Setup

## PWA Installation (Recommended)
1. Open Safari on your iPhone/iPad
2. Navigate to your VP-Overwatch server (e.g., http://YOUR_SERVER_IP:3000)
3. Tap the Share button (square with arrow)
4. Tap "Add to Home Screen"
5. Tap "Add"

The app will appear on your home screen as a standalone app with:
- Full-screen display (no Safari chrome)
- Dark status bar matching the app theme
- App icon on your home screen
- Portrait orientation lock

## Server Setup
VP-Overwatch runs as a web server. You need a machine on your network to host it:
- A Kali/Linux box, Mac, or Windows PC
- Raspberry Pi works great for always-on hosting
- See the Windows or Android INSTALL.md for server setup

## Notes
- iOS PWAs work offline for cached pages but need network for live data
- Push notifications require iOS 16.4+ for PWAs
- The app uses your device GPS for distance/bearing calculations
