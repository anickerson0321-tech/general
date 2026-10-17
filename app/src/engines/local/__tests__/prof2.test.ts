import { it } from 'vitest'
import { composeLocal, generateLocalLyrics } from '../index'
import { parseLyrics } from '../../../lib/lyrics'
it.skipIf(!process.env.PROF)('prof', async () => {
  const ly = generateLocalLyrics('city lights', 5)
  let last = performance.now(); let lastL = 'start'
  const rows: string[] = []
  await composeLocal({ title: '', style: process.env.STYLE ?? 'epic orchestral cinematic', lyrics: parseLyrics(ly.lyrics), instrumental: false, seed: 5, durationHint: 150 }, (_f, l) => { const t = performance.now(); rows.push(`${lastL.padEnd(20)} ${(t - last).toFixed(0)}ms`); last = t; lastL = l })
  console.log(rows.join('\n'))
}, 60000)
