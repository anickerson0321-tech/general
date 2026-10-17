import { describe, expect, it } from 'vitest'
import { fft } from '../fft'
import { makeRng } from '../util'

describe('fft', () => {
  for (const n of [2, 4, 8, 16, 64, 512, 1024, 2048]) {
    it(`matches a direct DFT and inverts (n=${n})`, () => {
      const rng = makeRng(n)
      const xr = Float64Array.from({ length: n }, () => rng() - 0.5)
      const xi = Float64Array.from({ length: n }, () => rng() - 0.5)
      const re = new Float64Array(xr)
      const im = new Float64Array(xi)
      fft(re, im)
      for (const k of [0, 1, n >> 1, n - 1]) {
        let sr = 0
        let si = 0
        for (let t = 0; t < n; t++) {
          const a = (-2 * Math.PI * k * t) / n
          sr += xr[t] * Math.cos(a) - xi[t] * Math.sin(a)
          si += xr[t] * Math.sin(a) + xi[t] * Math.cos(a)
        }
        expect(re[k]).toBeCloseTo(sr, 9)
        expect(im[k]).toBeCloseTo(si, 9)
      }
      fft(re, im, true)
      for (let t = 0; t < n; t++) {
        expect(re[t] / n).toBeCloseTo(xr[t], 9)
        expect(im[t] / n).toBeCloseTo(xi[t], 9)
      }
    })
  }
})
