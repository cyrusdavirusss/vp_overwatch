# Registers a Windows Scheduled Task that runs the Waze relay every 10 minutes.
# Run once in an ELEVATED PowerShell (Run as Administrator):
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1
#
# Re-running updates the task in place. To remove:
#   Unregister-ScheduledTask -TaskName "VP-Waze-Relay" -Confirm:$false

$ErrorActionPreference = "Stop"

$TaskName = "VP-Waze-Relay"
$ScriptDir = $PSScriptRoot
$Relay = Join-Path $ScriptDir "relay.mjs"

# Locate node.exe
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  Write-Error "node.exe not found on PATH. Install Node 18+ (https://nodejs.org) and retry."
}
Write-Host "node : $Node"
Write-Host "relay: $Relay"

if (-not (Test-Path $Relay)) { Write-Error "relay.mjs not found next to this script ($Relay)" }

# Action: node relay.mjs --once   (working dir = script dir so it finds .env)
$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Relay`" --once" -WorkingDirectory $ScriptDir

# Trigger: every 10 minutes, starting now, indefinitely. Also fire at startup.
$Start = (Get-Date)
$Every10 = New-ScheduledTaskTrigger -Once -At $Start `
  -RepetitionInterval (New-TimeSpan -Minutes 10) `
  -RepetitionDuration ([TimeSpan]::MaxValue)
$AtBoot = New-ScheduledTaskTrigger -AtStartup

# Run whether or not the user is logged on; don't stop on battery/idle.
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action `
  -Trigger @($Every10, $AtBoot) -Principal $Principal -Settings $Settings -Force | Out-Null

Write-Host ""
Write-Host "Installed scheduled task '$TaskName' (every 10 minutes)." -ForegroundColor Green
Write-Host "Run it now to test:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Watch last run:      Get-ScheduledTaskInfo -TaskName $TaskName"
