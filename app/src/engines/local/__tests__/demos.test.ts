// Renders demo WAVs when RENDER_DEMOS=1 (skipped in normal test runs).
import { describe, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { composeLocal, encodeWav16, generateLocalLyrics } from '../index'
import { parseLyrics } from '../../../lib/lyrics'

const DIR = process.env.DEMO_DIR ?? '/tmp/claude-0/-home-user-general/2a131875-8ff9-516c-9261-7a1885438602/scratchpad/local-demo'
const DEMOS: Array<[string, string, string]> = [
  ['pop', 'upbeat pop, female vocals', 'falling in love on a summer night'],
  ['trap', 'dark trap, 140 bpm, male vocals', 'money, city lights and the hustle'],
  ['folk', 'acoustic folk ballad', 'going back to my hometown by the river'],
  ['synthwave', '80s synthwave, dreamy', 'driving through neon city at midnight'],
]

describe.skipIf(!process.env.RENDER_DEMOS)('demo renders', () => {
  for (const [name, style, topic] of DEMOS) {
    it(name, async () => {
      mkdirSync(DIR, { recursive: true })
      const seed = Number(process.env.SEED ?? 7)
      const ly = generateLocalLyrics(topic, seed, { genre: style })
      const t0 = performance.now()
      const res = await composeLocal({ title: ly.title, style, lyrics: parseLyrics(ly.lyrics), instrumental: false, seed })
      const ms = performance.now() - t0
      writeFileSync(`${DIR}/${name}.wav`, encodeWav16(res.mix))
      writeFileSync(`${DIR}/${name}-instrumental.wav`, encodeWav16(res.instrumental))
      if (res.vocals) writeFileSync(`${DIR}/${name}-vocals.wav`, encodeWav16(res.vocals))
      writeFileSync(`${DIR}/${name}.txt`, `${ly.title}\n${res.tags.join(', ')}\nrender ${ms.toFixed(0)} ms, ${res.durationSec.toFixed(1)} s\n\n${ly.lyrics}\n`)
      console.log(name, `${ms.toFixed(0)} ms`, `${res.durationSec.toFixed(1)} s`, res.tags.join(', '))
    }, 120000)
  }
})
