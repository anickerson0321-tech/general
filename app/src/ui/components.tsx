import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Song } from '../state/models'
import { useApp } from '../state/store'
import { usePlayer } from '../state/player'
import { coverDataUrl } from '../lib/cover'
import { formatTime } from '../lib/audio'
import { getBlob } from '../lib/db'
import { I } from './icons'
import { navigate } from './router'
import { prepareKaraoke } from '../engines/generate'

export function useCoverUrl(song: Pick<Song, 'coverSeed' | 'style' | 'coverKey'>): string {
  const [url, setUrl] = useState(() => coverDataUrl(song.coverSeed, song.style))
  useEffect(() => {
    let u: string | null = null
    let alive = true
    if (song.coverKey) {
      void getBlob(song.coverKey).then((b) => {
        if (b && alive) {
          u = URL.createObjectURL(b)
          setUrl(u)
        }
      })
    } else setUrl(coverDataUrl(song.coverSeed, song.style))
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [song.coverKey, song.coverSeed, song.style])
  return url
}

export function Cover({ song, size, onClick, showPlay = true }: { song: Song; size?: number; onClick?: () => void; showPlay?: boolean }) {
  const url = useCoverUrl(song)
  const { songId, playing } = usePlayer()
  const isCur = songId === song.id
  const style = size ? { width: size, height: size } : undefined
  return (
    <div className="cover" style={style} onClick={onClick}>
      <img src={url} alt="" />
      {song.status === 'ready' && song.durationSec > 0 && <span className="dur">{formatTime(song.durationSec)}</span>}
      {(song.status === 'generating' || song.status === 'queued') && <div className="gen pulse">{Math.round(song.progress * 100)}%</div>}
      {song.status === 'ready' && showPlay && <div className={`hover-play ${isCur ? 'show' : ''}`}>{isCur && playing ? <I.pause /> : <I.play />}</div>}
    </div>
  )
}

export function playOrToggle(song: Song, queue?: string[]) {
  const p = usePlayer.getState()
  if (p.songId === song.id) p.toggle()
  else void p.play(song.id, queue)
}

export function SongRow({ song, queue, compact }: { song: Song; queue?: string[]; compact?: boolean }) {
  const { patchSong } = useApp()
  const cur = usePlayer((s) => s.songId === song.id)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  return (
    <div className={`song-row ${cur ? 'current' : ''}`}>
      <Cover song={song} onClick={() => song.status === 'ready' && playOrToggle(song, queue)} />
      <div className="meta" onClick={() => navigate(`/song/${song.id}`)}>
        <div className="title">
          <span className="t">{song.title}</span>
          <span className="badge">{song.modelLabel}</span>
          {song.kind !== 'generation' && <span className="badge hot">{song.kind}</span>}
          {song.takes.length > 0 && <span className="badge good">{song.takes.length} take{song.takes.length > 1 ? 's' : ''}</span>}
        </div>
        {song.status === 'error' ? (
          <div className="tags" style={{ color: 'var(--bad)', whiteSpace: 'normal' }}>{song.error}</div>
        ) : song.status !== 'ready' ? (
          <>
            <div className="tags">{song.progressLabel}…</div>
            <div className="progress">
              <div style={{ width: `${Math.max(3, song.progress * 100)}%` }} />
            </div>
          </>
        ) : (
          <div className="tags">
            {song.tags.length ? song.tags.join(', ') : song.style || (song.instrumental ? 'Instrumental' : '')}
            {song.karaoke === 'processing' && <span className="dim"> · {song.karaokeLabel ?? 'Preparing karaoke'}…</span>}
          </div>
        )}
      </div>
      <div className="actions">
        {!compact && song.status === 'ready' && (
          <>
            <button className="icon-btn sm hide-sm" title="Sing it (karaoke)" onClick={() => navigate(`/karaoke/${song.id}`)}>
              <I.mic />
            </button>
            <button className={`icon-btn sm hide-sm ${song.liked ? 'on' : ''}`} title="Like" onClick={() => patchSong(song.id, { liked: !song.liked, disliked: false })}>
              {song.liked ? <I.heartFill /> : <I.heart />}
            </button>
          </>
        )}
        <button className="icon-btn sm" title="More" onClick={(e) => setMenu((e.currentTarget as HTMLElement).getBoundingClientRect())}>
          <I.more />
        </button>
      </div>
      {menu && <SongMenu song={song} anchor={menu} onClose={() => setMenu(null)} queue={queue} />}
    </div>
  )
}

export function SongCard({ song, queue, sub }: { song: Song; queue?: string[]; sub?: string }) {
  const url = useCoverUrl(song)
  const { songId, playing } = usePlayer()
  const isCur = songId === song.id
  return (
    <div className="song-card" onClick={() => navigate(`/song/${song.id}`)}>
      <div className="art">
        <img src={url} alt="" />
        {song.status === 'ready' && (
          <button
            className="play-fab fab"
            style={{ width: 44, height: 44 }}
            onClick={(e) => {
              e.stopPropagation()
              playOrToggle(song, queue)
            }}
          >
            {isCur && playing ? <I.pause /> : <I.play />}
          </button>
        )}
        {song.status !== 'ready' && (
          <div className="gen pulse" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.5)', fontWeight: 700 }}>
            {song.status === 'error' ? 'Failed' : `${Math.round(song.progress * 100)}%`}
          </div>
        )}
      </div>
      <div className="t">{song.title}</div>
      <div className="s">{sub ?? (song.tags.slice(0, 3).join(', ') || song.style)}</div>
    </div>
  )
}

