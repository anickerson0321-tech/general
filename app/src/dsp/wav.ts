// Minimal WAV (RIFF) encoder/decoder. 16-bit PCM out; 16/24/32-bit PCM and
// 32-bit float in.

import type { MonoBuffer, StereoBuffer } from '../types'

function isStereo(b: StereoBuffer | MonoBuffer): b is StereoBuffer {
  return (b as StereoBuffer).left !== undefined
}

/** Encode to a 16-bit PCM WAV file (TPDF-dithered, clipped to ±1). */
export function encodeWav(buf: StereoBuffer | MonoBuffer): Uint8Array {
  const chans = isStereo(buf) ? [buf.left, buf.right] : [buf.data]
  const nCh = chans.length
  const n = chans[0].length
  const sr = Math.round(buf.sampleRate)
  const dataBytes = n * nCh * 2
  const out = new Uint8Array(44 + dataBytes)
  const dv = new DataView(out.buffer)
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i)
  }
  str(0, 'RIFF')
  dv.setUint32(4, 36 + dataBytes, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, nCh, true)
  dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * nCh * 2, true)
  dv.setUint16(32, nCh * 2, true)
  dv.setUint16(34, 16, true)
  str(36, 'data')
  dv.setUint32(40, dataBytes, true)
  let seed = 0x12345678
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      let v = chans[c][i]
      if (!(v === v)) v = 0
      const dither = (rnd() - rnd()) / 32768
      let s = Math.round((v + (v !== 0 ? dither : 0)) * 32767)
      if (s > 32767) s = 32767
      else if (s < -32768) s = -32768
      dv.setInt16(o, s, true)
      o += 2
    }
  }
  return out
}

/** Decode a PCM/float WAV. Mono files give a MonoBuffer, otherwise the first two channels. */
export function decodeWav(bytes: Uint8Array): StereoBuffer | MonoBuffer {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let o = 12
  let fmt = 0
  let nCh = 0
  let sr = 0
  let bits = 0
  let dataOff = -1
  let dataLen = 0
  while (o + 8 <= bytes.length) {
    const id = tag(o)
    const len = dv.getUint32(o + 4, true)
    if (id === 'fmt ') {
      fmt = dv.getUint16(o + 8, true)
      nCh = dv.getUint16(o + 10, true)
      sr = dv.getUint32(o + 12, true)
      bits = dv.getUint16(o + 22, true)
      if (fmt === 0xfffe && len >= 40) fmt = dv.getUint16(o + 32, true)
    } else if (id === 'data') {
      dataOff = o + 8
      dataLen = Math.min(len, bytes.length - dataOff)
      break
    }
    o += 8 + len + (len & 1)
  }
  if (dataOff < 0 || nCh === 0) throw new Error('malformed WAV')
  const bps = bits / 8
  const n = Math.floor(dataLen / (bps * nCh))
  const chans = Array.from({ length: Math.min(2, nCh) }, () => new Float32Array(n))
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < chans.length; c++) {
      const p = dataOff + (i * nCh + c) * bps
      let v = 0
      if (fmt === 3 && bits === 32) v = dv.getFloat32(p, true)
      else if (bits === 16) v = dv.getInt16(p, true) / 32768
      else if (bits === 24) v = ((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) << 8 >> 8) / 8388608
      else if (bits === 32) v = dv.getInt32(p, true) / 2147483648
      else if (bits === 8) v = (bytes[p] - 128) / 128
      chans[c][i] = v
    }
  }
  if (chans.length === 1) return { sampleRate: sr, data: chans[0] }
  return { sampleRate: sr, left: chans[0], right: chans[1] }
}
