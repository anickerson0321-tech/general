// Arrangement: turns the song plan into parts for every instrument and renders them into the bus.
import type { MelodyNote } from '../../types'
import { SR } from './dsp'
import type { DrumHit, DrumStyle } from './drums'
import { barHits, buildKit, drumStyleFor, renderDrums } from './drums'
import type { BassNote, Bus, GuitarKind, KeyNote, LeadKind, LeadNote, PadKind } from './instruments'
import {
  renderBass,
  renderEPiano,
  renderImpact,
  renderLeadPhrase,
  renderOrgan,
  renderPad,
  renderPiano,
  renderPluck,
  renderReverseCymbal,
  renderRiser,
  renderStrum,
  renderVinyl,
} from './instruments'
import type { SectionPlan, SongPlan } from './model'
import { beatToSec } from './model'
import { Rng, mixSeed } from './rng'
import type { Chord } from './theory'
import { chordPcs, chordThird, pcInRange, voiceChord } from './theory'

type Yield = (frac: number, label: string) => Promise<void>

const ELECTRONIC: DrumStyle[] = ['house', 'dance', 'trap', 'synthwave', 'dembow']

interface ChordSpan {
  chord: Chord
  next: Chord
  sec: SectionPlan
  /** absolute 16th */
  p0: number
  len16: number
}

function spans(plan: SongPlan): ChordSpan[] {
  const out: ChordSpan[] = []
  const all = plan.sections.flatMap((s) => s.chords.map((c) => ({ c, s })))
  all.forEach(({ c, s }, i) => {
    out.push({ chord: c.chord, next: (all[i + 1] ?? all[i]).c.chord, sec: s, p0: c.beat * 4, len16: c.beats * 4 })
  })
  return out
}

/** expand a 16-step pattern string over a span, returning (pos16, len16, char) events */
function patternEvents(pat: string, len16: number): Array<{ p: number; l: number; c: string }> {
  const ev: Array<{ p: number; l: number; c: string }> = []
  for (let i = 0; i < len16; i++) {
    const c = pat[i % pat.length]
    if (c === '.' || c === '-') continue
    let l = 1
    while (i + l < len16 && pat[(i + l) % pat.length] === '-') l++
    ev.push({ p: i, l, c })
  }
  return ev
}

const BASS_PATS: Record<string, [string, string, string]> = {
  pop: ['R-------R---F---', 'R--R--R-R--R--R-', 'R.R.R.RRR.R.R.RO'],
  dance: ['R-------R-------', 'R.RR.RR.R.RR.RRO', 'ROROROROROROROR.'],
  house: ['R-------R-------', '..R...R...R...R.', '..RR..RR..RR..RO'],
  rock: ['R-------R-------', 'R.R.R.R.R.R.R.R.', 'R.R.R.R.R.R.R.OA'],
  punk: ['R.R.R.R.R.R.R.R.', 'R.R.R.R.R.R.R.R.', 'RRRRRRRRRRRRRRRR'],
  metal: ['R-------R-------', 'R.R.R.R.R.R.R.R.', 'RRRRRRRRRRRRRRRR'],
  boombap: ['R---------R-----', 'R------R--R-----', 'R------R--R--A-.'],
  rnb: ['R-------R-------', 'R-----R-..R---A-', 'R--R--O-.RR---FA'],
  synthwave: ['R-------R-------', 'R.R.R.R.R.R.R.R.', 'RORORORORORORORO'],
  lofi: ['R-------R-------', 'R------R--R-----', 'R-----R-..R---A-'],
  country: ['R-------F-------', 'R---F---R---F---', 'R---F---R---F-A-'],
  folk: ['R---------------', 'R-------F-------', 'R---F---R---F---'],
  ballad: ['R---------------', 'R-------F-------', 'R-----R-R-------'],
  onedrop: ['R--.R.F-..R.O-F.', 'R--.R.F-..R.O-F.', 'R-.RR.F-R-.RO-F.'],
  dembow: ['R-------R-------', 'R--R..R.R--R..R.', 'R--R..R.R--R..RO'],
  gospel: ['R-------R-------', 'R---O-F-R--AR-A-', 'R-ORF-O-R-OAR-FA'],
  epic: ['R---------------', 'R---------------', 'R-------R-------'],
  jazz: ['R---------------', 'R---------------', 'R---------------'],
  trap: ['R---------------', 'R---------------', 'R---------------'],
}

export interface ArrangeOut {
  leadNotes: MelodyNote[]
  kickTimes: number[]
}

