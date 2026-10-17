// Scales, roman-numeral chord parsing, voicings and voice leading.
import type { MusicalKey } from '../../types'

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
}

export function keyName(k: MusicalKey): string {
  return `${NOTE_NAMES[((k.tonic % 12) + 12) % 12]} ${k.mode}`
}

export interface Chord {
  /** pitch class of root */
  root: number
  /** intervals from root (sorted, unique, includes 0) */
  tones: number[]
  /** pitch class of the bass note */
  bass: number
  /** 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | '5' */
  quality: string
  roman: string
  symbol: string
}

const DEG: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 }

/**
 * Parse a roman numeral relative to the tonic. Uppercase = major, lowercase = minor.
 * Prefix b/# alters the root. Suffixes: 7 maj7 9 maj9 add9 6 sus2 sus4 5 ° (dim) + (aug) m7b5.
 * Slash "/3" or "/5" puts that chord tone in the bass.
 */
export function parseRoman(rn: string, tonic: number): Chord {
  const m = rn.match(/^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/)
  if (!m) return parseRoman('I', tonic)
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0
  const num = m[2]
  let rest = m[3]
  let slash = ''
  const si = rest.indexOf('/')
  if (si >= 0) {
    slash = rest.slice(si + 1)
    rest = rest.slice(0, si)
  }
  const upper = num === num.toUpperCase()
  const root = (((tonic + DEG[num.toUpperCase()] + acc) % 12) + 12) % 12
  let quality = upper ? 'maj' : 'min'
  let third = upper ? 4 : 3
  let fifth = 7
  const ext: number[] = []
  if (rest.includes('°') || rest.includes('dim')) {
    quality = 'dim'
    third = 3
    fifth = 6
  } else if (rest.includes('m7b5')) {
    quality = 'dim'
    third = 3
    fifth = 6
    ext.push(10)
  } else if (rest.startsWith('+') || rest.includes('aug')) {
    quality = 'aug'
    fifth = 8
  }
  if (rest.includes('sus2')) {
    quality = 'sus2'
    third = 2
  } else if (rest.includes('sus4') || rest === 'sus') {
    quality = 'sus4'
    third = 5
  }
  if (rest.includes('maj9')) ext.push(11, 14)
  else if (rest.includes('maj7')) ext.push(11)
  else if (rest.includes('add9')) ext.push(14)
  else if (/(^|[^a-z])9/.test(rest) || rest === '9') ext.push(quality === 'dim' ? 9 : 10, 14)
  else if (rest.includes('7') && !rest.includes('m7b5')) ext.push(quality === 'dim' ? 9 : 10)
  if (/(^|[^0-9])6/.test(rest) && !rest.includes('b6')) ext.push(9)
  let tones: number[]
  if (rest === '5' || rest.endsWith('5') && !rest.includes('b5')) {
    quality = '5'
    tones = [0, 7]
  } else tones = [0, third, fifth, ...ext]
  tones = [...new Set(tones)].sort((a, b) => a - b)
  let bass = root
  if (slash === '3') bass = (root + third) % 12
  else if (slash === '5') bass = (root + fifth) % 12
  else if (slash === '7') bass = (root + (ext.includes(11) ? 11 : 10)) % 12
  const symbol =
    NOTE_NAMES[root] +
    (quality === 'min' ? 'm' : quality === 'dim' ? 'dim' : quality === 'aug' ? '+' : quality === '5' ? '5' : quality.startsWith('sus') ? quality : '') +
    (ext.includes(14) && ext.includes(11) ? 'maj9' : ext.includes(11) ? 'maj7' : ext.includes(14) && ext.includes(10) ? '9' : ext.includes(10) ? '7' : ext.includes(14) ? 'add9' : '') +
    (bass !== root ? '/' + NOTE_NAMES[bass] : '')
  return { root, tones, bass, quality, roman: rn, symbol }
}

