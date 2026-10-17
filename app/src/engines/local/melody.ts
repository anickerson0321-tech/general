// Vocal melody writer: syllables -> rhythm on the beat grid (DP) -> singable pitch contour.
import type { MotifKey, SectionPlan, SongPlan, VNote } from './model'
import { beatToSec, chordAt } from './model'
import { Rng, mixSeed } from './rng'
import type { SylPhones } from './syllables'
import { wordPhones } from './syllables'
import { chordPcs, stepToMidi } from './theory'

export interface SylSlot {
  phones?: SylPhones
  stress: number
  wordIdx?: number
  wordEnd: boolean
  comma: boolean
}

/** Syllables of a lyric line with word indices. */
export function lineSyllables(words: string[], wordBase: number): SylSlot[] {
  const out: SylSlot[] = []
  words.forEach((w, wi) => {
    const ph = wordPhones(w)
    ph.forEach((p, k) => {
      out.push({ phones: p, stress: p.stress, wordIdx: wordBase + wi, wordEnd: k === ph.length - 1, comma: k === ph.length - 1 && /[,;:.!?—-]$/.test(w) })
    })
  })
  return out
}

/** Pseudo-syllables for instrumental lead lines. */
export function pseudoSyllables(n: number, r: Rng): SylSlot[] {
  const out: SylSlot[] = []
  for (let i = 0; i < n; i++) {
    const stress = i % 2 === 0 ? 2 : r.chance(0.3) ? 1 : 0
    out.push({ stress, wordEnd: r.chance(0.6), comma: false })
  }
  return out
}

function metricWeight(pos16: number): number {
  const p = ((pos16 % 16) + 16) % 16
  if (p === 0) return 4
  if (p === 8) return 3
  if (p % 4 === 0) return 2
  if (p % 2 === 0) return 1
  return 0
}

export interface Rhythm {
  on: number[] // onset in 16ths from line start
  len: number[]
}

/**
 * Place syllables on the grid. DP over (syllable, slot): stressed syllables want strong beats,
 * motif preferences make repeated sections rhythmically consistent.
 */
