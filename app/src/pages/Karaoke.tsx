import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/store'
import { pauseMainPlayer } from '../state/player'
import type { Song, Take } from '../state/models'
import type { TimedLine } from '../types'
import type { PitchTrack } from '../dsp'
import { Transport } from '../lib/transport'
import { MicRecorder, livePitch } from '../lib/recorder'
import { loadBuffer, guidePitch, targetMidiAt, hzToMidi } from '../lib/songAudio'
import { activeLineIndex } from '../lib/lyrics'
import { encodeWav, formatTime } from '../lib/audio'
import { putBlob } from '../lib/db'
import { uid } from '../lib/id'
import { Cover, Slider, Spinner, Toggle, useCoverUrl } from '../ui/components'
import { I } from '../ui/icons'
import { navigate } from '../ui/router'

export function KaraokePage({ id }: { id?: string }) {
  if (!id) return <KaraokePicker />
  return <KaraokeRoom key={id} id={id} />
}

function KaraokePicker() {
  const songs = useApp((s) => s.songs)
  const singable = songs.filter((s) => s.status === 'ready' && !s.instrumental && !s.trashed)
  return (
    <div className="page">
      <h1 className="page-title">Karaoke</h1>
      <p className="page-sub">Pick a song, put on headphones, and sing. Your voice is recorded so you can polish it afterwards.</p>
      {singable.length === 0 ? (
        <div className="empty">
          No songs with vocals yet.{' '}
          <a href="#/create" style={{ color: 'var(--accent)' }}>
            Create one
          </a>{' '}
          first.
        </div>
      ) : (
        singable.map((s) => (
          <div key={s.id} className="song-row" style={{ cursor: 'pointer' }} onClick={() => navigate(`/karaoke/${s.id}`)}>
            <Cover song={s} showPlay={false} />
            <div className="meta">
              <div className="title">
                <span className="t">{s.title}</span>
                {s.karaoke === 'ready' && s.timedLyrics?.length ? <span className="badge good">synced</span> : <span className="badge">{s.karaoke === 'processing' ? 'syncing…' : 'lyrics only'}</span>}
              </div>
              <div className="tags">{s.tags.join(', ') || s.style}</div>
            </div>
            <button className="btn sm primary">
              <I.mic /> Sing
            </button>
          </div>
        ))
      )}
    </div>
  )
}

interface PitchPoint {
  t: number
  midi: number
}

