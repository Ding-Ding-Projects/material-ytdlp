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

REM --- Phase 3: ffmpeg + ffprobe ------------------------------------------
call :log "[3/3] Checking ffmpeg + ffprobe..."
set "FFMPEG_PRESENT=0"
if exist "%VENDOR_BIN%\ffmpeg.exe" if exist "%VENDOR_BIN%\ffprobe.exe" set "FFMPEG_PRESENT=1"
if "%FFMPEG_PRESENT%"=="1" (
  call :log "  Already present at %VENDOR_BIN%\ffmpeg.exe and ffprobe.exe; skipping."
) else (
  call :log "  Fetching pinned ffmpeg build (see vendor\dependencies.json for the source and digest)..."
  call :fetch_ffmpeg
  if errorlevel 1 (
    call :fail "ffmpeg fetch/verify/extract failed. See the messages above for the exact step and error."
    exit /b 1
  )
)

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
:refresh_path
REM Pull the freshly-written user + machine PATH into THIS cmd process.
for /f "usebackq tokens=2,*" %%A in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "USERPATH=%%B"
for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul`) do set "SYSPATH=%%B"
if defined SYSPATH if defined USERPATH set "PATH=%SYSPATH%;%USERPATH%"
if defined SYSPATH if not defined USERPATH set "PATH=%SYSPATH%"
goto :eof

REM ============================================================================
:fetch_ffmpeg
REM Reads url/sha256 from vendor\dependencies.json via a small inline python
REM check (python is guaranteed present by phase 1), downloads, verifies,
REM and extracts ffmpeg.exe/ffprobe.exe into vendor\bin.
set "FF_URL="
set "FF_SHA="
for /f "usebackq delims=" %%U in (`!PYTHON_EXE! -c "import json;d=json.load(open(r'%DEPS_JSON%',encoding='utf-8'));print(d['ffmpeg']['url'])"`) do set "FF_URL=%%U"
for /f "usebackq delims=" %%S in (`!PYTHON_EXE! -c "import json;d=json.load(open(r'%DEPS_JSON%',encoding='utf-8'));print(d['ffmpeg'].get('sha256',''))"`) do set "FF_SHA=%%S"

if not defined FF_URL (
  call :log "  vendor\dependencies.json has no ffmpeg.url entry."
  exit /b 1
)

set "FF_ZIP=%TOOLCHAIN_DIR%\ffmpeg-download.zip"

if "%FF_SHA%"=="" (
  call :log "  No recorded SHA-256 for ffmpeg yet. Downloading once to compute and record it..."
  powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\scripts\fetch-verified.ps1" -Url "%FF_URL%" -OutFile "%FF_ZIP%"
  set "PSRC=!ERRORLEVEL!"
  if "!PSRC!"=="2" (
    call :log "  Downloaded and hashed. Re-run this script's ffmpeg step after recording the printed SHA-256"
    call :log "  into vendor\dependencies.json (\"ffmpeg\".\"sha256\"). The file was NOT extracted yet"
    call :log "  because it is not verified -- this is fail-closed by design."
    exit /b 1
  )
  if not "!PSRC!"=="0" exit /b 1
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\scripts\fetch-verified.ps1" -Url "%FF_URL%" -OutFile "%FF_ZIP%" -Sha256 "%FF_SHA%"
  if errorlevel 1 exit /b 1
)

call :log "  Extracting ffmpeg.exe and ffprobe.exe..."
set "FF_EXTRACT=%TOOLCHAIN_DIR%\ffmpeg-extract"
if exist "%FF_EXTRACT%" rmdir /s /q "%FF_EXTRACT%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%FF_ZIP%' -DestinationPath '%FF_EXTRACT%' -Force"
if errorlevel 1 (
  call :log "  Expand-Archive failed."
  exit /b 1
)

set "FOUND_FFMPEG="
set "FOUND_FFPROBE="
for /f "delims=" %%F in ('dir /s /b "%FF_EXTRACT%\ffmpeg.exe" 2^>nul') do set "FOUND_FFMPEG=%%F"
for /f "delims=" %%F in ('dir /s /b "%FF_EXTRACT%\ffprobe.exe" 2^>nul') do set "FOUND_FFPROBE=%%F"

if not defined FOUND_FFMPEG (
  call :log "  ffmpeg.exe not found inside the extracted archive."
  exit /b 1
)
if not defined FOUND_FFPROBE (
  call :log "  ffprobe.exe not found inside the extracted archive."
  exit /b 1
)

copy /y "%FOUND_FFMPEG%" "%VENDOR_BIN%\ffmpeg.exe" >nul
copy /y "%FOUND_FFPROBE%" "%VENDOR_BIN%\ffprobe.exe" >nul

rmdir /s /q "%FF_EXTRACT%" >nul 2>&1
del /q "%FF_ZIP%" >nul 2>&1

call :log "  ffmpeg.exe and ffprobe.exe installed to %VENDOR_BIN%."
exit /b 0

REM ============================================================================
:log
echo [%TIME%] %~1
goto :eof

:fail
echo.
echo [%TIME%] FAILED: %~1
echo.
exit /b 1
