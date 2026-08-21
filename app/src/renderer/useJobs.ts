import { useEffect, useRef, useState } from 'react'
import { getBridge } from './bridge'
import type { JobLogEvent, JobRecord, StartJobRequest } from '../shared/ipc-contract'

export interface ConsoleLine extends JobLogEvent {
  ts: number
}

/**
 * Owns the live job list and console log, fed by the real preload bridge
 * subscriptions (job:progress / job:log / job:state) rather than any
 * simulated timer. Falls back to an empty, honestly-inert state when the
 * bridge is unavailable (e.g. this file opened outside Electron).
 */
export function useJobs() {
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [logs, setLogs] = useState<ConsoleLine[]>([])
  const bridgeRef = useRef(getBridge())

  useEffect(() => {
    const bridge = bridgeRef.current
    if (!bridge) return

    let cancelled = false
    bridge.jobs
      .list()
      .then((list) => {
        if (!cancelled) setJobs(list)
      })
      .catch(() => {})

    const unsubProgress = bridge.jobs.onProgress(({ id, progress }) => {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, progress, updatedAt: Date.now() } : j)))
    })
    const unsubLog = bridge.jobs.onLog((event) => {
      setLogs((prev) => [...prev.slice(-999), { ...event, ts: Date.now() }])
    })
    const unsubState = bridge.jobs.onState(({ id, state, exitCode }) => {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, state, exitCode, updatedAt: Date.now() } : j)))
    })

    return () => {
      cancelled = true
      unsubProgress()
      unsubLog()
      unsubState()
    }
  }, [])

  const start = async (req: StartJobRequest) => {
    const bridge = bridgeRef.current
    if (!bridge) return
    const record = await bridge.jobs.start(req)
    setJobs((prev) => [...prev, record])
  }

  const cancel = (id: string) => bridgeRef.current?.jobs.cancel(id)
  const retry = (id: string) => bridgeRef.current?.jobs.retry(id)
  const remove = (id: string) => {
    bridgeRef.current?.jobs.remove(id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }
  const pause = (id: string) => bridgeRef.current?.jobs.pause(id)
  const resume = (id: string) => bridgeRef.current?.jobs.resume(id)

  return { jobs, logs, start, cancel, retry, remove, pause, resume, bridgeAvailable: !!bridgeRef.current }
}
