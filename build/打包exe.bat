@echo off
rem ============================================================
rem  This file is deliberately PURE ASCII with CRLF line endings.
rem  Do NOT put Chinese (or any non-ASCII) text in a .bat that also
rem  runs "chcp 65001": CMD tracks its read position in the batch
rem  file in BYTES computed under the OLD codepage, so after the
rem  codepage switch it resumes mid-character and every following
rem  line is shifted. Command names get sliced -- "echo" becomes
rem  "ho", "start" becomes "s" -- and you get a screen full of
rem  "is not recognized as an internal or external command".
rem  All Chinese messages live in build-exe.mjs instead; chcp 65001
rem  makes Node's UTF-8 output display correctly, which is safe
rem  because THIS file has no multi-byte characters.
rem  See the "build exe" note under docs/ for the full story.
rem ============================================================
setlocal
cd /d "%~dp0.."
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install the LTS build from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo   [1/2] installing build tools ^(first run downloads, later runs are fast^)
call npm install --no-save --silent esbuild postject
if errorlevel 1 goto fail

echo   [2/2] building
node build\build-exe.mjs
if errorlevel 1 goto fail

pause
exit /b 0

:fail
echo.
echo   BUILD FAILED. Usual causes:
echo     - no network, or a corporate proxy blocking npm / github
echo     - Node.js too old ^(20 or newer required^)
echo.
pause
exit /b 1
