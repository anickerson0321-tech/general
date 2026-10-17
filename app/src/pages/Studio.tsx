import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useApp } from '../state/store'
import { pauseMainPlayer } from '../state/player'
import type { Song, Take } from '../state/models'
import type { StereoBuffer } from '../types'
import { describeLevel } from '../dsp'
import { Transport } from '../lib/transport'
import { loadBuffer, loadTakeRaw, analyzeTake, guidePitch } from '../lib/songAudio'
import { formatTime, monoToAudioBuffer, stereoToAudioBuffer, waveformPeaks } from '../lib/audio'
import { polishInWorker, encodeMp3InWorker } from '../workers/client'
import { mixdown, bufferToSource, type MixSource } from '../lib/mixdown'
import { Cover, Slider, Spinner, downloadBlob, safeName } from '../ui/components'
import { I } from '../ui/icons'
import { navigate } from '../ui/router'
import { encodeWav } from '../lib/audio'

export function StudioPage({ id }: { id?: string }) {
  const songs = useApp((s) => s.songs)
  const song = id ? songs.find((s) => s.id === id) : undefined
  if (!song) {
    const ready = songs.filter((s) => s.status === 'ready' && !s.trashed)
    return (
      <div className="page">
        <h1 className="page-title">Studio</h1>
        <p className="page-sub">A multitrack mixer for your songs: the backing track, the AI vocal and every take you’ve sung. Pick a song to open.</p>
        {ready.length === 0 && <div className="empty">No songs yet.</div>}
        {ready.map((s) => (
          <div key={s.id} className="song-row" style={{ cursor: 'pointer' }} onClick={() => navigate(`/studio/${s.id}`)}>
            <Cover song={s} showPlay={false} />
            <div className="meta">
              <div className="title">
                <span className="t">{s.title}</span>
                {s.takes.length > 0 && <span className="badge good">{s.takes.length} takes</span>}
              </div>
              <div className="tags">{s.tags.join(', ') || s.style}</div>
            </div>
            <button className="btn sm">Open</button>
          </div>
        ))}
      </div>
    )
  }
  return <StudioSession key={song.id} song={song} />
}

interface TrackUI {
  id: string
  name: string
  kind: 'inst' | 'guide' | 'mix' | 'take'
  color: string
  buffer: AudioBuffer | null
  offset: number
  volume: number
  pan: number
  muted: boolean
  solo: boolean
  take?: Take
  busy?: string
}

const COLORS = ['#ff6f8f', '#ffb547', '#7c9cff', '#3ddc97', '#c77dff', '#4cc9f0']

