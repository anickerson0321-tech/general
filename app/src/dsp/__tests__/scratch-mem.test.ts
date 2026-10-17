import { it } from 'vitest'
import { analyzePitch, polishVocal } from '../index'
interface ProcLike { memoryUsage(): { rss: number; heapUsed: number; arrayBuffers: number }; resourceUsage(): { maxRSS: number } }
const proc = (globalThis as unknown as { process: ProcLike }).process
const gc = (globalThis as unknown as { gc?: () => void }).gc
it('memtrace', () => {
  const sr = 48000
  const data = new Float32Array(sr * 180)
  let ph = 0
  for (let i = 0; i < data.length; i++) { const t = i / sr; const f = 220 * Math.pow(2, (Math.floor(t / 0.7) % 5) / 12); ph += f / sr; ph -= Math.floor(ph); data[i] = (t % 3.5 < 3 ? 0.3 : 0) * (Math.sin(2 * Math.PI * ph) + 0.5 * Math.sin(4 * Math.PI * ph)) }
  gc?.(); gc?.()
  const b = proc.memoryUsage()
  const log = (l: string) => { const m = proc.memoryUsage(); console.log(`MT ${l.padEnd(22)} rss +${((m.rss - b.rss) / 1e6).toFixed(0)}  ab +${((m.arrayBuffers - b.arrayBuffers) / 1e6).toFixed(0)}  maxrss +${((proc.resourceUsage().maxRSS * 1024 - b.rss) / 1e6).toFixed(0)}`) }
  const a = analyzePitch({ sampleRate: sr, data })
  log('after analysis')
  let last = ''
  polishVocal({ sampleRate: sr, data }, { amount: 75, analysis: a, key: { tonic: 9, mode: 'minor' } }, (f, l) => { if (l + f.toFixed(2) !== last) { last = l + f.toFixed(2); log(`${f.toFixed(2)} ${l}`) } })
  log('end')
}, 60000)
