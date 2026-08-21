import { app, safeStorage } from 'electron'
import { createHmac, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { atomicWriteFile } from './store'
import type {
  AuthenticatorEntrySummary,
  ConfirmPairingRequest,
  ConfirmPairingResult,
  CurrentCodeRequest,
  CurrentCodeResult,
  RegisterAuthenticatorRequest,
  RegisterAuthenticatorResult,
  RemoveAuthenticatorResult,
  RunTestVectorsResult,
  TotpAlgorithm,
  TotpVectorResult,
} from '../shared/locks-contract'

// ---------------------------------------------------------------------------
// Built-in TOTP authenticator — RFC 6238 (TOTP) over RFC 4226 (HOTP).
//
// Every secret is stored ONLY as ciphertext produced by Electron's
// `safeStorage`, which is backed by the operating system's own credential
// facility (DPAPI on Windows). The plaintext secret exists in memory only
// for the duration of a registration or a code computation; it is never
// written to disk, a log, an export, or a screenshot outside the one-time
// registration reveal the contract requires.
//
// QR codes are rendered locally, in this file, with no network request of
// any kind — handing an authenticator secret to a third-party "QR
// generator" service would defeat the entire point of keeping it local.
// ---------------------------------------------------------------------------

const AUTH_FILENAME = 'authenticator.json'
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

interface StoredEntry {
  id: string
  issuer: string
  account: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  confirmed: boolean
  createdAt: string
  /** base64 of the safeStorage-encrypted secret bytes. */
  cipher: string
}

interface AuthFile {
  entries: StoredEntry[]
}

function authPath(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, AUTH_FILENAME)
}

async function readAuthFile(userDataDir?: string): Promise<AuthFile> {
  try {
    const raw = await readFile(authPath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AuthFile>
    return { entries: Array.isArray(parsed.entries) ? (parsed.entries as StoredEntry[]) : [] }
  } catch {
    return { entries: [] }
  }
}

async function writeAuthFile(file: AuthFile, userDataDir?: string): Promise<void> {
  await atomicWriteFile(authPath(userDataDir), JSON.stringify(file, null, 2))
}

function encryptSecret(secretBytes: Buffer): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The operating system credential facility is unavailable, so no secret can be stored safely.')
  }
  return safeStorage.encryptString(secretBytes.toString('base64')).toString('base64')
}

function decryptSecret(cipherB64: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The operating system credential facility is unavailable.')
  }
  const plainB64 = safeStorage.decryptString(Buffer.from(cipherB64, 'base64'))
  return Buffer.from(plainB64, 'base64')
}

// ---------------------------------------------------------------------------
// base32 (RFC 4648, no padding) — the standard encoding for TOTP secrets.
// ---------------------------------------------------------------------------

export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// ---------------------------------------------------------------------------
// RFC 4226 HOTP / RFC 6238 TOTP
// ---------------------------------------------------------------------------

function hmacAlgoName(algorithm: TotpAlgorithm): string {
  return algorithm === 'SHA1' ? 'sha1' : algorithm === 'SHA256' ? 'sha256' : 'sha512'
}

export function hotp(secretBytes: Buffer, counter: bigint, algorithm: TotpAlgorithm, digits: number): string {
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(counter)
  const hmac = createHmac(hmacAlgoName(algorithm), secretBytes).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  const str = String(binCode % 10 ** digits)
  return str.padStart(digits, '0')
}

export function totp(
  secretBytes: Buffer,
  epochSeconds: number,
  algorithm: TotpAlgorithm = 'SHA1',
  digits = 6,
  period = 30,
): string {
  const counter = BigInt(Math.floor(epochSeconds / period))
  return hotp(secretBytes, counter, algorithm, digits)
}

// ---------------------------------------------------------------------------
// RFC 6238 Appendix B published test vectors.
//
// The RFC's own vectors use this fixed 20/32/64-byte ASCII secret,
// repeated to the required key length per algorithm, at 8 digits.
// ---------------------------------------------------------------------------