export function chordPcs(c: Chord): number[] {
  return c.tones.map((t) => (c.root + t) % 12)
}

/** third interval of chord (or null for power/sus chords) */
export function chordThird(c: Chord): number | null {
  if (c.tones.includes(4)) return 4
  if (c.tones.includes(3)) return 3
  return null
}

/**
 * Choose the intervals to voice with n notes. Extensions are kept, the fifth is dropped first.
 * rootless: drop the root (bass plays it) — jazzy keys.
 */
export function voiceTones(c: Chord, n: number, rootless = false): number[] {
  let t = c.tones.slice()
  if (c.quality === '5') t = [0, 7, 12]
  if (rootless && t.length >= 4) t = t.filter((x) => x !== 0)
  while (t.length > n && t.includes(7) && t.length > 3) t = t.filter((x) => x !== 7)
  while (t.length > n) t.pop()
  let k = 0
  while (t.length < n) {
    t.push(t[k % t.length] + 12)
    k++
  }
  return t
}

/**
 * Voice-lead the chord: choose an inversion/octave within [low, high] that moves minimally from prev.
 */
export function voiceChord(c: Chord, prev: number[] | null, low: number, high: number, n: number, rootless = false): number[] {
  const iv = voiceTones(c, n, rootless).map((x) => x % 12)
  const pcs = iv.map((x) => (c.root + x) % 12)
  const uniq = [...new Set(pcs)]
  const cands: number[][] = []
  // build close voicings from each pitch class as lowest note, at each octave
  for (let inv = 0; inv < uniq.length; inv++) {
    const order = uniq.slice(inv).concat(uniq.slice(0, inv))
    for (let base = low - 12; base <= high; base += 12) {
      const v: number[] = []
      let last = -1
      let ok = true
      for (let k = 0; k < n; k++) {
        const pc = order[k % order.length]
        let note = base + ((pc - (base % 12) + 24) % 12)
        while (note <= last) note += 12
        if (note < low || note > high) {
          ok = false
          break
        }
        v.push(note)
        last = note
      }
      if (ok) cands.push(v)
    }
  }
  if (!cands.length) {
    // fallback: stack from low
    const v: number[] = []
    let last = low - 1
    for (let k = 0; k < n; k++) {
      let note = low + ((pcs[k % pcs.length] - (low % 12) + 24) % 12)
      while (note <= last) note += 12
      v.push(note)
      last = note
    }
    return v
  }
  const center = (low + high) / 2
  let best = cands[0]
  let bestCost = Infinity
  for (const v of cands) {
    let cost: number
    if (prev && prev.length === v.length) {
      cost = 0
      for (let i = 0; i < v.length; i++) cost += Math.abs(v[i] - prev[i])
      const mid = (v[0] + v[v.length - 1]) / 2
      cost += Math.abs(mid - center) * 0.15
    } else {
      const mid = (v[0] + v[v.length - 1]) / 2
      cost = Math.abs(mid - center)
    }
    if (cost < bestCost) {
      bestCost = cost
      best = v
    }
  }
  return best
}

/** midi for pitch class nearest to target midi */
export function nearestPc(pc: number, target: number): number {
  const base = target - (((target % 12) - pc + 18) % 12) + 6
  return Math.round(base)
}

/** pitch class placed in octave range [lo, lo+11] */
export function pcInRange(pc: number, lo: number): number {
  return lo + ((((pc - lo) % 12) + 12) % 12)
}

/** Convert scale step (0 = tonic) to midi, given tonic midi and scale intervals */
export function stepToMidi(step: number, tonicMidi: number, scale: number[]): number {
  const oct = Math.floor(step / 7)
  const idx = ((step % 7) + 7) % 7
  return tonicMidi + oct * 12 + scale[idx]
}

export function isScaleTone(midi: number, tonic: number, scale: number[]): boolean {
  return scale.includes((((midi - tonic) % 12) + 12) % 12)
}
