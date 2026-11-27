# ==============================================================================
# PAYPILOT — LAUNCH CHROME WITH REMOTE DEBUGGING (PORT 9222)
# ==============================================================================
# Launches Google Chrome with CDP remote debugging enabled on port 9222.
# Uses a dedicated profile directory so your personal Chrome profile,
# extensions, and session remain completely untouched and safe.
# ==============================================================================

$profileDir = "$env:LOCALAPPDATA\Google\Chrome\PayPilotProfile"
if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}

if (-not (Test-Path $chromePath)) {
    Write-Host "❌ Error: Google Chrome executable not found." -ForegroundColor Red
    exit 1
}

$argList = @(
    "--remote-debugging-port=9222",
    "--user-data-dir=$profileDir",
    "--no-first-run",
    "--no-default-browser-check",
    "http://localhost:3001"
)

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  PAYPILOT — LAUNCHING CHROME WITH REMOTE DEBUGGING (PORT 9222)" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "• Chrome Path : $chromePath" -ForegroundColor White
Write-Host "• Profile Dir : $profileDir" -ForegroundColor White
Write-Host "• CDP Port    : 9222" -ForegroundColor White
Write-Host "• Initial URL : http://localhost:3001" -ForegroundColor White
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

Start-Process -FilePath $chromePath -ArgumentList $argList

Start-Sleep -Seconds 2

# Verify listening port
$listening = Test-NetConnection -ComputerName 127.0.0.1 -Port 9222 -WarningAction SilentlyContinue
if ($listening.TcpTestSucceeded) {
    Write-Host "✓ Chrome remote debugging is ACTIVE on http://127.0.0.1:9222" -ForegroundColor Green
    Write-Host "  You can now run: npm run test:paytm-e2e:current-browser" -ForegroundColor Yellow
} else {
    Write-Host "⚠️ Warning: Port 9222 is not yet responding. Please check Chrome window." -ForegroundColor Yellow
}
