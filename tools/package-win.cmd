@echo off
setlocal enableextensions
REM Build helper for electron-builder. Builds into dist\.
REM
REM Notes:
REM  - Use a project-local TEMP dir: the machine %TEMP% can trip electron-builder's
REM    proper-lockfile based artifact lock (EPERM on mkdir/rmdir eb-dl-*.lock.lock).
REM  - node.exe comes from PATH, so this works on any machine (and on CI).

set "ROOT=%~dp0.."
cd /d "%ROOT%"

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo [FCL] 找不到 node.exe，请先安装 Node.js 18+ 并加入 PATH
  exit /b 1
)

if not exist "%ROOT%\.build-tmp" mkdir "%ROOT%\.build-tmp"
set "TEMP=%ROOT%\.build-tmp"
set "TMP=%ROOT%\.build-tmp"
set "TMPDIR=%ROOT%\.build-tmp"

REM Never let Electron run as plain Node inside this script.
set "ELECTRON_RUN_AS_NODE="

REM Unsigned build: skip certificate auto-discovery.
set "CSC_IDENTITY_AUTO_DISCOVERY=false"

REM Prefer the npmmirror binaries mirror (GitHub fetches of winCodeSign/nsis
REM intermittently return 502 from this network).
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

REM 第一个参数只用来切 debug 日志；其余原样转给 electron-builder
set "BUILD_ARGS=%*"
if /i "%~1"=="debug" (
  set "DEBUG=electron-builder*"
  set "BUILD_ARGS=%2 %3 %4 %5 %6 %7 %8 %9"
)

echo ==== build started %DATE% %TIME% ==== > "%ROOT%\build.log"
"%NODE_EXE%" "node_modules\electron-builder\out\cli\cli.js" %BUILD_ARGS% --config.electronDist=node_modules/electron/dist >> "%ROOT%\build.log" 2>&1
echo EXITCODE=%ERRORLEVEL% >> "%ROOT%\build.log"
endlocal

