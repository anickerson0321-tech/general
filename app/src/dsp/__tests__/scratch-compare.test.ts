import { it } from 'vitest'
import { polishVocal } from '../index'
import { synthVoice } from './synthVoice'
import type { SynthNote } from './synthVoice'
import { makeRng } from '../util'
import type { MonoBuffer, StereoBuffer } from '../../types'

const REF = '/tmp/claude-0/-home-user-general/2a131875-8ff9-516c-9261-7a1885438602/scratchpad/ref/dsp/index.ts'
it('compare with reference', async () => {
  const ref = (await import(/* @vite-ignore */ REF)) as { polishVocal: (i: MonoBuffer, p: object) => StereoBuffer }
  const sr = 48000
  const rng = makeRng(11)
  const notes: SynthNote[] = []
  let t = 0.3
  while (t < 7) { const len = 0.3 + rng() * 0.8; notes.push({ start: t, end: t + len, midi: 60 + Math.floor(rng() * 12) + (rng() - 0.5) * 0.8, scoop: rng() < 0.3 ? 1 : 0 }); t += len + (rng() < 0.3 ? 0.5 : 0.08) }
  const data = synthVoice({ sr, duration: 8, notes, vibratoCents: 30, consonants: true, noiseFloor: 0.004 })
  const input = { sampleRate: sr, data }
  for (const [amount, robotic] of [[5, false], [15, false], [30, false], [50, false], [75, false], [100, false], [75, true]] as const) {
    const p = { amount, robotic, key: { tonic: 9, mode: 'minor' } }
    const a = ref.polishVocal(input, p)
    const b = polishVocal(input, p as never)
    let num = 0, den = 0, mx = 0
    for (const [x, y] of [[a.left, b.left], [a.right, b.right]]) for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; num += d * d; den += x[i] * x[i]; mx = Math.max(mx, Math.abs(d)) }
    console.log(`CMP amount ${amount}${robotic ? ' robotic' : ''}: residual ${(10 * Math.log10(num / den + 1e-30)).toFixed(1)} dB, max|diff| ${mx.toExponential(2)}`)
  }
}, 120000)
