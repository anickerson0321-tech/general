// Pitch-track conditioning and note segmentation shared by the tuner and PSOLA.

import type { MelodyNote } from '../types'
import type { PitchTrack } from './pitch'
import { hzToMidi } from './pitch'

export interface CleanTrack {
  hopSec: number
  n: number
  /** fractional MIDI per frame (0 where unvoiced) */
  midi: Float32Array
  /** Hz per frame (0 where unvoiced) — bridged/cleaned, used to drive PSOLA */
  f0: Float32Array
  voiced: Uint8Array
  conf: Float32Array
}

export interface Run {
  a: number // first frame
  b: number // one past last frame
}

export function voicedRuns(voiced: Uint8Array): Run[] {
  const runs: Run[] = []
  let i = 0
  const n = voiced.length
  while (i < n) {
    if (!voiced[i]) {
      i++
      continue
    }
    let j = i
    while (j < n && voiced[j]) j++
    runs.push({ a: i, b: j })
    i = j
  }
  return runs
}

export interface PrepareOptions {
  minConf?: number
  bridgeSec?: number
  minRunSec?: number
}

/** Clean a raw pitch track: confidence gating, octave-blip repair, gap bridging. */
export function prepareTrack(track: PitchTrack, opts: PrepareOptions = {}): CleanTrack {
  const minConf = opts.minConf ?? 0.35
  const hop = track.hopSec
  const n = track.f0.length
  const midi = new Float32Array(n)
  const voiced = new Uint8Array(n)
  const conf = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const f = track.f0[i]
    const c = track.confidence[i]
    if (f > 30 && f < 2500 && c >= minConf && f === f) {
      voiced[i] = 1
      midi[i] = hzToMidi(f)
      conf[i] = c
    }
  }
  // octave / gross-error repair against a running median (9 frames)
  const runs0 = voicedRuns(voiced)
  const win: number[] = []
  for (const r of runs0) {
    if (r.b - r.a < 5) continue
    const fixed = new Float32Array(r.b - r.a)
    for (let i = r.a; i < r.b; i++) {
      win.length = 0
      for (let j = Math.max(r.a, i - 4); j < Math.min(r.b, i + 5); j++) win.push(midi[j])
      win.sort((x, y) => x - y)
      const med = win[win.length >> 1]
      const dv = midi[i] - med
      fixed[i - r.a] = Math.abs(dv) > 7 ? med + dv - 12 * Math.round(dv / 12) : midi[i]
    }
    midi.set(fixed, r.a)
  }
  // bridge short unvoiced gaps between runs whose ends are within 4 semitones
  const bridge = Math.max(1, Math.round((opts.bridgeSec ?? 0.045) / hop))
  let runs = voicedRuns(voiced)
  for (let k = 0; k + 1 < runs.length; k++) {
    const gap = runs[k + 1].a - runs[k].b
    if (gap > bridge) continue
    const m0 = midi[runs[k].b - 1]
    const m1 = midi[runs[k + 1].a]
    if (Math.abs(m0 - m1) > 4) continue
    const c = Math.max(0.5, Math.min(conf[runs[k].b - 1], conf[runs[k + 1].a]))
    for (let i = runs[k].b; i < runs[k + 1].a; i++) {
      const t = (i - runs[k].b + 1) / (gap + 1)
      midi[i] = m0 + (m1 - m0) * t
      voiced[i] = 1
      conf[i] = c
    }
  }
  // drop tiny runs
  const minRun = Math.max(1, Math.round((opts.minRunSec ?? 0.03) / hop))
  runs = voicedRuns(voiced)
  for (const r of runs) {
    if (r.b - r.a >= minRun) continue
    for (let i = r.a; i < r.b; i++) {
      voiced[i] = 0
      midi[i] = 0
      conf[i] = 0
    }
  }
  const f0 = new Float32Array(n)
  for (let i = 0; i < n; i++) f0[i] = voiced[i] ? 440 * Math.pow(2, (midi[i] - 69) / 12) : 0
  return { hopSec: hop, n, midi, f0, voiced, conf }
}

/** Edge-preserving vibrato removal: median filter (≈ one vibrato cycle) then a short moving average. */
export function noteCenterCurve(midi: Float32Array, run: Run, hopSec: number): Float32Array {
  const len = run.b - run.a
  const out = new Float32Array(len)
  const half = Math.max(1, Math.round(0.085 / hopSec))
  const win: number[] = []
  const med = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    win.length = 0
    const lo = Math.max(0, i - half)
    const hi = Math.min(len - 1, i + half)
    for (let j = lo; j <= hi; j++) win.push(midi[run.a + j])
    win.sort((x, y) => x - y)
    const m = win.length
    med[i] = m & 1 ? win[m >> 1] : 0.5 * (win[(m >> 1) - 1] + win[m >> 1])
  }
  const sh = Math.max(1, Math.round(0.02 / hopSec))
  for (let i = 0; i < len; i++) {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - sh); j <= Math.min(len - 1, i + sh); j++) {
      s += med[j]
      c++
    }
    out[i] = s / c
  }
  return out
}

