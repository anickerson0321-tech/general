// Generates audio fixtures for the E2E tests: a fake "singer" for the mic and a fake AI song.
import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const dir = new URL('./fixtures/', import.meta.url).pathname
mkdirSync(dir, { recursive: true })
function wav(path, sr, chans) {
  const n = chans[0].length, nc = chans.length
  const b = Buffer.alloc(44 + n * nc * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * nc * 2, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nc, 22); b.writeUInt32LE(sr, 24)
  b.writeUInt32LE(sr * nc * 2, 28); b.writeUInt16LE(nc * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * nc * 2, 40)
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[c][i])) * 32767), o); o += 2 }
  writeFileSync(path, b)
}
// "voice": harmonic tone, slightly out of tune, with vibrato, phrases with gaps
const sr = 48000, dur = 30
const v = new Float32Array(sr * dur)
const notes = [57, 60, 62, 64, 62, 60, 57, 55]
let ph = 0
for (let i = 0; i < v.length; i++) {
  const t = i / sr
  const k = Math.floor(t / 0.75) % notes.length
  const inNote = (t % 0.75) < 0.6
  const midi = notes[k] + 0.35 + 0.3 * Math.sin(2 * Math.PI * 5.5 * t)
  const f = 440 * 2 ** ((midi - 69) / 12)
  ph += (2 * Math.PI * f) / sr
  let s = 0
  for (let h = 1; h <= 8; h++) s += Math.sin(ph * h) / h ** 1.2
  v[i] = inNote ? s * 0.25 : 0.002 * (Math.random() - 0.5)
}
wav(dir + 'singer.wav', sr, [v])
// fake AI song: chords + lead (stands in for a provider's mp3)
const sr2 = 44100, d2 = 40
const L = new Float32Array(sr2 * d2), R = new Float32Array(sr2 * d2)
for (let i = 0; i < L.length; i++) {
  const t = i / sr2
  const root = [57, 53, 60, 55][Math.floor(t / 2) % 4]
  let s = 0
  for (const m of [root, root + 4, root + 7]) s += Math.sin(2 * Math.PI * 440 * 2 ** ((m - 69) / 12) * t)
  const beat = Math.exp(-((t % 0.5) * 20))
  s = s * 0.12 + Math.sin(2 * Math.PI * 55 * t) * beat * 0.4
  L[i] = s; R[i] = s
}
wav(dir + 'song.wav', sr2, [L, R])
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', dir + 'song.wav', '-b:a', '128k', dir + 'song.mp3'])
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', dir + 'song.wav', '-af', 'volume=0.5', '-b:a', '96k', dir + 'stem.mp3'])
console.log('fixtures ok')
