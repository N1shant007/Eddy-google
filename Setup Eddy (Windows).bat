@echo off
rem Double-click to set up and start Eddy v3 on this Windows computer (local test mode).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-eddy.ps1" -AppDir "%~dp0."
pause
