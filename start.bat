@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 set "PATH=C:\Users\wbhh\.workbuddy\binaries\node\versions\22.22.2-6;%PATH%"
echo Starting DigfiShLauncher...
node start.js
if errorlevel 1 (
  echo.
  echo Failed to start. Make sure Node.js is installed, then run: npm install ^&^& npm start
  pause
)
