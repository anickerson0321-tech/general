import { beforeAll, describe, expect, it } from 'vitest'
import type { ComposeRequest, ComposeResult, StereoBuffer } from '../../../types'
import { parseLyrics, splitWords } from '../../../lib/lyrics'
import { __internal, analyzeStyle, composeLocal, generateLocalLyrics, suggestStyles } from '../index'
import { countSyllables, syllabify } from '../syllables'

const SR = 44100
const CEIL = Math.pow(10, -1 / 20) // -1 dBFS

function peak(b: StereoBuffer): number {
  let p = 0
  for (const ch of [b.left, b.right]) for (let i = 0; i < ch.length; i++) {
    const v = Math.abs(ch[i])
    if (v > p) p = v
  }
  return p
}
function hasNaN(b: StereoBuffer): boolean {
  for (const ch of [b.left, b.right]) for (let i = 0; i < ch.length; i++) if (!Number.isFinite(ch[i])) return true
  return false
}
function rmsRange(b: StereoBuffer, t0: number, t1: number): number {
  const a = Math.max(0, Math.floor(t0 * SR))
  const e = Math.min(b.left.length, Math.floor(t1 * SR))
  let s = 0
  for (let i = a; i < e; i++) s += b.left[i] * b.left[i] + b.right[i] * b.right[i]
  return Math.sqrt(s / Math.max(1, 2 * (e - a)))
}
function fingerprint(b: StereoBuffer): number[] {
  const out: number[] = []
  for (let i = 0; i < b.left.length; i += 9973) out.push(Math.round(b.left[i] * 1e6))
  return out
}

describe('style analysis', () => {
  const cases: Array<[string, string]> = [
    ['upbeat pop, female vocals', 'pop'],
    ['indie rock with distorted guitars', 'rock'],
    ['boom bap hip hop', 'hiphop'],
    ['dark trap, 140 bpm, male vocals', 'trap'],
    ['neo soul r&b, warm rhodes', 'rnb'],
    ['deep house, sidechained pads', 'edm'],
    ['80s synthwave, dreamy', 'synthwave'],
    ['lofi hip hop, chill, vinyl crackle', 'lofi'],
    ['modern country with pedal steel', 'country'],
    ['acoustic folk ballad', 'folk'],
    ['smooth jazz with saxophone', 'jazz'],
    ['emotional piano ballad', 'ballad'],
    ['heavy metal, double kick', 'metal'],
    ['pop punk', 'punk'],
    ['roots reggae one drop', 'reggae'],
    ['reggaeton, dembow', 'latin'],
    ['gospel choir, hammond organ', 'gospel'],
    ['k-pop dance anthem', 'kpop'],
    ['epic orchestral cinematic trailer', 'cinematic'],
  ]
  for (const [style, genre] of cases) it(`detects ${genre} from "${style}"`, () => expect(analyzeStyle(style).genre).toBe(genre))

  it('parses tempo, key, vocals, moods and instruments', () => {
    const p = analyzeStyle('sad synthwave in D minor, 96 bpm, female vocals, strings, saxophone')
    expect(p.bpm).toBe(96)
    expect(p.bpmExplicit).toBe(true)
    expect(p.key).toEqual({ tonic: 2, mode: 'minor' })
    expect(p.keyExplicit).toBe(true)
    expect(p.vocalGender).toBe('female')
    expect(p.moods).toContain('sad')
    expect(p.instruments.strings).toBe(true)
    expect(p.instruments.lead).toBe('sax')
    expect(analyzeStyle('rock in F# major').key).toEqual({ tonic: 6, mode: 'major' })
    expect(analyzeStyle('country, male vocals').vocalGender).toBe('male')
  })

  it('respects excludeStyle', () => {
    const p = analyzeStyle('upbeat pop with piano and guitar', 'drums, piano, guitar')
    expect(p.instruments.drums).toBeNull()
    expect(p.instruments.keys).toBeNull()
    expect(p.instruments.guitar).toBeNull()
    expect(analyzeStyle('dark trap', '808').instruments.bass).not.toBe('808')
    expect(analyzeStyle('pop', 'female vocals').vocalGender).toBe('male')
    expect(analyzeStyle('synthwave pop', 'synthwave').genre).toBe('pop')
  })

  it('suggests coherent, deterministic styles', () => {
    expect(suggestStyles(5)).toBe(suggestStyles(5))
    const seen = new Set<string>()
    for (let s = 0; s < 30; s++) {
      const st = suggestStyles(s)
      seen.add(st)
      expect(st.length).toBeGreaterThan(5)
      expect(analyzeStyle(st).genre).toBeTruthy()
    }
    expect(seen.size).toBeGreaterThan(15)
  })
})

