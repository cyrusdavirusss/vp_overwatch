VP-Overwatch — Waze ground-units relay (Windows)
================================================

WHAT IT DOES
  Polls Waze live-map alerts for Victoria and POSTs them to the VP-Overwatch
  app on the Kali box (http://100.94.31.125:3100/api/waze/ingest) over
  Tailscale. The app renders them as ground-unit markers. Must run on this
  Windows box because Waze blocks datacenter IPs.

WHY A SCHEDULED TASK
  Earlier the relay sent one batch and then stopped. A Windows Scheduled Task
  fires it every 10 minutes automatically, survives reboots, and restarts
  cleanly each run — no terminal to keep open.

SETUP (one time)
  1. Install Node 18+ if needed:  https://nodejs.org   (verify: node --version)
  2. Copy this whole "waze-relay" folder somewhere stable, e.g. C:\Tools\waze-relay
  3. Open PowerShell as Administrator, cd into the folder, and run:
        powershell -ExecutionPolicy Bypass -File .\install-task.ps1
  4. Test it immediately:
        Start-ScheduledTask -TaskName "VP-Waze-Relay"
     Within a few seconds you should see ground units appear in the app.

MANUAL TEST (without the scheduler)
  node relay.mjs --once        # single poll, prints how many ingested
  node relay.mjs               # loop forever (every POLL_SECONDS)

CHECK STATUS
  Get-ScheduledTaskInfo -TaskName "VP-Waze-Relay"   (LastRunTime / LastTaskResult=0 is OK)
  On the Kali box: curl http://localhost:3100/api/relay/status
      secondsSinceLastIngest should stay under ~600.

CONFIG  (.env)
  API_URL        the app URL (Tailscale IP form is most reliable)
  RELAY_SECRET   must match WAZE_RELAY_SECRET on the app (currently 'dev-secret')

TROUBLESHOOTING
  - "HTTP 403" from Waze  -> this IP is blocked (rare on home internet); try another network.
  - "Ingest: HTTP 401"    -> RELAY_SECRET here != app's WAZE_RELAY_SECRET.
  - connection refused / timeout to 100.94.31.125:3100 -> Tailscale down on either
    box, or the app isn't running. Test:  Invoke-WebRequest http://100.94.31.125:3100/api/healthz
  - Task shows LastTaskResult other than 0 -> run "node relay.mjs --once" by hand to see the error.

REMOVE
  Unregister-ScheduledTask -TaskName "VP-Waze-Relay" -Confirm:$false
