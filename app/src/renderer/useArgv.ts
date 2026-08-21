import { useMemo, useState } from 'react'
import type { FlagDef } from './catalog/ytdlp-flags'

/** Per-flag control state: bool -> on/off, everything else -> string value ('' = unset). */
export type ExpertState = Record<string, string | boolean>

/** Build the real argv (never a shell string) for the given flag values. */
export function buildArgvFromExpertState(state: ExpertState, flags: FlagDef[]): string[] {
  const argv: string[] = []
  for (const flag of flags) {
    const v = state[flag.f]
    if (flag.t === 'bool') {
      if (v === true) argv.push(flag.f)
      continue
    }
    if (typeof v === 'string' && v.trim() !== '') {
      argv.push(flag.f, v)
    }
  }
  return argv
}

export function useExpertState() {
  const [state, setState] = useState<ExpertState>({})
  const setFlag = (flag: string, value: string | boolean) => {
    setState((prev) => ({ ...prev, [flag]: value }))
  }
  return { state, setFlag }
}

export function useEasyState() {
  const [url, setUrl] = useState('')
  const [quality, setQuality] = useState('best')
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const [subtitles, setSubtitles] = useState(false)
  const [thumbnail, setThumbnail] = useState(false)

  const argv = useMemo(() => {
    const out: string[] = []
    if (quality === 'best') {
      // yt-dlp's own default; nothing to add.
    } else if (quality === 'audio-only') {
      out.push('-x', '--audio-format', 'mp3')
    } else if (quality === '1080p') {
      out.push('-S', 'res:1080')
    } else if (quality === '720p') {
      out.push('-S', 'res:720')
    }
    if (subtitles) out.push('--write-subs', '--write-auto-subs')
    if (thumbnail) out.push('--write-thumbnail')
    if (outputFolder) out.push('-P', outputFolder)
    if (url.trim()) out.push(url.trim())
    return out
  }, [url, quality, outputFolder, subtitles, thumbnail])

  return {
    url,
    setUrl,
    quality,
    setQuality,
    outputFolder,
    setOutputFolder,
    subtitles,
    setSubtitles,
    thumbnail,
    setThumbnail,
    argv,
  }
}
