@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ============================================================================
REM  download-dependencies.bat -- one-click dependency fetcher for yt-dlp Studio
REM
REM  Assumes a fresh Windows machine with nothing installed. Installs every
REM  build/runtime dependency the project needs, user-scoped, never admin,
REM  never machine-wide unless the tool itself has no user-scoped mode.
REM
REM  Usage:
REM    download-dependencies.bat            interactive
REM    download-dependencies.bat /s          silent (also --silent, SILENT=1)
REM
REM  Exits non-zero on the first real failure. Idempotent: re-running skips
REM  whatever is already present and verified.
REM ============================================================================

set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"

if not "%SILENT%"=="1" set "SILENT=0"
if /I "%~1"=="/s" set "SILENT=1"
if /I "%~1"=="--silent" set "SILENT=1"

set "VENDOR_DIR=%REPO_ROOT%\vendor"
set "VENDOR_BIN=%VENDOR_DIR%\bin"
set "TOOLCHAIN_DIR=%VENDOR_DIR%\toolchain"
set "DEPS_JSON=%VENDOR_DIR%\dependencies.json"
set "PS=%TOOLCHAIN_DIR%"

set "STEP_START=%TIME%"
call :log "=== download-dependencies.bat starting (silent=%SILENT%) ==="
call :log "Repo root: %REPO_ROOT%"

if not exist "%VENDOR_BIN%" mkdir "%VENDOR_BIN%" >nul 2>&1
if not exist "%TOOLCHAIN_DIR%" mkdir "%TOOLCHAIN_DIR%" >nul 2>&1

REM --- Phase 1: Python ---------------------------------------------------
call :log "[1/3] Checking for Python 3.11+..."
set "PYTHON_EXE="
call :find_python
if defined PYTHON_EXE (
  call :log "  Found: !PYTHON_EXE!"
) else (
  call :log "  Not found. Installing via winget (user-scoped)..."
  where winget >nul 2>&1
  if errorlevel 1 (
    call :fail "Python is missing and winget is not available on this machine. Install Python 3.11+ manually (https://www.python.org/downloads/) and re-run, or install winget (App Installer from the Microsoft Store) first."
    exit /b 1
  )
  winget install --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    call :fail "winget install of Python.Python.3.12 failed. Source tried: winget (Python.Python.3.12). See the winget output above for the exact error."
    exit /b 1
  )
  REM Refresh the CURRENT process PATH: winget writes PATH for future shells
  REM only, so without this the very next command still cannot find Python,
  REM which reads as "the install failed" when it actually succeeded.
  call :refresh_path
  call :find_python
  if not defined PYTHON_EXE (
    call :fail "Python was installed by winget but is not resolvable in this process even after a PATH refresh. Open a new shell and re-run this script."
    exit /b 1
  )
  call :log "  Installed: !PYTHON_EXE!"
)

REM --- Phase 2: app/ Node dependencies -----------------------------------
call :log "[2/3] Checking Node dependencies for app\..."
if exist "%REPO_ROOT%\app\package.json" (
  if exist "%REPO_ROOT%\app\node_modules" (
    call :log "  app\node_modules already present; skipping install (re-run with a deleted node_modules to force)."
  ) else (
    where npm >nul 2>&1
    if errorlevel 1 (
      call :fail "npm is not on PATH. Node.js (which bundles npm) must be installed first -- get it from https://nodejs.org/ (LTS) or 'winget install OpenJS.NodeJS.LTS --scope user'."
      exit /b 1
    )
    pushd "%REPO_ROOT%\app"
    if exist "package-lock.json" (
      call :log "  Running: npm ci"
      call npm ci
    ) else (
      call :log "  No package-lock.json found; running: npm install"
      call npm install
    )
    set "NPM_RC=!ERRORLEVEL!"
    popd
    if not "!NPM_RC!"=="0" (
      call :fail "npm install/ci failed in app\ with exit code !NPM_RC!. See the npm output above for the exact error."
      exit /b 1
    )
    call :log "  app\ dependencies installed."
  )
) else (
  call :log "  app\package.json does not exist yet (owned by another lane); skipping Node dependency install."
)

