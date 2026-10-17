import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { Bus } from '../instruments'
import { renderVoice } from '../voice'
import { encodeWav16 } from '../wav'
import { wordPhones } from '../syllables'
import type { VNote } from '../model'
it.skipIf(!process.env.VOWEL)('vowel', () => {
  const words = (process.env.WORDS ?? 'aah eee ooh').split(' ')
  const bus = new Bus(44100 * (words.length * 1.2 + 1))
  const notes: VNote[] = words.map((w, i) => ({ start: i * 1.2 + 0.1, end: i * 1.2 + 1.1, midi: Number(process.env.MIDI ?? 57), pos16: 0, len16: 4, syl: wordPhones(w)[0], stress: 2, phraseStart: true, phraseEnd: true, vel: 0.9 }))
  renderVoice(bus, notes, { gender: (process.env.G as 'male') ?? 'male', breath: 0.2, seed: 1, detune: 0, useHarm: false, gain: 1, pan: 0, rev: 0, dly: 0, vibDepth: 0.3, formant: 1, tag: 'v' })
  let pk = 0; for (const x of bus.L) pk = Math.max(pk, Math.abs(x))
  for (let i = 0; i < bus.n; i++) { bus.L[i] /= pk * 1.1; bus.R[i] /= pk * 1.1 }
  writeFileSync('/tmp/claude-0/-home-user-general/2a131875-8ff9-516c-9261-7a1885438602/scratchpad/local-demo/vowel.wav', encodeWav16({ sampleRate: 44100, left: bus.L, right: bus.R }))
})
