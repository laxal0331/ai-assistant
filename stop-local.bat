@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-local.ps1"
if errorlevel 1 (
  echo.
  echo Stop script failed. Press any key to exit.
  pause >nul
)
