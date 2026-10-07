@echo off
rem ============================================================
rem  Push the SOURCE code (this repo) to GitHub, branch "source" of
rem  https://github.com/yjc5760/Governmen-Information
rem
rem  Same GitHub repo as the published web page, different branch:
rem    main    = the published page only (site\, pushed by build\publish .bat)
rem    source  = everything for development (src\, test\, docs\, build\ ...)
rem  GitHub Pages serves "main" only, so this never changes the live page.
rem  NOTE: the repo is PUBLIC, so this branch (including docs\) is public too.
rem
rem  PURE ASCII + CRLF on purpose (see the note in the build-exe .bat).
rem ============================================================
setlocal
cd /d "%~dp0.."
chcp 65001 >nul

where git >nul 2>nul
if errorlevel 1 (
  echo   git not found. Install it from https://git-scm.com/
  goto fail
)

git remote get-url origin >nul 2>nul
if errorlevel 1 git remote add origin https://github.com/yjc5760/Governmen-Information

echo.
echo   Uncommitted changes (commit them first if you want them pushed):
git status --short
echo.
echo   Pushing current branch to origin/source ...
git push -u origin HEAD:source
if errorlevel 1 goto fail

echo.
echo   Done: https://github.com/yjc5760/Governmen-Information/tree/source
echo.
pause
exit /b 0

:fail
echo.
echo   PUSH FAILED. Usual causes:
echo     - not signed in to GitHub (a browser sign-in window should pop up)
echo     - no network
echo.
pause
exit /b 1
