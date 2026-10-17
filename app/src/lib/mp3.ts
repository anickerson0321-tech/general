import { Mp3Encoder } from '../vendor/lamejs.js'
import type { StereoBuffer } from '../types'

function toInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Encode stereo PCM to MP3 (worker-safe). lamejs supports 32/44.1/48 kHz. */
export function encodeMp3(buf: StereoBuffer, kbps = 192, onProgress?: (f: number) => void): Uint8Array {
  const enc = new Mp3Encoder(2, buf.sampleRate, kbps)
  const L = toInt16(buf.left)
  const R = toInt16(buf.right)
  const block = 1152 * 20
  const parts: Uint8Array[] = []
  let total = 0
  for (let i = 0; i < L.length; i += block) {
    const chunk = enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block))
    if (chunk.length) {
      parts.push(new Uint8Array(chunk))
      total += chunk.length
    }
    if (onProgress && (i / block) % 20 === 0) onProgress(i / L.length)
  }
  const end = enc.flush()
  if (end.length) {
    parts.push(new Uint8Array(end))
    total += end.length
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
