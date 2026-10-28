# Eddy v3: one-time setup on Windows for local testing.
# Installs Node.js if missing, installs the app's libraries, creates a private .env, runs the tests, builds, and starts Eddy.
# Data and audio are stored in .data (the local stand-in for Firestore and Cloud Storage); nothing leaves this computer.
param([string]$AppDir = (Resolve-Path "$PSScriptRoot\..\..").Path)
$ErrorActionPreference = 'Stop'
Set-Location $AppDir
Start-Transcript -Path "$AppDir\setup-log.txt" -Force | Out-Null
$result = [ordered]@{ started = (Get-Date).ToString('s'); appDir = $AppDir }
function Save-Result { $result | ConvertTo-Json | Set-Content -Encoding UTF8 "$AppDir\setup-result.json" }

try {
  Write-Host "== 1/5 Node.js" -ForegroundColor Cyan
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Installing Node.js LTS with winget..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  }
  $nodeVer = (node --version).Trim()
  $result.node = $nodeVer
  if ([int]($nodeVer.TrimStart('v').Split('.')[0]) -lt 20) { throw "Node.js $nodeVer is too old. Install Node.js 20 or newer from https://nodejs.org and run this again." }
  Write-Host "Node.js $nodeVer, npm $(npm --version)"

  Write-Host "== 2/5 Libraries (npm ci)" -ForegroundColor Cyan
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  $result.install = 'ok'

  Write-Host "== 3/5 Private settings (.env)" -ForegroundColor Cyan
  if (-not (Test-Path "$AppDir\.env")) {
    $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    @(
      '# Local settings for Eddy. This file is private: it is git-ignored and never uploaded.',
      'EDDY_STORAGE=local',
      'EDDY_PASSCODE=eddy-local',
      "SESSION_SECRET=$secret",
      'PORT=8080',
      '# Paste API keys here to try the AI edit (optional):',
      'GEMINI_API_KEY=',
      'OPENAI_API_KEY='
    ) | Set-Content -Encoding ASCII "$AppDir\.env"
    Write-Host "Created .env (passcode: eddy-local)"
  } else { Write-Host ".env already exists; left as it is" }

  Write-Host "== 4/5 Tests" -ForegroundColor Cyan
  npm test
  $result.tests = if ($LASTEXITCODE -eq 0) { 'passed' } else { 'failed' }

  Write-Host "== 5/5 Build" -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
  $result.build = 'ok'

  Write-Host "Starting Eddy on http://localhost:8080 ..." -ForegroundColor Green
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title Eddy server && cd /d `"$AppDir`" && npm start" -WorkingDirectory $AppDir
  $up = $false
  for ($i = 0; $i -lt 30 -and -not $up; $i++) {
    Start-Sleep -Seconds 1
    try { $h = Invoke-RestMethod -Uri 'http://localhost:8080/healthz' -TimeoutSec 2; $up = $h.ok } catch { }
  }
  $result.server = if ($up) { 'running on http://localhost:8080' } else { 'did not answer within 30 s' }
  $result.ok = $up -and $result.tests -eq 'passed'
}
catch {
  $result.ok = $false
  $result.error = $_.Exception.Message
  Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  $result.finished = (Get-Date).ToString('s')
  Save-Result
  Stop-Transcript | Out-Null
}
Write-Host ""
Write-Host "Done. Open http://localhost:8080 and sign in with the passcode in .env (eddy-local)." -ForegroundColor Green
