@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo.
echo  ====================================================
echo   標案參謀室 - 打包成單一 exe
echo  ====================================================
echo.
echo  需要：已安裝 Node.js 20 以上、電腦可以連上網路
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  找不到 Node.js。請先安裝 https://nodejs.org/ 的 LTS 版。
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo  使用 Node.js %%v
echo.

echo  [1/2] 準備打包工具（第一次會下載，之後很快）...
call npm install --no-save --silent esbuild postject
if errorlevel 1 goto fail

echo  [2/2] 打包...
node build\build-exe.mjs
if errorlevel 1 goto fail

echo.
echo  完成。檔案在 dist\ 資料夾裡：
echo    標案參謀室.exe   ← 給同仁的，單一檔案就能跑
echo    使用說明.txt     ← 一起給他們
echo.
echo  提醒：以後只改了網頁（標案參謀室.html）的話，
echo        也可以不重新打包，直接把新的 html 放到 exe 旁邊就會生效。
echo.
pause
exit /b 0

:fail
echo.
echo  打包失敗。常見原因：
echo    - 沒有網路，或公司代理阻擋 npm / github
echo    - Node.js 版本太舊（需要 20 以上）
echo.
pause
exit /b 1
