@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ============================================================================
REM  build-installer.bat -- produces the Squirrel.Windows installer
REM
REM  Runs "npm run dist" in app\ (electron-vite build + electron-builder
REM  --win squirrel per app\electron-builder.yml). Verifies the built
REM  Setup.exe exists, prints its path/size/SHA-256, and asserts it is
REM  UNSIGNED -- code signing is permanently prohibited in this project.
REM
REM  Never publishes, tags, or creates a release. That is the orchestrator's
REM  job, not this script's.
REM
REM  Usage:
REM    build-installer.bat            interactive
REM    build-installer.bat /s          silent (also --silent, SILENT=1)
REM ============================================================================

set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"

if not "%SILENT%"=="1" set "SILENT=0"
if /I "%~1"=="/s" set "SILENT=1"
if /I "%~1"=="--silent" set "SILENT=1"

call :log "=== build-installer.bat starting (silent=%SILENT%) ==="

if not exist "%REPO_ROOT%\app\package.json" (
  call :fail "app\package.json does not exist. The Electron app source has not been created yet."
  exit /b 1
)

call :log "This project permanently prohibits code signing. The produced installer will be"
call :log "unsigned and will trigger the operating system's unknown-publisher / SmartScreen"
call :log "warning. This is expected; no certificate is requested or used."

call :log "Running npm run dist in app\ (electron-vite build + electron-builder --win squirrel)..."
pushd "%REPO_ROOT%\app"
call npm run dist
set "DIST_RC=%ERRORLEVEL%"
popd

if not "%DIST_RC%"=="0" (
  call :fail "npm run dist failed in app\ with exit code %DIST_RC%. See the npm/electron-builder output above for the exact error."
  exit /b 1
)

REM Squirrel.Windows output lands under app\dist\squirrel-windows\ (electron-builder
REM writes Setup.exe, RELEASES, and the full .nupkg there for the --win squirrel target).
set "SQUIRREL_DIR=%REPO_ROOT%\app\dist\squirrel-windows"
set "SETUP_EXE="
for /f "delims=" %%F in ('dir /b "%SQUIRREL_DIR%\*Setup.exe" 2^>nul') do set "SETUP_EXE=%SQUIRREL_DIR%\%%F"

if not defined SETUP_EXE (
  call :fail "No *Setup.exe found under %SQUIRREL_DIR%. electron-builder reported success but produced no Squirrel setup executable."
  exit /b 1
)

if not exist "%SQUIRREL_DIR%\RELEASES" (
  call :fail "%SQUIRREL_DIR%\RELEASES is missing. A Squirrel.Windows release must ship Setup.exe, RELEASES, and the full .nupkg together."
  exit /b 1
)

for %%F in ("%SETUP_EXE%") do set "SETUP_SIZE=%%~zF"

for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "(Get-FileHash -LiteralPath '%SETUP_EXE%' -Algorithm SHA256).Hash.ToLowerInvariant()"`) do set "SETUP_SHA256=%%H"

call :log "Setup executable: %SETUP_EXE%"
call :log "Size (bytes): %SETUP_SIZE%"
call :log "SHA-256: %SETUP_SHA256%"

REM Assert unsigned: query the Authenticode signature status via PowerShell.
REM Code signing is permanently prohibited in this project; a signed installer
REM here would mean signing was silently introduced somewhere and must fail
REM the build, not pass it.
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "(Get-AuthenticodeSignature -LiteralPath '%SETUP_EXE%').Status"`) do set "SIGN_STATUS=%%S"
call :log "Authenticode signature status: %SIGN_STATUS%"
if /I not "%SIGN_STATUS%"=="NotSigned" (
  call :fail "Setup.exe signature status is '%SIGN_STATUS%', not NotSigned. Code signing is permanently prohibited in this project -- something signed this build and that must be removed."
  exit /b 1
)
call :log "Confirmed unsigned (NotSigned), as required by the permanent no-signing policy."
call :log "The installer will show the operating system's unknown-publisher / SmartScreen"
call :log "warning on first run. This is expected and is not a build defect."

call :log "=== build-installer.bat finished successfully ==="
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