export function fitRhythm(syl: SylSlot[], beats: number, motifSeed: number, syncopation: number): Rhythm {
  const n = syl.length
  const total16 = beats * 4
  // grid step: 8ths unless too many syllables
  const restMin = beats >= 8 ? 6 : 3 // in 16ths
  let g = 2
  if (n * 2 > total16 - restMin - 1) g = 1
  const S = Math.floor(total16 / g)
  const restSlots = Math.max(1, Math.ceil((n > S * 0.75 ? 2 : restMin) / g))
  const lastMax = Math.max(n - 1, S - restSlots - 1)
  const r = new Rng(motifSeed)
  const pref = new Float64Array(S)
  for (let k = 0; k < S; k++) {
    const w = metricWeight(k * g)
    pref[k] = (r.next() - 0.5) * 0.7 + (w === 0 || w === 1 ? syncopation * 0.5 * (r.next() - 0.3) : 0)
  }
  const startPref = r.pick(beats >= 8 ? [0, 0, 1, 2] : [0, 0, 1]) // in 8ths
  const avail = Math.max(n, S - restSlots - startPref * (2 / g))
  const dStar = Math.min(4 / g, Math.max(1, (avail * 0.82) / Math.max(1, n)))
  const INF = 1e18
  const cost = new Float64Array(n * S).fill(INF)
  const from = new Int32Array(n * S).fill(-1)
  const unit = (i: number, k: number) => {
    const w = metricWeight(k * g)
    const st = syl[i].stress
    let c = -pref[k]
    if (st === 2) c += w < 2 ? (2 - w) * 1.1 : -0.25 * (w - 2)
    else if (st === 1) c += w === 0 ? 0.4 : 0
    else c += w >= 3 ? 0.7 : w === 2 ? 0.2 : 0
    return c
  }
  const gapCost = (d: number, i: number) => {
    // d in slots between syllable i-1 and i
    const d16 = d * g
    let c: number
    if (d16 === 1) c = 0.35
    else if (d16 === 2) c = 0
    else if (d16 === 3) c = 0.6
    else if (d16 === 4) c = 0.25
    else if (d16 <= 6) c = 0.9
    else if (d16 <= 8) c = 1.3
    else c = 2 + (d16 - 8) * 0.4
    const prev = syl[i - 1]
    if (prev.comma && d16 >= 3 && d16 <= 8) c -= 0.8
    if (prev.stress === 2 && prev.wordEnd && d16 >= 3 && d16 <= 4) c -= 0.25
    c += Math.abs(d - dStar) * 0.3
    return c
  }
  const startMax = Math.min(S - n, Math.max(0, Math.round((startPref * 2) / g) + 2))
  for (let k = 0; k <= startMax; k++) {
    cost[k] = unit(0, k) + Math.abs(k - (startPref * 2) / g) * 0.5
  }
  for (let i = 1; i < n; i++) {
    const kmin = i
    const kmax = i === n - 1 ? lastMax : S - (n - i) - restSlots + 1
    for (let k = kmin; k <= Math.min(kmax, S - 1); k++) {
      const u = unit(i, k) + (i === n - 1 && metricWeight(k * g) < 2 ? 0.8 : 0)
      let best = INF
      let arg = -1
      const pmin = Math.max(i - 1, k - Math.ceil(12 / g))
      for (let p = k - 1; p >= pmin; p--) {
        const cp = cost[(i - 1) * S + p]
        if (cp >= INF) continue
        const c = cp + gapCost(k - p, i)
        if (c < best) {
          best = c
          arg = p
        }
      }
      if (arg >= 0) {
        cost[i * S + k] = best + u
        from[i * S + k] = arg
      }
    }
  }
  // best end
  let bestK = -1
  let best = INF
  for (let k = n - 1; k < S; k++) {
    const c = cost[(n - 1) * S + k]
    if (c < best) {
      best = c
      bestK = k
    }
  }
  const on: number[] = new Array(n)
  if (bestK < 0) {
    // fallback: evenly spaced 16ths
    for (let i = 0; i < n; i++) on[i] = Math.min(total16 - 1, i)
  } else {
    let k = bestK
    for (let i = n - 1; i >= 0; i--) {
      on[i] = k * g
      k = from[i * S + k]
      if (i > 0 && k < 0) k = on[i] / g - 1
    }
  }
  const len: number[] = new Array(n)
  for (let i = 0; i < n - 1; i++) {
    let d = on[i + 1] - on[i]
    if (syl[i].comma && d >= 3) d -= 1
    len[i] = Math.max(1, d)
  }
  const endLimit = total16 - Math.max(2, Math.min(restMin, total16 - on[n - 1] - 2))
  len[n - 1] = Math.max(2, Math.min(beats >= 8 ? 12 : 8, endLimit - on[n - 1]))
  if (on[n - 1] + len[n - 1] > total16 - 1) len[n - 1] = Math.max(1, total16 - 1 - on[n - 1])
  return { on, len }
}

interface Contour {
  start: number
  peak: number
  end: number
  peakPos: number
}

const CONTOURS: Record<string, Contour[]> = {
  verse: [
    { start: 0.3, peak: 0.6, end: 0.4, peakPos: 0.5 },
    { start: 0.4, peak: 0.7, end: 0.3, peakPos: 0.35 },
    { start: 0.45, peak: 0.55, end: 0.1, peakPos: 0.3 },
  ],
  pre: [
    { start: 0.3, peak: 0.7, end: 0.65, peakPos: 0.7 },
    { start: 0.45, peak: 0.85, end: 0.8, peakPos: 0.8 },
    { start: 0.5, peak: 0.9, end: 0.85, peakPos: 0.85 },
  ],
  chorus: [
    { start: 0.55, peak: 0.95, end: 0.65, peakPos: 0.35 },
    { start: 0.65, peak: 0.85, end: 0.4, peakPos: 0.3 },
    { start: 0.6, peak: 0.95, end: 0.2, peakPos: 0.35 },
  ],
  bridge: [
    { start: 0.35, peak: 0.75, end: 0.55, peakPos: 0.6 },
    { start: 0.5, peak: 0.85, end: 0.6, peakPos: 0.5 },
    { start: 0.55, peak: 0.95, end: 0.75, peakPos: 0.6 },
  ],
}

