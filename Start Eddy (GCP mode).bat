@echo off
rem Starts Eddy on this PC in Google Cloud mode: Firestore + Cloud Storage emulators, production build.
rem Data is kept in .data-gcp between runs. Sign in as admin with ADMIN_PASSWORD from .env.
cd /d "%~dp0"
title Eddy (Google Cloud mode) - keep this window open
if not exist "node_modules\@firestore-emulator\server" (
  echo Installing libraries...
  call npm ci --no-audit --no-fund || goto :error
)
echo Building Eddy...
call npm run build || goto :error
node scripts\local-gcp.mjs %*
goto :end
:error
echo.
echo Something went wrong above. Copy the messages and send them to Nishant.
:end
pause
