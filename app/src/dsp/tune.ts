// Pitch-correction planning: note segmentation, target selection
// (melody → guide → key scale → chromatic), vibrato-preserving correction
// curve with zero-phase retune smoothing.

import type { MelodyNote, MusicalKey } from '../types'
import type { CleanTrack, NoteSeg } from './track'
import { noteCenterCurve, segmentRun, voicedRuns } from './track'
import { clamp, smoothstep } from './util'

export interface TuneParams {
  /** 0..1 fraction of the pitch error removed */
  strength: number
  /** retune time constant (ms); 0 = instant */
  retuneMs: number
  /** 0..1 fraction of the natural vibrato depth kept */
  vibratoKeep: number
  /** 0..1 blend toward hard-tune (robotic) behaviour */
  robotic: number
  key?: MusicalKey
  /** melody notes in TAKE time (seconds from take start) */
  melody?: MelodyNote[]
  /** guide notes in TAKE time */
  guide?: MelodyNote[]
  /** max semitones a melody/guide target may pull the singer (after octave folding) */
  maxPull?: number
}

export interface TunePlan {
  /** per-frame pitch shift in semitones (0 for unvoiced) */
  shift: Float32Array
  /** per-frame target MIDI (NaN where none) */
  target: Float32Array
  notes: NoteSeg[]
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

export function scaleSnap(midi: number, key: MusicalKey): number {
  const pcs = key.mode === 'minor' ? MINOR : MAJOR
  const r = Math.round(midi)
  let best = r
  let bestD = Infinity
  for (let m = r - 2; m <= r + 2; m++) {
    const pc = (((m - key.tonic) % 12) + 12) % 12
    if (pcs.indexOf(pc) < 0) continue
    const d = Math.abs(m - midi)
    if (d < bestD) {
      bestD = d
      best = m
    }
  }
  return best
}

function foldOctave(ref: number, sung: number): number {
  return ref + 12 * Math.round((sung - ref) / 12)
}

/** Pick the best reference note for [t0, t1] (take seconds). */
function matchRef(refs: MelodyNote[] | undefined, t0: number, t1: number, center: number, maxPull: number): number {
  if (!refs || refs.length === 0) return NaN
  const dur = Math.max(1e-3, t1 - t0)
  let best = NaN
  let bestScore = -Infinity
  // binary search to first ref that could overlap
  let lo = 0
  let hi = refs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (refs[mid].end < t0 - 0.15) lo = mid + 1
    else hi = mid
  }
  for (let k = lo; k < refs.length; k++) {
    const r = refs[k]
    if (r.start > t1 + 0.15) break
    // overlap with tolerance (singer may be early/late)
    const ov = Math.min(t1, r.end + 0.12) - Math.max(t0, r.start - 0.12)
    if (ov <= 0) continue
    const folded = foldOctave(r.midi, center)
    const dist = Math.abs(folded - center)
    if (dist > maxPull) continue
    const score = Math.min(1, ov / dur) - 0.08 * dist
    if (score > bestScore) {
      bestScore = score
      best = folded
    }
  }
  return best
}

/** Split note segments at reference-note boundaries the singer did not articulate. */
function splitAtRefs(notes: NoteSeg[], refs: MelodyNote[] | undefined, hopSec: number): NoteSeg[] {
  if (!refs || refs.length === 0) return notes
  const minF = Math.max(2, Math.round(0.08 / hopSec))
  const edgeF = Math.max(2, Math.round(0.15 / hopSec))
  const out: NoteSeg[] = []
  for (const n of notes) {
    if (n.transition) {
      out.push(n)
      continue
    }
    const t0 = n.a * hopSec
    const t1 = n.b * hopSec
    const cuts: number[] = []
    for (let k = 0; k + 1 < refs.length; k++) {
      const r = refs[k]
      const r2 = refs[k + 1]
      if (r.end < t0 || r.end > t1) continue
      if (Math.abs(r.midi - r2.midi) < 0.5) continue
      if (r2.start - r.end > 0.25) continue
      const bt = 0.5 * (r.end + r2.start)
      const bf = Math.round(bt / hopSec)
      if (bf - n.a < Math.max(minF, edgeF) || n.b - bf < Math.max(minF, edgeF)) continue
      cuts.push(bf)
    }
    if (cuts.length === 0) {
      out.push(n)
      continue
    }
    let a = n.a
    for (const c of cuts) {
      out.push({ ...n, a, b: c })
      a = c
    }
    out.push({ ...n, a, b: n.b })
  }
  return out
}

