# Runs the bot on this computer for testing: app + temporary https link + Telegram polling.
# Started by run-bot.bat. Secrets stay on this computer.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
# Finds programs installed after this window's parent started
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

function Stop-WithMessage($text) { Write-Host ""; Write-Host $text -ForegroundColor Yellow; Read-Host "Press Enter to close"; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Stop-WithMessage "Node.js is not installed. Run:  winget install OpenJS.NodeJS.LTS   then open this file again." }
$major = [int]((node -p "process.versions.node.split('.')[0]") | Out-String).Trim()
if ($major -lt 24) { Stop-WithMessage "Node.js 24 or newer is needed (found $major). Run:  winget install OpenJS.NodeJS.LTS" }
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { Stop-WithMessage "cloudflared is not installed. Run:  winget install Cloudflare.cloudflared   then open this file again." }

# Token and admin come from .env.local, or from the old bot's settings.txt
$oldBot = Join-Path (Split-Path $root -Parent) "bot"
if (-not (Test-Path ".env.local") -and -not (Test-Path "settings.txt")) {
  $old = Join-Path $oldBot "settings.txt"
  if (-not (Test-Path $old)) { Stop-WithMessage "No token found. Create .env.local from .env.example." }
  $env:SETTINGS_FILE = $old
}

# Test copy of the old database, so products and prices are there
New-Item -ItemType Directory -Force "data" | Out-Null
if (-not (Test-Path "data\store.db") -and (Test-Path (Join-Path $oldBot "store.db"))) {
  Copy-Item (Join-Path $oldBot "store.db") "data\store.db"
  Write-Host "Copied the old database to data\store.db for testing."
}

if (-not (Test-Path "node_modules")) { & npm.cmd ci; if ($LASTEXITCODE) { Stop-WithMessage "Installing packages failed." } }
Write-Host "Building the app..."
& npm.cmd run build | Out-Null
if ($LASTEXITCODE) { Stop-WithMessage "Build failed." }
foreach ($c in Get-ChildItem "data\content\*\catalog.json" -ErrorAction SilentlyContinue) {
  & npm.cmd run load-exams -- $c.Directory.Name
}

Write-Host "Opening a temporary https link..."
$log = Join-Path $env:TEMP "qmath-tunnel.log"
if (Test-Path $log) { Clear-Content $log }
$tunnel = Start-Process cloudflared -ArgumentList "tunnel","--url","http://localhost:3000","--logfile",$log -WindowStyle Hidden -PassThru
$app = $null
try {
  $url = $null
  foreach ($i in 1..40) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value; break }
    }
  }
  if (-not $url) { Stop-WithMessage "Could not open the https link. Check the internet and try again." }
  $env:STORE_URL = $url
  $app = Start-Process cmd -ArgumentList "/c","npx next start -p 3000" -WindowStyle Hidden -PassThru
  & node --env-file-if-exists=.env.local scripts/poll.ts
} finally {
  if ($app) { & taskkill /PID $app.Id /T /F 2>$null | Out-Null }
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -Confirm:$false }
}