describe('syllables', () => {
  it('splits common words sensibly', () => {
    expect(syllabify('beautiful').length).toBe(3)
    expect(syllabify('summer').length).toBe(2)
    expect(syllabify('time').length).toBe(1)
    expect(syllabify('loved').length).toBe(1)
    expect(syllabify('wanted').length).toBe(2)
    expect(syllabify('little').length).toBe(2)
    expect(syllabify('together').length).toBe(3)
    expect(countSyllables('I keep running back to the window')).toBe(9)
  })
})

describe('lyrics generator', () => {
  it('writes Suno-formatted lyrics that parse into >= 4 sections', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { title, lyrics } = generateLocalLyrics('a road trip with my friends in the summer', seed)
      expect(title.length).toBeGreaterThan(0)
      const parsed = parseLyrics(lyrics)
      expect(parsed.sections.length).toBeGreaterThanOrEqual(4)
      const tags = parsed.sections.map((s) => s.tag)
      expect(tags).toContain('Verse')
      expect(tags.filter((t) => t === 'Chorus').length).toBeGreaterThanOrEqual(2)
      expect(tags).toContain('Bridge')
      for (const s of parsed.sections) for (const l of s.lines) expect(countSyllables(l)).toBeLessThanOrEqual(16)
    }
  })
  it('uses the topic and is deterministic', () => {
    const a = generateLocalLyrics('neon city at midnight', 3)
    expect(a).toEqual(generateLocalLyrics('neon city at midnight', 3))
    expect(a.lyrics.toLowerCase()).toMatch(/neon|city|midnight/)
    expect(generateLocalLyrics('neon city at midnight', 4).lyrics).not.toBe(a.lyrics)
  })
})

