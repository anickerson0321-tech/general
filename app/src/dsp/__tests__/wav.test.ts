import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav } from '../wav'

describe('encodeWav / decodeWav', () => {
  it('writes a valid 16-bit PCM stereo header and round-trips', () => {
    const n = 1000
    const left = new Float32Array(n).map((_, i) => 0.5 * Math.sin(i / 10))
    const right = new Float32Array(n).map((_, i) => -0.25 * Math.sin(i / 7))
    const bytes = encodeWav({ sampleRate: 44100, left, right })
    expect(bytes.length).toBe(44 + n * 4)
    const dv = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(dv.getUint16(22, true)).toBe(2)
    expect(dv.getUint32(24, true)).toBe(44100)
    expect(dv.getUint16(34, true)).toBe(16)
    const back = decodeWav(bytes)
    if (!('left' in back)) throw new Error('expected stereo')
    expect(back.sampleRate).toBe(44100)
    for (let i = 0; i < n; i++) {
      expect(Math.abs(back.left[i] - left[i])).toBeLessThan(2e-4)
      expect(Math.abs(back.right[i] - right[i])).toBeLessThan(2e-4)
    }
  })

  it('writes mono and clips out-of-range / NaN samples', () => {
    const data = Float32Array.from([0, 2, -2, NaN, 0.5])
    const back = decodeWav(encodeWav({ sampleRate: 48000, data }))
    if (!('data' in back)) throw new Error('expected mono')
    expect(back.data.length).toBe(5)
    expect(back.data[1]).toBeCloseTo(32767 / 32768, 4)
    expect(back.data[2]).toBe(-1)
    expect(back.data[3]).toBe(0)
  })
})