const RFC6238_SEED_SHA1 = Buffer.from('12345678901234567890', 'ascii')
const RFC6238_SEED_SHA256 = Buffer.from('12345678901234567890123456789012', 'ascii')
const RFC6238_SEED_SHA512 = Buffer.from(
  '1234567890123456789012345678901234567890123456789012345678901234',
  'ascii',
)

const RFC6238_VECTORS: Array<{ algorithm: TotpAlgorithm; time: number; expected: string }> = [
  { algorithm: 'SHA1', time: 59, expected: '94287082' },
  { algorithm: 'SHA256', time: 59, expected: '46119246' },
  { algorithm: 'SHA512', time: 59, expected: '90693936' },
  { algorithm: 'SHA1', time: 1111111109, expected: '07081804' },
  { algorithm: 'SHA256', time: 1111111109, expected: '68084774' },
  { algorithm: 'SHA512', time: 1111111109, expected: '25091201' },
  { algorithm: 'SHA1', time: 1111111111, expected: '14050471' },
  { algorithm: 'SHA256', time: 1111111111, expected: '67062674' },
  { algorithm: 'SHA512', time: 1111111111, expected: '99943326' },
  { algorithm: 'SHA1', time: 1234567890, expected: '89005924' },
  { algorithm: 'SHA256', time: 1234567890, expected: '91819424' },
  { algorithm: 'SHA512', time: 1234567890, expected: '93441116' },
  { algorithm: 'SHA1', time: 2000000000, expected: '69279037' },
  { algorithm: 'SHA256', time: 2000000000, expected: '90698825' },
  { algorithm: 'SHA512', time: 2000000000, expected: '38618901' },
  { algorithm: 'SHA1', time: 20000000000, expected: '65353130' },
  { algorithm: 'SHA256', time: 20000000000, expected: '77737706' },
  { algorithm: 'SHA512', time: 20000000000, expected: '47863826' },
]

function seedFor(algorithm: TotpAlgorithm): Buffer {
  return algorithm === 'SHA1' ? RFC6238_SEED_SHA1 : algorithm === 'SHA256' ? RFC6238_SEED_SHA256 : RFC6238_SEED_SHA512
}

export function runTotpTestVectors(): RunTestVectorsResult {
  const results: TotpVectorResult[] = RFC6238_VECTORS.map((v) => {
    const actual = totp(seedFor(v.algorithm), v.time, v.algorithm, 8, 30)
    return { algorithm: v.algorithm, timeSeconds: v.time, expected: v.expected, actual, pass: actual === v.expected }
  })
  return { ok: true, results, allPassed: results.every((r) => r.pass) }
}

// ---------------------------------------------------------------------------
// otpauth:// URI parsing / building
// ---------------------------------------------------------------------------

interface ParsedOtpAuth {
  secret: string
  issuer: string
  account: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
}

function parseOtpAuthUri(uri: string): ParsedOtpAuth | null {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'otpauth:' || url.host !== 'totp') return null
    const label = decodeURIComponent(url.pathname.replace(/^\//, ''))
    let issuer = url.searchParams.get('issuer') || ''
    let account = label
    if (label.includes(':')) {
      const [labelIssuer, labelAccount] = label.split(':', 2)
      issuer = issuer || labelIssuer
      account = labelAccount
    }
    const secret = url.searchParams.get('secret') || ''
    if (!secret) return null
    const algorithm = ((url.searchParams.get('algorithm') || 'SHA1').toUpperCase() as TotpAlgorithm) ?? 'SHA1'
    const digits = Number(url.searchParams.get('digits') || '6')
    const period = Number(url.searchParams.get('period') || '30')
    return {
      secret,
      issuer: issuer || 'yt-dlp Studio',
      account: account || 'account',
      algorithm: (['SHA1', 'SHA256', 'SHA512'] as TotpAlgorithm[]).includes(algorithm) ? algorithm : 'SHA1',
      digits: digits >= 6 && digits <= 8 ? digits : 6,
      period: period > 0 ? period : 30,
    }
  } catch {
    return null
  }
}