describe('composeLocal (vocal song)', () => {
  const ly = generateLocalLyrics('falling in love on a summer night', 11)
  const req: ComposeRequest = { title: ly.title, style: 'upbeat pop, female vocals', lyrics: parseLyrics(ly.lyrics), instrumental: false, seed: 11 }
  let res: ComposeResult
  const labels: string[] = []
  let ms = 0
  beforeAll(async () => {
    const t0 = performance.now()
    res = await composeLocal(req, (f, l) => {
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(1)
      labels.push(l)
    })
    ms = performance.now() - t0
  }, 60000)

  it('reports progress with stage labels', () => {
    for (const l of ['Writing chords', 'Arranging drums', 'Singing', 'Mixing', 'Mastering']) expect(labels).toContain(l)
    console.log(`vocal song: ${res.durationSec.toFixed(1)} s rendered in ${ms.toFixed(0)} ms; tags: ${res.tags.join(', ')}`)
  })

  it('returns consistent buffers and metadata', () => {
    const n = res.mix.left.length
    expect(res.durationSec).toBeCloseTo(n / SR, 5)
    for (const b of [res.mix, res.instrumental, res.vocals!]) {
      expect(b.sampleRate).toBe(SR)
      expect(b.left.length).toBe(n)
      expect(b.right.length).toBe(n)
    }
    expect(res.durationSec).toBeGreaterThan(60)
    expect(res.tags).toContain(`${res.bpm} bpm`)
    expect(res.tags).toContain('female vocals')
    expect(res.tags[0]).toBe('pop')
  })

  it('has no NaN, no clipping, peaks <= -1 dBFS and sensible loudness', () => {
    for (const b of [res.mix, res.instrumental, res.vocals!]) {
      expect(hasNaN(b)).toBe(false)
      expect(peak(b)).toBeLessThanOrEqual(CEIL + 1e-6)
    }
    const r = rmsRange(res.mix, 10, res.durationSec - 5)
    expect(20 * Math.log10(r)).toBeGreaterThan(-20)
    expect(20 * Math.log10(r)).toBeLessThan(-8)
    expect(rmsRange(res.vocals!, 0, res.durationSec)).toBeGreaterThan(0.005)
  })

  it('times every lyric word inside the song, monotonically', () => {
    const lines = req.lyrics.sections.flatMap((s) => s.lines)
    expect(res.timedLyrics.length).toBe(lines.length)
    let last = 0
    let words = 0
    res.timedLyrics.forEach((tl, i) => {
      expect(tl.text).toBe(lines[i])
      expect(tl.words.map((w) => w.text)).toEqual(splitWords(lines[i]))
      expect(tl.section).toBeTruthy()
      expect(tl.start).toBeGreaterThanOrEqual(last - 1e-9)
      for (const w of tl.words) {
        expect(w.start).toBeGreaterThanOrEqual(last - 1e-9)
        expect(w.end).toBeGreaterThan(w.start)
        expect(w.end).toBeLessThanOrEqual(res.durationSec)
        last = w.start
        words++
      }
      expect(tl.end).toBeCloseTo(tl.words[tl.words.length - 1].end, 9)
    })
    expect(words).toBe(lines.reduce((a, l) => a + splitWords(l).length, 0))
  })

  it('maps melody notes onto words', () => {
    const flat = res.timedLyrics.flatMap((l) => l.words)
    let prevStart = -1
    const covered = new Set<number>()
    for (const n of res.melody) {
      expect(n.wordIndex).toBeDefined()
      const w = flat[n.wordIndex!]
      expect(w).toBeDefined()
      expect(n.start).toBeGreaterThanOrEqual(prevStart)
      expect(n.end).toBeGreaterThan(n.start)
      expect(n.start).toBeGreaterThanOrEqual(w.start - 1e-9)
      expect(n.end).toBeLessThanOrEqual(w.end + 1e-9)
      expect(n.midi).toBeGreaterThanOrEqual(50)
      expect(n.midi).toBeLessThanOrEqual(84)
      prevStart = n.start
      covered.add(n.wordIndex!)
    }
    expect(covered.size).toBe(flat.length)
  })

  it('repeats the same melody in every chorus', () => {
    const flat = res.timedLyrics.flatMap((l) => l.words.map(() => l))
    const byChorusLine = new Map<string, string[]>()
    const notesByLine = new Map<object, typeof res.melody>()
    for (const n of res.melody) {
      const line = flat[n.wordIndex!]
      if (!notesByLine.has(line)) notesByLine.set(line, [])
      notesByLine.get(line)!.push(n)
    }
    for (const tl of res.timedLyrics) {
      if (tl.section !== 'Chorus') continue
      const ns = notesByLine.get(tl)!
      const sig = ns.map((n) => `${n.midi}:${(n.start - tl.start).toFixed(3)}:${(n.end - n.start).toFixed(3)}`).join(' ')
      if (!byChorusLine.has(tl.text)) byChorusLine.set(tl.text, [])
      byChorusLine.get(tl.text)!.push(sig)
    }
    expect(byChorusLine.size).toBeGreaterThan(0)
    let repeats = 0
    for (const sigs of byChorusLine.values()) {
      if (sigs.length > 1) repeats++
      for (const s of sigs) expect(s).toBe(sigs[0])
    }
    expect(repeats).toBeGreaterThan(0)
  })

  it('keeps the vocal stem silent outside sung notes (plus reverb tail)', () => {
    const v = res.vocals!
    const first = res.melody[0].start
    expect(rmsRange(v, 0, first - 0.01)).toBe(0)
    // long gaps between sung notes: after the reverb has decayed the stem must be (near) silent
    const notes = res.melody
    let checked = 0
    for (let i = 0; i + 1 < notes.length; i++) {
      const gap0 = notes[i].end
      const gap1 = notes[i + 1].start
      if (gap1 - gap0 > 6) {
        expect(rmsRange(v, gap0 + 4.5, gap1 - 0.01)).toBeLessThan(2e-3)
        checked++
      }
    }
    const lastEnd = notes[notes.length - 1].end
    if (res.durationSec - lastEnd > 5) expect(rmsRange(v, lastEnd + 4.5, res.durationSec)).toBeLessThan(2e-3)
    // instrumental is clearly not the mix (vocals removed)
    let diff = 0
    for (let i = 0; i < res.mix.left.length; i += 101) diff += Math.abs(res.mix.left[i] - res.instrumental.left[i])
    expect(diff).toBeGreaterThan(1)
    void checked
  })
})