export function Menu({ anchor, onClose, children, width = 230 }: { anchor: DOMRect; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.right - width, top: anchor.bottom + 6 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    let top = anchor.bottom + 6
    if (top + h > innerHeight - 10) top = Math.max(10, anchor.top - h - 6)
    let left = anchor.right - width
    if (left < 10) left = 10
    if (left + width > innerWidth - 10) left = innerWidth - width - 10
    setPos({ left, top })
  }, [anchor, width])
  useEffect(() => {
    const down = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    setTimeout(() => {
      document.addEventListener('pointerdown', down)
      document.addEventListener('keydown', esc)
    })
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])
  return (
    <div className="menu" ref={ref} style={{ ...pos, width }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

export async function downloadBlobKey(key: string | undefined, filename: string) {
  if (!key) return
  const b = await getBlob(key)
  if (!b) return
  downloadBlob(b, filename)
}

export function downloadBlob(b: Blob, filename: string) {
  const url = URL.createObjectURL(b)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'song'

function SongMenu({ song, anchor, onClose, queue }: { song: Song; anchor: DOMRect; onClose: () => void; queue?: string[] }) {
  const { patchSong, removeSong, playlists, savePlaylist, toast } = useApp()
  const [confirm, setConfirm] = useState(false)
  const [rename, setRename] = useState(false)
  const act = (f: () => void) => () => {
    f()
    onClose()
  }
  if (rename)
    return (
      <Modal onClose={onClose}>
        <h3>Rename song</h3>
        <RenameForm
          initial={song.title}
          onDone={(t) => {
            patchSong(song.id, { title: t })
            onClose()
          }}
        />
      </Modal>
    )
  const ready = song.status === 'ready'
  return (
    <Menu anchor={anchor} onClose={onClose}>
      {ready && (
        <>
          <button onClick={act(() => playOrToggle(song, queue))}>
            <I.play /> Play
          </button>
          <button onClick={act(() => navigate(`/karaoke/${song.id}`))}>
            <I.mic /> Sing it (karaoke)
          </button>
          <button onClick={act(() => navigate(`/studio/${song.id}`))}>
            <I.studio /> Open in Studio
          </button>
          <div className="sep" />
          <div className="lbl">Remix / Edit</div>
          <button onClick={act(() => navigate(`/create?from=${song.id}&mode=cover`))}>
            <I.repeat /> Cover (new style, same lyrics)
          </button>
        </>
      )}
      <button onClick={act(() => navigate(`/create?from=${song.id}`))}>
        <I.copy /> Reuse prompt
      </button>
      <button onClick={() => setRename(true)}>
        <I.edit /> Rename
      </button>
      {ready && (
        <>
          <div className="sep" />
          <div className="lbl">Download</div>
          <button onClick={act(() => void downloadBlobKey(song.mixKey, `${safeName(song.title)}.mp3`))}>
            <I.download /> Song (MP3)
          </button>
          {song.instrumentalKey && (
            <button onClick={act(() => void downloadBlobKey(song.instrumentalKey, `${safeName(song.title)}_instrumental.mp3`))}>
              <I.download /> Instrumental stem
            </button>
          )}
          {song.vocalsKey && (
            <button onClick={act(() => void downloadBlobKey(song.vocalsKey, `${safeName(song.title)}_vocals.mp3`))}>
              <I.download /> Vocal stem
            </button>
          )}
          {song.engine !== 'local' && song.karaoke === 'error' && (
            <button onClick={act(() => void prepareKaraoke(song.id))}>
              <I.repeat /> Retry karaoke prep
            </button>
          )}
          {playlists.length > 0 && (
            <>
              <div className="sep" />
              <div className="lbl">Add to playlist</div>
              {playlists.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  onClick={act(() => {
                    if (!p.songIds.includes(song.id)) savePlaylist({ ...p, songIds: [...p.songIds, song.id] })
                    toast(`Added to ${p.name}`, 'success')
                  })}
                >
                  <I.list /> {p.name}
                </button>
              ))}
            </>
          )}
        </>
      )}
      <div className="sep" />
      {!confirm ? (
        <button className="danger" onClick={() => setConfirm(true)}>
          <I.trash /> Delete
        </button>
      ) : (
        <button
          className="danger"
          style={{ color: 'var(--bad)' }}
          onClick={act(() => {
            if (usePlayer.getState().songId === song.id) usePlayer.getState().pause()
            void removeSong(song.id)
          })}
        >
          <I.trash /> Tap again to delete forever
        </button>
      )}
    </Menu>
  )
}

function RenameForm({ initial, onDone }: { initial: string; onDone: (t: string) => void }) {
  const [t, setT] = useState(initial)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onDone(t.trim() || initial)
      }}
    >
      <input className="input" autoFocus value={t} maxLength={100} onChange={(e) => setT(e.target.value)} />
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn primary">Save</button>
      </div>
    </form>
  )
}