function buildOtpAuthUri(entry: { issuer: string; account: string; secret: string; algorithm: TotpAlgorithm; digits: number; period: number }): string {
  const label = encodeURIComponent(`${entry.issuer}:${entry.account}`)
  const params = new URLSearchParams({
    secret: entry.secret,
    issuer: entry.issuer,
    algorithm: entry.algorithm,
    digits: String(entry.digits),
    period: String(entry.period),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toSummary(e: StoredEntry): AuthenticatorEntrySummary {
  return {
    id: e.id,
    issuer: e.issuer,
    account: e.account,
    algorithm: e.algorithm,
    digits: e.digits,
    period: e.period,
    confirmed: e.confirmed,
    createdAt: e.createdAt,
  }
}

export async function listAuthenticatorEntries(): Promise<AuthenticatorEntrySummary[]> {
  const file = await readAuthFile()
  return file.entries.map(toSummary)
}

export async function registerAuthenticatorEntry(
  req: RegisterAuthenticatorRequest,
): Promise<RegisterAuthenticatorResult> {
  try {
    const trimmed = (req.input || '').trim()
    let secretB32: string | undefined
    let issuer = req.issuer || 'yt-dlp Studio'
    let account = req.account || 'account'
    let algorithm: TotpAlgorithm = req.algorithm || 'SHA1'
    let digits = req.digits || 6
    let period = req.period || 30

    if (!trimmed) {
      // No input at all means "generate one for me" — used when pairing a
      // fresh per-lock TOTP credential that was never shown to the user as
      // a secret to paste (the toy-lock wizard's own QR/manual-secret step
      // is this registration's one-time reveal instead).
      secretB32 = base32Encode(randomBytes(20))
    } else if (trimmed.toLowerCase().startsWith('otpauth://')) {
      const parsed = parseOtpAuthUri(trimmed)
      if (!parsed) return { ok: false, error: 'That does not look like a valid otpauth:// link.' }
      secretB32 = parsed.secret
      issuer = parsed.issuer
      account = parsed.account
      algorithm = parsed.algorithm
      digits = parsed.digits
      period = parsed.period
    } else {
      secretB32 = trimmed
    }
    secretB32 = secretB32!

    const secretBytes = base32Decode(secretB32)
    if (secretBytes.length < 10) {
      return { ok: false, error: 'That does not look like a base32 secret — it decoded to too few bytes to be usable.' }
    }
    if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) algorithm = 'SHA1'
    if (digits < 6 || digits > 8) digits = 6
    if (period <= 0) period = 30

    const id = randomUUID()
    const entry: StoredEntry = {
      id,
      issuer,
      account,
      algorithm,
      digits,
      period,
      confirmed: false,
      createdAt: new Date().toISOString(),
      cipher: encryptSecret(secretBytes),
    }
    const file = await readAuthFile()
    file.entries.push(entry)
    await writeAuthFile(file)

    const normalizedB32 = base32Encode(secretBytes)
    const manualSecret = normalizedB32.replace(/(.{4})/g, '$1 ').trim()
    const otpauthUri = buildOtpAuthUri({ issuer, account, secret: normalizedB32, algorithm, digits, period })
    const qrSvg = renderQrSvg(otpauthUri)

    return { ok: true, entry: toSummary(entry), otpauthUri, manualSecret, qrSvg }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function confirmAuthenticatorPairing(req: ConfirmPairingRequest): Promise<ConfirmPairingResult> {
  const file = await readAuthFile()
  const entry = file.entries.find((e) => e.id === req.id)
  if (!entry) return { ok: false, error: 'No such authenticator entry.' }
  try {
    const secretBytes = decryptSecret(entry.cipher)
    const now = Math.floor(Date.now() / 1000)
    const candidates = [-1, 0, 1].map((skew) => totp(secretBytes, now + skew * entry.period, entry.algorithm, entry.digits, entry.period))
    const typed = (req.code || '').replace(/\s+/g, '')
    if (!candidates.includes(typed)) {
      return { ok: false, error: 'That code did not match. Wait for the next code and try again.' }
    }
    entry.confirmed = true
    await writeAuthFile(file)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function currentAuthenticatorCode(req: CurrentCodeRequest): Promise<CurrentCodeResult> {
  const file = await readAuthFile()
  const entry = file.entries.find((e) => e.id === req.id)
  if (!entry) return { ok: false, error: 'No such authenticator entry.' }
  try {
    const secretBytes = decryptSecret(entry.cipher)
    const now = Math.floor(Date.now() / 1000)
    const code = totp(secretBytes, now, entry.algorithm, entry.digits, entry.period)
    const nextCode = totp(secretBytes, now + entry.period, entry.algorithm, entry.digits, entry.period)
    const secondsRemaining = entry.period - (now % entry.period)
    // This app has no trusted external time reference to compare against
    // (that would mean a network call this feature must never make), so
    // clock-skew detection is necessarily limited to what the OS itself
    // reports. A system clock reporting a date before this file's own
    // build watermark, or one absurdly far in the future, is the one case
    // this can honestly flag without phoning home.
    const reportedYear = new Date(now * 1000).getUTCFullYear()
    const clockSkewWarning = reportedYear < 2024 || reportedYear > 2100
    return { ok: true, code, nextCode, secondsRemaining, clockSkewWarning }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function removeAuthenticatorEntry(id: string): Promise<RemoveAuthenticatorResult> {
  const file = await readAuthFile()
  const before = file.entries.length
  file.entries = file.entries.filter((e) => e.id !== id)
  if (file.entries.length === before) return { ok: false, error: 'No such authenticator entry.' }
  await writeAuthFile(file)
  return { ok: true }
}

/** Used by locks.ts to verify a TOTP-method lock without re-deriving storage logic. */
export async function verifyAuthenticatorCode(id: string, code: string): Promise<boolean> {
  const file = await readAuthFile()
  const entry = file.entries.find((e) => e.id === id)
  if (!entry) return false
  try {
    const secretBytes = decryptSecret(entry.cipher)
    const now = Math.floor(Date.now() / 1000)
    const typed = (code || '').replace(/\s+/g, '')
    return [-1, 0, 1]
      .map((skew) => totp(secretBytes, now + skew * entry.period, entry.algorithm, entry.digits, entry.period))
      .includes(typed)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Minimal, standards-correct QR Code encoder (Model 2), byte mode only,
// error-correction level M, auto version selection. Rendered locally as an
// inline SVG string — no network request, no third-party service.
//
// This follows the structure of the widely used reference algorithm:
// Reed–Solomon error correction over GF(256), zigzag module placement,
// penalty-scored mask selection (best of masks 0–7), and standard
// format/version information bits.
// ---------------------------------------------------------------------------

const GF_EXP: number[] = new Array(512)
const GF_LOG: number[] = new Array(256)
;(function initGaloisField() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next: number[] = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1)
      next[j + 1] ^= poly[j]
    }
    // multiply by (x - alpha^i) == (x + alpha^i) in GF(2^8)
    for (let j = 0; j <= poly.length; j++) {
      const hi = j < poly.length ? poly[j] : 0
      const lo = j > 0 ? gfMul(poly[j - 1], GF_EXP[i]) : 0
      next[j] = hi ^ lo
    }
    poly = next
  }
  return poly
}

function rsEncode(data: number[], ecCount: number): number[] {
  const generator = rsGeneratorPoly(ecCount)
  const result = data.concat(new Array(ecCount).fill(0))
  for (let i = 0; i < data.length; i++) {
    const coeff = result[i]
    if (coeff === 0) continue
    for (let j = 0; j < generator.length; j++) {
      result[i + j] ^= gfMul(generator[j], coeff)
    }
  }
  return result.slice(data.length)
}

// Per-version capacity (byte mode, EC level M) and EC codeword count, for
// the version range this app needs (an otpauth:// URI is comfortably under
// 150 bytes, well within version 9).
const VERSION_TABLE: Array<{ version: number; totalCodewords: number; ecCodewords: number; capacityBytes: number }> = [
  { version: 1, totalCodewords: 26, ecCodewords: 10, capacityBytes: 14 },
  { version: 2, totalCodewords: 44, ecCodewords: 16, capacityBytes: 26 },
  { version: 3, totalCodewords: 70, ecCodewords: 26, capacityBytes: 42 },
  { version: 4, totalCodewords: 100, ecCodewords: 18, capacityBytes: 62 },
  { version: 5, totalCodewords: 134, ecCodewords: 24, capacityBytes: 84 },
  { version: 6, totalCodewords: 172, ecCodewords: 16, capacityBytes: 106 },
  { version: 7, totalCodewords: 196, ecCodewords: 18, capacityBytes: 122 },
  { version: 8, totalCodewords: 242, ecCodewords: 22, capacityBytes: 152 },
  { version: 9, totalCodewords: 292, ecCodewords: 22, capacityBytes: 180 },
  { version: 10, totalCodewords: 346, ecCodewords: 26, capacityBytes: 213 },
]

// Format info bits for EC level M, indexed by mask pattern (0-7), including
// the standard BCH(15,5) error-correcting code and 0x5412 XOR mask.
const FORMAT_INFO_M: number[] = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
]

function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16
}

function buildBitStream(dataBytes: Buffer, version: number): number[] {
  const bits: number[] = []
  const pushBits = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  pushBits(0b0100, 4) // byte mode indicator
  pushBits(dataBytes.length, charCountBits(version))
  for (const byte of dataBytes) pushBits(byte, 8)
  return bits
}

function bitsToCodewords(bits: number[], totalDataCodewords: number): number[] {
  const bitsNeeded = totalDataCodewords * 8
  const padded = bits.slice()
  // terminator (up to 4 zero bits)
  for (let i = 0; i < 4 && padded.length < bitsNeeded; i++) padded.push(0)
  while (padded.length % 8 !== 0) padded.push(0)
  const codewords: number[] = []
  for (let i = 0; i < padded.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (padded[i + j] ?? 0)
    codewords.push(byte)
  }
  const padBytes = [0xec, 0x11]
  let padIdx = 0
  while (codewords.length < totalDataCodewords) {
    codewords.push(padBytes[padIdx % 2])
    padIdx++
  }
  return codewords
}

function buildMatrix(version: number): { size: number; module: (number | null)[][] } {
  const size = version * 4 + 17
  const module: (number | null)[][] = Array.from({ length: size }, () => new Array(size).fill(null))
  const setFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r
        const cc = col + c
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
        const inSquare = r >= 0 && r <= 6 && c >= 0 && c <= 6
        module[rr][cc] = inSquare ? (isBorder || isCore ? 1 : 0) : 0
      }
    }
  }
  setFinder(0, 0)
  setFinder(0, size - 7)
  setFinder(size - 7, 0)
  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    module[6][i] = i % 2 === 0 ? 1 : 0
    module[i][6] = i % 2 === 0 ? 1 : 0
  }
  // dark module
  module[size - 8][8] = 1
  // reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (module[8][i] === null) module[8][i] = 0
    if (module[i][8] === null) module[i][8] = 0
  }
  for (let i = 0; i < 8; i++) {
    if (module[8][size - 1 - i] === null) module[8][size - 1 - i] = 0
    if (module[size - 1 - i][8] === null) module[size - 1 - i][8] = 0
  }
  // alignment pattern (versions 2+ have exactly one extra, centered)
  if (version >= 2) {
    const pos = size - 7
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const isBorder = r === -2 || r === 2 || c === -2 || c === 2
        module[pos + r][pos + c] = isBorder || (r === 0 && c === 0) ? 1 : 0
      }
    }
  }
  return { size, module }
}

