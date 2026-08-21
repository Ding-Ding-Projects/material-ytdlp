@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ============================================================================
REM  build-ffmpeg.bat -- builds ffmpeg.exe and ffprobe.exe from the vendored
REM  FFmpeg submodule source
REM
REM  Builds a native Windows ffmpeg/ffprobe using the MSYS2 + mingw-w64
REM  toolchain (bootstrapped by download-dependencies.bat) against the pinned
REM  git submodule at vendor\ffmpeg. Copies the results to vendor\bin\ and
REM  verifies they actually run.
REM
REM  LICENCE: this is an LGPL build. --enable-gpl and --enable-nonfree are
REM  never passed. See docs\features\build-and-packaging\
REM  building-ffmpeg-from-source.md for why.
REM
REM  Usage:
REM    build-ffmpeg.bat            interactive
REM    build-ffmpeg.bat /s          silent (also --silent, SILENT=1)
REM
REM  Idempotent: skips the rebuild when vendor\bin\ffmpeg.build.json already
REM  records the current submodule commit. A submodule SHA change forces a
REM  rebuild.
REM ============================================================================

set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"

if not "%SILENT%"=="1" set "SILENT=0"
if /I "%~1"=="/s" set "SILENT=1"
if /I "%~1"=="--silent" set "SILENT=1"

set "SUBMODULE_DIR=%REPO_ROOT%\vendor\ffmpeg"
set "VENDOR_BIN=%REPO_ROOT%\vendor\bin"
set "STAMP_FILE=%VENDOR_BIN%\ffmpeg.build.json"
set "BUILD_ROOT=%REPO_ROOT%\vendor\toolchain\ffmpeg-build"

REM Configure flags: LGPL, modest feature set matching what yt-dlp actually
REM calls ffmpeg/ffprobe for (remux, merge, extract-audio, embed metadata and
REM subtitles). No --enable-gpl. No --enable-nonfree, ever.
REM
REM Only libmp3lame is enabled as an external codec library: yt-dlp's
REM audio-extraction postprocessor needs it because ffmpeg has no native MP3
REM encoder, and it is the one library that earns its place for a
REM remux/merge/extract-audio/embed-metadata workload. gnutls, libopus and
REM libvorbis were all considered and dropped: gnutls (TLS) is unnecessary
REM because yt-dlp does all network I/O itself, and ffmpeg has native
REM encoders for opus and vorbis, so the external libraries added nothing.
REM Fewer external libraries also means fewer static archives that have to
REM exist and link correctly -- see the "Static linking" section of
REM docseaturesuild-and-packaginguilding-ffmpeg-from-source.md.
REM
REM --extra-ldflags forces the linker to prefer each remaining library's
REM static .a archive over its .dll.a shared-import counterpart (MSYS2 ships
REM both), and to statically link the MinGW C++/GCC runtime too, so the
REM resulting ffmpeg.exe/ffprobe.exe carry no MSYS2/mingw-w64 runtime DLL
REM dependency at all. This is verified by :verify_self_contained below,
REM which fails the build if it is not true -- a stamp recording that a
REM build succeeded is not the same claim as a binary that actually runs
REM outside the machine that built it.
set "FF_CONFIGURE_FLAGS=--target-os=mingw32 --arch=x86_64 --disable-debug --disable-doc --disable-ffplay --disable-shared --enable-static --pkg-config-flags=--static --extra-ldflags="-static -static-libgcc -static-libstdc++" --disable-autodetect --enable-zlib --enable-libmp3lame"

call :log "=== build-ffmpeg.bat starting (silent=%SILENT%) ==="

if not exist "%SUBMODULE_DIR%\configure" (
  call :fail "vendor\ffmpeg does not look like an initialized submodule (configure is missing). Run: git submodule update --init --recursive"
  exit /b 1
)

REM --- Resolve the current submodule commit -------------------------------
for /f "usebackq delims=" %%S in (`git -C "%SUBMODULE_DIR%" rev-parse HEAD`) do set "SUBMODULE_SHA=%%S"
if not defined SUBMODULE_SHA (
  call :fail "Could not resolve the current commit of vendor\ffmpeg via git rev-parse HEAD."
  exit /b 1
)
call :log "Submodule commit: %SUBMODULE_SHA%"

