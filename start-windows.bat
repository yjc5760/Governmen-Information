@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo 第一次執行，正在安裝套件...
  call npm install
)
echo.
echo 啟動中，請保持這個視窗開著。
echo 網頁： http://localhost:5178/
echo.
start "" http://localhost:5178/
node server.js
pause