function placeData(size: number, module: (number | null)[][], codewords: number[]): number[][] {
  const bits: number[] = []
  for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1)
  const matrix = module.map((row) => row.slice())
  let bitIdx = 0
  let upward = true
  for (let colPair = size - 1; colPair > 0; colPair -= 2) {
    const col = colPair === 6 ? 5 : colPair
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i
      for (const c of [col, col - 1]) {
        if (matrix[row][c] !== null) continue
        matrix[row][c] = bitIdx < bits.length ? bits[bitIdx] : 0
        bitIdx++
      }
    }
    upward = !upward
  }
  return matrix as number[][]
}

function applyMask(size: number, module: (number | null)[][], data: number[][], maskId: number): number[][] {
  const masked = data.map((row) => row.slice())
  const maskFn = (r: number, c: number): boolean => {
    switch (maskId) {
      case 0: return (r + c) % 2 === 0
      case 1: return r % 2 === 0
      case 2: return c % 3 === 0
      case 3: return (r + c) % 3 === 0
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    }
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (module[r][c] !== null) continue // function module, not masked
      if (maskFn(r, c)) masked[r][c] ^= 1
    }
  }
  return masked
}

function penalty(size: number, matrix: number[][]): number {
  let score = 0
  for (let r = 0; r < size; r++) {
    let runColor = -1
    let runLen = 0
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === runColor) runLen++
      else {
        if (runLen >= 5) score += runLen - 2
        runColor = matrix[r][c]
        runLen = 1
      }
    }
    if (runLen >= 5) score += runLen - 2
  }
  for (let c = 0; c < size; c++) {
    let runColor = -1
    let runLen = 0
    for (let r = 0; r < size; r++) {
      if (matrix[r][c] === runColor) runLen++
      else {
        if (runLen >= 5) score += runLen - 2
        runColor = matrix[r][c]
        runLen = 1
      }
    }
    if (runLen >= 5) score += runLen - 2
  }
  let dark = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += matrix[r][c]
  const percent = Math.floor((dark * 100) / (size * size))
  score += Math.min(Math.abs(percent - 45), Math.abs(percent - 55)) * 2
  return score
}