export interface NoteSeg {
  a: number
  b: number
  /** median of the vibrato-free centre curve over the note (MIDI) */
  center: number
  transition: boolean
  /** chosen target pitch (MIDI) */
  target: number
  source: 'melody' | 'guide' | 'scale' | 'chromatic' | 'none'
}

export interface SegmentOptions {
  /** mark slow glides (scoops, slides) as transitions instead of notes */
  transitions: boolean
  minNoteSec?: number
}

/**
 * Split a voiced run into notes using hysteresis quantisation of the centre curve.
 * Returns segments in frame coordinates (absolute).
 */
export function segmentRun(center: Float32Array, run: Run, hopSec: number, opts: SegmentOptions): NoteSeg[] {
  const len = run.b - run.a
  const minNote = Math.max(2, Math.round((opts.minNoteSec ?? 0.06) / hopSec))
  const glideMin = Math.max(2, Math.round(0.04 / hopSec))
  const isTrans = new Uint8Array(len)
  if (opts.transitions && len > 4) {
    const gl = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      const i0 = Math.max(0, i - 2)
      const i1 = Math.min(len - 1, i + 2)
      const slope = (center[i1] - center[i0]) / (Math.max(1, i1 - i0) * hopSec)
      gl[i] = Math.abs(slope) > 12 ? 1 : 0
    }
    let i = 0
    while (i < len) {
      if (!gl[i]) {
        i++
        continue
      }
      let j = i
      while (j < len && gl[j]) j++
      if (j - i >= glideMin) for (let k = i; k < j; k++) isTrans[k] = 1
      i = j
    }
  }
  // hysteresis quantisation on non-transition frames
  type Raw = { a: number; b: number; q: number; trans: boolean }
  const raws: Raw[] = []
  let q = NaN
  for (let i = 0; i < len; i++) {
    const tr = isTrans[i] === 1
    const c = center[i]
    if (!tr) {
      if (!(q === q) || Math.abs(c - q) > 0.65) q = Math.round(c)
    }
    const last = raws[raws.length - 1]
    if (last && last.trans === tr && (tr || last.q === q)) last.b = i + 1
    else raws.push({ a: i, b: i + 1, q: tr ? NaN : q, trans: tr })
    if (tr) q = NaN
  }
  // short notes → transitions (or merge when transitions are disabled)
  for (const r of raws) {
    if (!r.trans && r.b - r.a < minNote && raws.length > 1) {
      if (opts.transitions) r.trans = true
      else r.q = NaN // merged below
    }
  }
  if (!opts.transitions) {
    // assign NaN-q segments to the neighbour with closest pitch
    for (let k = 0; k < raws.length; k++) {
      const r = raws[k]
      if (r.q === r.q) continue
      let mean = 0
      for (let i = r.a; i < r.b; i++) mean += center[i]
      mean /= r.b - r.a
      const prev = raws.slice(0, k).reverse().find((x) => x.q === x.q)
      const next = raws.slice(k + 1).find((x) => x.q === x.q)
      const cands = [prev, next].filter((x): x is Raw => !!x)
      if (cands.length === 0) r.q = Math.round(mean)
      else {
        cands.sort((x, y) => Math.abs(x.q - mean) - Math.abs(y.q - mean))
        r.q = cands[0].q
      }
    }
  }
  // merge neighbours with identical state
  const merged: Raw[] = []
  for (const r of raws) {
    const last = merged[merged.length - 1]
    if (last && last.trans === r.trans && (r.trans || last.q === r.q)) last.b = r.b
    else merged.push({ ...r })
  }
  const segs: NoteSeg[] = []
  const tmp: number[] = []
  for (const r of merged) {
    tmp.length = 0
    for (let i = r.a; i < r.b; i++) tmp.push(center[i])
    tmp.sort((x, y) => x - y)
    // ignore the outer 15% of a note for its centre (scoops/fall-offs)
    const lo = Math.floor(tmp.length * 0.15)
    const hi = Math.max(lo + 1, Math.ceil(tmp.length * 0.85))
    const mid = tmp.slice(lo, hi)
    const c = mid[mid.length >> 1]
    segs.push({
      a: run.a + r.a,
      b: run.a + r.b,
      center: c,
      transition: r.trans,
      target: NaN,
      source: 'none',
    })
  }
  return segs
}

/** Turn a (guide) pitch track into discrete semitone notes, times in the track's own timeline. */
export function notesFromTrack(track: PitchTrack): MelodyNote[] {
  const ct = prepareTrack(track, { minConf: 0.5 })
  const notes: MelodyNote[] = []
  for (const run of voicedRuns(ct.voiced)) {
    const center = noteCenterCurve(ct.midi, run, ct.hopSec)
    const segs = segmentRun(center.subarray(0), run, ct.hopSec, { transitions: false, minNoteSec: 0.08 })
    for (const s of segs) {
      notes.push({ start: s.a * ct.hopSec, end: s.b * ct.hopSec, midi: Math.round(s.center) })
    }
  }
  return notes
}
