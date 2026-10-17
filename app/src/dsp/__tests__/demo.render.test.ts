// Renders before/after WAVs of a synthetic detuned "voice".
//   DSP_DEMO=1 npx vitest run src/dsp/__tests__/demo.render.test.ts
// Optional DSP_DEMO_DIR overrides the output directory.
// (Node APIs are loaded dynamically so the app tsconfig needs no Node types.)

import { expect, it } from 'vitest'
import type { MelodyNote } from '../../types'
import { analyzePitch, describeLevel, encodeWav, integratedLoudness, polishVocal, truePeak } from '../index'
import { synthVoice } from './synthVoice'
import type { SynthNote } from './synthVoice'
import { makeRng } from '../util'

interface FsLike {
  mkdirSync(p: string, o: { recursive: boolean }): void
  writeFileSync(p: string, d: Uint8Array): void
}
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const DEFAULT_DIR = '/tmp/claude-0/-home-user-general/2a131875-8ff9-516c-9261-7a1885438602/scratchpad/dsp-demo'

it.skipIf(!env.DSP_DEMO)('renders demo WAVs', async () => {
  const fsName = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsName)) as FsLike
  const dir = env.DSP_DEMO_DIR ?? DEFAULT_DIR
  fs.mkdirSync(dir, { recursive: true })

  const sr = 48000
  // A-minor phrase, each note sung 20–50 cents off, scoops, vibrato, consonants, room noise
  const rng = makeRng(2024)
  const melody = [69, 72, 71, 69, 67, 69, 64, 65, 67, 69, 72, 76, 74, 72, 71, 69]
  const notes: SynthNote[] = []
  const target: MelodyNote[] = []
  let t = 0.4
  for (let i = 0; i < melody.length; i++) {
    const len = i % 4 === 3 ? 1.0 : 0.42
    const off = (rng() < 0.5 ? -1 : 1) * (0.2 + rng() * 0.3)
    notes.push({ start: t, end: t + len, midi: melody[i] + off, scoop: rng() < 0.35 ? 0.8 + rng() : 0 })
    target.push({ start: t, end: t + len, midi: melody[i] })
    t += len + (i % 4 === 3 ? 0.45 : 0.07)
  }
  const dur = t + 0.6
  const raw = synthVoice({ sr, duration: dur, notes, vibratoCents: 35, consonants: true, noiseFloor: 0.004, breathNoise: 0.015 })
  const input = { sampleRate: sr, data: raw }
  const analysis = analyzePitch(input)
  fs.writeFileSync(`${dir}/input.wav`, encodeWav(input))
  const lines: string[] = []
  const render = (name: string, amount: number, extra: Record<string, unknown> = {}): void => {
    const t0 = performance.now()
    const out = polishVocal(input, { amount, key: { tonic: 9, mode: 'minor' }, analysis, ...extra })
    const ms = performance.now() - t0
    fs.writeFileSync(`${dir}/${name}.wav`, encodeWav(out))
    const lufs = integratedLoudness([out.left, out.right], sr)
    const tp = 20 * Math.log10(truePeak([out.left, out.right]))
    lines.push(`${name}: ${describeLevel(amount).name}, ${lufs.toFixed(1)} LUFS, TP ${tp.toFixed(2)} dBFS, ${ms.toFixed(0)} ms`)
    expect(out.left.length).toBe(raw.length)
  }
  for (const a of [0, 25, 50, 75, 100]) render(`amount-${String(a).padStart(3, '0')}`, a)
  render('amount-100-melody', 100, { targetMelody: target })
  render('amount-075-robotic', 75, { robotic: true })
  console.log(`[demo] wrote to ${dir}\n` + lines.join('\n'))
}, 120000)
