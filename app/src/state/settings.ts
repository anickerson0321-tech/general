import type { EngineId } from './models'

export interface Settings {
  /** default engine for new songs */
  engine: EngineId
  keys: Partial<Record<Exclude<EngineId, 'local'>, string>>
  /** optional CORS proxy base URL (e.g. a Supabase edge function) for providers that block browsers */
  proxyUrl: string
  displayName: string
  /** default mic settings */
  echoCancellation: boolean
  /** extra latency compensation in ms, from the calibration tool */
  latencyMs: number
  autoTitle: boolean
}

const KEY = 'encore.settings.v1'

export const defaultSettings: Settings = {
  engine: 'local',
  keys: {},
  proxyUrl: '',
  displayName: 'You',
  echoCancellation: false,
  latencyMs: 0,
  autoTitle: true,
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaultSettings, ...JSON.parse(raw), keys: { ...JSON.parse(raw).keys } }
  } catch {
    /* ignore */
  }
  return { ...defaultSettings }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}