const RANGE: Record<string, [number, number]> = {
  verse: [0, 0.62],
  pre: [0.15, 0.78],
  chorus: [0.35, 1],
  bridge: [0.25, 0.9],
}

function motifGroup(m: MotifKey): 'verse' | 'pre' | 'chorus' | 'bridge' {
  if (m === 'verse') return 'verse'
  if (m === 'pre') return 'pre'
  if (m === 'bridge' || m === 'break') return 'bridge'
  return 'chorus'
}

function contourAt(c: Contour, x: number): number {
  const sm = (t: number) => t * t * (3 - 2 * t)
  if (x < c.peakPos) return c.start + (c.peak - c.start) * sm(x / c.peakPos)
  return c.peak + (c.end - c.peak) * sm((x - c.peakPos) / Math.max(0.01, 1 - c.peakPos))
}

export interface PitchCtx {
  plan: SongPlan
  tonicMidi: number
  sLo: number
  sHi: number
}

export function vocalTonic(plan: SongPlan): PitchCtx {
  const low = plan.vocalLow
  const high = plan.vocalHigh
  let tonicMidi = plan.key.tonic
  while (tonicMidi < low + 2) tonicMidi += 12
  if (tonicMidi - 12 >= low - 1 && Math.abs(tonicMidi - 12 - (low + 4)) < Math.abs(tonicMidi - (low + 4))) tonicMidi -= 12
  let sLo = 0
  while (stepToMidi(sLo - 1, tonicMidi, plan.scale) >= low) sLo--
  while (stepToMidi(sLo, tonicMidi, plan.scale) < low) sLo++
  let sHi = sLo
  while (stepToMidi(sHi + 1, tonicMidi, plan.scale) <= high) sHi++
  return { plan, tonicMidi, sLo, sHi }
}

/**
 * Pitches for one line. Deterministic for (seed, motif, role) so repeated sections share melodies.
 */
export function pitchLine(
  pc: PitchCtx,
  sec: SectionPlan,
  line: { startBeat: number },
  syl: SylSlot[],
  rh: Rhythm,
  role: number,
  isLastLine: boolean,
  prevStep: number | null,
  pitchSeed: number,
): number[] {
  const plan = pc.plan
  const grp = motifGroup(sec.motif)
  const [f0, f1] = RANGE[grp]
  const span = pc.sHi - pc.sLo
  const lo = Math.round(pc.sLo + f0 * span)
  const hi = Math.round(pc.sLo + f1 * span)
  const r = new Rng(pitchSeed)
  const base = CONTOURS[grp][Math.min(2, role)]
  const jit = 0.12 * (1 + plan.weirdness)
  const ct: Contour = {
    start: base.start + (r.next() - 0.5) * jit,
    peak: base.peak + (r.next() - 0.5) * jit,
    end: base.end + (r.next() - 0.5) * jit,
    peakPos: Math.min(0.85, Math.max(0.15, base.peakPos + (r.next() - 0.5) * 0.3)),
  }
  const n = syl.length
  const noise: number[] = []
  for (let i = 0; i < n * (hi - lo + 3); i++) noise.push(r.next())
  const leapiness = 0.6 + plan.weirdness * 0.8
  const steps: number[] = []
  let prev = prevStep
  let lastMove = 0
  const tonicPc = plan.key.tonic
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0.5 : i / (n - 1)
    const target = lo + contourAt(ct, x) * (hi - lo)
    const pos16 = line.startBeat * 4 + rh.on[i]
    const chord = chordAt(sec, plan, pos16 / 4)
    const pcs = chordPcs(chord)
    const w = metricWeight(rh.on[i])
    const strong = w >= 2 || rh.len[i] >= 4 || i === n - 1
    let best = lo
    let bestC = Infinity
    for (let c = lo - 1; c <= hi + 1; c++) {
      const midi = stepToMidi(c, pc.tonicMidi, plan.scale)
      const mpc = ((midi % 12) + 12) % 12
      let cost = Math.abs(c - target) * 0.55
      if (c < lo || c > hi) cost += 1.5
      if (prev !== null) {
        const d = c - prev
        const ad = Math.abs(d)
        if (ad === 0) cost += rh.len[i] <= 2 && i > 0 ? 0.15 : 0.6
        else if (ad === 1) cost += 0
        else if (ad === 2) cost += 0.3 * leapiness
        else if (ad === 3) cost += 1.0 * leapiness
        else if (ad === 4) cost += 1.4 * leapiness
        else cost += 3 + ad
        if (Math.abs(lastMove) >= 3 && Math.sign(d) === Math.sign(lastMove)) cost += 1.2
        if (i === 0 && ad > 4) cost += 2
      }
      const isCT = pcs.includes(mpc)
      if (strong && !isCT) cost += 2.2
      else if (!isCT) {
        // avoid notes: semitone above a chord tone
        if (pcs.some((p) => (mpc - p + 12) % 12 === 1)) cost += 1.2
        else cost += 0.2
      }
      if (i === n - 1) {
        const deg = ((c % 7) + 7) % 7
        if (isLastLine) cost += deg === 0 ? -1.4 : deg === 2 || deg === 4 ? -0.4 : 0.6
        else if (role === 1) cost += deg === 1 || deg === 4 ? -0.6 : 0
        if (mpc === tonicPc && isLastLine) cost -= 0.4
      }
      cost += (noise[i * (hi - lo + 3) + (c - lo + 1)] - 0.5) * 0.7
      if (cost < bestC) {
        bestC = cost
        best = c
      }
    }
    if (prev !== null) lastMove = best - prev
    steps.push(best)
    prev = best
  }
  return steps
}

