import type { ParsedLyrics, TimedLine, TimedWord } from '../types'
import { splitWords } from './lyrics'

const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]/g, '')

function similar(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  // cheap similarity: common prefix / edit-ish
  const la = a.length
  const lb = b.length
  const dp = new Array(lb + 1).fill(0).map((_, j) => j)
  for (let i = 1; i <= la; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  const d = dp[lb]
  return Math.max(0, 1 - d / Math.max(la, lb))
}

/**
 * Map word timestamps from a transcription of the sung vocal onto the user's lyrics,
 * so karaoke shows the real lyrics with the real timing. Global alignment (Needleman–Wunsch),
 * then unmatched lyric words are interpolated between matched neighbours.
 */
export function alignLyrics(lyrics: ParsedLyrics, heard: TimedWord[], songDuration: number): TimedLine[] {
  const lines: { text: string; words: string[]; section: string }[] = []
  for (const s of lyrics.sections) for (const l of s.lines) lines.push({ text: l, words: splitWords(l), section: s.label })
  const flat: { line: number; text: string }[] = []
  lines.forEach((l, li) => l.words.forEach((w) => flat.push({ line: li, text: w })))
  if (!flat.length) return []
  if (!heard.length) return evenlySpread(lines, songDuration)

  const A = flat.map((f) => norm(f.text))
  const B = heard.map((h) => norm(h.text))
  const n = A.length
  const m = B.length
  const GAP = -0.6
  const score = new Float32Array((n + 1) * (m + 1))
  const back = new Uint8Array((n + 1) * (m + 1)) // 0 diag, 1 up (skip lyric), 2 left (skip heard)
  const idx = (i: number, j: number) => i * (m + 1) + j
  for (let i = 1; i <= n; i++) {
    score[idx(i, 0)] = i * GAP
    back[idx(i, 0)] = 1
  }
  for (let j = 1; j <= m; j++) {
    score[idx(0, j)] = j * GAP * 0.5
    back[idx(0, j)] = 2
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = similar(A[i - 1], B[j - 1])
      const d = score[idx(i - 1, j - 1)] + (sim > 0.5 ? sim * 2 : -1)
      const u = score[idx(i - 1, j)] + GAP
      const l = score[idx(i, j - 1)] + GAP * 0.5 // ad-libs / repeats in audio are cheap to skip
      if (d >= u && d >= l) {
        score[idx(i, j)] = d
        back[idx(i, j)] = 0
      } else if (u >= l) {
        score[idx(i, j)] = u
        back[idx(i, j)] = 1
      } else {
        score[idx(i, j)] = l
        back[idx(i, j)] = 2
      }
    }
  }
  const match = new Int32Array(n).fill(-1)
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const b = back[idx(i, j)]
    if (i > 0 && j > 0 && b === 0) {
      if (similar(A[i - 1], B[j - 1]) > 0.5) match[i - 1] = j - 1
      i--
      j--
    } else if (i > 0 && (j === 0 || b === 1)) i--
    else j--
  }

  const starts = new Float64Array(n).fill(NaN)
  const ends = new Float64Array(n).fill(NaN)
  for (let k = 0; k < n; k++) {
    if (match[k] >= 0) {
      starts[k] = heard[match[k]].start
      ends[k] = heard[match[k]].end
    }
  }
  // interpolate gaps
  let k = 0
  while (k < n) {
    if (!isNaN(starts[k])) {
      k++
      continue
    }
    let e = k
    while (e < n && isNaN(starts[e])) e++
    const t0 = k > 0 ? ends[k - 1] : Math.max(0, (starts[e] ?? songDuration) - (e - k) * 0.4)
    const t1 = e < n ? starts[e] : Math.min(songDuration, t0 + (e - k) * 0.4)
    const span = Math.max(0.1, t1 - t0)
    for (let q = k; q < e; q++) {
      starts[q] = t0 + (span * (q - k)) / (e - k)
      ends[q] = t0 + (span * (q - k + 1)) / (e - k)
    }
    k = e
  }
  // build lines
  const out: TimedLine[] = []
  let p = 0
  for (const l of lines) {
    const words: TimedWord[] = l.words.map((w) => {
      const tw = { text: w, start: starts[p], end: Math.max(starts[p] + 0.05, ends[p]) }
      p++
      return tw
    })
    if (!words.length) continue
    out.push({ text: l.text, words, start: words[0].start, end: words[words.length - 1].end, section: l.section })
  }
  // enforce monotonic order
  for (let q = 1; q < out.length; q++) {
    if (out[q].start < out[q - 1].start) {
      const shift = out[q - 1].start + 0.05 - out[q].start
      out[q].start += shift
      out[q].end = Math.max(out[q].end + shift, out[q].start + 0.1)
      for (const w of out[q].words) {
        w.start += shift
        w.end += shift
      }
    }
  }
  return out
}

function evenlySpread(lines: { text: string; words: string[]; section: string }[], duration: number): TimedLine[] {
  const start = Math.min(10, duration * 0.08)
  const end = duration * 0.95
  const per = (end - start) / Math.max(1, lines.length)
  return lines.map((l, i) => {
    const s = start + i * per
    const wd = (per * 0.9) / Math.max(1, l.words.length)
    return {
      text: l.text,
      section: l.section,
      start: s,
      end: s + per * 0.9,
      words: l.words.map((w, k) => ({ text: w, start: s + k * wd, end: s + (k + 1) * wd })),
    }
  })
}

/** When we have no written lyrics (AI wrote them), group heard words into lines by pauses. */
export function linesFromWords(words: TimedWord[]): TimedLine[] {
  const out: TimedLine[] = []
  let cur: TimedWord[] = []
  const flush = () => {
    if (!cur.length) return
    out.push({ text: cur.map((w) => w.text).join(' '), words: cur, start: cur[0].start, end: cur[cur.length - 1].end })
    cur = []
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const prev = cur[cur.length - 1]
    if (prev && (w.start - prev.end > 0.6 || cur.length >= 10 || /[.!?]$/.test(prev.text))) flush()
    cur.push({ ...w, text: w.text.trim() })
  }
  flush()
  return out
}
