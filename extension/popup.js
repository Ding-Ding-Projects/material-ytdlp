// yt-dlp Studio Companion -- popup logic.
//
// The whole job of this file: read the current tab's URL, and if it looks
// like a real page, hand it to the desktop app over the ytdlp-studio://
// custom protocol. See extension/README.md (and
// docs/features/browser-extension/) for why a custom protocol rather than
// native messaging or a local HTTP server, and app/src/main/protocol.ts for
// the receiving end.
//
// This never uses chrome.tabs.update() to navigate the real page tab --
// that would leave the video page and replace it with a failed navigation
// attempt. Instead a hidden <a> inside THIS popup document is clicked,
// which is the standard way to trigger a custom-protocol handler prompt
// without touching the page the user is looking at.

const PROTOCOL_SCHEME = 'ytdlp-studio'
const HINT_DELAY_MS = 2200

const pageTitleEl = document.getElementById('pageTitle')
const pageUrlEl = document.getElementById('pageUrl')
const sendBtn = document.getElementById('sendBtn')
const statusEl = document.getElementById('status')
const hintEl = document.getElementById('hint')

let currentTabUrl = null
let currentTabTitle = null
let confirmArmed = false
let confirmArmTimer = null

function setStatus(text, cls) {
  statusEl.textContent = text || ''
  statusEl.className = 'status-line ' + (cls || 'status-hint')
}

function isDownloadableUrl(url) {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function buildProtocolUrl(pageUrl) {
  return `${PROTOCOL_SCHEME}://download?url=${encodeURIComponent(pageUrl)}`
}

// Fires the OS/browser "open this in yt-dlp Studio?" prompt without
// navigating anything the user is looking at. Extensions cannot observe
// whether this actually reached an installed handler -- Chrome gives no
// success/failure signal for a custom-protocol navigation attempt -- so
// this never claims to know. It always follows up with the honest hint
// below instead of pretending the click either definitely worked or
// definitely failed.
function triggerProtocolHandoff(pageUrl) {
  const link = document.createElement('a')
  link.href = buildProtocolUrl(pageUrl)
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function resetSendButton() {
  confirmArmed = false
  clearTimeout(confirmArmTimer)
  sendBtn.textContent = 'Send to yt-dlp Studio'
}

async function getConfirmBeforeSend() {
  try {
    const stored = await chrome.storage.local.get('confirmBeforeSend')
    return !!stored.confirmBeforeSend
  } catch {
    // storage should always be available given the declared permission, but
    // fail open to "no extra confirmation" rather than blocking the button.
    return false
  }
}

async function handleSendClick() {
  if (!currentTabUrl) return

  const confirmFirst = await getConfirmBeforeSend()
  if (confirmFirst && !confirmArmed) {
    confirmArmed = true
    sendBtn.textContent = 'Click again to confirm'
    setStatus('Confirmation is on in Options — click once more to send.', 'status-hint')
    clearTimeout(confirmArmTimer)
    confirmArmTimer = setTimeout(resetSendButton, 4000)
    return
  }

  resetSendButton()
  hintEl.classList.remove('show')
  triggerProtocolHandoff(currentTabUrl)
  setStatus('Sent to yt-dlp Studio.', 'status-ok')
  setTimeout(() => {
    hintEl.classList.add('show')
  }, HINT_DELAY_MS)
}

async function init() {
  sendBtn.addEventListener('click', handleSendClick)

  let tab = null
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    tab = tabs && tabs[0] ? tabs[0] : null
  } catch (err) {
    pageTitleEl.textContent = 'Could not read the current tab.'
    pageUrlEl.textContent = err && err.message ? err.message : String(err)
    return
  }

  if (!tab || !isDownloadableUrl(tab.url)) {
    pageTitleEl.textContent = "This page isn't a link this extension can send."
    pageUrlEl.textContent = tab && tab.url ? tab.url : 'Open a video page (http/https) first, then click the icon again.'
    sendBtn.disabled = true
    return
  }

  currentTabUrl = tab.url
  currentTabTitle = tab.title || tab.url
  pageTitleEl.textContent = currentTabTitle
  pageUrlEl.textContent = currentTabUrl
  sendBtn.disabled = false
}

init()
