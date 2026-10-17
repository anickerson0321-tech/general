// Song planning: resolve the style with the seed, build the section structure, chords and melody.
import type { ComposeRequest, LyricSection, MusicalKey } from '../../types'
import { splitWords } from '../../lib/lyrics'
import { chooseProgressions, chooseScale, motifProgKey } from './harmony'
import type { ChordEvent, LinePlan, MotifKey, SectionPlan, SongPlan } from './model'
import { buildHook, composeMelody } from './melody'
import { Rng, mixSeed } from './rng'
import type { InstrumentSet, LeadType, StyleProfile } from './style'
import { GENRE_BY_ID, analyzeStyle } from './style'
import { countSyllables } from './syllables'
import { SCALES, parseRoman } from './theory'

export function motifOf(tag: string): MotifKey {
  const t = tag.toLowerCase()
  if (t.startsWith('intro')) return 'intro'
  if (t.startsWith('pre') || t.startsWith('build')) return 'pre'
  if (t.startsWith('post')) return 'post'
  if (t.includes('chorus') || t.startsWith('hook') || t.startsWith('refrain') || t.startsWith('drop')) return 'chorus'
  if (t.startsWith('bridge')) return 'bridge'
  if (t.startsWith('break')) return 'break'
  if (t.startsWith('instrumental') || t.startsWith('solo') || t.startsWith('interlude')) return 'inst'
  if (t.startsWith('outro') || t.startsWith('end')) return 'outro'
  return 'verse'
}

const BASE_ENERGY: Record<MotifKey, number> = {
  intro: 0.35,
  verse: 0.5,
  pre: 0.65,
  chorus: 0.88,
  post: 0.8,
  bridge: 0.45,
  inst: 0.75,
  break: 0.3,
  outro: 0.38,
}

/** Choose beats per lyric line so syllables fit comfortably at this tempo. */
function beatsPerLine(maxSyl: number, spb: number): number {
  const want = Math.max(2.8, maxSyl * 0.36 + 1.1) // seconds
  let best = 8
  let bestErr = Infinity
  for (const b of [4, 8, 16]) {
    const slots = b * 4 - (b >= 8 ? 6 : 3)
    if (maxSyl > slots) continue
    const err = Math.abs(b * spb - want) + (maxSyl * 2 > slots && b < 16 ? 0.4 : 0)
    if (err < bestErr) {
      bestErr = err
      best = b
    }
  }
  if (maxSyl > 16 * 4 - 6) best = 32
  return best
}

const MAJOR_KEYS_GUITAR = [4, 9, 2, 7, 0]
const MINOR_KEYS_GUITAR = [4, 9, 2, 7, 11]

function resolveInstruments(p: StyleProfile, r: Rng, influence: number): InstrumentSet {
  const inst: InstrumentSet = { ...p.instruments }
  const loose = 1 - influence
  const named = p.namedInstruments
  const pickLead = (opts: LeadType[]) => (inst.lead = r.pick(opts))
  // seed-dependent variations inside the genre (so two versions differ)
  switch (p.genre) {
    case 'pop':
      if (!named.length && r.chance(0.4)) inst.guitar = r.chance(0.5) ? 'clean' : null
      if (!named.length && r.chance(0.35)) inst.keys = r.chance(0.5) ? 'epiano' : null
      if (r.chance(0.4) && !named.some((n) => n.includes('lead'))) pickLead(['pluck', 'bell', 'saw', 'square'])
      if (!inst.keys && !inst.guitar) inst.keys = 'piano'
      break
    case 'edm':
    case 'kpop':
      if (r.chance(0.5)) pickLead(['pluck', 'saw', 'square', 'bell'])
      if (r.chance(0.3) && !named.includes('piano')) inst.keys = null
      break
    case 'synthwave':
      if (r.chance(0.4)) pickLead(['saw', 'square', 'brass'])
      if (r.chance(0.3)) inst.keys = 'epiano'
      break
    case 'lofi':
      if (r.chance(0.35) && !named.includes('rhodes')) inst.keys = 'piano'
      if (r.chance(0.4)) inst.guitar = 'clean'
      if (r.chance(0.3)) inst.bass = 'upright'
      if (r.chance(0.3)) pickLead(['flute', 'bell', 'sax'])
      break
    case 'trap':
      if (r.chance(0.4)) pickLead(['bell', 'pluck', 'flute', 'piano'])
      if (r.chance(0.35)) inst.keys = 'piano'
      break
    case 'hiphop':
      if (r.chance(0.4)) inst.keys = 'epiano'
      if (r.chance(0.3)) inst.strings = true
      if (r.chance(0.3)) pickLead(['bell', 'brass', 'flute'])
      break
    case 'rnb':
      if (r.chance(0.3)) inst.guitar = 'clean'
      if (r.chance(0.3)) inst.bass = 'synth'
      break
    case 'rock':
      if (r.chance(0.3)) inst.keys = 'organ'
      if (r.chance(0.3)) inst.guitar = 'distorted'
      break
    case 'country':
      if (r.chance(0.35)) inst.guitar2 = 'clean'
      if (r.chance(0.3)) inst.keys = null
      break
    case 'folk':
      if (r.chance(0.4)) inst.keys = 'piano'
      if (r.chance(0.4)) inst.lead = null
      break
    case 'ballad':
      if (r.chance(0.3)) inst.pad = 'warm'
      break
    case 'cinematic':
      if (r.chance(0.4)) inst.choir = false
      break
    case 'latin':
      if (r.chance(0.4)) pickLead(['pluck', 'brass', 'flute'])
      break
    default:
      break
  }
  // weak style influence: borrow a random element
  if (r.chance(loose * 0.6)) {
    const roll = r.int(0, 4)
    if (roll === 0 && !inst.pad) inst.pad = 'warm'
    else if (roll === 1 && !inst.keys) inst.keys = r.pick(['piano', 'epiano', 'organ'] as const)
    else if (roll === 2 && !inst.arp) inst.arp = true
    else if (roll === 3) inst.lead = r.pick(['bell', 'flute', 'saw', 'pluck', 'sax'] as LeadType[])
    else if (roll === 4 && !inst.strings) inst.strings = true
  }
  // honour exclusions again (they always win)
  return applyExclusions(inst, p)
}

