@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ============================================================================
REM  build.bat -- one-click build of the runnable app
REM
REM  Assumes a fresh Windows machine with nothing installed. Calls
REM  download-dependencies.bat then build-ytdlp.bat (never duplicates their
REM  steps), then builds the Electron app in app\. On success, and only when
REM  not running silently, offers to launch it.
REM
REM  Usage:
REM    build.bat            interactive; prompts to run the app at the end
REM    build.bat /s          silent (also --silent, SILENT=1); never prompts
REM ============================================================================

set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"

if not "%SILENT%"=="1" set "SILENT=0"
if /I "%~1"=="/s" set "SILENT=1"
if /I "%~1"=="--silent" set "SILENT=1"

call :log "=== build.bat starting (silent=%SILENT%) ==="

REM Invoke sibling batch files by ABSOLUTE path. NoDefaultCurrentDirectoryInExePath
REM makes "cmd /c some.bat" fail with "is not recognized" even when the cwd is
REM correct, so a bare relative name here would be a landmine on some machines.
call "%REPO_ROOT%\download-dependencies.bat" %*
if errorlevel 1 (
  call :fail "download-dependencies.bat failed. See the output above for the exact step and error."
  exit /b 1
)

call "%REPO_ROOT%\build-ytdlp.bat" %*
if errorlevel 1 (
  call :fail "build-ytdlp.bat failed. See the output above for the exact step and error."
  exit /b 1
)

call :log "Building the app (npm run build in app\)..."
if not exist "%REPO_ROOT%\app\package.json" (
  call :fail "app\package.json does not exist. The Electron app source has not been created yet."
  exit /b 1
)

pushd "%REPO_ROOT%\app"
call npm run build
set "BUILD_RC=%ERRORLEVEL%"
popd

if not "%BUILD_RC%"=="0" (
  call :fail "npm run build failed in app\ with exit code %BUILD_RC%. See the npm output above for the exact error."
  exit /b 1
)

call :log "=== build.bat finished successfully ==="

if "%SILENT%"=="1" (
  exit /b 0
)

echo.
set /p "RUN_NOW=Run the app now? [y/N] "
if /I "%RUN_NOW%"=="y" (
  pushd "%REPO_ROOT%\app"
  call npm run start
  popd
)

exit /b 0

REM ============================================================================
:log
echo [%TIME%] %~1
goto :eof

:fail
echo.
echo [%TIME%] FAILED: %~1
echo.
goto :eof
