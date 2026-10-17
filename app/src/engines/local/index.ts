// Encore "Local" engine: fully offline, pure-TypeScript song generator with a synthesised guide vocal.
import type { ComposeRequest, ComposeResult, MelodyNote, ProgressFn, TimedLine, TimedWord } from '../../types'
import { arrange } from './arrange'
import { SR } from './dsp'
import { Bus } from './instruments'
import { master, processInstrumental, processVocals } from './mix'
import type { SongPlan, VNote } from './model'
import { planSong } from './plan'
import { keyName } from './theory'
import { renderVoice } from './voice'

export { analyzeStyle, suggestStyles } from './style'
export type { StyleProfile, GenreId, InstrumentSet } from './style'
export { generateLocalLyrics } from './lyricsgen'
export { encodeWav16 } from './wav'

const tick = (): Promise<void> =>
  new Promise((res) => {
    if (typeof setTimeout === 'function') setTimeout(res, 0)
    else Promise.resolve().then(res)
  })

function timedLyrics(plan: SongPlan): TimedLine[] {
  const out: TimedLine[] = []
  for (const s of plan.sections) {
    for (const l of s.lines) {
      if (!l.words.length) continue
      const words: TimedWord[] = []
      let lastEnd = l.notes.length ? l.notes[0].start : 0
      l.words.forEach((w, wi) => {
        const idx = l.wordBase + wi
        const ns = l.notes.filter((n) => n.wordIndex === idx)
        if (ns.length) {
          const st = Math.max(lastEnd, ns[0].start)
          const en = Math.max(st, ns[ns.length - 1].end)
          words.push({ text: w, start: st, end: en })
          lastEnd = en
        } else words.push({ text: w, start: lastEnd, end: lastEnd })
      })
      out.push({ text: l.text, start: words[0].start, end: words[words.length - 1].end, words, section: s.label })
    }
  }
  return out
}

function vibratoFor(genre: string): number {
  if (genre === 'rnb' || genre === 'gospel' || genre === 'ballad' || genre === 'jazz' || genre === 'cinematic') return 0.42
  if (genre === 'rock' || genre === 'punk' || genre === 'metal' || genre === 'hiphop' || genre === 'trap') return 0.22
  return 0.32
}

/** Compose and render a complete song offline. */
export async function composeLocal(req: ComposeRequest, onProgress?: ProgressFn): Promise<ComposeResult> {
  const progress = async (f: number, label: string) => {
    onProgress?.(Math.max(0, Math.min(1, f)), label)
    await tick()
  }
  await progress(0.01, 'Reading the style')
  const plan = planSong(req)
  await progress(0.06, 'Writing chords')
  await progress(0.1, 'Writing melody')
  const tail = 2.6
  const n = Math.ceil((plan.musicSec + tail) * SR)
  const inst = new Bus(n)
  const arr = await arrange(plan, inst, async (f, label) => progress(0.1 + f * 0.75, label))
  // --- vocals
  let voc: Bus | null = null
  let mask: Float32Array | null = null
  if (!plan.instrumental && plan.melody.length) {
    await progress(0.66, 'Singing')
    voc = new Bus(n)
    const p = plan.profile
    const vib = vibratoFor(p.genre)
    const seed = plan.seed
    renderVoice(voc, plan.melody, { gender: plan.gender, breath: p.breathiness, seed: seed % 100000, detune: 0, useHarm: false, gain: 1, pan: 0, rev: 0.32, dly: 0.12, vibDepth: vib, formant: 1, tag: 'lead' })
    await progress(0.72, 'Singing harmonies')
    const big = new Set(plan.sections.filter((s) => s.motif === 'chorus' || s.motif === 'post').flatMap((s) => s.lines.flatMap((l) => l.notes)))
    const chorusNotes: VNote[] = plan.melody.filter((x) => big.has(x))
    if (chorusNotes.length) {
      // re-flag phrase boundaries for the subset
      const sub = chorusNotes.map((x, i) => {
        const nx = chorusNotes[i + 1]
        const pv = chorusNotes[i - 1]
        return { ...x, phraseStart: !pv || x.start - pv.end > 0.12 || x.phraseStart, phraseEnd: !nx || nx.start - x.end > 0.12 || x.phraseEnd }
      })
      renderVoice(voc, sub, { gender: plan.gender, breath: Math.min(1, p.breathiness + 0.15), seed: (seed % 100000) + 17, detune: 9, useHarm: false, gain: 0.36, pan: -0.45, rev: 0.4, dly: 0.1, vibDepth: vib * 0.8, formant: 1.02, tag: 'double' })
      renderVoice(voc, sub, { gender: plan.gender, breath: Math.min(1, p.breathiness + 0.2), seed: (seed % 100000) + 41, detune: -6, useHarm: true, gain: 0.3, pan: 0.45, rev: 0.45, dly: 0.1, vibDepth: vib * 0.8, formant: 0.98, tag: 'harmony' })
    }
    // mask of sung regions for level matching
    mask = new Float32Array(n)
    for (const m of plan.melody) mask.fill(1, Math.max(0, Math.floor(m.start * SR)), Math.min(n, Math.ceil(m.end * SR)))
    await progress(0.8, 'Mixing vocals')
    processVocals(voc, plan)
  }
  await progress(0.84, 'Mixing')
  processInstrumental(inst, plan)
  await progress(0.92, 'Mastering')
  const m = master(inst, voc, plan, mask)
  // trim trailing silence (keep >= 0.6 s after the music)
  let end = n
  const minEnd = Math.min(n, Math.ceil((plan.musicSec + 0.6) * SR))
  while (end > minEnd && Math.abs(m.mix.left[end - 1]) < 2e-4 && Math.abs(m.mix.right[end - 1]) < 2e-4) end--
  // short fade to avoid a click at the very end
  const fade = Math.min(end, Math.round(0.08 * SR))
  const bufs = [m.mix, m.instrumental, ...(m.vocals ? [m.vocals] : [])]
  for (const b of bufs) {
    for (let i = 0; i < fade; i++) {
      const g = i / fade
      b.left[end - 1 - i] *= g
      b.right[end - 1 - i] *= g
    }
  }
  const cut = (b: { sampleRate: number; left: Float32Array; right: Float32Array }) => (end === n ? b : { sampleRate: b.sampleRate, left: b.left.slice(0, end), right: b.right.slice(0, end) })
  const melody: MelodyNote[] = plan.instrumental
    ? arr.leadNotes.slice().sort((a, b) => a.start - b.start)
    : plan.melody.map((x) => ({ start: x.start, end: x.end, midi: x.midi, wordIndex: x.wordIndex }))
  const p = plan.profile
  const tags: string[] = [p.genreLabel]
  for (const t of p.tags.slice(1)) {
    if (/vocals$/.test(t)) continue
    if (!tags.includes(t)) tags.push(t)
  }
  if (!plan.instrumental) tags.splice(1, 0, `${plan.gender} vocals`)
  else tags.push('instrumental')
  tags.push(`${plan.bpm} bpm`, keyName(plan.key))
  await progress(1, 'Done')
  return {
    mix: cut(m.mix),
    instrumental: cut(m.instrumental),
    vocals: m.vocals ? cut(m.vocals) : undefined,
    melody,
    timedLyrics: plan.instrumental ? [] : timedLyrics(plan),
    key: plan.key,
    bpm: plan.bpm,
    durationSec: end / SR,
    tags,
  }
}

/** Internal hooks for tests and tooling. */
export const __internal = { planSong }
