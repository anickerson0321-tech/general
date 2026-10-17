import { it } from 'vitest'
import { parseLyrics } from '../../../lib/lyrics'
import { planSong } from '../plan'
import { generateLocalLyrics } from '../lyricsgen'
import { NOTE_NAMES } from '../theory'
it.skipIf(!process.env.PLANDUMP)('plan', () => {
  const ly = generateLocalLyrics(process.env.TOPIC ?? 'falling in love on a summer night', Number(process.env.SEED ?? 7))
  const plan = planSong({ title: '', style: process.env.STYLE ?? 'upbeat pop, female vocals', lyrics: parseLyrics(ly.lyrics), instrumental: false, seed: Number(process.env.SEED ?? 7) })
  const nn = (m: number) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1)
  console.log(plan.bpm, plan.key, plan.scale, plan.gender, plan.vocalLow, plan.vocalHigh, JSON.stringify(plan.profile.instruments))
  for (const s of plan.sections) {
    console.log(`\n[${s.label}] beat ${s.startBeat} x${s.beats} e=${s.energy.toFixed(2)} bpl=${s.beatsPerLine} chords: ${s.chords.slice(0, 8).map((c) => c.chord.symbol).join(' ')}`)
    for (const l of s.lines) console.log('  ' + l.text.padEnd(44) + l.notes.map((n) => `${nn(n.midi)}@${(n.pos16 - l.startBeat * 4)}/${n.len16}`).join(' '))
  }
})