REM --- Skip rebuild if the stamp already matches this commit --------------
REM (Stamp reading lives in a subroutine, not inline inside this IF block:
REM  cmd.exe's block parser breaks when a parenthesized command inside a
REM  FOR /F backquoted call -- e.g. Python's json.load(open(...)) -- sits
REM  inside an outer "( ... )" IF block. Calling out avoids the nesting.)
set "SKIP_BUILD=0"
set "STAMPED_SHA="
if exist "%STAMP_FILE%" if exist "%VENDOR_BIN%\ffmpeg.exe" if exist "%VENDOR_BIN%\ffprobe.exe" call :read_stamp_sha

if "%STAMPED_SHA%"=="%SUBMODULE_SHA%" if defined STAMPED_SHA set "SKIP_BUILD=1"

if "%SKIP_BUILD%"=="1" (
  call :log "vendor\bin\ffmpeg.exe and ffprobe.exe already built from this exact submodule commit; skipping rebuild."
  call :log "=== build-ffmpeg.bat finished successfully (skipped) ==="
  exit /b 0
)

call :find_msys2_bash
if not defined MSYS2_BASH (
  call :fail "MSYS2 was not found (expected at C:\msys64\usr\bin\bash.exe or on PATH). Run download-dependencies.bat first to bootstrap the MSYS2 + mingw-w64 toolchain."
  exit /b 1
)
call :log "Using MSYS2 bash: %MSYS2_BASH%"

if not exist "%BUILD_ROOT%" mkdir "%BUILD_ROOT%" >nul 2>&1
if not exist "%VENDOR_BIN%" mkdir "%VENDOR_BIN%" >nul 2>&1

REM Convert Windows paths to the POSIX form MSYS2 bash expects.
set "SUBMODULE_DIR_POSIX=%SUBMODULE_DIR:\=/%"
set "SUBMODULE_DIR_POSIX=/!SUBMODULE_DIR_POSIX::=!"
set "BUILD_ROOT_POSIX=%BUILD_ROOT:\=/%"
set "BUILD_ROOT_POSIX=/!BUILD_ROOT_POSIX::=!"
set "VENDOR_BIN_POSIX=%VENDOR_BIN:\=/%"
set "VENDOR_BIN_POSIX=/!VENDOR_BIN_POSIX::=!"

call :log "Configuring ffmpeg (LGPL build; no --enable-gpl, no --enable-nonfree)..."
call :log "  configure flags: %FF_CONFIGURE_FLAGS%"

REM Run the whole configure+make+install inside one MSYS2 mingw64 shell
REM invocation so PATH/toolchain env (MSYSTEM=MINGW64) is set consistently.
set "MSYS2_ENV_VARS=MSYSTEM=MINGW64 CHERE_INVOKING=1"

(
  echo #!/bin/bash
  echo set -e
  echo export PATH="/mingw64/bin:$PATH"
  echo mkdir -p "%BUILD_ROOT_POSIX%"
  echo cd "%BUILD_ROOT_POSIX%"
  echo echo "[build-ffmpeg] configuring..."
  echo "%SUBMODULE_DIR_POSIX%/configure" --prefix="%BUILD_ROOT_POSIX%/dist" %FF_CONFIGURE_FLAGS%
  echo echo "[build-ffmpeg] building (this takes a long time)..."
  echo make -j"$(nproc)"
  echo echo "[build-ffmpeg] installing..."
  echo make install
  echo cp -f ffmpeg.exe "%VENDOR_BIN_POSIX%/ffmpeg.exe"
  echo cp -f ffprobe.exe "%VENDOR_BIN_POSIX%/ffprobe.exe"
  echo echo "FFMPEG_BUILD_COMPLETE"
) > "%BUILD_ROOT%\run-build.sh"

"%MSYS2_BASH%" -lc "MSYSTEM=MINGW64 CHERE_INVOKING=1 bash '%BUILD_ROOT_POSIX%/run-build.sh'"
set "BUILD_RC=%ERRORLEVEL%"

