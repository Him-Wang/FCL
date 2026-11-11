@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [FCL] 找不到 node.exe，请先安装 Node.js 18+ 并加入 PATH
  pause
  exit /b 1
)
echo Starting FishCraftLauncher...
node start.js
if errorlevel 1 (
  echo.
  echo Failed to start. Make sure Node.js is installed, then run: npm install ^&^& npm start
  pause
)
