# VP-Overwatch Waze Updater
# ==========================
#
# A Linux/Kali version of the Waze relay for VP-Overwatch tactical operations.
# Polls Waze live-map alerts across Victoria and forwards them to the app.
#
# LOCATION
#   ~/Documents/vp_overwatch/tools/waze-updater/
#
# QUICK START
#   1. Copy .env.example to .env and configure API_URL and RELAY_SECRET
#   2. Test the configuration:
#        node waze-updater.mjs --test
#   3. Run a single poll:
#        node waze-updater.mjs --once
#   4. Run in loop mode (continuous):
#        node waze-updater.mjs
#
# DEPLOYMENT OPTIONS
#
# Option A: systemd service (recommended for production)
#   - Copy waze-updater.service to /etc/systemd/system/
#   - Run: sudo systemctl daemon-reload
#   - Enable and start: sudo systemctl enable --now waze-updater
#   - Check status: sudo systemctl status waze-updater
#   - View logs: journalctl -u waze-updater -f
#
# Option B: Cron scheduling
#   - Edit crontab: crontab -e
#   - Add entry for every 10 minutes:
#     */10 * * * * cd /home/cyrus/Documents/vp_overwatch/tools/waze-updater && \
#       /usr/bin/node waze-updater.mjs --once >> /var/log/waze-updater.log 2>&1
#
# CONFIGURATION
#   Edit .env file with:
#   - API_URL: VP-Overwatch app endpoint (e.g. http://100.94.31.125:3100)
#   - RELAY_SECRET: Must match WAZE_RELAY_SECRET on app server
#   - POLL_SECONDS: Polling interval (default 600s = 10 minutes)
#   - LOG_LEVEL: Logging verbosity (info/warn/error)
#
# USAGE MODES
#   --test    Test configuration and connectivity without collecting data
#   --once    Run single collection cycle and exit (for cron/scheduler)
#   (none)    Loop mode — continuous polling at configured interval
#
# COVERAGE AREAS
#   The updater polls 6 bounding boxes covering Victoria:
#   - Melbourne Metro (urban core)
#   - Geelong/Bellarine Peninsula
#   - Ballarat/Bendigo region
#   - Gippsland (eastern Victoria)
#   - NE Victoria
#   - Wimmera/Mallee (western Victoria)
#
# MONITORING
#   - Check app relay status: curl http://localhost:3100/api/relay/status
#   - Verify secondsSinceLastIngest stays under POLL_SECONDS + buffer
#   - Review logs for tile failures or ingest errors
#
# TROUBLESHOOTING
#
# Connection issues to app:
#   - Verify Tailscale connectivity: ping 100.94.31.125
#   - Test app health: curl http://100.94.31.125:3100/api/healthz
#   - Check RELAY_SECRET matches on both sides
#
# Waze API errors:
#   - HTTP 403: IP may be blocked (rare on residential networks)
#   - Non-JSON response: Check network/firewall settings
#   - All tiles failing: Verify internet connectivity
#
# Ingest failures:
#   - HTTP 401: RELAY_SECRET mismatch
#   - HTTP 400: Invalid payload format
#   - Connection refused: App server not running
#
# LOGS
#   - stdout/stderr for direct execution
#   - journalctl -u waze-updater for systemd
#   - Custom log file when using cron
#
# FILES
#   waze-updater.mjs    - Main updater script
#   .env.example        - Configuration template
#   .env                - Active configuration (create from example)
#   README.md           - This file
#   waze-updater.service - systemd service unit (optional)
#
# COMPATIBILITY
#   - Node.js 18+ required
#   - Designed for Linux/Kali deployment
#   - Works with residential and VPS networks
#   - Tailscale IP addresses recommended for cross-network reliability
#
# INTEGRATION
#   Alerts collected by this updater appear in the VP-Overwatch tactical map
#   as ground-unit markers alongside ADS-B aircraft tracking.
#
# MAINTENANCE
#   - Review logs weekly for recurring errors
#   - Monitor tile success rates for coverage gaps
#   - Update bounding boxes if coverage needs change
#   - Keep Node.js current for security updates