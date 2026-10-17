import { describe, expect, it } from 'vitest'
import { parseLyrics, activeLineIndex } from '../lyrics'
import { alignLyrics, linesFromWords } from '../align'
import { detectKey } from '../keydetect'
import { mixdown } from '../mixdown'
import { unzip } from '../unzip'
import { parseMultipart } from '../../engines/cloud/elevenlabs'
import { minimaxLyrics, estimateDurationSec } from '../../engines/cloud/format'
import { parseLyricsJson } from '../../engines/cloud/fal'
import { deflateRawSync } from 'node:zlib'

const LYR = `[Verse 1]
Walking down the empty street tonight
Neon signs are flickering bright

[Chorus]
Hold on, hold on to me
(hold on)
We are young and we are free

[Bridge]
Never let it go`

describe('lyrics', () => {
  it('parses Suno-style tags', () => {
    const p = parseLyrics(LYR)
    expect(p.sections.map((s) => s.label)).toEqual(['Verse 1', 'Chorus', 'Bridge'])
    expect(p.sections[1].lines).toHaveLength(3)
  })
  it('defaults untagged text to a verse and strips inline tags', () => {
    const p = parseLyrics('hello world [whispered]\nsecond line')
    expect(p.sections[0].tag).toBe('Verse')
    expect(p.sections[0].lines[0]).toBe('hello world')
  })
  it('formats for MiniMax', () => {
    const t = minimaxLyrics(parseLyrics(LYR))
    expect(t.startsWith('[Verse]\nWalking')).toBe(true)
    expect(t).toContain('[Chorus]')
    expect(estimateDurationSec(parseLyrics(LYR))).toBeGreaterThanOrEqual(60)
  })
})

describe('alignment', () => {
  it('maps heard word timings onto written lyrics, tolerating misheard and extra words', () => {
    const p = parseLyrics(LYR)
    const words = 'walking down the empty street to night yeah neon signs are flickering bright hold on hold on to me hold on we are young and we are free never let it go'.split(' ')
    const heard = words.map((w, i) => ({ text: w, start: 10 + i * 0.5, end: 10 + i * 0.5 + 0.4 }))
    const lines = alignLyrics(p, heard, 120)
    expect(lines).toHaveLength(6)
    expect(lines[0].words[0].start).toBeCloseTo(10, 5)
    for (let i = 1; i < lines.length; i++) expect(lines[i].start).toBeGreaterThanOrEqual(lines[i - 1].start)
    // "Neon" should land after the heard "yeah"
    expect(lines[1].words[0].start).toBeCloseTo(10 + 8 * 0.5, 5)
    expect(activeLineIndex(lines, lines[2].start + 0.01)).toBe(2)
  })
  it('spreads lyrics evenly when nothing was heard', () => {
    const lines = alignLyrics(parseLyrics(LYR), [], 100)
    expect(lines).toHaveLength(6)
    expect(lines[5].end).toBeLessThanOrEqual(100)
  })
  it('groups words into lines', () => {
    const w = ['a', 'b', 'c.', 'd', 'e'].map((t, i) => ({ text: t, start: i, end: i + 0.5 }))
    expect(linesFromWords(w).map((l) => l.text)).toEqual(['a b c.', 'd e'])
  })
})

describe('key detection', () => {
  it('finds A minor from an Am-Dm-E progression', () => {
    const sr = 22050
    const out = new Float32Array(sr * 8)
    const chords = [[57, 60, 64], [62, 65, 69], [64, 68, 71], [57, 60, 64]]
    chords.forEach((c, k) => {
      for (let i = 0; i < sr * 2; i++) {
        let s = 0
        for (const m of c) s += Math.sin((2 * Math.PI * 440 * 2 ** ((m - 69) / 12) * i) / sr)
        out[k * sr * 2 + i] = s * 0.2
      }
    })
    const key = detectKey(out, sr)
    expect(key).toEqual({ tonic: 9, mode: 'minor' })
  })
})

describe('mixdown', () => {
  it('places sources at offsets and never clips', () => {
    const a = new Float32Array(1000).fill(0.9)
    const m = mixdown([
      { left: a, right: a, sampleRate: 1000, offsetSec: 0, gain: 1 },
      { left: a, right: a, sampleRate: 1000, offsetSec: 0.5, gain: 1 },
    ], 1000)
    expect(m.left.length).toBe(1500)
    let peak = 0
    for (const x of m.left) peak = Math.max(peak, Math.abs(x))
    expect(peak).toBeLessThanOrEqual(1)
    expect(m.left[1400]).toBeGreaterThan(0.5)
  })
})

describe('provider helpers', () => {
  it('parses multipart/mixed', () => {
    const enc = new TextEncoder()
    const body = enc.encode('--XYZ\r\nContent-Type: application/json\r\n\r\n{"a":1}\r\n--XYZ\r\nContent-Type: audio/mpeg\r\n\r\nAUDIO\r\n--XYZ--\r\n')
    const parts = parseMultipart(body, 'XYZ')
    expect(parts).toHaveLength(2)
    expect(new TextDecoder().decode(parts[0].body)).toBe('{"a":1}')
    expect(new TextDecoder().decode(parts[1].body)).toBe('AUDIO')
  })
  it('reads a zip', async () => {
    const data = new TextEncoder().encode('hello hello hello vocals')
    const comp = new Uint8Array(deflateRawSync(data))
    const name = new TextEncoder().encode('vocals.mp3')
    const local = new Uint8Array(30 + name.length + comp.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, 8, true)
    lv.setUint32(18, comp.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(comp, 30 + name.length)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, 8, true)
    cv.setUint32(20, comp.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, 0, true)
    cd.set(name, 46)
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, 1, true)
    ev.setUint16(10, 1, true)
    ev.setUint32(12, cd.length, true)
    ev.setUint32(16, local.length, true)
    const all = new Uint8Array(local.length + cd.length + eocd.length)
    all.set(local)
    all.set(cd, local.length)
    all.set(eocd, local.length + cd.length)
    const files = await unzip(all.buffer)
    expect(files[0].name).toBe('vocals.mp3')
    expect(new TextDecoder().decode(files[0].data)).toBe('hello hello hello vocals')
  })
  it('parses LLM lyric JSON', () => {
    const r = parseLyricsJson('Sure! {"title":"Night Drive","style":"synthwave","lyrics":"[Verse]\\nla la"}')
    expect(r.title).toBe('Night Drive')
    expect(r.lyrics).toContain('[Verse]')
  })
})
