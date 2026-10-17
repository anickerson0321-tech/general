// Tiny 16-bit PCM WAV encoder (used by tests/demos; works in browsers and Node).
import type { StereoBuffer } from '../../types'

export function encodeWav16(buf: StereoBuffer): Uint8Array {
  const n = buf.left.length
  const bytes = 44 + n * 4
  const out = new Uint8Array(bytes)
  const dv = new DataView(out.buffer)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i)
  }
  str(0, 'RIFF')
  dv.setUint32(4, bytes - 8, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 2, true)
  dv.setUint32(24, buf.sampleRate, true)
  dv.setUint32(28, buf.sampleRate * 4, true)
  dv.setUint16(32, 4, true)
  dv.setUint16(34, 16, true)
  str(36, 'data')
  dv.setUint32(40, n * 4, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, buf.left[i]))
    const r = Math.max(-1, Math.min(1, buf.right[i]))
    dv.setInt16(o, Math.round(l * 32767), true)
    dv.setInt16(o + 2, Math.round(r * 32767), true)
    o += 4
  }
  return out
}
