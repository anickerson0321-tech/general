import type { ComposeRequest, MelodyNote, MonoBuffer, MusicalKey, ProgressFn, StereoBuffer, TimedLine } from '../types'
import type { PitchTrack, PolishParams } from '../dsp'

export interface LocalComposeOutput {
  mixMp3: Uint8Array
  instrumentalMp3: Uint8Array
  vocalsMp3?: Uint8Array
  melody: MelodyNote[]
  timedLyrics: TimedLine[]
  key: MusicalKey
  bpm: number
  durationSec: number
  tags: string[]
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onProgress?: ProgressFn
}

class PoolWorker {
  w: Worker
  busy = 0
  pending = new Map<number, Pending>()
  constructor() {
    this.w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    this.w.onmessage = (ev) => {
      const m = ev.data as { id: number; type: string; fraction?: number; label?: string; result?: unknown; error?: string }
      const p = this.pending.get(m.id)
      if (!p) return
      if (m.type === 'progress') p.onProgress?.(m.fraction ?? 0, m.label ?? '')
      else {
        this.pending.delete(m.id)
        this.busy--
        if (m.type === 'done') p.resolve(m.result)
        else p.reject(new Error(m.error || 'Worker error'))
      }
    }
    this.w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Worker crashed'))
      this.pending.clear()
      this.busy = 0
    }
  }
}

const POOL_SIZE = Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 2) - 1))
const pool: PoolWorker[] = []
let nextId = 1

function pick(): PoolWorker {
  if (pool.length < POOL_SIZE && pool.every((p) => p.busy > 0)) pool.push(new PoolWorker())
  if (!pool.length) pool.push(new PoolWorker())
  return pool.reduce((a, b) => (b.busy < a.busy ? b : a))
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[], onProgress?: ProgressFn): Promise<T> {
  const w = pick()
  const id = nextId++
  w.busy++
  return new Promise<T>((resolve, reject) => {
    w.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
    w.w.postMessage({ ...msg, id }, transfer)
  })
}

export function composeInWorker(req: ComposeRequest, onProgress?: ProgressFn) {
  return call<LocalComposeOutput>({ op: 'compose', req }, [], onProgress)
}

/** Note: input buffers are copied so callers keep theirs. */
export function analyzePitchInWorker(input: MonoBuffer, onProgress?: ProgressFn) {
  const copy = { sampleRate: input.sampleRate, data: new Float32Array(input.data) }
  return call<PitchTrack>({ op: 'analyzePitch', input: copy }, [copy.data.buffer], onProgress)
}

export function polishInWorker(input: MonoBuffer, params: PolishParams, opts: { mp3?: boolean } = {}, onProgress?: ProgressFn) {
  const copy = { sampleRate: input.sampleRate, data: new Float32Array(input.data) }
  const p: PolishParams = { ...params }
  if (p.analysis) p.analysis = { ...p.analysis, f0: new Float32Array(p.analysis.f0), confidence: new Float32Array(p.analysis.confidence) }
  return call<{ out: StereoBuffer; mp3?: Uint8Array }>({ op: 'polish', input: copy, params: p, mp3: opts.mp3 }, [copy.data.buffer], onProgress)
}

export function encodeMp3InWorker(input: StereoBuffer, kbps = 192, onProgress?: ProgressFn) {
  const copy = { sampleRate: input.sampleRate, left: new Float32Array(input.left), right: new Float32Array(input.right) }
  return call<Uint8Array>({ op: 'encodeMp3', input: copy, kbps }, [copy.left.buffer, copy.right.buffer], onProgress)
}

export function detectKeyInWorker(input: MonoBuffer) {
  const copy = { sampleRate: input.sampleRate, data: new Float32Array(input.data) }
  return call<MusicalKey>({ op: 'detectKey', input: copy }, [copy.data.buffer])
}