/** Zero-phase one-pole smoothing (forward + backward), in place on a slice. */
function smoothZeroPhase(buf: Float32Array, a: number, b: number, tauFrames: number): void {
  if (tauFrames <= 0.05 || b - a < 2) return
  const c = Math.exp(-1 / tauFrames)
  let s = buf[a]
  for (let i = a; i < b; i++) {
    s = c * s + (1 - c) * buf[i]
    buf[i] = s
  }
  s = buf[b - 1]
  for (let i = b - 1; i >= a; i--) {
    s = c * s + (1 - c) * buf[i]
    buf[i] = s
  }
}

export function planCorrection(ct: CleanTrack, p: TuneParams): TunePlan {
  const n = ct.n
  const hop = ct.hopSec
  const shift = new Float32Array(n)
  const target = new Float32Array(n).fill(NaN)
  const allNotes: NoteSeg[] = []
  if (p.strength <= 0 || n === 0) return { shift, target, notes: allNotes }
  const robotic = clamp(p.robotic, 0, 1)
  const strength = clamp(p.strength + (1 - p.strength) * robotic, 0, 1)
  const retuneMs = p.retuneMs * (1 - robotic)
  const vibKeep = clamp(p.vibratoKeep * (1 - robotic), 0, 1)
  const driftCorr = Math.max(robotic, smoothstep(0.55, 1.0, strength))
  const maxPull = p.maxPull ?? 3.5
  const useTransitions = robotic < 0.5
  const desired = new Float32Array(n)
  const vib = new Float32Array(n)
  const weight = new Float32Array(n)

  for (const run of voicedRuns(ct.voiced)) {
    const center = noteCenterCurve(ct.midi, run, hop)
    for (let i = run.a; i < run.b; i++) {
      vib[i] = ct.midi[i] - center[i - run.a]
      weight[i] = smoothstep(0.3, 0.6, ct.conf[i])
    }
    let notes = segmentRun(center, run, hop, { transitions: useTransitions })
    notes = splitAtRefs(notes, p.melody && p.melody.length ? p.melody : p.guide, hop)
    // recompute per-note centres after splitting
    for (const nt of notes) {
      const vals: number[] = []
      for (let i = nt.a; i < nt.b; i++) vals.push(center[i - run.a])
      vals.sort((x, y) => x - y)
      const lo = Math.floor(vals.length * 0.15)
      const hi = Math.max(lo + 1, Math.ceil(vals.length * 0.85))
      const mid = vals.slice(lo, hi)
      nt.center = mid[mid.length >> 1]
      if (nt.transition) continue
      const t0 = nt.a * hop
      const t1 = nt.b * hop
      let tg = matchRef(p.melody, t0, t1, nt.center, maxPull)
      if (tg === tg) nt.source = 'melody'
      else {
        tg = matchRef(p.guide, t0, t1, nt.center, maxPull)
        if (tg === tg) nt.source = 'guide'
        else if (p.key) {
          tg = scaleSnap(nt.center, p.key)
          nt.source = 'scale'
        } else {
          tg = Math.round(nt.center)
          nt.source = 'chromatic'
        }
      }
      nt.target = tg
      for (let i = nt.a; i < nt.b; i++) {
        target[i] = tg
        const c = center[i - run.a]
        const ref = nt.center + (c - nt.center) * driftCorr
        desired[i] = clamp(tg - ref, -maxPull - 0.5, maxPull + 0.5)
      }
    }
    // transitions: interpolate the neighbouring notes' corrections (keeps scoop/slide shapes)
    for (let k = 0; k < notes.length; k++) {
      const nt = notes[k]
      if (!nt.transition) continue
      let prev: NoteSeg | undefined
      let next: NoteSeg | undefined
      for (let j = k - 1; j >= 0; j--)
        if (!notes[j].transition) {
          prev = notes[j]
          break
        }
      for (let j = k + 1; j < notes.length; j++)
        if (!notes[j].transition) {
          next = notes[j]
          break
        }
      const d0 = prev ? desired[prev.b - 1] : next ? desired[next.a] : 0
      const d1 = next ? desired[next.a] : d0
      const len = nt.b - nt.a
      for (let i = nt.a; i < nt.b; i++) {
        const t = (i - nt.a + 0.5) / len
        desired[i] = d0 + (d1 - d0) * t
      }
    }
    for (let i = run.a; i < run.b; i++) desired[i] *= weight[i]
    smoothZeroPhase(desired, run.a, run.b, retuneMs / 1000 / hop)
    for (let i = run.a; i < run.b; i++) {
      shift[i] = strength * desired[i] - (1 - vibKeep) * vib[i] * weight[i]
    }
    allNotes.push(...notes)
  }
  return { shift, target, notes: allNotes }
}
