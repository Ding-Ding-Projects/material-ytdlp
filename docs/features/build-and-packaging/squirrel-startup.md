# Squirrel.Windows lifecycle handling (install/update/uninstall events)

## Behavior

Squirrel.Windows does not silently copy files and create a shortcut on its own. When it installs,
updates, or uninstalls the app, it launches the just-installed (or about-to-be-removed) executable
with one of five special command-line flags and expects the app itself to react — and then exit
immediately, without opening its normal window:

| Flag                            | Meaning                                             | App must...                     |
| -------------------------------- | ---------------------------------------------------- | -------------------------------- |
| `--squirrel-install <version>`   | First install                                        | Create shortcuts, then quit      |
| `--squirrel-updated <version>`   | Just updated to this version                         | Recreate shortcuts, then quit    |
| `--squirrel-obsolete <version>`  | This version is being replaced by a newer one         | Just quit                        |
| `--squirrel-uninstall <version>` | Being uninstalled                                    | Remove shortcuts, then quit      |
| `--squirrel-firstrun`            | Real first user-visible launch, right after install   | Run normally (do **not** quit)   |

This handling lives in `app/src/main/squirrel-startup.ts`, exporting `handleSquirrelEvent(): boolean`.
It is called as the very first statement in `app/src/main/index.ts`, before `app.whenReady()`,
before any `BrowserWindow` is created, and before IPC registration. If it returns `true`, the main
process calls `app.quit()` immediately and nothing else in startup runs.

### Why this matters

Without this handling, Electron simply launches the app for every one of these events. The app
opens its normal window and sits there. Squirrel's own install sequence never gets a chance to
finish, because it is waiting for the app process it just launched to exit. The practical symptom
is exactly what was reported: the installer appears to run, but no Start Menu shortcut is created,
and running `Setup.exe` again looks like it "does nothing."

### How shortcut creation actually happens

Squirrel.Windows does not create the shortcut itself — it is the *app's own responsibility* to ask
for it, by shelling out to `Update.exe`, which Squirrel places one directory above the installed
app's own executable:

```
<install root>\Update.exe
<install root>\app-<version>\<AppName>.exe   <- process.execPath
```

`squirrel-startup.ts` resolves this path as `path.resolve(process.execPath, '..', '..', 'Update.exe')`
rather than assuming a fixed absolute path, since the install root varies per user and per machine
(`%LOCALAPPDATA%\<AppName>` by default). It verifies the file exists before spawning it, and reports
clearly (via `console.error`) if it does not — this would indicate an abnormal Squirrel install
layout, not a bug in the app itself.

Shortcut creation and removal are requested with:

```
Update.exe --createShortcut=<exeName>
Update.exe --removeShortcut=<exeName>
```

where `<exeName>` is `path.basename(process.execPath)`.

`Update.exe` is spawned via Node's synchronous `spawnSync` (bounded to a 15-second timeout), never
`shell: true`, always with argv passed as an explicit array. The **synchronous, bounded wait is
required**: Squirrel documents that the shortcut may not actually be written to disk until
`Update.exe` finishes, so quitting the app before that completes can lose the shortcut even though
the correct command was issued.

### Where the shortcut actually lands

Squirrel.Windows groups shortcuts under a **publisher-name subfolder**, not directly inside
`Start Menu\Programs\`. For this app that is:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\<publisher>\<AppName>.lnk
```

(`<publisher>` is drawn from the packaging metadata, e.g. the `author`/company name — verified in
this project's real captured Squirrel log as `Ding Ding Projects\yt-dlp Studio.lnk`.) Squirrel also
creates a Desktop shortcut alongside it. Anything that verifies "did a shortcut get created" must
search recursively under `Start Menu\Programs\`, not just its top level, or it will report a false
negative on a working install.

## Configuration

No dependency is required for this. `Update.exe` ships with every Squirrel.Windows install; the
handler only needs Node's built-in `node:child_process` and `node:fs`/`node:path`.

`handleSquirrelEvent()` is a no-op (returns `false`) on:

- any non-Windows platform (Squirrel.Windows does not exist elsewhere), and
- an unpackaged build (`app.isPackaged === false`) — i.e. `electron-vite dev` / `electron-vite
  preview`, where these argv flags are never present anyway.

This means normal development is completely unaffected; the handler only ever does anything inside
a real packaged, installed build.

## Failure modes

- **`Update.exe` not found at the expected path** (`process.execPath/../../Update.exe` does not
  exist): shortcut creation/removal is skipped and an error is logged. This indicates an install
  layout Squirrel did not produce (for example, running the packaged `.exe` directly outside of an
  actual Squirrel install) rather than a defect in the handler itself.
- **`Update.exe` exits non-zero, times out, or throws while spawning**: caught, logged via
  `console.error`, and startup continues to `app.quit()` regardless — a failure here must never
  crash the installer lifecycle handling itself, since Squirrel is waiting for this process to
  exit either way.
- **Verifying "no shortcut was created" by only scanning the top level of `Start Menu\Programs\`**:
  this is a false negative, not a real failure — see "Where the shortcut actually lands" above.

## Verification

`scripts/verify-installer.mjs` is a real, repeatable, non-mocked verification of the actual
installer, not a smoke test against `win-unpacked`. It:

1. Builds `Setup.exe` via `electron-vite build` + `electron-builder --win squirrel` if one is not
   already present under `app/dist/squirrel-windows/`.
2. Runs the real `Setup.exe -s` (silent install) on the machine.
3. Asserts, against the real filesystem:
   - the app was installed under `%LOCALAPPDATA%\<AppName>` with `Update.exe` present,
   - the installed application executable exists under `app-<version>\`,
   - **a real Start Menu `.lnk` shortcut exists on disk**, searched recursively (see above),
   - the installed executable launches without immediately crashing.
4. Uninstalls via `Update.exe --uninstall` (Squirrel's own supported uninstall path — never a raw
   directory delete) and asserts the shortcut and install directory are actually gone afterward.
5. If cleanup left anything behind, it removes only the exact artifacts this run created and
   reports the leftover plainly rather than silently declaring success.

Run it directly:

```
node scripts/verify-installer.mjs
```

It exits `0` with a `PASS` summary line per assertion on success, and exits `1` on the first
failing assertion. On non-Windows platforms it reports and exits `0`, since Squirrel.Windows has
nothing to verify there.

### What was actually observed running this

A prior packaged build (predating this fix) was found already installed at
`%LOCALAPPDATA%\yt-dlp-studio` with `Update.exe` and the app executable present, but **no Start
Menu shortcut anywhere** — this is the exact defect reported by the user, reproduced live on this
machine before the fix, and cleaned up via `Update.exe --uninstall`.

After adding `squirrel-startup.ts` and wiring it into `index.ts`, a clean rebuild and a full silent
install run produced Squirrel's own `Squirrel-Shortcut.log`:

```
info: Program: Starting Squirrel Updater: --createShortcut=yt-dlp Studio.exe
info: ApplyReleasesImpl: Creating shortcut for yt-dlp Studio.exe =>
  C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Ding Ding Projects\yt-dlp Studio.lnk
info: ApplyReleasesImpl: Creating shortcut for yt-dlp Studio.exe =>
  C:\Users\<user>\...\Desktop\yt-dlp Studio.lnk
info: Program: Finished Squirrel Updater
```

`scripts/verify-installer.mjs` confirmed the `.lnk` on disk, launched the installed executable, and
uninstalled cleanly with both the shortcut and install directory removed afterward.