REM --- Phase 3: MSYS2 + mingw-w64 toolchain (for building ffmpeg from source) ---
call :log "[3/3] Checking MSYS2 + mingw-w64 build toolchain..."
call :find_msys2_bash
if defined MSYS2_BASH (
  call :log "  Found MSYS2 at %MSYS2_BASH%. Checking required packages..."
  call :ensure_mingw_packages
  if errorlevel 1 (
    call :fail "Failed to install required MSYS2/mingw-w64 packages. See the pacman output above for the exact error."
    exit /b 1
  )
) else (
  call :log "  MSYS2 not found. Installing via winget (user-scoped, unattended)..."
  where winget >nul 2>&1
  if errorlevel 1 (
    call :fail "MSYS2 is missing and winget is not available on this machine. Install MSYS2 manually (https://www.msys2.org/) and re-run, or install winget (App Installer from the Microsoft Store) first."
    exit /b 1
  )
  winget install --id MSYS2.MSYS2 --scope machine --silent --accept-package-agreements --accept-source-agreements
  set "MSYS2_RC=!ERRORLEVEL!"
  if not "!MSYS2_RC!"=="0" (
    winget install --id MSYS2.MSYS2 --silent --accept-package-agreements --accept-source-agreements
    set "MSYS2_RC=!ERRORLEVEL!"
  )
  if not "!MSYS2_RC!"=="0" (
    call :fail "winget install of MSYS2.MSYS2 failed with exit code !MSYS2_RC!. Source tried: winget (MSYS2.MSYS2). See the winget output above for the exact error."
    exit /b 1
  )
  call :refresh_path
  call :find_msys2_bash
  if not defined MSYS2_BASH (
    call :fail "MSYS2 was installed by winget but its bash.exe cannot be found at C:\msys64\usr\bin\bash.exe. Open a new shell and re-run this script."
    exit /b 1
  )
  call :log "  Installed MSYS2 at %MSYS2_BASH%."
  call :ensure_mingw_packages
  if errorlevel 1 (
    call :fail "Failed to install required MSYS2/mingw-w64 packages after a fresh MSYS2 install. See the pacman output above for the exact error."
    exit /b 1
  )
)
call :log "  MSYS2 + mingw-w64 build toolchain ready. Run build-ffmpeg.bat to build ffmpeg.exe and ffprobe.exe from vendor\ffmpeg."

set "STEP_END=%TIME%"
call :log "=== download-dependencies.bat finished successfully ==="
exit /b 0

REM ============================================================================
:find_python
set "PYTHON_EXE="
for %%P in (python.exe) do (
  if exist "%%~$PATH:P" (
    "%%~$PATH:P" -c "import sys; sys.exit(0 if sys.version_info[:2]>=(3,11) else 1)" >nul 2>&1
    if not errorlevel 1 set "PYTHON_EXE=%%~$PATH:P"
  )
)
if defined PYTHON_EXE goto :eof
where py >nul 2>&1
if not errorlevel 1 (
  py -3 -c "import sys; sys.exit(0 if sys.version_info[:2]>=(3,11) else 1)" >nul 2>&1
  if not errorlevel 1 set "PYTHON_EXE=py -3"
)
goto :eof

REM ============================================================================
:find_msys2_bash
set "MSYS2_BASH="
if exist "C:\msys64\usr\bin\bash.exe" set "MSYS2_BASH=C:\msys64\usr\bin\bash.exe"
goto :eof

REM ============================================================================
:ensure_mingw_packages
REM Installs the mingw-w64 x86_64 toolchain plus the packages ffmpeg's own
REM configure/make needs: gcc toolchain, nasm assembler, make, pkg-config,
REM diffutils, and the small set of LGPL-compatible codec libraries the
REM configure flags in build-ffmpeg.bat enable (gnutls, zlib, mp3lame, opus,
REM vorbis -- no GPL-only library such as libx264 or libvpx is installed,
REM since build-ffmpeg.bat never enables one). Idempotent: pacman -S --needed
REM skips what is already present.
"%MSYS2_BASH%" -lc "pacman -Sy --noconfirm" >nul 2>&1
"%MSYS2_BASH%" -lc "pacman -S --needed --noconfirm mingw-w64-x86_64-toolchain mingw-w64-x86_64-nasm mingw-w64-x86_64-pkg-config mingw-w64-x86_64-gnutls mingw-w64-x86_64-zlib mingw-w64-x86_64-lame mingw-w64-x86_64-opus mingw-w64-x86_64-libvorbis make diffutils yasm python3"
exit /b !ERRORLEVEL!

REM ============================================================================
:refresh_path
REM Pull the freshly-written user + machine PATH into THIS cmd process.
for /f "usebackq tokens=2,*" %%A in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "USERPATH=%%B"
for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul`) do set "SYSPATH=%%B"
if defined SYSPATH if defined USERPATH set "PATH=%SYSPATH%;%USERPATH%"
if defined SYSPATH if not defined USERPATH set "PATH=%SYSPATH%"
goto :eof

REM ============================================================================
:log
echo [%TIME%] %~1
goto :eof

:fail
echo.
echo [%TIME%] FAILED: %~1
echo.
exit /b 1