export function Modal({ children, onClose, width }: { children: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        {children}
      </div>
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" aria-label={label} aria-pressed={on} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
}

export function Slider({ value, min = 0, max = 1, step = 0.01, onChange, onCommit, label, className = 'slider' }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; label?: string; className?: string }) {
  const p = ((value - min) / (max - min)) * 100
  return (
    <input
      aria-label={label}
      type="range"
      className={className}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ['--p' as string]: `${p}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
    />
  )
}

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

/** Simple waveform drawn from peaks onto a canvas. */
export function Waveform({ peaks, color = 'rgba(255,255,255,.55)', height = 64, progress, progressColor = '#ff6f8f' }: { peaks: Float32Array | null; color?: string; height?: number; progress?: number; progressColor?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    c.width = w * dpr
    c.height = height * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, height)
    if (!peaks) return
    const n = peaks.length
    const bw = w / n
    let max = 0.0001
    for (let i = 0; i < n; i++) max = Math.max(max, peaks[i])
    for (let i = 0; i < n; i++) {
      const v = (peaks[i] / max) * (height / 2 - 2)
      g.fillStyle = progress !== undefined && i / n < progress ? progressColor : color
      g.fillRect(i * bw, height / 2 - v, Math.max(1, bw - 1), Math.max(1, v * 2))
    }
  }, [peaks, color, height, progress, progressColor])
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 0.9s linear infinite' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}