function StudioSession({ song }: { song: Song }) {
  const { patchSong, toast } = useApp()
  const transport = useMemo(() => new Transport(), [])
  const [tracks, setTracks] = useState<TrackUI[]>([])
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [exporting, setExporting] = useState('')
  const processedRef = useRef(new Map<string, StereoBuffer>())
  const laneRef = useRef<HTMLDivElement>(null)

  const upd = (id: string, patch: Partial<TrackUI>) => setTracks((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  // build tracks
  useEffect(() => {
    pauseMainPlayer()
    let alive = true
    ;(async () => {
      const list: TrackUI[] = []
      const [inst, voc] = await Promise.all([loadBuffer(song.instrumentalKey), loadBuffer(song.vocalsKey)])
      if (inst) list.push({ id: 'inst', name: 'Instrumental', kind: 'inst', color: '#7c9cff', buffer: inst, offset: 0, volume: 0.85, pan: 0, muted: false, solo: false })
      if (voc) list.push({ id: 'guide', name: song.kind === 'my version' ? 'My vocal (bounced)' : 'AI vocal', kind: 'guide', color: '#c77dff', buffer: voc, offset: 0, volume: 0.8, pan: 0, muted: song.takes.length > 0, solo: false })
      if (!inst) {
        const mix = await loadBuffer(song.mixKey)
        list.push({ id: 'mix', name: 'Full song', kind: 'mix', color: '#7c9cff', buffer: mix, offset: 0, volume: 0.9, pan: 0, muted: false, solo: false })
      }
      song.takes.forEach((tk, i) =>
        list.push({ id: tk.id, name: tk.name, kind: 'take', color: COLORS[i % COLORS.length], buffer: null, offset: tk.offsetSec + tk.nudgeMs / 1000, volume: tk.volume, pan: 0, muted: tk.muted, solo: false, take: tk, busy: 'Loading' }),
      )
      if (!alive) return
      setTracks(list)
      // render takes with their saved polish
      const guide = song.melody?.length ? null : await guidePitch(song).catch(() => null)
      for (const tk of song.takes) {
        try {
          const raw = await loadTakeRaw(tk)
          if (!alive) return
          upd(tk.id, { buffer: monoToAudioBuffer(raw), busy: tk.polish > 0 ? 'Polishing' : undefined })
          if (tk.polish > 0) {
            const analysis = await analyzeTake(tk)
            const { out } = await polishInWorker(raw, { amount: tk.polish, robotic: tk.robotic, key: song.key, targetMelody: song.melody, guideTrack: guide ?? undefined, takeOffsetSec: tk.offsetSec + tk.nudgeMs / 1000, analysis })
            if (!alive) return
            processedRef.current.set(tk.id, out)
            upd(tk.id, { buffer: stereoToAudioBuffer(out), busy: undefined })
          }
        } catch (e) {
          upd(tk.id, { busy: `Error: ${e instanceof Error ? e.message : e}` })
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id])

  // sync to transport
  useEffect(() => {
    for (const tr of tracks) transport.setTrack({ id: tr.id, buffer: tr.buffer, offset: tr.offset, volume: tr.volume, pan: tr.pan, muted: tr.muted, solo: tr.solo })
    for (const id of [...transport.tracks.keys()]) if (!tracks.some((x) => x.id === id)) transport.removeTrack(id)
  }, [tracks, transport])
  useEffect(() => () => transport.dispose(), [transport])
  transport.onEnded = () => setPlaying(false)

  useEffect(() => {
    let raf = 0
    const loop = () => {
      setT(transport.currentTime)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [transport])

  // persist take mixer changes
  useEffect(() => {
    const h = setTimeout(() => {
      const takes = song.takes.map((tk) => {
        const tr = tracks.find((x) => x.id === tk.id)
        return tr ? { ...tk, volume: tr.volume, muted: tr.muted, nudgeMs: Math.round((tr.offset - tk.offsetSec) * 1000) } : tk
      })
      if (JSON.stringify(takes) !== JSON.stringify(song.takes)) patchSong(song.id, { takes })
    }, 500)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks])

  const duration = transport.duration || song.durationSec || 1
  const pxPerSec = 12 * zoom
  const width = Math.max(600, duration * pxPerSec)

  const seekFromEvent = (e: MouseEvent) => {
    const el = laneRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left + el.scrollLeft
    transport.seek(x / pxPerSec)
  }

  const exportMix = async (fmt: 'mp3' | 'wav') => {
    setExporting('Bouncing mix')
    try {
      const anySolo = tracks.some((x) => x.solo)
      const sources: MixSource[] = tracks
        .filter((x) => x.buffer && !x.muted && (!anySolo || x.solo))
        .map((x) => {
          const p = processedRef.current.get(x.id)
          if (x.kind === 'take' && p) return { left: p.left, right: p.right, sampleRate: p.sampleRate, offsetSec: x.offset, gain: x.volume, pan: x.pan }
          return bufferToSource(x.buffer!, x.offset, x.volume, x.pan)
        })
      if (!sources.length) {
        toast('Nothing to export — all tracks are muted.')
        return
      }
      const sr = tracks.find((x) => x.buffer)!.buffer!.sampleRate
      const mix = mixdown(sources, sr)
      if (fmt === 'wav') downloadBlob(encodeWav(mix), `${safeName(song.title)}_studio_mix.wav`)
      else {
        const mp3 = await encodeMp3InWorker(mix, 256)
        downloadBlob(new Blob([mp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }), `${safeName(song.title)}_studio_mix.mp3`)
      }
    } finally {
      setExporting('')
    }
  }

  // ruler ticks
  const ticks: number[] = []
  const step = zoom >= 3 ? 5 : zoom >= 1.5 ? 10 : 20
  for (let s = 0; s <= duration; s += step) ticks.push(s)

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="icon-btn" onClick={() => navigate(`/song/${song.id}`)} aria-label="Back">
          <I.chevronLeft />
        </button>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>
            {song.title}
          </h1>
          <div className="small muted">Studio · {tracks.length} tracks</div>
        </div>
      </div>
      <div className="studio">
        <div className="studio-bar">
          <button className="play-sm" onClick={() => (playing ? (transport.pause(), setPlaying(false)) : void transport.play().then(() => setPlaying(true)))} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <I.pause /> : <I.play />}
          </button>
          <button className="icon-btn" onClick={() => transport.seek(0)} aria-label="Rewind">
            <I.prev />
          </button>
          <div className="lcd">{formatTime(t)}.{String(Math.floor((t % 1) * 10))}</div>
          <span className="small muted">{song.bpm ? `${Math.round(song.bpm)} BPM` : ''}</span>
          <span className="spacer" />
          <span className="small muted">Zoom</span>
          <div style={{ width: 110 }}>
            <Slider value={zoom} min={0.5} max={5} step={0.1} onChange={setZoom} label="Zoom" />
          </div>
          <button className="btn sm primary" onClick={() => navigate(`/karaoke/${song.id}`)}>
            <I.mic /> Record take
          </button>
          <button className="btn sm" disabled={!!exporting} onClick={() => void exportMix('mp3')}>
            <I.download /> MP3
          </button>
          <button className="btn sm" disabled={!!exporting} onClick={() => void exportMix('wav')}>
            <I.download /> WAV
          </button>
        </div>
        {exporting && (
          <div className="small muted row">
            <Spinner size={14} /> {exporting}…
          </div>
        )}
        <div className="tracks">
          <div style={{ display: 'grid', gridTemplateColumns: 'var(--head, 230px) 1fr' }} className="studio-grid">
            <div style={{ borderRight: '1px solid var(--line)' }}>
              <div style={{ height: 24, borderBottom: '1px solid var(--line)', background: 'var(--surface)' }} />
              {tracks.map((tr) => (
                <TrackHead key={tr.id} tr={tr} onChange={(p) => upd(tr.id, p)} songId={song.id} />
              ))}
            </div>
            <div ref={laneRef} style={{ overflowX: 'auto', position: 'relative' }}>
              <div style={{ width, position: 'relative' }}>
                <div className="ruler" onClick={seekFromEvent}>
                  {ticks.map((s) => (
                    <span key={s} style={{ position: 'absolute', left: s * pxPerSec + 3, top: 5 }}>
                      {formatTime(s)}
                    </span>
                  ))}
                </div>
                {tracks.map((tr) => (
                  <div key={tr.id} className="lane" style={{ height: 84, borderBottom: '1px solid var(--line)' }} onClick={seekFromEvent}>
                    {tr.buffer && <Clip tr={tr} pxPerSec={pxPerSec} onMove={(off) => upd(tr.id, { offset: off })} />}
                    {tr.busy && (
                      <div className="small muted row" style={{ position: 'absolute', left: 10, top: 8 }}>
                        {!tr.busy.startsWith('Error') && <Spinner size={13} />} {tr.busy}
                      </div>
                    )}
                  </div>
                ))}
                <div className="playhead" style={{ left: t * pxPerSec }} />
              </div>
            </div>
          </div>
        </div>
        <div className="tiny dim">
          Tip: drag a take left/right to fix timing. Tap a lane to move the playhead. Open a take to change its polish level.
        </div>
      </div>
      <style>{'@media (max-width:760px){ .studio-grid{ --head: 124px } }'}</style>
    </div>
  )
}

function TrackHead({ tr, onChange, songId }: { tr: TrackUI; onChange: (p: Partial<TrackUI>) => void; songId: string }) {
  return (
    <div className="track-head" style={{ height: 84, borderBottom: '1px solid var(--line)' }}>
      <div className="name">
        <span style={{ width: 8, height: 8, borderRadius: 2, background: tr.color, flex: 'none' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr.name}</span>
        {tr.take && <span className="badge hot">{describeLevel(tr.take.polish).short}</span>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <div className="ms">
          <button className={`m ${tr.muted ? 'on' : ''}`} onClick={() => onChange({ muted: !tr.muted })} title="Mute">
            M
          </button>
          <button className={`s ${tr.solo ? 'on' : ''}`} onClick={() => onChange({ solo: !tr.solo })} title="Solo">
            S
          </button>
        </div>
        {tr.take && (
          <button className="icon-btn sm" title="Polish this take" onClick={() => navigate(`/take/${songId}/${tr.take!.id}`)}>
            <I.sparkle />
          </button>
        )}
      </div>
      <Slider value={tr.volume} max={1.5} onChange={(v) => onChange({ volume: v })} label={`${tr.name} volume`} />
    </div>
  )
}

function Clip({ tr, pxPerSec, onMove }: { tr: TrackUI; pxPerSec: number; onMove: (off: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const peaks = useMemo(() => {
    const b = tr.buffer!
    const chans = [b.getChannelData(0)]
    return waveformPeaks(chans, Math.min(4000, Math.ceil(b.duration * 20)))
  }, [tr.buffer])
  const w = tr.buffer!.duration * pxPerSec
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const h = 84
    c.width = Math.min(16000, w * dpr)
    c.height = h * dpr
    const g = c.getContext('2d')!
    g.setTransform(c.width / w, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.fillStyle = tr.color + '22'
    g.fillRect(0, 2, w, h - 4)
    g.fillStyle = tr.color
    let max = 0.001
    for (const p of peaks) max = Math.max(max, p)
    const bw = w / peaks.length
    for (let i = 0; i < peaks.length; i++) {
      const v = (peaks[i] / max) * (h / 2 - 8)
      g.fillRect(i * bw, h / 2 - v, Math.max(0.6, bw * 0.8), Math.max(1, v * 2))
    }
  }, [peaks, w, tr.color])
  const drag = useRef<{ x: number; off: number } | null>(null)
  const draggable = tr.kind === 'take'
  return (
    <canvas
      ref={ref}
      style={{ left: tr.offset * pxPerSec, width: w, opacity: tr.muted ? 0.35 : 1, cursor: draggable ? 'grab' : undefined, borderRadius: 6, touchAction: draggable ? 'none' : undefined }}
      onClick={(e) => draggable && e.stopPropagation()}
      onPointerDown={(e) => {
        if (!draggable) return
        e.stopPropagation()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, off: tr.offset }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        onMove(drag.current.off + (e.clientX - drag.current.x) / pxPerSec)
      }}
      onPointerUp={() => (drag.current = null)}
    />
  )
}
