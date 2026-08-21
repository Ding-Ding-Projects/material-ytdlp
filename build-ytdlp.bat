@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ============================================================================
REM  build-ytdlp.bat -- builds yt-dlp.exe from the vendored submodule source
REM
REM  Runs yt-dlp's own official PyInstaller build path from inside
REM  vendor\yt-dlp (the pinned git submodule), in a user-scoped venv so it
REM  never touches the machine's global Python packages. Copies the result
REM  to vendor\bin\yt-dlp.exe and verifies it actually runs.
REM
REM  Usage:
REM    build-ytdlp.bat            interactive
REM    build-ytdlp.bat /s          silent (also --silent, SILENT=1)
REM
REM  Idempotent: skips the rebuild when vendor\bin\yt-dlp.build.json already
REM  records the current submodule commit. A submodule SHA change forces a
REM  rebuild.
REM ============================================================================

set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"

if not "%SILENT%"=="1" set "SILENT=0"
if /I "%~1"=="/s" set "SILENT=1"
if /I "%~1"=="--silent" set "SILENT=1"

set "SUBMODULE_DIR=%REPO_ROOT%\vendor\yt-dlp"
set "VENDOR_BIN=%REPO_ROOT%\vendor\bin"
set "VENV_DIR=%REPO_ROOT%\vendor\toolchain\venv"
set "STAMP_FILE=%VENDOR_BIN%\yt-dlp.build.json"

call :log "=== build-ytdlp.bat starting (silent=%SILENT%) ==="

if not exist "%SUBMODULE_DIR%\devscripts\install_deps.py" (
  call :fail "vendor\yt-dlp does not look like an initialized submodule (devscripts\install_deps.py is missing). Run: git submodule update --init --recursive"
  exit /b 1
)

REM --- Resolve the current submodule commit -------------------------------
for /f "usebackq delims=" %%S in (`git -C "%SUBMODULE_DIR%" rev-parse HEAD`) do set "SUBMODULE_SHA=%%S"
if not defined SUBMODULE_SHA (
  call :fail "Could not resolve the current commit of vendor\yt-dlp via git rev-parse HEAD."
  exit /b 1
)
call :log "Submodule commit: %SUBMODULE_SHA%"

REM --- Skip rebuild if the stamp already matches this commit --------------
set "SKIP_BUILD=0"
if exist "%STAMP_FILE%" if exist "%VENDOR_BIN%\yt-dlp.exe" (
  call :find_python
  for /f "usebackq delims=" %%R in (`!PYTHON_EXE! -c "import json;print(json.load(open(r'%STAMP_FILE%',encoding='utf-8')).get('submoduleSha',''))" 2^>nul`) do set "STAMPED_SHA=%%R"
  if "!STAMPED_SHA!"=="%SUBMODULE_SHA%" set "SKIP_BUILD=1"
)

if "%SKIP_BUILD%"=="1" (
  call :log "vendor\bin\yt-dlp.exe already built from this exact submodule commit; skipping rebuild."
  call :log "=== build-ytdlp.bat finished successfully (skipped) ==="
  exit /b 0
)

call :find_python
if not defined PYTHON_EXE (
  call :fail "No Python 3.11+ found. Run download-dependencies.bat first."
  exit /b 1
)
call :log "Using system Python: %PYTHON_EXE%"

REM --- Create the user-scoped build venv -----------------------------------
if not exist "%VENV_DIR%\Scripts\python.exe" (
  call :log "Creating build venv at %VENV_DIR% ..."
  %PYTHON_EXE% -m venv "%VENV_DIR%"
  if errorlevel 1 (
    call :fail "Failed to create venv at %VENV_DIR%."
    exit /b 1
  )
) else (
  call :log "Reusing existing build venv at %VENV_DIR%."
)

set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

REM --- Install yt-dlp's own declared build dependencies ---------------------
call :log "Installing yt-dlp's declared build dependencies (devscripts\install_deps.py --include pyinstaller)..."
pushd "%SUBMODULE_DIR%"
"%VENV_PY%" -m pip install --upgrade pip >nul
"%VENV_PY%" devscripts\install_deps.py --include pyinstaller
set "DEPS_RC=%ERRORLEVEL%"
if not "%DEPS_RC%"=="0" (
  popd
  call :fail "devscripts\install_deps.py failed with exit code %DEPS_RC%. See the pip output above for the exact error."
  exit /b 1
)

call :log "Generating lazy extractors (devscripts\make_lazy_extractors.py)..."
"%VENV_PY%" devscripts\make_lazy_extractors.py
if errorlevel 1 (
  popd
  call :fail "devscripts\make_lazy_extractors.py failed."
  exit /b 1
)

call :log "Running PyInstaller bundle (python -m bundle.pyinstaller). This takes several minutes..."
"%VENV_PY%" -m bundle.pyinstaller
set "BUILD_RC=%ERRORLEVEL%"
popd

if not "%BUILD_RC%"=="0" (
  call :fail "python -m bundle.pyinstaller failed with exit code %BUILD_RC%. See the PyInstaller output above for the exact error."
  exit /b 1
)

if not exist "%SUBMODULE_DIR%\dist\yt-dlp.exe" (
  call :fail "PyInstaller reported success but %SUBMODULE_DIR%\dist\yt-dlp.exe does not exist."
  exit /b 1
)

if not exist "%VENDOR_BIN%" mkdir "%VENDOR_BIN%" >nul 2>&1
copy /y "%SUBMODULE_DIR%\dist\yt-dlp.exe" "%VENDOR_BIN%\yt-dlp.exe" >nul
if errorlevel 1 (
  call :fail "Failed to copy dist\yt-dlp.exe to %VENDOR_BIN%\yt-dlp.exe."
  exit /b 1
)

REM --- Verify the built binary actually runs --------------------------------
call :log "Verifying built binary..."
for /f "usebackq delims=" %%V in (`"%VENDOR_BIN%\yt-dlp.exe" --version 2^>^&1`) do set "YTDLP_VERSION=%%V"
if not defined YTDLP_VERSION (
  call :fail "vendor\bin\yt-dlp.exe --version produced no output; the built binary does not run."
  exit /b 1
)
call :log "Built yt-dlp version: %YTDLP_VERSION%"

for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "(Get-FileHash -LiteralPath '%VENDOR_BIN%\yt-dlp.exe' -Algorithm SHA256).Hash.ToLowerInvariant()"`) do set "YTDLP_SHA256=%%H"
call :log "SHA-256: %YTDLP_SHA256%"

REM --- Write the build stamp -------------------------------------------------
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "Get-Date -Format o"`) do set "BUILT_AT=%%D"
(
  echo {
  echo   "submoduleSha": "%SUBMODULE_SHA%",
  echo   "ytdlpVersion": "%YTDLP_VERSION%",
  echo   "sha256": "%YTDLP_SHA256%",
  echo   "builtAt": "%BUILT_AT%"
  echo }
) > "%STAMP_FILE%"

call :log "Wrote build stamp: %STAMP_FILE%"
call :log "=== build-ytdlp.bat finished successfully ==="
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
:log
echo [%TIME%] %~1
goto :eof

:fail
echo.
echo [%TIME%] FAILED: %~1
echo.
goto :eof
