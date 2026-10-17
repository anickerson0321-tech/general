import { it } from 'vitest'
import { analyzePitch, decodeWav, hzToMidi } from '../index'
interface FsLike { readFileSync(p: string): Uint8Array; writeFileSync(p: string, d: Uint8Array): void }
const D = '/tmp/claude-0/-home-user-general/2a131875-8ff9-516c-9261-7a1885438602/scratchpad/dsp-demo'
it('plot', async () => {
  const fsName = 'node:fs'
  const fs = (await import(fsName)) as FsLike
  const files = ['input', 'amount-025', 'amount-050', 'amount-075', 'amount-100', 'amount-100-melody', 'amount-075-robotic']
  const W = 1400, PH = 260, H = PH * files.length
  const img = new Uint8Array(W * H * 3).fill(255)
  const px = (x: number, y: number, r: number, g: number, b: number) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b }
  const mLo = 62, mHi = 78
  let inTrack: { t: number; m: number }[] = []
  files.forEach((f, k) => {
    const w = decodeWav(fs.readFileSync(`${D}/${f}.wav`))
    const data = 'data' in w ? w.data : w.left
    const tr = analyzePitch({ sampleRate: w.sampleRate, data })
    const dur = data.length / w.sampleRate
    const y0 = k * PH
    for (let m = mLo; m <= mHi; m++) { const y = y0 + Math.round(PH - (m - mLo) / (mHi - mLo) * PH); const inScale = [0,2,3,5,7,8,10].includes(((m - 9) % 12 + 12) % 12); for (let x = 0; x < W; x++) px(x, y, inScale ? 170 : 225, inScale ? 170 : 225, inScale ? 170 : 225) }
    for (let x = 0; x < W; x++) px(x, y0, 0, 0, 0)
    const pts: { t: number; m: number }[] = []
    for (let i = 0; i < tr.f0.length; i++) if (tr.f0[i] > 0) pts.push({ t: i * tr.hopSec, m: hzToMidi(tr.f0[i]) })
    if (k === 0) inTrack = pts
    const draw = (p: { t: number; m: number }[], r: number, g: number, b: number) => { for (const q of p) { const x = Math.round(q.t / dur * W); const y = y0 + Math.round(PH - (q.m - mLo) / (mHi - mLo) * PH); px(x, y, r, g, b); px(x, y + 1, r, g, b) } }
    if (k > 0) draw(inTrack, 255, 150, 150)
    draw(pts, k === 0 ? 220 : 0, 0, k === 0 ? 0 : 220)
  })
  const hdr = new TextEncoder().encode(`P6\n${W} ${H}\n255\n`)
  const out = new Uint8Array(hdr.length + img.length); out.set(hdr); out.set(img, hdr.length)
  fs.writeFileSync(`${D}/pitch.ppm`, out)
})
