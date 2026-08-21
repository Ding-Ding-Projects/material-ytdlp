// yt-dlp Studio Companion -- options page logic.
//
// One real, working setting: whether the popup requires a second click
// before firing the protocol handoff. Backed by chrome.storage.local (not
// .sync) so this never touches a Google account or leaves the machine.

const toggle = document.getElementById('confirmToggle')
const savedNote = document.getElementById('savedNote')

let savedNoteTimer = null

function showSaved() {
  savedNote.textContent = 'Saved.'
  clearTimeout(savedNoteTimer)
  savedNoteTimer = setTimeout(() => {
    savedNote.textContent = ''
  }, 1500)
}

async function load() {
  try {
    const stored = await chrome.storage.local.get('confirmBeforeSend')
    toggle.checked = !!stored.confirmBeforeSend
  } catch (err) {
    savedNote.textContent = 'Could not read saved settings: ' + (err && err.message ? err.message : String(err))
    savedNote.className = 'status-line status-error'
  }
}

toggle.addEventListener('change', async () => {
  try {
    await chrome.storage.local.set({ confirmBeforeSend: toggle.checked })
    showSaved()
  } catch (err) {
    savedNote.textContent = 'Could not save: ' + (err && err.message ? err.message : String(err))
    savedNote.className = 'status-line status-error'
  }
})

load()