function applyExclusions(inst: InstrumentSet, p: StyleProfile): InstrumentSet {
  const ex = p.excluded
  if (ex.some((e) => ['drums', 'drum', 'percussion', 'beat', 'beats', 'kick'].includes(e))) inst.drums = null
  if (ex.includes('bass')) inst.bass = null
  if (ex.some((e) => ['piano', 'keys', 'keyboard'].includes(e))) {
    inst.keys = null
    if (inst.lead === 'piano') inst.lead = null
  }
  if (ex.some((e) => e === 'guitar' || e === 'guitars')) {
    inst.guitar = null
    inst.guitar2 = null
    if (inst.lead === 'guitar' || inst.lead === 'steel') inst.lead = null
  }
  if (ex.some((e) => ['synth', 'synths', 'synthesizer', 'electronic'].includes(e))) {
    if (inst.pad === 'warm' || inst.pad === 'supersaw') inst.pad = null
    if (inst.lead === 'saw' || inst.lead === 'square' || inst.lead === 'pluck') inst.lead = null
    inst.arp = false
    if (inst.bass === 'synth') inst.bass = 'picked'
  }
  if (ex.some((e) => ['strings', 'violin', 'cello', 'orchestra'].includes(e))) {
    inst.strings = false
    if (inst.pad === 'strings') inst.pad = null
  }
  if (ex.some((e) => ['brass', 'horns', 'trumpet'].includes(e))) {
    inst.brass = false
    if (inst.lead === 'brass') inst.lead = null
  }
  if (ex.includes('choir')) inst.choir = false
  if (ex.some((e) => e.startsWith('arp'))) inst.arp = false
  if (ex.some((e) => e === 'sax' || e === 'saxophone') && inst.lead === 'sax') inst.lead = null
  return inst
}

interface RawSection {
  tag: string
  label: string
  motif: MotifKey
  lines: string[]
  bars: number
}

function defaultStructure(totalBars: number, bpm: number): RawSection[] {
  const S = (tag: string, bars: number, label = tag): RawSection => ({ tag, label, motif: motifOf(tag), lines: [], bars })
  const introBars = bpm < 80 ? 2 : 4
  const out: RawSection[] = [S('Intro', introBars), S('Verse', 8, 'Verse 1'), S('Pre-Chorus', 4), S('Chorus', 8), S('Verse', 8, 'Verse 2'), S('Pre-Chorus', 4), S('Chorus', 8)]
  let used = out.reduce((a, s) => a + s.bars, 0) + 4
  if (totalBars - used >= 16) {
    out.push(S('Bridge', 8))
    out.push(S('Chorus', 8))
    used += 16
  } else if (totalBars - used >= 8) {
    out.push(S('Chorus', 8))
    used += 8
  }
  if (totalBars - used >= 8) {
    out.splice(out.length - 1, 0, S('Instrumental', 8))
    used += 8
  }
  if (totalBars < used - 12) {
    // short song: remove pre-choruses
    return [S('Intro', introBars), S('Verse', 8, 'Verse 1'), S('Chorus', 8), S('Verse', 8, 'Verse 2'), S('Chorus', 8), S('Outro', 4)]
  }
  out.push(S('Outro', totalBars - used >= 4 ? 8 : 4))
  return out
}