if not "%BUILD_RC%"=="0" (
  call :fail "ffmpeg configure/make/install failed with exit code %BUILD_RC%. See the build output above for the exact step and error."
  exit /b 1
)

if not exist "%VENDOR_BIN%\ffmpeg.exe" (
  call :fail "Build reported success but %VENDOR_BIN%\ffmpeg.exe does not exist."
  exit /b 1
)
if not exist "%VENDOR_BIN%\ffprobe.exe" (
  call :fail "Build reported success but %VENDOR_BIN%\ffprobe.exe does not exist."
  exit /b 1
)

REM --- Verify the binaries are genuinely self-contained -----------------------
REM A binary that only runs on a machine with MSYS2 installed is not bundled,
REM it is broken -- see docseaturesuild-and-packagingREM building-ffmpeg-from-source.md ("Static linking"). This checks the PE
REM import table directly with objdump rather than trusting that -version
REM succeeding on THIS machine (which has MSYS2 on PATH) means anything.
call :log "Verifying ffmpeg.exe and ffprobe.exe are statically linked (no MSYS2/mingw-w64 runtime DLLs)..."
call :verify_self_contained "%VENDOR_BIN%fmpeg.exe"
if errorlevel 1 exit /b 1
call :verify_self_contained "%VENDOR_BIN%fprobe.exe"
if errorlevel 1 exit /b 1

REM --- Verify the built binaries actually run --------------------------------
call :log "Verifying built binaries..."
set "FFMPEG_VERSION="
for /f "usebackq delims=" %%V in (`"%VENDOR_BIN%\ffmpeg.exe" -version 2^>^&1`) do (
  if not defined FFMPEG_VERSION set "FFMPEG_VERSION=%%V"
)
if not defined FFMPEG_VERSION (
  call :fail "vendor\bin\ffmpeg.exe -version produced no output; the built binary does not run."
  exit /b 1
)
call :log "Built ffmpeg version: %FFMPEG_VERSION%"

set "FFPROBE_VERSION="
for /f "usebackq delims=" %%V in (`"%VENDOR_BIN%\ffprobe.exe" -version 2^>^&1`) do (
  if not defined FFPROBE_VERSION set "FFPROBE_VERSION=%%V"
)
if not defined FFPROBE_VERSION (
  call :fail "vendor\bin\ffprobe.exe -version produced no output; the built binary does not run."
  exit /b 1
)
call :log "Built ffprobe version: %FFPROBE_VERSION%"

for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "(Get-FileHash -LiteralPath '%VENDOR_BIN%\ffmpeg.exe' -Algorithm SHA256).Hash.ToLowerInvariant()"`) do set "FFMPEG_SHA256=%%H"
for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "(Get-FileHash -LiteralPath '%VENDOR_BIN%\ffprobe.exe' -Algorithm SHA256).Hash.ToLowerInvariant()"`) do set "FFPROBE_SHA256=%%H"
call :log "ffmpeg.exe SHA-256: %FFMPEG_SHA256%"
call :log "ffprobe.exe SHA-256: %FFPROBE_SHA256%"