export async function arrange(plan: SongPlan, bus: Bus, step: Yield): Promise<ArrangeOut> {
  const p = plan.profile
  const inst = p.instruments
  const g = p.genre
  const seed = plan.seed
  const r = new Rng(mixSeed(seed, 'arrange'))
  const t16 = (pos16: number) => beatToSec(plan, pos16 / 4)
  const bright = p.brightness
  const revAmt = 0.6 + p.reverb * 0.8
  const kitName = inst.drums
  const drumStyle: DrumStyle = kitName ? drumStyleFor(g, kitName) : 'pop'
  const electronic = ELECTRONIC.includes(drumStyle)
  const secs = plan.sections
  const lastSec = secs[secs.length - 1]
  const songEnd16 = plan.totalBeats * 4

  // ================================================================ DRUMS
  const hits: DrumHit[] = []
  const drumMin = g === 'ballad' ? 0.5 : g === 'folk' ? 0.36 : g === 'cinematic' ? 0.42 : g === 'jazz' ? 0 : 0.28
  if (kitName) {
    const kit = buildKit(kitName, mixSeed(seed, 'kit'))
    const human = electronic ? 0.0015 : kitName === 'lofi' ? 0.012 : 0.006
    for (let si = 0; si < secs.length; si++) {
      const s = secs[si]
      const next = secs[si + 1]
      const prev = secs[si - 1]
      let e = s.energy
      if (s.motif === 'intro' && (g === 'edm' || g === 'kpop' || g === 'synthwave') && e < drumMin) e = drumMin
      if (e < drumMin) continue
      const bars = s.beats / 4
      let level: 0 | 1 | 2 = e < 0.45 ? 0 : e < 0.74 ? 1 : 2
      if (s.motif === 'bridge' && level > 1) level = 1
      for (let b = 0; b < bars; b++) {
        const bar16 = s.startBeat * 4 + b * 16
        const lastBar = b === bars - 1
        let fill: 'none' | 'toms' | 'snare' | 'build' | 'stop' = 'none'
        if (lastBar && next) {
          const big = next.motif === 'chorus' || next.motif === 'inst' || next.motif === 'post'
          if (big && s.motif === 'pre' && (drumStyle === 'house' || drumStyle === 'dance')) fill = 'build'
          else if (big) fill = electronic || drumStyle === 'lofi' || drumStyle === 'boombap' || drumStyle === 'rnb' ? (r.chance(0.5) ? 'snare' : 'stop') : drumStyle === 'jazz' ? 'snare' : 'toms'
          else if (next.motif === 'bridge' || next.motif === 'outro') fill = r.chance(0.5) ? 'snare' : 'none'
          else if (r.chance(0.5)) fill = electronic ? 'snare' : r.chance(0.5) ? 'toms' : 'snare'
          if (drumStyle === 'epic') fill = big ? 'toms' : 'none'
        } else if (b % 8 === 7 && r.chance(0.35)) fill = electronic ? 'none' : 'snare'
        if (s.motif === 'pre' && (drumStyle === 'house' || drumStyle === 'dance') && b === bars - 2 && bars >= 4) fill = 'build'
        // last bar of the song: only a final hit
        if (s === lastSec && lastBar) {
          hits.push({ t: t16(bar16), inst: 'k', vel: 1 })
          hits.push({ t: t16(bar16), inst: drumStyle === 'epic' ? 'taiko' : 'crash', vel: 0.95 })
          continue
        }
        const crash =
          b === 0 &&
          drumStyle !== 'jazz' &&
          (s.motif === 'chorus' || s.motif === 'inst' || s.motif === 'post' || (prev && prev.motif === 'chorus' && s.motif !== 'bridge') || (s.motif === 'verse' && s.occurrence === 1 && prev?.motif === 'intro' && e > 0.4))
        const lv: 0 | 1 | 2 = s.motif === 'outro' && b >= bars / 2 ? 0 : level
        const bh = barHits({ style: drumStyle, level: lv, bar16, barInSection: b, barsInSection: bars, fill, crash, r, humanize: human, weird: plan.weirdness })
        for (const h of bh) {
          const pos = bar16 + h.p
          if (pos >= songEnd16) continue
          const jitter = (r.next() - 0.5) * 2 * human
          const boost = drumStyle === 'trap' && (h.inst === 'clap' || h.inst === 's') ? 1.6 : 1
          hits.push({ t: Math.max(0, t16(pos) + jitter), inst: h.inst, vel: h.vel * boost })
        }
      }
    }
    const snareRev = drumStyle === 'synthwave' ? 3 : drumStyle === 'ballad' || drumStyle === 'epic' ? 1.8 : drumStyle === 'lofi' ? 0.7 : 1
    renderDrums(bus, kit, hits, kitName === 'brush' ? 0.75 : 0.85, snareRev * revAmt, r)
  }
  const kickTimes = hits.filter((h) => h.inst === 'k' || h.inst === 'taiko').map((h) => h.t).sort((a, b) => a - b)
  await step(0.3, 'Arranging drums')

  // ================================================================ SIDECHAIN
  if (p.sidechain && kickTimes.length) {
    const n = (bus.n >> 6) + 2
    const duck = new Float32Array(n).fill(1)
    const rel = Math.min(0.22, plan.spb * 0.45)
    for (const kt of kickTimes) {
      const c0 = Math.floor((kt * SR) / 64)
      const c1 = Math.min(n, c0 + Math.ceil((rel * 3 * SR) / 64))
      for (let c = c0; c < c1; c++) {
        const t = (c * 64) / SR - kt
        const v = t < 0.004 ? 1 - 0.65 * (t / 0.004) : 1 - 0.65 * Math.exp(-(t - 0.004) / (rel * 0.45))
        if (v < duck[c]) duck[c] = Math.max(0, v)
      }
    }
    bus.duck = duck
  }

  const sp = spans(plan)
  const secE = (s: SectionPlan) => s.energy
  const bassRoot = (pc: number) => pcInRange(pc, 28)

  // ================================================================ BASS
  if (inst.bass) {
    const kind = inst.bass
    const pats = BASS_PATS[drumStyle] ?? BASS_PATS.pop
    const bassMin = g === 'ballad' || g === 'folk' ? 0.42 : g === 'cinematic' ? 0.4 : 0.32
    let prevMidi: number | undefined
    const bassNotes: BassNote[] = []
    const octUp = kind === 'synth' && (g === 'synthwave' || g === 'kpop' || g === 'edm' || g === 'pop') ? 12 : 0
    for (const span of sp) {
      const s = span.sec
      const e = secE(s)
      if (e < bassMin) {
        prevMidi = undefined
        continue
      }
      if (s === lastSec && span.p0 + span.len16 >= songEnd16) {
        // final bar: one long root note
        bassNotes.push({ t: t16(span.p0), dur: Math.min(3, beatToSec(plan, (span.p0 + span.len16) / 4) - t16(span.p0)), midi: bassRoot(span.chord.bass) + octUp, vel: 0.9 })
        continue
      }
      const lvl = e < 0.45 ? 0 : e < 0.74 ? 1 : 2
      const root = bassRoot(span.chord.bass) + octUp
      const fifth = root + 7 > 45 + octUp ? root - 5 : root + 7
      const third = chordThird(span.chord)
      const nextRoot = bassRoot(span.next.bass) + octUp
      if (kind === '808' || drumStyle === 'trap') {
        // 808 follows the kick
        const k0 = t16(span.p0)
        const k1 = t16(span.p0 + span.len16)
        const ks = kickTimes.filter((t) => t >= k0 - 0.01 && t < k1 - 0.01)
        if (!ks.length || ks[0] > k0 + 0.02) ks.unshift(k0)
        ks.forEach((t, i) => {
          const tEnd = i + 1 < ks.length ? ks[i + 1] : k1
          const slide = r.chance(0.18 + plan.weirdness * 0.2) && i > 0
          const midi = slide ? root + 12 : root
          bassNotes.push({ t, dur: Math.max(0.08, tEnd - t - 0.02), midi, vel: 0.95, glideFrom: prevMidi !== undefined && prevMidi !== midi && r.chance(0.5) ? prevMidi : undefined })
          prevMidi = midi
        })
        continue
      }
      if (drumStyle === 'jazz') {
        // walking bass in quarter notes
        const pcs = chordPcs(span.chord)
        for (let q = 0; q < span.len16; q += 4) {
          const beatIdx = q / 4
          let m: number
          if (beatIdx === 0) m = root
          else if (q + 4 >= span.len16) m = nextRoot + (r.chance(0.5) ? -1 : 1)
          else m = pcInRange(pcs[(beatIdx % (pcs.length - 1)) + 1] ?? pcs[0], root - 2)
          bassNotes.push({ t: t16(span.p0 + q), dur: plan.spb * 0.92, midi: m, vel: beatIdx === 0 ? 0.95 : 0.8 })
        }
        continue
      }
      const pat = pats[lvl]
      for (const ev of patternEvents(pat, span.len16)) {
        let m = root
        if (ev.c === 'O') m = root + 12
        else if (ev.c === 'F') m = fifth
        else if (ev.c === '3') m = root + (third ?? 7)
        else if (ev.c === 'A') m = nextRoot + (nextRoot > root ? -1 : nextRoot < root ? 1 : r.chance(0.5) ? 2 : -1)
        const tS = t16(span.p0 + ev.p)
        const tE = t16(span.p0 + ev.p + ev.l)
        const gate = ev.l === 1 ? 0.7 : 0.92
        bassNotes.push({ t: tS, dur: Math.max(0.05, (tE - tS) * gate), midi: m, vel: ev.c === 'R' && ev.p % 16 === 0 ? 1 : 0.85 })
      }
    }
    const bassGain = kind === '808' ? 0.42 : kind === 'sub' ? 0.6 : kind === 'synth' ? 0.5 : 0.62
    bassNotes.forEach((n, i) => renderBass(bus, kind, n, bassGain * n.vel, p.sidechain, mixSeed(seed, 'b', i), bright))
  }
  await step(0.4, 'Playing bass')

  // ================================================================ KEYS
  const keysMin = g === 'edm' || g === 'kpop' ? 0.55 : 0
  if (inst.keys) {
    const kind = inst.keys
    let prevV: number[] | null = null
    const organChords: KeyNote[][] = []
    const kr = new Rng(mixSeed(seed, 'keys'))
    for (const span of sp) {
      const s = span.sec
      const e = secE(s)
      if (e < keysMin) continue
      // in heavy genres keys sit out the loud parts
      if ((g === 'rock' || g === 'metal' || g === 'punk') && kind !== 'organ') continue
      const lvl = e < 0.45 ? 0 : e < 0.74 ? 1 : 2
      const rootless = kind === 'epiano' && (g === 'lofi' || g === 'rnb' || g === 'jazz')
      const nV = kind === 'organ' ? 4 : 4
      const v = voiceChord(span.chord, prevV, kind === 'epiano' ? 50 : 53, kind === 'epiano' ? 72 : 76, nV, rootless || g === 'jazz')
      prevV = v
      const bassM = pcInRange(span.chord.bass, 36)
      const t0 = t16(span.p0)
      const tEnd = t16(span.p0 + span.len16)
      const spanDur = tEnd - t0
      const final = s === lastSec && span.p0 + span.len16 >= songEnd16
      if (kind === 'organ') {
        if (g === 'reggae' && !final) {
          // organ bubble: short chords on the off-beats
          for (let q = 2; q < span.len16; q += 4) organChords.push(v.map((m) => ({ t: t16(span.p0 + q), dur: plan.spb * 0.22, midi: m, vel: 0.7 })))
        } else {
          organChords.push(v.map((m) => ({ t: t0, dur: spanDur * (final ? 1.5 : 0.98), midi: m, vel: 0.8 })))
          if (g === 'gospel' && lvl >= 1) organChords.push([{ t: t0, dur: spanDur * 0.98, midi: bassM + 12, vel: 0.7 }])
        }
        continue
      }
      const play = (rel16: number, dur: number, notes: number[], vel: number, lh = false) => {
        const tt = t16(span.p0 + rel16)
        for (const m of notes) {
          const kn: KeyNote = { t: tt + (kr.next() - 0.5) * 0.008, dur, midi: m, vel: Math.min(1, vel * (0.92 + kr.next() * 0.12)) }
          if (kind === 'piano') renderPiano(bus, kn, lh ? 0.5 : 0.42, lh ? -0.1 : 0.1, 0.2 * revAmt, bright)
          else renderEPiano(bus, kn, 0.5, 0, 0.16 * revAmt, inst.vinyl ? 1 : 0)
        }
      }
      if (final) {
        play(0, 3.5, v, 0.75)
        if (kind === 'piano') play(0, 3.5, [bassM, bassM + 12], 0.7, true)
        continue
      }
      const style = g === 'ballad' || g === 'cinematic' || (g === 'folk' && kind === 'piano') ? 'ballad' : g === 'gospel' ? 'gospel' : g === 'jazz' ? 'jazz' : kind === 'epiano' ? 'ep' : g === 'hiphop' || g === 'trap' ? 'loop' : 'pop'
      if (style === 'ballad') {
        // left hand: root (+octave), right hand: broken chord in 8ths
        play(0, spanDur * 0.98, lvl >= 2 ? [bassM, bassM + 12] : [bassM + 12], 0.62, true)
        const arpOrder = [0, 1, 2, 3, 2, 1, 2, 3]
        const stepLen = lvl >= 2 ? 2 : 2
        for (let q = 0, k = 0; q < span.len16; q += stepLen, k++) {
          const m = v[arpOrder[k % arpOrder.length] % v.length]
          play(q, Math.min(spanDur, plan.spb * 2), [m], q % 8 === 0 ? 0.6 : 0.45)
        }
        if (lvl >= 2) play(0, spanDur * 0.9, v.slice(1), 0.45)
      } else if (style === 'gospel') {
        play(0, spanDur * 0.5, [bassM, bassM + 12], 0.7, true)
        const hitsAt = lvl >= 1 ? [0, 6, 10, 14] : [0, 8]
        for (const h of hitsAt) if (h < span.len16) play(h, plan.spb * (h === 0 ? 1.4 : 0.7), v, h === 0 ? 0.7 : 0.55)
      } else if (style === 'jazz') {
        const comps = kr.pick([[0, 6], [2, 8], [0, 10], [4, 10, 14], [0, 7]])
        for (const h of comps) if (h < span.len16) play(h, plan.spb * kr.pick([0.6, 1, 1.5]), v, 0.55)
      } else if (style === 'ep') {
        play(0, Math.min(spanDur, plan.spb * 2.6), v, 0.65)
        if (lvl >= 1) {
          const h = kr.pick([6, 10, 11, 8])
          if (h < span.len16) play(h, plan.spb * 1.5, v, 0.5)
        }
        if (kind === 'epiano' && g !== 'lofi' && lvl >= 1) play(0, spanDur * 0.9, [bassM + 12], 0.4, true)
      } else if (style === 'loop') {
        const hitsAt = [0, 6, 10]
        for (const h of hitsAt) if (h < span.len16) play(h, plan.spb * 1.4, h === 0 ? v : v.slice(1), 0.55)
      } else {
        // pop: sustained chord in verses, rhythmic eighths in big sections
        if (lvl === 0) play(0, spanDur * 0.97, v, 0.55)
        else if (lvl === 1) {
          play(0, plan.spb * 1.4, v, 0.6)
          play(6, plan.spb * 1.4, v, 0.48)
          if (span.len16 > 12) play(12, plan.spb * 0.9, v, 0.45)
        } else {
          for (let q = 0; q < span.len16; q += 2) play(q, plan.spb * 0.45, v, q % 8 === 0 ? 0.62 : 0.45)
        }
        if (lvl >= 1) play(0, spanDur * 0.95, [bassM], 0.45, true)
      }
    }
    for (const c of organChords) renderOrgan(bus, c, g === 'reggae' ? 0.42 : 0.36, 0, 0.2 * revAmt, g === 'gospel' || g === 'jazz')
  }
  await step(0.5, 'Playing chords')

  // ================================================================ GUITARS
  const guitarParts: Array<{ kind: GuitarKind; layer: number }> = []
  if (inst.guitar) guitarParts.push({ kind: inst.guitar, layer: 0 })
  if (inst.guitar2 && inst.guitar2 !== inst.guitar) guitarParts.push({ kind: inst.guitar2, layer: 1 })
  else if (inst.guitar2 === 'distorted' && inst.guitar === 'distorted') guitarParts[0].layer = 2
  for (const gp of guitarParts) {
    const kind = gp.kind
    const gr = new Rng(mixSeed(seed, 'gtr', kind))
    let prevV: number[] | null = null
    const dist = kind === 'distorted'
    for (const span of sp) {
      const s = span.sec
      const e = secE(s)
      const lvl = e < 0.45 ? 0 : e < 0.74 ? 1 : 2
      // rock: clean guitar in quiet parts, distorted layer in loud parts
      if (gp.layer === 1 && dist && lvl < 2 && !(g === 'metal' || g === 'punk')) continue
      if (gp.layer === 0 && guitarParts.length > 1 && guitarParts[1].kind === 'distorted' && lvl >= 2 && kind === 'clean' && g !== 'country') continue
      if (e < 0.25 && dist) continue
      const final = s === lastSec && span.p0 + span.len16 >= songEnd16
      const t0 = t16(span.p0)
      const spanDur = t16(span.p0 + span.len16) - t0
      if (dist) {
        const root = pcInRange(span.chord.root, 40)
        const notes = [root, root + 7, root + 12]
        const takes = [-0.8, 0.8]
        takes.forEach((pan, ti) => {
          const off = ti * 0.007
          if (final || (lvl === 0 && g !== 'metal')) {
            renderStrum(bus, 'distorted', { t: t0 + off, dur: Math.min(spanDur, final ? 3 : spanDur), notes, vel: 0.8, dir: 1 }, 0.45, pan, 0.1 * revAmt, mixSeed(seed, span.p0, ti))
            return
          }
          const chug = g === 'metal' ? (lvl >= 2 ? 'x.xxx.xxx.xxx.xx' : 'x.x.x.x.x.x.x.x.') : g === 'punk' ? 'x.x.x.x.x.x.x.x.' : lvl >= 2 ? 'x.x.x.x.x.x.x.x.' : 'x.....x.x.......'
          for (const ev of patternEvents(chug, span.len16)) {
            const mute = g === 'metal' ? ev.p % 4 !== 0 : lvl < 2
            const tS = t16(span.p0 + ev.p) + off
            const dur = mute ? plan.spb * 0.24 : Math.max(plan.spb * 0.45, t16(span.p0 + ev.p + (ev.l > 1 ? ev.l : 2)) - tS)
            renderStrum(bus, 'distorted', { t: tS, dur, notes: mute ? notes.slice(0, 2) : notes, vel: 0.85, dir: 1, mute }, 0.42, pan, 0.08 * revAmt, mixSeed(seed, span.p0, ev.p, ti))
          }
        })
        continue
      }
      // non-distorted guitars
      const v5 = voiceChord(span.chord, prevV, 52, 71, kind === 'skank' ? 3 : 4)
      prevV = v5
      const bassN = pcInRange(span.chord.bass, 40)
      const full = kind === 'skank' ? v5.map((x) => (x < 60 ? x + 12 : x)) : [bassN, ...v5]
      const pan = gp.layer === 0 ? (guitarParts.length > 1 ? -0.4 : -0.3) : 0.4
      const gain = kind === 'acoustic' ? 0.6 : kind === 'nylon' ? 0.6 : kind === 'skank' ? 0.6 : 0.48
      const rev = (kind === 'clean' ? 0.2 : 0.14) * revAmt
      if (final) {
        renderStrum(bus, kind, { t: t0, dur: 3, notes: full, vel: 0.75, dir: 1 }, gain, pan, rev, mixSeed(seed, 'gf'))
        continue
      }
      if (kind === 'skank') {
        for (let q = 4; q < span.len16; q += 8) renderStrum(bus, kind, { t: t16(span.p0 + q), dur: plan.spb * 0.28, notes: full, vel: 0.8, dir: 1, mute: true }, gain, 0.3, rev, mixSeed(seed, span.p0, q))
        continue
      }
      if (kind === 'nylon' || (kind === 'clean' && (lvl === 0 || g === 'rock' || g === 'ballad' || g === 'lofi'))) {
        // picked arpeggio
        const pat = kind === 'nylon' ? [0, 3, 6, 8, 11, 14] : lvl >= 1 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 6, 8, 12, 14]
        const order = [0, 2, 3, 1, 4, 2, 3, 4]
        let k = 0
        for (let q = 0; q < span.len16; q += 16) {
          for (const pp of pat) {
            if (q + pp >= span.len16) continue
            const m = full[order[k++ % order.length] % full.length]
            renderStrum(bus, kind, { t: t16(span.p0 + q + pp), dur: plan.spb * 1.5, notes: [m], vel: 0.7 + (pp === 0 ? 0.2 : 0), dir: 1 }, gain * 1.3, pan, rev, mixSeed(seed, span.p0, q, pp))
          }
        }
        continue
      }
      // strumming patterns (D = down, U = up)
      const strum = lvl === 0 ? 'D.......D.......' : lvl === 1 ? 'D...D.U...U.D.U.' : 'D.D.D.U.D.UDD.U.'
      const swingish = gr.chance(0.3)
      for (let i = 0; i < span.len16; i++) {
        const c = strum[i % 16]
        if (c === '.') continue
        const dir: 1 | -1 = c === 'D' ? 1 : -1
        let nn = i + 1
        while (nn < span.len16 && strum[nn % 16] === '.') nn++
        const tS = t16(span.p0 + i)
        const dur = Math.max(0.12, t16(span.p0 + nn) - tS)
        renderStrum(bus, kind, { t: tS + (swingish && i % 2 ? 0.01 : 0), dur, notes: dir === 1 ? full : full.slice(1), vel: (i % 4 === 0 ? 0.85 : 0.65) * (dir === 1 ? 1 : 0.8), dir }, gain, pan, rev, mixSeed(seed, span.p0, i, kind))
      }
    }
  }
  await step(0.58, 'Playing guitars')

  // ================================================================ PADS / STRINGS / CHOIR / BRASS
  const padLayers: Array<{ kind: PadKind; min: number; lo: number; hi: number; gain: number; rev: number; only?: (s: SectionPlan) => boolean }> = []
  if (inst.pad === 'warm') padLayers.push({ kind: 'warm', min: g === 'synthwave' ? 0 : 0.45, lo: 52, hi: 74, gain: 0.18, rev: 0.35 })
  if (inst.pad === 'supersaw') {
    padLayers.push({ kind: 'supersaw', min: 0.74, lo: 55, hi: 79, gain: 0.14, rev: 0.25 })
    padLayers.push({ kind: 'warm', min: 0.3, lo: 52, hi: 72, gain: 0.15, rev: 0.35, only: (s) => s.energy < 0.74 })
  }
  if (inst.pad === 'strings' || inst.strings) padLayers.push({ kind: 'strings', min: g === 'cinematic' ? 0 : g === 'ballad' ? 0.48 : 0.55, lo: 55, hi: 81, gain: 0.15, rev: 0.45 })
  if (inst.pad === 'choir' || inst.choir) padLayers.push({ kind: 'choir', min: g === 'gospel' ? 0.6 : 0.7, lo: 55, hi: 74, gain: 0.22, rev: 0.5 })
  if (inst.brass && g === 'cinematic') padLayers.push({ kind: 'brass', min: 0.72, lo: 46, hi: 64, gain: 0.22, rev: 0.4 })
  for (const layer of padLayers) {
    let prevV: number[] | null = null
    for (const span of sp) {
      const s = span.sec
      if (s.energy < layer.min) continue
      if (layer.only && !layer.only(s)) continue
      const v = voiceChord(span.chord, prevV, layer.lo, layer.hi, layer.kind === 'strings' ? 4 : 4)
      prevV = v
      const t0 = t16(span.p0)
      const final = s === lastSec && span.p0 + span.len16 >= songEnd16
      const dur = (final ? 3.2 : t16(span.p0 + span.len16) - t0) + 0.02
      const notes = layer.kind === 'strings' && s.energy > 0.7 ? [...v, v[0] + 12] : layer.kind === 'brass' ? [v[0] - 12, ...v.slice(0, 3)] : v
      renderPad(bus, layer.kind, { t: t0, dur, notes, vel: 0.6 + s.energy * 0.4 }, layer.gain, layer.rev * revAmt, bright, p.sidechain && layer.kind !== 'strings', mixSeed(seed, layer.kind, span.p0), layer.kind === 'brass' ? { attack: 0.12 } : undefined)
    }
  }
  // cinematic string ostinato in big sections
  if ((inst.strings || inst.pad === 'strings') && (g === 'cinematic') ) {
    for (const span of sp) {
      if (span.sec.energy < 0.7) continue
      const v = voiceChord(span.chord, null, 60, 76, 3)
      const ord = [0, 1, 2, 1]
      for (let q = 0, k = 0; q < span.len16; q += 2, k++) {
        renderPad(bus, 'strings', { t: t16(span.p0 + q), dur: plan.spb * 0.4, notes: [v[ord[k % 4]]], vel: 0.8 }, 0.22, 0.3 * revAmt, bright, false, mixSeed(seed, 'ost', span.p0, q), { attack: 0.005, release: 0.12, staccato: true })
      }
    }
  }
  await step(0.66, 'Adding pads')

  // ================================================================ ARP
  if (inst.arp) {
    const arpMin = g === 'synthwave' ? 0.3 : 0.55
    const ar = new Rng(mixSeed(seed, 'arp'))
    const shape = ar.pick(['up', 'updown', 'random'])
    const rate = plan.bpm > 125 ? 2 : 1
    for (const span of sp) {
      if (span.sec.energy < arpMin) continue
      if (span.sec === lastSec) continue
      const v = voiceChord(span.chord, null, 60, 79, 4)
      const seq = shape === 'up' ? [...v, v[0] + 12] : shape === 'updown' ? [...v, v[0] + 12, ...v.slice(1).reverse()] : [v[0], v[2], v[1], v[3], v[0] + 12, v[2]]
      for (let q = 0, k = 0; q < span.len16; q += rate, k++) {
        renderPluck(bus, 'arp', { t: t16(span.p0 + q), dur: plan.spb * 0.2 * rate, midi: seq[k % seq.length], vel: q % 4 === 0 ? 0.8 : 0.6 }, 0.45, 0.3, 0.18 * revAmt, 0.3, bright)
      }
    }
  }

  // ================================================================ LEAD / HOOK
  const leadNotes: MelodyNote[] = []
  if (inst.lead) {
    const kind = inst.lead as LeadKind
    const center = kind === 'flute' || kind === 'bell' || kind === 'pluck' ? 79 : kind === 'sax' || kind === 'brass' ? 67 : kind === 'guitar' || kind === 'steel' ? 69 : 74
    const transpose = (ms: number[]) => {
      const mean = ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)
      return Math.round((center - mean) / 12) * 12
    }
    const phrases: LeadNote[][] = []
    const addPhraseNotes = (ns: LeadNote[]) => {
      // split into legato phrases
      let cur: LeadNote[] = []
      for (let i = 0; i < ns.length; i++) {
        cur.push(ns[i])
        const nx = ns[i + 1]
        if (!nx || nx.t - (ns[i].t + ns[i].dur) > 0.06) {
          phrases.push(cur)
          cur = []
        }
      }
    }
    const hookMidis = plan.hook.map((h) => h.midi)
    const hookShift = transpose(hookMidis)
    for (const s of secs) {
      const leadHere = s.motif === 'intro' || s.motif === 'inst' || s.motif === 'post' || (s.motif === 'outro' && s.beats >= 16) || (plan.instrumental && s.lines.length > 0)
      if (!leadHere) continue
      if (s.motif === 'intro' && s.energy < 0.25 && !plan.instrumental) continue
      if (plan.instrumental && s.lines.length) {
        const ns = s.lines.flatMap((l) => l.notes)
        const shift = transpose(ns.map((n) => n.midi))
        const lns = ns.map((n) => ({ t: n.start, dur: Math.max(0.06, n.end - n.start - 0.01), midi: n.midi + shift, vel: 0.85 }))
        addPhraseNotes(lns)
        continue
      }
      if (!plan.hook.length) continue
      const base16 = s.startBeat * 4
      const end16 = base16 + s.beats * 4 - (s === lastSec ? 16 : 0)
      const lns: LeadNote[] = []
      for (let rep = 0; base16 + rep * plan.hookLen16 < end16; rep++) {
        const oct = s.motif === 'inst' && rep % 2 === 1 ? 12 : 0
        for (const h of plan.hook) {
          const p0 = base16 + rep * plan.hookLen16 + h.pos16
          if (p0 + h.len16 > end16) continue
          const tS = t16(p0)
          lns.push({ t: tS, dur: Math.max(0.06, t16(p0 + h.len16) - tS - 0.01), midi: h.midi + hookShift + oct, vel: 0.85 })
        }
      }
      addPhraseNotes(lns)
    }
    const leadGain = kind === 'pluck' || kind === 'bell' ? 0.8 : kind === 'piano' ? 0.7 : kind === 'guitar' ? 0.75 : 0.8
    phrases.forEach((ph, i) => {
      renderLeadPhrase(bus, kind, ph, leadGain, 0.08, 0.22 * revAmt, 0.16, bright, mixSeed(seed, 'lead', i))
      for (const n of ph) leadNotes.push({ start: n.t, end: n.t + n.dur, midi: n.midi })
    })
  }
  await step(0.72, 'Adding hooks')

  // ================================================================ FX
  if (inst.fx) {
    const fr = new Rng(mixSeed(seed, 'fx'))
    for (let si = 1; si < secs.length; si++) {
      const s = secs[si]
      const prev = secs[si - 1]
      if (s.motif !== 'chorus' || prev.motif === 'chorus') continue
      const tC = t16(s.startBeat * 4)
      const riseLen = Math.min(prev.beats, 8) * plan.spb
      renderRiser(bus, tC - riseLen, riseLen, 0.22, fr.int(1, 1e6))
      renderReverseCymbal(bus, tC, plan.spb * 2, 0.35, fr.int(1, 1e6))
      if (g === 'edm' || g === 'cinematic' || g === 'trap' || g === 'kpop') renderImpact(bus, tC, 0.35, fr.int(1, 1e6))
    }
  }
  if (inst.vinyl) renderVinyl(bus, 0.05, mixSeed(seed, 'vinyl'))
  return { leadNotes, kickTimes }
}