export function planSong(req: ComposeRequest): SongPlan {
  const seed = req.seed >>> 0
  const r = new Rng(mixSeed(seed, 'plan'))
  const weird = Math.max(0, Math.min(1, req.weirdness ?? 0.3))
  const infl = Math.max(0, Math.min(1, req.styleInfluence ?? 0.7))
  const profile = analyzeStyle(req.style ?? '', req.excludeStyle)
  const def = GENRE_BY_ID[profile.genre]
  // ---- tempo
  let bpm = profile.bpm
  if (!profile.bpmExplicit) {
    const [lo, hi] = def.bpm
    bpm = Math.round(Math.max(lo - 4, Math.min(hi + 6, profile.bpm + r.int(-8, 8) + (1 - infl) * r.int(-6, 6))))
  }
  const spb = 60 / bpm
  // ---- key
  let key: MusicalKey = profile.key
  if (!profile.keyExplicit) {
    let mode = profile.key.mode
    if (!profile.modeExplicit && def.minorProb > 0.2 && def.minorProb < 0.85) {
      const pMinor = Math.max(0.05, Math.min(0.95, (mode === 'minor' ? 0.75 : 0.25) - profile.valence * 0.2))
      mode = r.chance(pMinor) ? 'minor' : 'major'
    }
    const guitarGenres = ['rock', 'folk', 'country', 'metal', 'punk', 'reggae']
    const tonic = guitarGenres.includes(profile.genre) ? r.pick(mode === 'major' ? MAJOR_KEYS_GUITAR : MINOR_KEYS_GUITAR) : r.int(0, 11)
    key = { tonic, mode }
  }
  const scaleName = chooseScale(key.mode, profile.genre, r, weird)
  const scale = SCALES[scaleName]
  // ---- vocals
  let gender: 'male' | 'female'
  if (req.vocalGender === 'male' || req.vocalGender === 'female') gender = req.vocalGender
  else if (profile.vocalGender !== 'any') gender = profile.vocalGender
  else gender = r.chance(0.5) ? 'female' : 'male'
  const vocalLow = gender === 'male' ? 46 : 57
  const vocalHigh = gender === 'male' ? 64 : 76
  // ---- instruments (seeded variation)
  const instruments = resolveInstruments(profile, r, infl)
  const resolved: StyleProfile = { ...profile, bpm, key, vocalGender: gender, instruments }
  // ---- structure
  const hasLyrics = req.lyrics.sections.some((s) => s.lines.length > 0)
  let raw: RawSection[] = []
  if (hasLyrics) {
    raw = req.lyrics.sections.map((s: LyricSection) => ({ tag: s.tag, label: s.label, motif: motifOf(s.tag), lines: s.lines.slice(), bars: 0 }))
    if (raw[0].motif !== 'intro') raw.unshift({ tag: 'Intro', label: 'Intro', motif: 'intro', lines: [], bars: 0 })
    const last = raw[raw.length - 1]
    if (last.motif !== 'outro') raw.push({ tag: 'Outro', label: 'Outro', motif: 'outro', lines: [], bars: 0 })
  } else {
    const hint = req.durationHint && req.durationHint > 20 ? req.durationHint : 120 + r.int(0, 35)
    raw = defaultStructure(Math.round(hint / (spb * 4)), bpm)
  }
  const sections: SectionPlan[] = []
  let beat = 0
  const occ: Record<string, number> = {}
  let wordBase = 0
  for (let i = 0; i < raw.length; i++) {
    const rs = raw[i]
    occ[rs.motif] = (occ[rs.motif] ?? 0) + 1
    let bpl = 8
    let beats: number
    const linesWords = rs.lines.map((l) => splitWords(l))
    if (rs.lines.length) {
      const maxSyl = Math.max(...rs.lines.map((l) => countSyllables(l)), 1)
      bpl = beatsPerLine(maxSyl, spb)
      const raw16 = rs.lines.length * bpl
      beats = raw16 <= 8 ? 8 : Math.ceil(raw16 / 16) * 16
    } else if (rs.bars) beats = rs.bars * 4
    else {
      const m = rs.motif
      const bars = m === 'intro' ? (bpm < 80 ? 2 : bpm >= 118 && ['edm', 'kpop', 'synthwave'].includes(profile.genre) ? 8 : 4) : m === 'outro' ? (bpm < 80 ? 4 : 4) : m === 'break' ? 4 : 8
      beats = bars * 4
    }
    if (!hasLyrics && (rs.motif === 'verse' || rs.motif === 'chorus' || rs.motif === 'pre' || rs.motif === 'bridge')) {
      // instrumental: pseudo lines for the lead melody
      bpl = bpm >= 150 ? 16 : bpm < 72 ? 4 : 8
    }
    const motif = rs.motif
    let energy = BASE_ENERGY[motif] + (resolved.energy - 0.6) * 0.35
    if (motif === 'verse' && occ.verse > 1) energy += 0.07
    if (motif === 'chorus') energy += Math.min(0.1, (occ.chorus - 1) * 0.05)
    energy = Math.max(0.1, Math.min(1, energy))
    const sec: SectionPlan = { tag: rs.tag, label: rs.label, motif, startBeat: beat, beats, energy, chords: [], lines: [], beatsPerLine: bpl, occurrence: occ[motif], index: i }
    if (rs.lines.length) {
      rs.lines.forEach((text, li) => {
        const words = linesWords[li]
        const lp: LinePlan = { text, words, wordBase, startBeat: beat + li * bpl, beats: bpl, notes: [] }
        wordBase += words.length
        sec.lines.push(lp)
      })
    } else if (!hasLyrics && ['verse', 'chorus', 'pre', 'bridge'].includes(motif)) {
      const n = Math.floor(beats / bpl)
      for (let li = 0; li < n; li++) sec.lines.push({ text: '', words: [], wordBase: 0, startBeat: beat + li * bpl, beats: bpl, notes: [] })
    }
    sections.push(sec)
    beat += beats
  }
  // stretch very short lyric songs toward the duration hint with an instrumental break
  if (hasLyrics && req.durationHint && beat * spb < req.durationHint * 0.7) {
    const lastChorus = sections.map((s) => s.motif).lastIndexOf('chorus')
    if (lastChorus > 1) {
      const ins: SectionPlan = { tag: 'Instrumental', label: 'Instrumental', motif: 'inst', startBeat: 0, beats: 32, energy: 0.72, chords: [], lines: [], beatsPerLine: 8, occurrence: 1, index: 0 }
      sections.splice(lastChorus, 0, ins)
      let b = 0
      for (const s of sections) {
        const shift = b - s.startBeat
        s.startBeat = b
        for (const l of s.lines) l.startBeat += shift
        b += s.beats
      }
      beat = b
    }
  }
  sections.forEach((s, i) => (s.index = i))
  // ---- chords
  const progs = chooseProgressions(profile.genre, key.mode, r, weird, infl)
  const introUsesVerse = r.chance(0.35)
  const barsPerChord = profile.genre === 'trap' || (profile.genre === 'cinematic' && bpm > 90) || (profile.genre === 'edm' && r.chance(0.3)) ? 2 : bpm < 66 && r.chance(0.3) ? 0.5 : 1
  for (const s of sections) {
    let pk = motifProgKey(s.motif)
    if (s.motif === 'intro' && introUsesVerse) pk = 'verse'
    const prog = progs[pk]
    const chords: ChordEvent[] = []
    const bars = s.beats / 4
    const step = barsPerChord * 4
    let k = 0
    for (let b = 0; b < bars * 4; b += step) {
      const rn = prog[k % prog.length]
      chords.push({ chord: parseRoman(rn, key.tonic), beat: s.startBeat + b, beats: Math.min(step, bars * 4 - b) })
      k++
    }
    if (s.motif === 'outro' && chords.length) {
      const tonicRn = key.mode === 'minor' ? 'i' : 'I'
      const lastC = chords[chords.length - 1]
      lastC.chord = parseRoman(tonicRn, key.tonic)
    }
    s.chords = chords
  }
  const swingUnit: 8 | 16 = profile.genre === 'jazz' ? 8 : 16
  const plan: SongPlan = {
    profile: resolved,
    seed,
    weirdness: weird,
    styleInfluence: infl,
    bpm,
    spb,
    key,
    scale,
    vocalLow,
    vocalHigh,
    gender,
    sections,
    totalBeats: beat,
    musicSec: beat * spb,
    instrumental: req.instrumental || !hasLyrics,
    melody: [],
    hook: [],
    hookLen16: 32,
    swing: profile.swing,
    swingUnit,
  }
  composeMelody(plan)
  buildHook(plan)
  return plan
}