REM --- Write the build stamp -------------------------------------------------
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "Get-Date -Format o"`) do set "BUILT_AT=%%D"
(
  echo {
  echo   "submoduleSha": "%SUBMODULE_SHA%",
  echo   "ffmpegVersion": "%FFMPEG_VERSION:"=\"%",
  echo   "ffmpegSha256": "%FFMPEG_SHA256%",
  echo   "ffprobeSha256": "%FFPROBE_SHA256%",
  echo   "configureFlags": "%FF_CONFIGURE_FLAGS:"=\"%",
  echo   "licence": "LGPL (no --enable-gpl, no --enable-nonfree)",
  echo   "builtAt": "%BUILT_AT%"
  echo }
) > "%STAMP_FILE%"

call :log "Wrote build stamp: %STAMP_FILE%"
call :log "=== build-ffmpeg.bat finished successfully ==="
exit /b 0

REM ============================================================================
REM Checks a built .exe's PE import table with objdump and fails the build if
REM it depends on any DLL that is not a standard Windows system DLL. Windows
REM ships kernel32/user32/etc. on every machine; a "lib*.dll",
REM "libgcc_s_seh-1.dll", "libwinpthread-1.dll" or "libstdc++-6.dll" entry
REM means the binary is not actually self-contained, whatever -version just
REM reported on a machine that happens to have MSYS2 installed.
:verify_self_contained
set "VSC_TARGET=%~1"
set "VSC_TARGET_POSIX=%VSC_TARGET:\=/%"
set "VSC_TARGET_POSIX=/!VSC_TARGET_POSIX::=!"
set "VSC_BAD_DLLS="
set "VSC_OUT=%BUILD_ROOT%\dll-check.txt"
set "VSC_OUT_POSIX=%BUILD_ROOT_POSIX%/dll-check.txt"
REM Write objdump's output to a plain file rather than reading it through a
REM FOR /F backquoted command: nested double quotes inside a backquoted
REM command (the -lc argument here needs its own quoting on top of the
REM single quotes around the path) breaks cmd.exe's subshell parsing --
REM confirmed by an earlier attempt that printed a mangled command name
REM instead of running objdump at all. Redirecting to a file and reading
REM that file with a plain FOR /F sidesteps that problem, but introduced a
REM second one: MSYS2's redirect writes LF-only line endings, and
REM findstr /R's "$" anchor does not recognize a bare LF as end-of-line --
REM confirmed by testing the identical pattern against a CRLF file (matched
REM correctly) and this LF file (matched nothing at all, every DLL flagged
REM as bad including ones plainly present and allowlisted). The allowlist
REM comparison below is done in PowerShell instead, which has no such
REM line-ending sensitivity, rather than fighting findstr further.
"%MSYS2_BASH%" -lc "/mingw64/bin/objdump -p '%VSC_TARGET_POSIX%' | grep -i 'DLL Name' | sed -E 's/.*DLL Name: //I' > '%VSC_OUT_POSIX%'"
if not exist "%VSC_OUT%" (
  call :fail "Could not read the import table of %VSC_TARGET% (objdump produced no output file)."
  exit /b 1
)
set "VSC_BAD_DLLS="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "$allow = @('KERNEL32.dll','msvcrt.dll','ADVAPI32.dll','USER32.dll','GDI32.dll','WS2_32.dll','BCRYPT.dll','CRYPT32.dll','ncrypt.dll','SHELL32.dll','SHLWAPI.dll','ole32.dll','OLEAUT32.dll','SECUR32.dll','IPHLPAPI.dll','WINMM.dll','AVICAP32.dll','dwmapi.dll'); (Get-Content -LiteralPath '%VSC_OUT%' ^| Where-Object { $_.Trim() -and ($allow -notcontains $_.Trim()) }) -join ' '"`) do set "VSC_BAD_DLLS=%%D"
if defined VSC_BAD_DLLS (
  call :fail "%VSC_TARGET% is not statically linked -- it depends on non-system DLLs at runtime and would fail to start on a user's machine: %VSC_BAD_DLLS%"
  exit /b 1
)
call :log "  %VSC_TARGET%: only Windows system DLLs in the import table (self-contained)."
exit /b 0

REM ============================================================================
:find_msys2_bash
set "MSYS2_BASH="
if exist "C:\msys64\usr\bin\bash.exe" set "MSYS2_BASH=C:\msys64\usr\bin\bash.exe"
if not defined MSYS2_BASH if exist "%REPO_ROOT%\vendor\toolchain\msys64\usr\bin\bash.exe" set "MSYS2_BASH=%REPO_ROOT%\vendor\toolchain\msys64\usr\bin\bash.exe"
goto :eof

REM ============================================================================
REM Reads submoduleSha out of the existing stamp file. Kept as its own
REM subroutine (not inline in an IF block) because the PowerShell one-liner
REM below is a bare, unparenthesized FOR /F -- nesting it inside an outer
REM "( ... )" IF block is what broke cmd.exe's parser earlier.
:read_stamp_sha
set "STAMPED_SHA="
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "try { (Get-Content -Raw -LiteralPath '%STAMP_FILE%' | ConvertFrom-Json).submoduleSha } catch { '' }"`) do set "STAMPED_SHA=%%R"
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