/** Diatonic harmony a third above (or below) that agrees with the chord when possible. */
export function harmonyStep(step: number, pc: PitchCtx, chordPcsList: number[]): number {
  const cands = [step + 2, step - 2, step + 4, step - 3]
  const top = pc.sHi + 3
  for (const c of cands) {
    if (c > top) continue
    const m = stepToMidi(c, pc.tonicMidi, pc.plan.scale)
    if (chordPcsList.includes(((m % 12) + 12) % 12)) return c
  }
  return step + 2 <= top ? step + 2 : step - 2
}

/**
 * Compose the melody for all sung lines (or pseudo lines when instrumental).
 * Fills line.notes and returns the flattened note list.
 */
export function composeMelody(plan: SongPlan): VNote[] {
  const pc = vocalTonic(plan)
  const all: VNote[] = []
  let prevStep: number | null = null
  const sync = 0.3 + plan.weirdness * 0.6 + (['rnb', 'hiphop', 'trap', 'latin', 'reggae', 'kpop', 'pop'].includes(plan.profile.genre) ? 0.3 : 0)
  for (const sec of plan.sections) {
    const nLines = sec.lines.length
    prevStep = null
    sec.lines.forEach((line, li) => {
      const role4 = [0, 1, 0, 2][li % 4]
      const isLast = li === nLines - 1
      const role = isLast ? 2 : role4
      const motif = sec.motif
      const syl = plan.instrumental || !line.words.length
        ? pseudoSyllables(new Rng(mixSeed(plan.seed, motif, 'ps', role4)).int(5, 9), new Rng(mixSeed(plan.seed, motif, 'pss', role4)))
        : lineSyllables(line.words, line.wordBase)
      const rhSeed = mixSeed(plan.seed, motifGroup(motif), 'rhythm', li % 2, syl.length)
      const rh = fitRhythm(syl, line.beats, rhSeed, sync)
      const pSeed = mixSeed(plan.seed, motifGroup(motif), 'pitch', role, isLast ? 1 : 0)
      const steps = pitchLine(pc, sec, line, syl, rh, role, isLast && sec.motif !== 'pre', prevStep, pSeed)
      const notes: VNote[] = []
      for (let i = 0; i < syl.length; i++) {
        const pos16 = line.startBeat * 4 + rh.on[i]
        const midi = stepToMidi(steps[i], pc.tonicMidi, plan.scale)
        const chord = chordAt(sec, plan, pos16 / 4)
        const hs = harmonyStep(steps[i], pc, chordPcs(chord))
        const vn: VNote = {
          start: beatToSec(plan, pos16 / 4),
          end: beatToSec(plan, (pos16 + rh.len[i]) / 4),
          midi,
          pos16,
          len16: rh.len[i],
          wordIndex: syl[i].wordIdx,
          syl: syl[i].phones,
          stress: syl[i].stress,
          phraseStart: i === 0,
          phraseEnd: i === syl.length - 1,
          vel: 0.85 + (syl[i].stress === 2 ? 0.1 : 0) + (sec.motif === 'chorus' ? 0.05 : 0),
          harm: stepToMidi(hs, pc.tonicMidi, plan.scale),
        }
        notes.push(vn)
      }
      // melisma on long final notes: fall to a neighbouring chord tone
      const last = notes[notes.length - 1]
      const mr = new Rng(mixSeed(plan.seed, motifGroup(motif), 'mel', role))
      if (last.len16 >= 8 && mr.chance(0.55)) {
        const split = Math.round(last.len16 * 0.6)
        const s2 = steps[steps.length - 1] + (mr.chance(0.6) ? -1 : 1)
        const m2 = stepToMidi(s2, pc.tonicMidi, plan.scale)
        const n2: VNote = {
          ...last,
          pos16: last.pos16 + split,
          len16: last.len16 - split,
          start: beatToSec(plan, (last.pos16 + split) / 4),
          midi: m2,
          cont: true,
          phraseStart: false,
          harm: stepToMidi(harmonyStep(s2, pc, chordPcs(chordAt(sec, plan, (last.pos16 + split) / 4))), pc.tonicMidi, plan.scale),
        }
        last.len16 = split
        last.end = n2.start
        last.phraseEnd = false
        notes.push(n2)
      }
      // tiny articulation gaps between words when the rhythm leaves room
      for (let i = 0; i < notes.length - 1; i++) {
        const a = notes[i]
        const b = notes[i + 1]
        if (b.start - a.end > 0.0005) a.phraseEnd = false
        a.end = Math.min(a.end, b.start)
      }
      line.notes = notes
      prevStep = steps[steps.length - 1]
      all.push(...notes)
    })
  }
  // split phrases where there is a real gap (> 120ms)
  for (let i = 0; i < all.length; i++) {
    const a = all[i]
    const b = all[i + 1]
    if (!b || b.start - a.end > 0.12) {
      a.phraseEnd = true
      if (b) b.phraseStart = true
    }
  }
  plan.melody = all
  return all
}