describe('composeLocal (instrumental, determinism, seeds)', () => {
  const base: ComposeRequest = { title: 'x', style: '80s synthwave, dreamy', lyrics: { sections: [] }, instrumental: true, seed: 42, durationHint: 45 }
  it('instrumental mode: no vocals, no lyrics, lead melody without words', async () => {
    const r = await composeLocal(base)
    expect(r.vocals).toBeUndefined()
    expect(r.timedLyrics).toEqual([])
    expect(r.melody.length).toBeGreaterThan(10)
    for (const n of r.melody) {
      expect(n.wordIndex).toBeUndefined()
      expect(n.end).toBeGreaterThan(n.start)
    }
    expect(hasNaN(r.mix)).toBe(false)
    expect(peak(r.mix)).toBeLessThanOrEqual(CEIL + 1e-6)
    expect(r.tags).toContain('instrumental')
  }, 30000)

  it('is deterministic for a seed', async () => {
    const a = await composeLocal(base)
    const b = await composeLocal(base)
    expect(fingerprint(a.mix)).toEqual(fingerprint(b.mix))
    expect(a.melody).toEqual(b.melody)
  }, 30000)

  it('different seeds give noticeably different songs', async () => {
    const plans = [1, 2, 3, 4].map((seed) => __internal.planSong({ ...base, instrumental: false, lyrics: parseLyrics(generateLocalLyrics('summer', 1).lyrics), seed }))
    const sigs = plans.map((p) => `${p.key.tonic}${p.key.mode}|${p.bpm}|${p.sections.map((s) => s.chords.map((c) => c.chord.symbol).join(',')).join(';')}|${p.melody.map((n) => n.midi).join(',')}`)
    expect(new Set(sigs).size).toBe(4)
    for (let i = 1; i < plans.length; i++) expect(plans[i].melody.map((n) => n.midi)).not.toEqual(plans[0].melody.map((n) => n.midi))
    const a = await composeLocal({ ...base, seed: 1 })
    const b = await composeLocal({ ...base, seed: 2 })
    expect(fingerprint(a.mix)).not.toEqual(fingerprint(b.mix))
  }, 30000)

  it('respects explicit bpm and key', async () => {
    const r = await composeLocal({ ...base, style: 'lofi in E minor, 80 bpm', durationHint: 30 })
    expect(r.bpm).toBe(80)
    expect(r.key).toEqual({ tonic: 4, mode: 'minor' })
    expect(r.tags).toContain('E minor')
  }, 30000)
})

describe('genre coverage', () => {
  const styles = [
    'pop', 'rock', 'boom bap hip hop', 'trap', 'r&b', 'house', 'synthwave', 'lofi', 'country', 'folk', 'jazz', 'piano ballad',
    'metal', 'punk', 'reggae', 'reggaeton', 'gospel', 'k-pop', 'cinematic',
  ]
  it('renders every genre cleanly (short instrumental)', async () => {
    for (const style of styles) {
      const r = await composeLocal({ title: style, style, lyrics: { sections: [] }, instrumental: true, seed: 3, durationHint: 24 })
      expect(hasNaN(r.mix), style).toBe(false)
      expect(peak(r.mix), style).toBeLessThanOrEqual(CEIL + 1e-6)
      expect(rmsRange(r.mix, 2, r.durationSec - 1), style).toBeGreaterThan(0.02)
    }
  }, 120000)
  it('renders a short sung song for every genre', async () => {
    const lyrics = parseLyrics('[Verse]\nI walk along the river light\n[Chorus]\nOh tonight we shine so bright\nOh tonight we shine so bright')
    for (const style of styles) {
      const r = await composeLocal({ title: style, style, lyrics, instrumental: false, seed: 9, durationHint: 20 })
      expect(hasNaN(r.mix), style).toBe(false)
      expect(hasNaN(r.vocals!), style).toBe(false)
      expect(peak(r.vocals!), style).toBeLessThanOrEqual(CEIL + 1e-6)
      expect(r.timedLyrics.length, style).toBe(3)
    }
  }, 180000)
})

describe('performance', () => {
  it('renders a 2:30 vocal song in < 12 s', async () => {
    const ly = generateLocalLyrics('city lights and a long drive home', 5)
    const t0 = performance.now()
    const r = await composeLocal({ title: ly.title, style: 'synthwave, female vocals, 100 bpm', lyrics: parseLyrics(ly.lyrics), instrumental: false, seed: 5, durationHint: 150 })
    const ms = performance.now() - t0
    console.log(`perf: ${r.durationSec.toFixed(1)} s song in ${ms.toFixed(0)} ms`)
    expect(r.durationSec).toBeGreaterThan(140)
    expect(ms).toBeLessThan(12000)
  }, 60000)
})