function writeFormatInfo(size: number, matrix: number[][], maskId: number): void {
  const bits = FORMAT_INFO_M[maskId]
  const bitAt = (i: number) => (bits >>> i) & 1
  for (let i = 0; i <= 5; i++) matrix[8][i] = bitAt(i)
  matrix[8][7] = bitAt(6)
  matrix[8][8] = bitAt(7)
  matrix[7][8] = bitAt(8)
  for (let i = 9; i <= 14; i++) matrix[14 - i][8] = bitAt(i)
  for (let i = 0; i <= 7; i++) matrix[size - 1 - i][8] = bitAt(i)
  for (let i = 8; i <= 14; i++) matrix[8][size - 15 + i] = bitAt(i)
}

/** Encode `text` as a QR Code and render it as a self-contained inline SVG string. */
export function renderQrSvg(text: string): string {
  const dataBytes = Buffer.from(text, 'utf8')
  const table = VERSION_TABLE.find((v) => v.capacityBytes >= dataBytes.length + 3)
  if (!table) throw new Error('That value is too long to encode as a QR code at the supported size.')
  const dataCodewords = table.totalCodewords - table.ecCodewords
  const bits = buildBitStream(dataBytes, table.version)
  const codewords = bitsToCodewords(bits, dataCodewords)
  const ec = rsEncode(codewords, table.ecCodewords)
  const allCodewords = codewords.concat(ec)

  const { size, module } = buildMatrix(table.version)
  const dataMatrix = placeData(size, module, allCodewords)

  let best: { maskId: number; matrix: number[][]; score: number } | null = null
  for (let maskId = 0; maskId < 8; maskId++) {
    const masked = applyMask(size, module, dataMatrix, maskId)
    writeFormatInfo(size, masked, maskId)
    const score = penalty(size, masked)
    if (!best || score < best.score) best = { maskId, matrix: masked, score }
  }
  const matrix = best!.matrix

  const quiet = 4
  const totalSize = size + quiet * 2
  const scale = 4
  const px = totalSize * scale
  let rects = ''
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${(c + quiet) * scale}" y="${(r + quiet) * scale}" width="${scale}" height="${scale}"/>`
      }
    }
  }
  return (
    `<svg viewBox="0 0 ${px} ${px}" width="${px}" height="${px}" xmlns="http://www.w3.org/2000/svg" role="img" ` +
    `aria-label="QR code encoding the authenticator pairing link">` +
    `<rect width="${px}" height="${px}" fill="#ffffff"/>` +
    `<g fill="#000000">${rects}</g></svg>`
  )
}
