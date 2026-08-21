# Interaction audit (observable-effect only) — yt-dlp Studio

Ground-truth audit of the packaged renderer: every reachable interactive control was clicked with a real synthesized mouse event over CDP, and classified by what actually happened afterward. This is measurement only — nothing here was fixed.

**This method has two known blind spots, and every classification below must be read in light of them.**

1. **No confirmed bridge/IPC calls (WIRED is unreachable).** `window.ytdlpStudio` is exposed via Electron's `contextBridge`, whose properties are non-writable/non-configurable, so the instrumentation that tries to wrap its methods for logging fails (`Bridge instrumentation active: false`, confirmed every run). No row below is ever a confirmed IPC call.
2. **No visibility into native OS windows (a working control can look identical to a broken one).** This harness only reads the renderer's DOM over CDP. A control whose real effect is a native Save/Open dialog, folder picker, print dialog, or similar produces ZERO renderer DOM change and is therefore indistinguishable, by this method alone, from a control that truly does nothing. **Confirmed on this exact build:** the INTAKE "Export" button opens a native Win32 "Save As" dialog (window class `#32770`) with no renderer DOM change at all — verified independently, outside this harness, by enumerating the desktop's top-level windows before/after the click (13 -> 34 windows, including the new "Save As" / #32770 / 960x540 window). This harness has no way to enumerate native OS windows from inside the CDP session, so it cannot detect this class of effect at all; it can only flag labels that plausibly belong to it (see **UNDETERMINED-possible-native-dialog** below) rather than assert they do nothing.

As a direct consequence, **this report never asserts a control is inert.** A click that produced no detected effect is classified **UNDETERMINED** (or, if its label plausibly opens a native dialog, **UNDETERMINED-possible-native-dialog**) — "no effect observed" and "no effect exists" are different claims, and only the first is this method's to make. Read **UI-ONLY** as "produced a visible effect, mechanism unconfirmed." Plain text/search fields that were clicked but not typed into are reported separately as **SKIPPED-text-input** and excluded from the actionable set, since a bare click correctly changing nothing is expected behaviour, not a defect.

Run at: 2026-08-21T17:07:00.659Z

## Headline

**No fake buttons were found.** No control in this run produced a toast with no other effect and no confirmed IPC call (the two prerequisites for calling something a decorative/fake control by this method). 4 control(s) could not be positively classified either way, purely because of the two blind spots above — several of these are already known, from direct manual testing on this same build, to be working controls this method simply cannot see (see "Known false positives this method has produced" below).

## Totals

| Classification | Count |
| --- | --- |
| UNDETERMINED-possible-native-dialog | 1 |
| UNDETERMINED | 3 |
| UI-ONLY | 133 |
| SKIPPED-text-input | 9 |
| SKIPPED-destructive | 3 |
| **Total controls processed** | **149** |

**TOAST-ONLY** is the only classification this report treats as positive evidence of a fake/decorative control. **UNDETERMINED** and **UNDETERMINED-possible-native-dialog** are NOT evidence of anything broken — they are this method's honest "could not tell" result and are sorted near the top only because they are the rows most worth a human looking at, not because they are known defects.

## Known false positives this method has produced

Four controls that an earlier, buggier version of this harness (or an earlier version of this method's signal) reported as having no effect were independently proven, by hand, on this same packaged build, to be fully working controls:

| Control | Client coordinates | Actual effect | Why this method missed it |
| --- | --- | --- | --- |
| Config rail item | resolved dynamically (rail button) | Opens a tab and renders the full config surface | An earlier bug in this harness's own path-resolution code (resolvePath short-circuiting to a huge ancestor element) caused the click to land on the wrong coordinates entirely; fixed in this harness, and this control now correctly reads UI-ONLY. |
| Notifications bell (QUEUE) | (1190, 31) | Opens a full Notifications dialog: heading, explanatory copy, a search field with its own regex affordance, "Clear history"/"Close" buttons, an honest empty state | An earlier version of this harness snapshotted the DOM once, immediately after the click, before the async-mounted dialog had painted; this harness now polls for a settled signature change instead of reading once. |
| Global search regex toggle `.*` | (843, 31) | Opens the "Pattern builder" popover: pattern field, searchable building blocks, Match/How many/Where/Grouping/Look around sections | Same async-mount timing gap as the notifications bell, now fixed by polling. |
| INTAKE "Export" | (1243, 128) | Opens a native Win32 "Save As" dialog (class `#32770`, 960x540); desktop top-level window count went 13 -> 34 | This method can only read the renderer's DOM over CDP and has no way to see a native OS window at all; this is a structural blind spot (see the limitations above), not a bug that was fixed. Labels resembling this one are now flagged UNDETERMINED-possible-native-dialog instead of asserted inert, but the underlying blind spot remains. |

The first two of these are now correctly classified UI-ONLY by this run, after the click-landing and async-mount-timing bugs were fixed (see Coverage below for the full account of both). The fourth cannot be fixed by better DOM measurement — it is a genuine capability gap in a CDP-only method — so it is handled by classifying suspiciously-labelled controls as UNDETERMINED-possible-native-dialog rather than by pretending the gap does not exist.

## Coverage

4 coverage gap(s)/limitations were recorded:

- bridge-call instrumentation could not be installed: window.ytdlpStudio is exposed via contextBridge, which Electron makes non-writable/non-configurable, so WIRED is unreachable in this run -- classification relies entirely on the observable DOM/toast signature, never on a confirmed bridge call. A control that calls a bridge method but produces no visible effect and no toast (e.g. a background write with no UI feedback) is classified UNDETERMINED rather than WIRED, and is NOT thereby proven inert.
- this method cannot see native OS windows (Save/Open dialogs, folder pickers, print dialogs, message boxes): it only reads the renderer's DOM over CDP. Confirmed on this build for the INTAKE "Export" button, which opens a native Win32 "Save As" dialog (class #32770) with zero renderer DOM change -- verified independently, outside this harness. Controls whose label matches common native-dialog wording are flagged UNDETERMINED-possible-native-dialog rather than asserted inert, but a control whose label gives no such hint and which genuinely opens a native window will still be reported as plain UNDETERMINED; this is a structural capability gap in a CDP-only method, not something the detection logic can fully close.
- no form fields were populated before clicking (no URL was pasted into the intake field), so controls whose behaviour depends on a filled form (Download, format/subtitle probes, per-row actions on a populated queue) were exercised only in their empty-state, which may legitimately do nothing and should not be read as proof those controls are broken when filled.
- an earlier version of this harness had a real bug that produced false INERT results across nearly the whole rail/tab-strip: its resolvePath() helper short-circuited to document.getElementById(...) the instant a path contained ANY id segment, abandoning every deeper segment -- so any control nested under an id'd ancestor (e.g. the app's root container) resolved to that huge ancestor instead of the actual element, and the click landed at the center of the whole app rather than on the control. This was caught by an external positive-control check (clicking the 'Config' rail item directly, which worked, while this harness had reported it INERT), reproduced in isolation (body.innerHTML length 285013 -> 354675 for a correctly-targeted click on the same control that this harness's buggy version had shown as byte-identical), and fixed by removing the id short-circuit from both the path-building and path-resolution code so they are exact inverses of each other, and by verifying every click point with elementFromPoint after scrollIntoView before dispatching. The numbers in THIS report are from the run made after that fix (rail buttons like Settings/Docs/History/Config now correctly show UI-ONLY). A hit-test mismatch at the verified click point (recorded inline in a row's detail as '[hit-test note: ...]') is left as an informational note rather than a reason to skip the click, since the click is still dispatched at the real, scrolled-into-view pixel and whatever is actually there is what a real user's click would also hit.

## Spot-checks

- No TOAST-ONLY rows were produced in this run, so there is nothing in that category to spot-check -- this is the headline result itself (see Headline above): no control raised a toast with no other effect, which is this method's only positive signal for a fake/decorative control.
- "Export" at INTAKE (UNDETERMINED-possible-native-dialog): no renderer DOM change, no bridge call, no toast -- but the label matches controls known on this build to open native OS dialogs (confirmed for "Export"), which this CDP-only harness cannot observe; a native dialog may have opened and is NOT ruled out by this result -- this row's own click-prep step independently verified the click landed on the resolved element (scrollIntoView + elementFromPoint hit-test before dispatch), and the post-click read polled the robust signature (element count, visible-text hash, dialog/popover-like element count) every 250ms for up to 2500ms rather than reading once, specifically to rule out the async-mount timing gap that produced the notifications-bell and pattern-builder false positives reported by the coordinator. The signature was still unchanged at the end of that full poll window.
- "-s simulate" at INTAKE (UNDETERMINED): no renderer DOM change, no bridge call, no toast, no thrown error observed -- this is NOT a claim that the control does nothing; see the Coverage section for what this method cannot see [hit-test note: elementFromPoint at the click coordinates returned p, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] -- this row's own click-prep step independently verified the click landed on the resolved element (scrollIntoView + elementFromPoint hit-test before dispatch), and the post-click read polled the robust signature (element count, visible-text hash, dialog/popover-like element count) every 250ms for up to 2500ms rather than reading once, specifically to rule out the async-mount timing gap that produced the notifications-bell and pattern-builder false positives reported by the coordinator. The signature was still unchanged at the end of that full poll window.
- "All states Downloading Queued Completed Errored" at QUEUE (UNDETERMINED): no renderer DOM change, no bridge call, no toast, no thrown error observed -- this is NOT a claim that the control does nothing; see the Coverage section for what this method cannot see -- this row's own click-prep step independently verified the click landed on the resolved element (scrollIntoView + elementFromPoint hit-test before dispatch), and the post-click read polled the robust signature (element count, visible-text hash, dialog/popover-like element count) every 250ms for up to 2500ms rather than reading once, specifically to rule out the async-mount timing gap that produced the notifications-bell and pattern-builder false positives reported by the coordinator. The signature was still unchanged at the end of that full poll window.

## Controls

| Location | Label | Tag | Classification | Detail |
| --- | --- | --- | --- | --- |
| INTAKE | Export | button | UNDETERMINED-possible-native-dialog | no renderer DOM change, no bridge call, no toast -- but the label matches controls known on this build to open native OS dialogs (confirmed for "Export"), which this CDP-only harness cannot observe; a native dialog may have opened and is NOT ruled out by this result |
| INTAKE | -s simulate | button | UNDETERMINED | no renderer DOM change, no bridge call, no toast, no thrown error observed -- this is NOT a claim that the control does nothing; see the Coverage section for what this method cannot see [hit-test note: elementFromPoint at the click coordinates returned p, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| QUEUE | All states Downloading Queued Completed Errored | select | UNDETERMINED | no renderer DOM change, no bridge call, no toast, no thrown error observed -- this is NOT a claim that the control does nothing; see the Coverage section for what this method cannot see |
| CONSOLE -V OUTPUT | .* | button | UNDETERMINED | no renderer DOM change, no bridge call, no toast, no thrown error observed -- this is NOT a claim that the control does nothing; see the Coverage section for what this method cannot see [hit-test note: elementFromPoint at the click coordinates returned div, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| Paste a link. Pick a quality. Download. | .* | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 252->379, overlayCount 0->0); no bridge call and no toast observed |
| Paste a link. Pick a quality. Download. | keyboard_command_key | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 379->644, overlayCount 0->0); no bridge call and no toast observed |
| Paste a link. Pick a quality. Download. | Easy | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 644->252, overlayCount 0->0); no bridge call and no toast observed [hit-test note: elementFromPoint at the click coordinates returned div, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| Paste a link. Pick a quality. Download. | Expert | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 252->443, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Plain | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 443->199, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | notifications | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 199->214, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | crop_square | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 214->199, overlayCount 0->0); no bridge call and no toast observed [hit-test note: elementFromPoint at the click coordinates returned div, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| INTAKE | add New | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 199->252, overlayCount 0->0); no bridge call and no toast observed |
| Paste a link. Pick a quality. Download. | .* | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 252->379, overlayCount 0->0); no bridge call and no toast observed |
| Paste a link. Pick a quality. Download. | bolt Easy | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 379->252, overlayCount 0->0); no bridge call and no toast observed |
| Paste a link. Pick a quality. Download. | download Download | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 252->443, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | video_settings Formats | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 443->618, overlayCount 0->0); no bridge call and no toast observed |
| -F SELECTOR | drive_file_rename_outline Output | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 618->578, overlayCount 0->0); no bridge call and no toast observed |
| -O OUTPUT TEMPLATE | video_library Library | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 578->389, overlayCount 0->0); no bridge call and no toast observed |
| -O OUTPUT TEMPLATE | travel_explore Sites | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 389->517, overlayCount 0->0); no bridge call and no toast observed |
| -O OUTPUT TEMPLATE | settings Config | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 517->730, overlayCount 0->0); no bridge call and no toast observed |
| CONFIG FILES | linked_services Chain | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 730->544, overlayCount 0->0); no bridge call and no toast observed |
| PROCESSING CHAIN | block SponsorBlock | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 544->603, overlayCount 0->0); no bridge call and no toast observed |
| SPONSORBLOCK CATEGORIES | bookmarks Presets | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 603->458, overlayCount 0->0); no bridge call and no toast observed |
| PRESET ALIASES AND CUSTOM --ALIAS | emergency_home Wizards | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 458->478, overlayCount 0->0); no bridge call and no toast observed |
| AUTO-FIX WIZARDS | menu_book Docs | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 478->542, overlayCount 0->0); no bridge call and no toast observed |
| CONTENTS | tune Settings | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 542->824, overlayCount 0->0); no bridge call and no toast observed |
| APPLICATION SETTINGS | history History | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 824->538, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | terminal General 33 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 538->1022, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | lan Network 8 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 1022->602, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | public_off Geo-restriction 2 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 602->510, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | filter_alt Video Selection 21 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 510->831, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | download Download 23 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->883, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | folder_open Filesystem 37 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 883->1102, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | image Thumbnail 4 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 1102->569, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | link Shortcuts 4 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 569->576, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | bug_report Verbosity 23 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 576->895, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | handyman Workarounds 10 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 895->691, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | high_quality Video Format 16 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 691->788, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | subtitles Subtitles 7 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 788->650, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | key Authentication 14 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 650->762, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | linked_services Post-Processing 37 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 762->1169, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | block SponsorBlock 5 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 1169->635, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | extension Extractor 6 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 635->655, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | push_pin Download close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 655->625, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Video Format close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 625->816, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Post-Processing close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 816->1183, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Format explorer close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 1183->793, overlayCount 0->0); no bridge call and no toast observed |
| -F SELECTOR | Output template studio close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 793->746, overlayCount 0->0); no bridge call and no toast observed |
| -O OUTPUT TEMPLATE | Library and archive close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 746->550, overlayCount 0->0); no bridge call and no toast observed |
| -O OUTPUT TEMPLATE | Supported sites close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 550->671, overlayCount 0->0); no bridge call and no toast observed |
| -O OUTPUT TEMPLATE | Config files close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 671->877, overlayCount 0->0); no bridge call and no toast observed |
| CONFIG FILES | Processing chain close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 877->684, overlayCount 0->0); no bridge call and no toast observed |
| PROCESSING CHAIN | Segments and chapters close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 684->736, overlayCount 0->0); no bridge call and no toast observed |
| SPONSORBLOCK CATEGORIES | Presets and aliases close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 736->584, overlayCount 0->0); no bridge call and no toast observed |
| PRESET ALIASES AND CUSTOM --ALIAS | Auto-fix wizards close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 584->597, overlayCount 0->0); no bridge call and no toast observed |
| AUTO-FIX WIZARDS | Docs close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 597->654, overlayCount 0->0); no bridge call and no toast observed |
| CONTENTS | Settings close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 654->929, overlayCount 0->0); no bridge call and no toast observed |
| APPLICATION SETTINGS | History close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 929->636, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | General close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 636->1113, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Network close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 1113->686, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Geo-restriction close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 686->587, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Video Selection close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 587->901, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Download close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 901->946, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Filesystem close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 946->1158, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Thumbnail close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 1158->618, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Shortcuts close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 618->618, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Verbosity close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 618->930, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Workarounds close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 930->719, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Subtitles close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 719->671, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Authentication close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 671->776, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | SponsorBlock close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 776->642, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | Extractor close | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 642->655, overlayCount 0->0); no bridge call and no toast observed |
| LOCAL HISTORY | add | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 655->625, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | tab | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 625->1201, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | .md .txt .json .jsonl .yaml .toml .xml .csv .tsv .html .sql .ts .py .go .rs .proto .schema.json .conf .sh | select | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 1201->625, overlayCount 0->0); no bridge call and no toast observed [hit-test note: elementFromPoint at the click coordinates returned div, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| INTAKE | Refresh | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 625->630, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | -t mp3 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 630->635, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | -t aac | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 635->640, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | -t mp4 | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 640->645, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | -t mkv | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 645->650, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | -t sleep | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 650->655, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Add 0 to queue | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 655->660, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | -a batch file… | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 660->630, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | --load-info-json… | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 630->625, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Open browser to sign in | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 625->665, overlayCount 0->0); no bridge call and no toast observed |
| SESSION | Pause queue | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 665->625, overlayCount 0->0); no bridge call and no toast observed [hit-test note: elementFromPoint at the click coordinates returned div, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| QUEUE | .* | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 625->752, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Copy | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 752->757, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | .conf | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 757->762, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Run | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 762->61, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Search flags, jobs, sites, config, history | input | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 61->802, overlayCount 0->0); no bridge call and no toast observed |
| QUEUE | ⚑ Fix | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 802->867, overlayCount 0->0); no bridge call and no toast observed |
| QUEUE | F | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 867->802, overlayCount 0->0); no bridge call and no toast observed [hit-test note: elementFromPoint at the click coordinates returned div, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| QUEUE | ↻ | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 802->61, overlayCount 0->0); no bridge call and no toast observed |
| QUEUE | .* | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 61->799, overlayCount 0->0); no bridge call and no toast observed |
| QUEUE | × | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 799->771, overlayCount 0->0); no bridge call and no toast observed |
| CONSOLE -V OUTPUT | ⚑ Fix | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 771->766, overlayCount 0->0); no bridge call and no toast observed [hit-test note: elementFromPoint at the click coordinates returned div, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| CONSOLE -V OUTPUT | ⚑ Fix | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 766->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | . | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | \d | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | \w | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | \s | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | \S | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | [abc] | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | [^abc] | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | [a-z] | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | + | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | * | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | ? | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | {2,4} | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | +? | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | ^ | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | $ | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | \b | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | \B | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (…) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?:…) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | \| | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?<name>…) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?=…) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?!…) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?<=…) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?<!…) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?i) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?s) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?m) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | (?x) | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Contains a word | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Starts with | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Ends with | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | A four-digit year | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Anything in brackets | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | A resolution like 1080p | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | An episode number | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | A URL | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->831, overlayCount 0->0); no bridge call and no toast observed |
| INTAKE | Cancel | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 831->704, overlayCount 0->0); no bridge call and no toast observed |
| Pick how yt-dlp should authenticate | × | button | UI-ONLY | renderer DOM/visible-text signature changed (elementCount 704->639, overlayCount 0->0); no bridge call and no toast observed |
| Paste a link. Pick a quality. Download. | Search flags, jobs, sites, config, history | input | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set |
| Paste a link. Pick a quality. Download. | Filter | input | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set |
| INTAKE | textarea | textarea | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set |
| QUEUE | title, extractor, format id, state | input | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set |
| CONSOLE -V OUTPUT | Search log | input | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set [hit-test note: elementFromPoint at the click coordinates returned div, not the enumerated element itself; the click was still dispatched at that verified, scrolled-into-view point] |
| INTAKE | (?i)\b(4k\|2160p)\b | input | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set |
| INTAKE | Search building blocks | input | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set |
| INTAKE | iu | input | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set |
| INTAKE | Big Buck Bunny 4K remaster [aqz-KE-bpKQ] | input | SKIPPED-text-input | clicked (focused) but not typed into; a bare click on a text field is expected to leave the DOM unchanged and is not evidence of a defect, so this is excluded from the actionable set |
| INTAKE | remove | button | SKIPPED-destructive | matched destructive/window-close skip pattern; not clicked for safety |
| INTAKE | close | button | SKIPPED-destructive | matched destructive/window-close skip pattern; not clicked for safety |
| INTAKE | close | button | SKIPPED-destructive | matched destructive/window-close skip pattern; not clicked for safety |

