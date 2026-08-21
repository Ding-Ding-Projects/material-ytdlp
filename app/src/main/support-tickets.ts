import { app, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './store'
import {
  type SupportTicket,
  type TicketCreateRequest,
  type TicketCreateResult,
  type TicketSeverity,
  type TicketStatus,
} from '../shared/settings-actions-contract'

// ---------------------------------------------------------------------------
// Support Tickets: a local-only, entirely fictional support desk. Its
// "resolution" is always the same, honest one — open this app's own local
// data folder in the platform file manager so the user can delete it
// themselves. It NEVER deletes anything on the user's behalf, and it NEVER
// makes a network request. See SUPPORT_TICKETS_DISCLOSURE in the shared
// contract for the exact disclosure line the renderer must show alongside
// every rendering of this surface.
// ---------------------------------------------------------------------------

const TICKETS_FILENAME = 'support-tickets.json'
const MAX_DESCRIPTION_LENGTH = 4_000
const MAX_CATEGORY_LENGTH = 200

interface TicketsFile {
  nextNumber: number
  tickets: SupportTicket[]
}

function ticketsPath(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, TICKETS_FILENAME)
}

async function readTicketsFile(userDataDir?: string): Promise<TicketsFile> {
  try {
    const raw = await readFile(ticketsPath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw) as Partial<TicketsFile>
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.nextNumber === 'number' &&
      Array.isArray(parsed.tickets)
    ) {
      return { nextNumber: parsed.nextNumber, tickets: parsed.tickets }
    }
  } catch {
    // Missing, unreadable, or corrupt — start fresh. This is a local toy
    // record, not durable state anything else depends on.
  }
  return { nextNumber: 1, tickets: [] }
}

async function writeTicketsFile(file: TicketsFile, userDataDir?: string): Promise<void> {
  await atomicWriteFile(ticketsPath(userDataDir), JSON.stringify(file, null, 2))
}

// A small, deterministic rotation so the "severity" reads as a bit — never
// randomised, so the same category always reads the same way and nothing
// here pretends to be a real triage system.
const SEVERITY_ROTATION: TicketSeverity[] = ['trivial', 'moderate', 'severe', 'catastrophic (not really)']
const STATUS_ROTATION: TicketStatus[] = ['received', 'triaged', 'the-fix-is-you', 'awaiting-your-click']

function pickFromRotation<T>(rotation: T[], seed: number): T {
  return rotation[Math.abs(seed) % rotation.length] as T
}

/**
 * Records a new local ticket. Validates and bounds the free-text fields
 * before storing; never touches the network, never touches another
 * process, and never deletes anything.
 */
export async function createSupportTicket(req: TicketCreateRequest, userDataDir?: string): Promise<TicketCreateResult> {
  const category = (req.category ?? '').trim().slice(0, MAX_CATEGORY_LENGTH)
  const description = (req.description ?? '').trim().slice(0, MAX_DESCRIPTION_LENGTH)
  if (category.length === 0) {
    return { ok: false, error: 'Pick a category before filing the ticket.', ticket: null }
  }
  if (description.length === 0) {
    return { ok: false, error: 'Describe what went wrong before filing the ticket.', ticket: null }
  }

  const file = await readTicketsFile(userDataDir)
  const number = `T-${String(file.nextNumber).padStart(4, '0')}`
  const ticket: SupportTicket = {
    id: `${Date.now()}-${file.nextNumber}`,
    number,
    category,
    description,
    severity: pickFromRotation(SEVERITY_ROTATION, file.nextNumber),
    status: pickFromRotation(STATUS_ROTATION, file.nextNumber + 1),
    createdAt: Date.now(),
  }
  const updated: TicketsFile = { nextNumber: file.nextNumber + 1, tickets: [ticket, ...file.tickets] }
  await writeTicketsFile(updated, userDataDir)
  return { ok: true, error: null, ticket }
}

/** Lists every locally recorded ticket, newest first. An unreadable or missing file yields an honest empty list. */
export async function listSupportTickets(userDataDir?: string): Promise<SupportTicket[]> {
  const file = await readTicketsFile(userDataDir)
  return file.tickets
}

/**
 * The one real action this surface performs: opens the app's own local data
 * folder in the platform file manager. Returns whether it actually
 * succeeded — `shell.openPath` resolves to a non-empty error string on
 * failure rather than rejecting, so that string is surfaced honestly
 * instead of being swallowed into a false "it worked".
 */
export async function openSupportDataFolder(userDataDir?: string): Promise<{ ok: boolean; error: string | null }> {
  const dir = userDataDir ?? app.getPath('userData')
  const errorMessage = await shell.openPath(dir)
  if (errorMessage) {
    return { ok: false, error: `Could not open the folder: ${errorMessage}` }
  }
  return { ok: true, error: null }
}
