// PM2 process definition for VP-Overwatch.
//
// IMPORTANT: PM2 and the systemd unit (vp-overwatch.service) both supervise the
// SAME app on the SAME port — they cannot run at once or they fight over the
// port. systemd is the active supervisor in this setup. To drive the app with
// PM2 instead:
//
//   systemctl --user stop vp-overwatch.service      # free the port
//   cd /home/cyrus/Documents/vp_overwatch/Tactical
//   pnpm build                                       # PM2 doesn't build; do it first
//   pm2 start ecosystem.config.cjs
//   pm2 save
//
// Port 3000 is taken by the Hermes WhatsApp bridge, so this uses 3100 to match
// the systemd unit.

module.exports = {
  apps: [
    {
      name: 'vp-overwatch',
      cwd: '/home/cyrus/Documents/vp_overwatch/Tactical',
      script: '.next/standalone/server.js',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        HOSTNAME: '0.0.0.0',
        PORT: '3100',
      },
    },
  ],
}
