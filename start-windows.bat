@echo off
rem ============================================================
rem  Pure ASCII with CRLF on purpose -- the build .bat under build/
rem  explains why. Chinese startup messages come from server.js instead.
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install the LTS build from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo   first run: installing packages
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install failed -- no network, or a proxy is blocking npm.
    echo.
    pause
    exit /b 1
  )
)

start "" http://localhost:5178/
node server.js
pause
