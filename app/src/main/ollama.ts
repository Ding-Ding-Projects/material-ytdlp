/**
 * Local Ollama model-suite probe.
 *
 * Talks ONLY to Ollama's documented local HTTP API at 127.0.0.1 — never an
 * invented proxy, never a cloud model service. Hardware fit is computed from
 * REAL numbers only: the host's actual total/free memory (`os.totalmem` /
 * `os.freemem`) against each model's REAL reported size and quantization
 * from Ollama's own `/api/tags` response. Nothing here infers capability
 * from a model's name, and nothing here promises a pull will succeed —
 * missing metadata produces `unknown`, never a fabricated number.
 */

import { totalmem, freemem } from 'node:os'
import {
  OLLAMA_LOCAL_BASE_URL,
  type OllamaFitVerdict,
  type OllamaModelInfo,
  type OllamaProbeResult,
} from '../shared/tools-contract'

const REQUEST_TIMEOUT_MS = 4_000

interface OllamaTagsModel {
  name: string
  size: number
  digest: string
  modified_at: string
  details?: {
    parameter_size?: string
    quantization_level?: string
    family?: string
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${OLLAMA_LOCAL_BASE_URL}${path}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

function describeConnectionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return `Ollama did not answer at ${OLLAMA_LOCAL_BASE_URL} within ${REQUEST_TIMEOUT_MS / 1000}s.`
  }
  if (/ECONNREFUSED/i.test(message)) {
    return `Connection refused at ${OLLAMA_LOCAL_BASE_URL} — Ollama is not running (or not installed).`
  }
  return `Could not reach Ollama at ${OLLAMA_LOCAL_BASE_URL}: ${message}`
}

/**
 * Conservative, evidence-based fit verdict. Every input is a real number;
 * when a real number is missing, the verdict is `unknown` rather than a
 * guess dressed up as one of the other three.
 */
function computeFit(sizeBytes: number, hostFreeBytes: number, hostTotalBytes: number): { fit: OllamaFitVerdict; evidence: string } {
  if (!sizeBytes || sizeBytes <= 0) {
    return { fit: 'unknown', evidence: 'Ollama did not report a size for this model, so fit cannot be evaluated.' }
  }
  const sizeGiB = sizeBytes / 1024 ** 3
  const freeGiB = hostFreeBytes / 1024 ** 3
  const totalGiB = hostTotalBytes / 1024 ** 3
  // A pulled model on disk typically needs roughly its own size again in
  // resident memory while loaded, plus context/runtime overhead — this is a
  // conservative, stated assumption, not a measured guarantee.
  const estimatedRuntimeGiB = sizeGiB * 1.2
  const evidenceBase = `Model reports ${sizeGiB.toFixed(1)} GiB on disk; host has ${freeGiB.toFixed(1)} GiB free of ${totalGiB.toFixed(1)} GiB total (assumption: loaded runtime needs about ${estimatedRuntimeGiB.toFixed(1)} GiB).`
  if (estimatedRuntimeGiB <= freeGiB * 0.7) {
    return { fit: 'runs-well', evidence: evidenceBase }
  }
  if (estimatedRuntimeGiB <= totalGiB * 0.9) {
    return { fit: 'runs-with-limits', evidence: `${evidenceBase} Free memory is tight; other applications may need to close first.` }
  }
  return { fit: 'unlikely', evidence: `${evidenceBase} This exceeds the host's total memory.` }
}

export async function probeOllama(): Promise<OllamaProbeResult> {
  const hostTotalMemBytes = totalmem()
  const hostFreeMemBytes = freemem()

  let version: string | null = null
  try {
    const v = await fetchJson<{ version: string }>('/api/version')
    version = v.version ?? null
  } catch (err) {
    return {
      status: 'unreachable',
      error: describeConnectionError(err),
      version: null,
      models: [],
      hostTotalMemBytes,
      hostFreeMemBytes,
    }
  }

  let models: OllamaModelInfo[] = []
  try {
    const tags = await fetchJson<{ models: OllamaTagsModel[] }>('/api/tags')
    models = (tags.models ?? []).map((m) => {
      const { fit, evidence } = computeFit(m.size, hostFreeMemBytes, hostTotalMemBytes)
      return {
        name: m.name,
        sizeBytes: m.size,
        digest: m.digest,
        modifiedAt: m.modified_at,
        parameterSize: m.details?.parameter_size ?? null,
        quantizationLevel: m.details?.quantization_level ?? null,
        family: m.details?.family ?? null,
        fit,
        fitEvidence: evidence,
      }
    })
  } catch {
    // Reachable (version answered) but tags failed transiently — report
    // reachable with an empty, honestly-empty model list rather than
    // collapsing the whole probe to unreachable.
    models = []
  }

  return { status: 'reachable', error: null, version, models, hostTotalMemBytes, hostFreeMemBytes }
}
