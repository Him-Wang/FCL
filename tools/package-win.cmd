@echo off
setlocal enableextensions
REM Build helper for electron-builder. Builds into dist\.
REM
REM Notes:
REM  - Use a project-local TEMP dir: the machine %TEMP% can trip electron-builder's
REM    proper-lockfile based artifact lock (EPERM on mkdir/rmdir eb-dl-*.lock.lock).
REM  - Use a node.exe that runs at normal integrity level. The node bundled with DSH
REM    (C:\Users\wbhh\.dsh\tools\node\node.exe) runs at Low integrity on this machine,
REM    which makes every write fail with EPERM, so electron-builder cannot work.

set "ROOT=%~dp0.."
cd /d "%ROOT%"

set "NODE_EXE=C:\Users\wbhh\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=C:\Users\wbhh\.dsh\tools\node\node.exe"

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

if /i "%~1"=="debug" set "DEBUG=electron-builder*"

echo ==== build started %DATE% %TIME% ==== > "%ROOT%\build.log"
"%NODE_EXE%" "node_modules\electron-builder\out\cli\cli.js" %2 %3 %4 %5 %6 >> "%ROOT%\build.log" 2>&1
echo EXITCODE=%ERRORLEVEL% >> "%ROOT%\build.log"
endlocal