function KaraokeRoom({ id }: { id: string }) {
  const song = useApp((s) => s.songs.find((x) => x.id === id))
  const { settings, setSettings, patchSong, toast } = useApp()
  const cover = useCoverUrl(song ?? { coverSeed: 1, style: '' })
  const transport = useMemo(() => new Transport(), [])
  const mic = useRef<MicRecorder | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [t, setT] = useState(0)
  const [duration, setDuration] = useState(0)
  const [guideVol, setGuideVol] = useState(0.25)
  const [backVol, setBackVol] = useState(0.9)
  const [monitor, setMonitor] = useState(0)
  const [hasGuide, setHasGuide] = useState(false)
  const [usingMix, setUsingMix] = useState(false)
  const [showMixer, setShowMixer] = useState(false)
  const [saving, setSaving] = useState(false)
  const guideRef = useRef<PitchTrack | null>(null)
  const pitchTrail = useRef<PitchPoint[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const recStart = useRef(0)

  // load audio
  useEffect(() => {
    pauseMainPlayer()
    if (!song) return
    let alive = true
    ;(async () => {
      try {
        const [inst, voc, mix] = await Promise.all([loadBuffer(song.instrumentalKey), loadBuffer(song.vocalsKey), song.instrumentalKey ? Promise.resolve(null) : loadBuffer(song.mixKey)])
        if (!alive) return
        if (inst) transport.setTrack({ id: 'inst', buffer: inst, volume: backVol })
        else if (mix) {
          transport.setTrack({ id: 'inst', buffer: mix, volume: backVol })
          setUsingMix(true)
        }
        if (voc) {
          transport.setTrack({ id: 'guide', buffer: voc, volume: guideVol })
          setHasGuide(true)
        }
        setDuration(transport.duration)
        setLoading(false)
        if (!song.melody?.length && song.vocalsKey)
          void guidePitch(song).then((g) => {
            guideRef.current = g
          })
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.instrumentalKey, song?.vocalsKey])

  useEffect(
    () => () => {
      transport.dispose()
      mic.current?.close()
    },
    [transport],
  )

  useEffect(() => transport.setTrack({ id: 'inst', volume: backVol }), [backVol, transport])
  useEffect(() => {
    if (transport.tracks.has('guide')) transport.setTrack({ id: 'guide', volume: guideVol })
  }, [guideVol, transport])
  useEffect(() => mic.current?.setMonitor(monitor), [monitor])

  transport.onEnded = () => {
    setPlaying(false)
    if (mic.current?.isRecording) void stopRecording()
  }

  // animation loop: time, live pitch, pitch lane
  useEffect(() => {
    let raf = 0
    const buf = new Float32Array(2048)
    const loop = () => {
      const now = transport.currentTime
      setT(now)
      const m = mic.current
      if (m?.analyser && transport.isPlaying) {
        m.analyser.getFloatTimeDomainData(buf)
        const f = livePitch(buf, m.ctx.sampleRate)
        const trail = pitchTrail.current
        const lag = m.roundTripLatency
        if (f > 0) trail.push({ t: now - lag, midi: hzToMidi(f) })
        while (trail.length && trail[0].t < now - 4) trail.shift()
      }
      drawLane(canvasRef.current, now, song?.melody, guideRef.current, pitchTrail.current)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [transport, song?.melody])

  const ensureMic = useCallback(async () => {
    if (!mic.current) mic.current = new MicRecorder()
    await mic.current.open({ echoCancellation: settings.echoCancellation })
    mic.current.setMonitor(monitor)
  }, [settings.echoCancellation, monitor])

  const play = async () => {
    await transport.play()
    setPlaying(true)
  }
  const pause = () => {
    transport.pause()
    setPlaying(false)
  }

  const startRecording = async () => {
    try {
      await ensureMic()
    } catch (e) {
      toast(e instanceof Error && e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser settings.' : `Mic error: ${e instanceof Error ? e.message : e}`, 'error')
      return
    }
    pitchTrail.current = []
    // start a little before the current point, so the singer gets a lead-in
    const from = transport.currentTime > 0.5 ? Math.max(0, transport.currentTime - 2) : 0
    recStart.current = from
    transport.pause()
    mic.current!.start()
    await transport.play(from, 0.15)
    setPlaying(true)
    setRecording(true)
  }

  const stopRecording = async () => {
    const m = mic.current
    if (!m || !song) return
    const { data, sampleRate, firstCtxTime } = m.stop()
    const { ctxStart, songStart } = transport.playbackInfo
    transport.pause()
    setPlaying(false)
    setRecording(false)
    if (data.length < sampleRate * 1.5) {
      toast('That take was too short to keep.')
      return
    }
    setSaving(true)
    try {
      const latency = m.roundTripLatency + settings.latencyMs / 1000
      const offsetSec = songStart + (firstCtxTime - ctxStart) - latency
      const rawKey = uid('r')
      await putBlob(rawKey, encodeWav({ sampleRate, data }))
      const take: Take = {
        id: uid('t'),
        createdAt: Date.now(),
        name: `Take ${song.takes.length + 1}`,
        rawKey,
        sampleRate,
        durationSec: data.length / sampleRate,
        offsetSec,
        nudgeMs: 0,
        polish: 55,
        robotic: false,
        volume: 1,
        muted: false,
      }
      patchSong(song.id, { takes: [...song.takes, take] })
      m.close()
      mic.current = null
      navigate(`/take/${song.id}/${take.id}`)
    } finally {
      setSaving(false)
    }
  }

  if (!song) return <div className="page">Song not found.</div>

  const lines = song.timedLyrics ?? []
  const idx = activeLineIndex(lines, t + 0.05)
  const firstStart = lines[0]?.start ?? 0
  const countdown = recording && t < firstStart && firstStart - t <= 3.2 ? Math.ceil(firstStart - t) : 0

  return (
    <div className="kara">
      <div className="kara-bg" style={{ backgroundImage: `url("${cover}")` }} />
      <div className="kara-top">
        <button
          className="icon-btn"
          onClick={() => {
            if (recording) void stopRecording()
            else navigate(`/song/${song.id}`)
          }}
          aria-label="Close"
        >
          <I.chevronLeft />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
          <div className="small muted">
            {recording ? (
              <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                <span className="rec-dot" /> Recording · {formatTime(t - recStart.current)}
              </span>
            ) : (
              'Karaoke'
            )}
          </div>
        </div>
        <span className="spacer" />
        <button className={`icon-btn ${showMixer ? 'on' : ''}`} onClick={() => setShowMixer((v) => !v)} aria-label="Mixer">
          <I.studio />
        </button>
      </div>

      <div className="kara-lyrics">
        {loading ? (
          err ? (
            <div className="muted">{err}</div>
          ) : (
            <div className="muted row" style={{ justifyContent: 'center' }}>
              <Spinner /> Loading backing track…
            </div>
          )
        ) : countdown > 0 ? (
          <div className="kara-count">{countdown}</div>
        ) : lines.length ? (
          <LyricWindow lines={lines} idx={idx} t={t} />
        ) : (
          <div className="muted" style={{ maxWidth: 600, margin: '0 auto', whiteSpace: 'pre-wrap', overflowY: 'auto', maxHeight: '100%' }}>
            {song.karaoke === 'processing' ? `Syncing lyrics (${song.karaokeLabel ?? 'working'})… you can still sing along:\n\n` : song.karaoke === 'error' ? `Couldn't sync lyrics: ${song.karaokeError}\n\n` : ''}
            {song.lyricsText.replace(/^\[.*\]$/gm, '')}
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="pitch-lane" />

      <div className="kara-bottom">
        {showMixer && (
          <div className="card" style={{ padding: 14, marginBottom: 10, background: 'rgba(20,20,26,.9)' }}>
            <div className="mix-sliders">
              <div>
                <label>
                  <span>Backing track</span>
                  <span>{Math.round(backVol * 100)}%</span>
                </label>
                <Slider value={backVol} max={1.2} onChange={setBackVol} label="Backing volume" />
              </div>
              <div>
                <label>
                  <span>Guide vocal {hasGuide ? '' : '(n/a)'}</span>
                  <span>{Math.round(guideVol * 100)}%</span>
                </label>
                <Slider value={guideVol} max={1} onChange={setGuideVol} label="Guide vocal volume" />
              </div>
              <div>
                <label>
                  <span>Hear my mic</span>
                  <span>{Math.round(monitor * 100)}%</span>
                </label>
                <Slider value={monitor} max={1} onChange={setMonitor} label="Mic monitor" />
              </div>
            </div>
            <div className="row wrap" style={{ marginTop: 10 }}>
              <span className="small muted">Echo cancel (no headphones)</span>
              <Toggle
                on={settings.echoCancellation}
                onChange={(v) => {
                  setSettings({ echoCancellation: v })
                  mic.current?.close()
                  mic.current = null
                }}
              />
              {usingMix && <span className="small" style={{ color: 'var(--warn)' }}>No separate backing track yet — playing the full song.</span>}
            </div>
            <div className="tiny dim" style={{ marginTop: 6 }}>
              <I.headphones /> Headphones give the cleanest takes. Without them, turn on echo cancel so the music isn’t recorded with your voice.
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 12 }}>
          <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums', width: 40 }}>
            {formatTime(t)}
          </span>
          <Slider value={t} max={duration || 1} step={0.1} onChange={(v) => !recording && transport.seek(v)} label="Seek" />
          <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums', width: 40, textAlign: 'right' }}>
            {formatTime(duration)}
          </span>
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 22, marginTop: 6 }}>
          <button className="icon-btn" disabled={recording} onClick={() => transport.seek(0)} aria-label="Restart">
            <I.prev />
          </button>
          {!recording && (
            <button className="play-fab" style={{ width: 54, height: 54 }} disabled={loading} onClick={() => (playing ? pause() : void play())} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <I.pause /> : <I.play />}
            </button>
          )}
          <button className={`rec-btn ${recording ? 'on' : ''}`} disabled={loading || saving} onClick={() => (recording ? void stopRecording() : void startRecording())} aria-label={recording ? 'Stop recording' : 'Record'}>
            {saving ? <Spinner size={30} /> : <span />}
          </button>
          <div style={{ width: 36 }} />
        </div>
        <div className="tiny dim" style={{ textAlign: 'center', marginTop: 6 }}>
          {recording ? 'Tap the square to finish your take' : 'Tap the red button to record your take · ▶ to practice'}
        </div>
      </div>
    </div>
  )
}

function LyricWindow({ lines, idx, t }: { lines: TimedLine[]; idx: number; t: number }) {
  // show the active line, the next one big, and one line of context either side
  const cur = Math.max(0, idx)
  const before = idx >= 1 ? lines[idx - 1] : null
  const active = idx >= 0 ? lines[idx] : null
  const upcoming = lines.slice(idx + 1, idx + 3)
  const sectionLabel = (active ?? lines[0])?.section
  const showActive = active && t <= active.end + 1.2
  return (
    <div>
      {sectionLabel && <div className="kara-section">{sectionLabel}</div>}
      {before && <div className="kara-line far">{before.text}</div>}
      {showActive ? <KaraLine line={active!} t={t} /> : idx < 0 && lines[0] ? <div className="kara-line next">{lines[0].text}</div> : null}
      {upcoming.map((l, i) => (
        <div key={cur + i + 1} className={`kara-line ${i === 0 ? 'next' : 'far'}`}>
          {l.text}
        </div>
      ))}
    </div>
  )
}

function KaraLine({ line, t }: { line: TimedLine; t: number }) {
  return (
    <div className="kara-line active">
      {line.words.map((w, i) => {
        const f = Math.max(0, Math.min(1, (t - w.start) / Math.max(0.05, w.end - w.start)))
        return (
          <span key={i} className="kara-word">
            {w.text}
            <span className="fill" style={{ width: `${f * 100}%` }}>
              {w.text}
            </span>
            {i < line.words.length - 1 ? ' ' : ''}
          </span>
        )
      })}
    </div>
  )
}

function drawLane(c: HTMLCanvasElement | null, now: number, melody: Song['melody'], guide: PitchTrack | null, trail: PitchPoint[]) {
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  const w = c.clientWidth
  const h = c.clientHeight
  if (c.width !== w * dpr) {
    c.width = w * dpr
    c.height = h * dpr
  }
  const g = c.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const past = 2.5
  const future = 4
  const x = (tt: number) => ((tt - (now - past)) / (past + future)) * w
  // figure out visible pitch range
  const visible: number[] = []
  if (melody?.length) for (const n of melody) if (n.end > now - past && n.start < now + future) visible.push(n.midi)
  if (guide && !melody?.length) {
    for (let tt = now - past; tt < now + future; tt += 0.05) {
      const m = targetMidiAt(tt, undefined, guide)
      if (m) visible.push(m)
    }
  }
  const center = visible.length ? visible.reduce((a, b) => a + b, 0) / visible.length : 62
  const span = 16
  const y = (m: number) => h / 2 - ((m - center) / span) * h
  // grid
  g.strokeStyle = 'rgba(255,255,255,0.05)'
  for (let k = -8; k <= 8; k += 2) {
    g.beginPath()
    g.moveTo(0, y(center + k))
    g.lineTo(w, y(center + k))
    g.stroke()
  }
  // target notes
  g.fillStyle = 'rgba(255,255,255,0.22)'
  if (melody?.length) {
    for (const n of melody) {
      if (n.end < now - past || n.start > now + future) continue
      const x0 = x(n.start)
      const x1 = x(n.end)
      const active = now >= n.start && now < n.end
      g.fillStyle = active ? 'rgba(255,180,90,0.75)' : 'rgba(255,255,255,0.22)'
      roundRect(g, x0, y(n.midi) - 4, Math.max(3, x1 - x0 - 2), 8, 4)
    }
  } else if (guide) {
    g.fillStyle = 'rgba(255,255,255,0.25)'
    for (let tt = now - past; tt < now + future; tt += 0.02) {
      const m = targetMidiAt(tt, undefined, guide)
      if (m) g.fillRect(x(tt), y(m) - 2.5, 3, 5)
    }
  }
  // user trail, octave-folded toward the target
  for (const p of trail) {
    let m = p.midi
    const target = targetMidiAt(p.t, melody, guide)
    const ref = target || center
    m -= 12 * Math.round((m - ref) / 12)
    const ok = target && Math.abs(m - target) < 0.6
    g.fillStyle = ok ? '#3ddc97' : '#ff6f8f'
    g.beginPath()
    g.arc(x(p.t), y(m), 2.6, 0, Math.PI * 2)
    g.fill()
  }
  // now line
  g.fillStyle = 'rgba(255,255,255,0.7)'
  g.fillRect(x(now) - 1, 0, 2, h)
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.fill()
}