/** Hook motif for intros / instrumental sections: first two lines of the first chorus, else generated. */
export function buildHook(plan: SongPlan): void {
  const ch = plan.sections.find((s) => s.motif === 'chorus' && s.lines.length && s.lines[0].notes.length)
  if (ch) {
    const lines = ch.lines.slice(0, 2)
    const base = ch.startBeat * 4
    plan.hook = lines.flatMap((l) => l.notes.map((n) => ({ pos16: n.pos16 - base, len16: n.len16, midi: n.midi })))
    plan.hookLen16 = Math.max(32, lines.length * lines[0].beats * 4)
    return
  }
  // generate an 8-note-ish hook over 2 bars from the chorus progression
  const pc = vocalTonic(plan)
  const r = new Rng(mixSeed(plan.seed, 'hook'))
  const n = r.int(6, 9)
  const syl = pseudoSyllables(n, r)
  const rh = fitRhythm(syl, 8, mixSeed(plan.seed, 'hookr'), 0.5)
  const sec = plan.sections.find((s) => s.motif === 'chorus') ?? plan.sections[0]
  const steps = pitchLine(pc, { ...sec, motif: 'chorus' }, { startBeat: sec.startBeat }, syl, rh, 0, false, null, mixSeed(plan.seed, 'hookp'))
  plan.hook = steps.map((s, i) => ({ pos16: rh.on[i], len16: rh.len[i], midi: stepToMidi(s, pc.tonicMidi, plan.scale) }))
  plan.hookLen16 = 32
}
