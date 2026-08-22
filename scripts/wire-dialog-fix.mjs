// scripts/wire-dialog-fix.mjs
//
// Fixes a real generation-pipeline bug reported by the user as "dialogs not
// popping up": clicking the small open-in-new arrow next to an option row
// (Picture quality, File type, File names, ...) sets state.studio correctly
// -- confirmed by driving the packaged app over CDP and reading
// logic.renderVals().hasStudio back as `true` -- yet no popover ever reaches
// the DOM. No console error, no exception, no sc-has-error boundary either.
//
// Root cause, found by walking the generated HTML's <sc-if>/</sc-if>
// nesting depth by hand: `wireSchoolDialog()` in wire-tools-modes.mjs
// anchors on the literal opening tag of the (unrelated) auto-fix-wizard
// block --
//
//   const ANCHOR = '  <sc-if value="{{ hasWizard }}" hint-placeholder-val="{{ false }}">'
//
// -- and its DIALOG string already ends with `+ ANCHOR` (so the School
// mode enable/disable dialogs render immediately before the wizard block,
// same idiom wireTicketsDialogMarkup in wire-settings-actions.mjs uses
// correctly). But wireSchoolDialog's own `return` statement ALSO does
// `replaceExact(html, ANCHOR, DIALOG + ANCHOR)` -- appending ANCHOR a
// SECOND time. The generated HTML ends up with the hasWizard opening tag
// written twice back to back, with no closing tag between them:
//
//   <sc-if value="{{ hasWizard }}" ...>  <sc-if value="{{ hasWizard }}" ...>
//
// Browsers do not auto-close an unrecognized custom element like <sc-if>,
// so this doubled tag is a genuine extra, unclosed level of nesting: it
// silently wraps every single thing that comes after it in the document --
// the flag-editor "studio" popover (hasStudio), the toy-lock wizard
// (hasLockWizard), and everything else physically below that point --
// inside an ADDITIONAL `hasWizard` conditional that is false whenever no
// auto-fix wizard is open. hasStudio computes true, but the actual DOM
// node tree it would render into is a child of a currently-closed
// ancestor, so nothing appears -- exactly the reported symptom, and
// exactly why it throws nothing: the render is completely correct given
// the (accidentally) doubled condition it is nested under.
//
// This lane does not own wire-tools-modes.mjs, so the root cause is fixed
// here instead: run LAST (after wireToolsModes has already produced the
// duplicate) and collapse the doubled opening tag back down to one, which
// restores the exact nesting the design source has. Fails loudly via the
// shared `replaceExact` if the duplicate is not found exactly once -- if a
// future change to wire-tools-modes.mjs fixes the root cause directly,
// this needle stops matching and the build tells you so instead of
// silently doing nothing.
//
// See docs/features/downloading/open-and-reveal.md for the write-up and
// the CDP reproduction steps.

const HAS_WIZARD_ANCHOR = '  <sc-if value="{{ hasWizard }}" hint-placeholder-val="{{ false }}">'

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireDialogFix(html, replaceExact) {
  return collapseDoubledHasWizardAnchor(html, replaceExact)
}

function collapseDoubledHasWizardAnchor(html, replaceExact) {
  const doubled = HAS_WIZARD_ANCHOR + HAS_WIZARD_ANCHOR
  return replaceExact(html, doubled, HAS_WIZARD_ANCHOR)
}
