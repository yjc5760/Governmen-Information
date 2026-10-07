@echo off
rem ============================================================
rem  Publish the web page to GitHub Pages.
rem  PURE ASCII + CRLF on purpose (see the note in build-exe .bat:
rem  non-ASCII text in a .bat that runs chcp 65001 breaks CMD).
rem
rem  1. builds site\index.html from the main HTML
rem  2. site\ is its own git repo; first run asks for the URL of the
rem     PUBLIC GitHub repo, e.g. https://github.com/NAME/tender-hq.git
rem  3. commits and pushes; GitHub Pages redeploys in about a minute
rem
rem  Only site\index.html and site\.nojekyll go public. Source code,
rem  docs and server.js stay in this (private / local) repo.
rem ============================================================
setlocal
cd /d "%~dp0.."
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js not found. Install the LTS build from https://nodejs.org/
  goto fail
)
where git >nul 2>nul
if errorlevel 1 (
  echo   git not found. Install it from https://git-scm.com/
  goto fail
)

echo.
echo   [1/3] building site\
node build\build-pages.mjs
if errorlevel 1 goto fail

cd site
if not exist .git (
  git init -q
  git checkout -q -b main
)

git remote get-url origin >nul 2>nul
if not errorlevel 1 goto haveremote
echo.
echo   First publish: paste the URL of your PUBLIC GitHub repo
echo   example: https://github.com/NAME/tender-hq.git
set /p REPO=  repo URL: 
if "%REPO%"=="" goto fail
git remote add origin %REPO%
:haveremote

echo   [2/3] committing
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -q -m "update site %DATE% %TIME%"
) else (
  echo   nothing changed since last publish
)

echo   [3/3] pushing to GitHub
rem  If the repo was created on GitHub with a README/.gitignore, or the page
rem  was published from another PC, the remote has commits we do not have.
rem  Merge them in first (site\ only holds generated files, so this is safe).
git fetch -q origin
git rev-parse -q --verify origin/main >nul 2>nul
if errorlevel 1 goto push
git merge -q --no-edit --allow-unrelated-histories origin/main
if errorlevel 1 (
  echo   Could not merge what is already on GitHub. Resolve inside site\ and run again.
  goto fail
)
:push
git push -u origin main
if errorlevel 1 goto fail

echo.
echo   Done. GitHub Pages updates in about a minute.
echo.
pause
exit /b 0

:fail
echo.
echo   PUBLISH FAILED. Usual causes:
echo     - not signed in to GitHub (a browser sign-in window should pop up)
echo     - wrong repo URL: run  git -C site remote set-url origin NEW_URL
echo     - no network
echo.
pause
exit /b 1
