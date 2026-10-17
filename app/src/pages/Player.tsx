import { useEffect, useRef } from 'react'
import { usePlayer } from '../state/player'
import { useApp } from '../state/store'
import { Cover, Slider, useCoverUrl } from '../ui/components'
import { I } from '../ui/icons'
import { formatTime } from '../lib/audio'
import { navigate } from '../ui/router'
import { activeLineIndex } from '../lib/lyrics'
import type { TimedLine } from '../types'

export function PlayerBar() {
  const { songId, playing, time, duration, volume, toggle, seek, next, prev, setVolume, setExpanded } = usePlayer()
  const song = useApp((s) => s.songs.find((x) => x.id === songId))
  const patchSong = useApp((s) => s.patchSong)
  if (!song) return null
  const d = duration || song.durationSec || 0
  return (
    <div className="player">
      <div className="mini-progress" style={{ display: 'none', position: 'absolute', left: 0, right: 0, top: -1, height: 2, background: 'var(--surface-3)' }}>
        <div style={{ width: `${d ? (time / d) * 100 : 0}%`, height: '100%', background: 'var(--grad)' }} />
      </div>
      <div className="now">
        <Cover song={song} size={48} showPlay={false} onClick={() => setExpanded(true)} />
        <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => setExpanded(true)}>
          <div className="t">{song.title}</div>
          <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {song.tags.slice(0, 3).join(', ') || song.style}
          </div>
        </div>
        <button className={`icon-btn sm ${song.liked ? 'on' : ''}`} onClick={() => patchSong(song.id, { liked: !song.liked })} aria-label="Like">
          {song.liked ? <I.heartFill /> : <I.heart />}
        </button>
      </div>
      <div className="center">
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn sm hide-sm vol" onClick={prev} aria-label="Previous">
            <I.prev />
          </button>
          <button className="play-sm" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <I.pause /> : <I.play />}
          </button>
          <button className="icon-btn sm vol" onClick={next} aria-label="Next">
            <I.next />
          </button>
        </div>
        <div className="scrub">
          <span>{formatTime(time)}</span>
          <Slider value={time} max={d || 1} step={0.1} onChange={seek} label="Seek" />
          <span>{formatTime(d)}</span>
        </div>
      </div>
      <div className="right">
        <button className="icon-btn" title="Sing along" onClick={() => navigate(`/karaoke/${song.id}`)} aria-label="Karaoke">
          <I.mic />
        </button>
        <span className="vol" style={{ display: 'inline-flex' }}>
          <I.volume />
        </span>
        <Slider value={volume} onChange={setVolume} label="Volume" />
        <button className="icon-btn" onClick={() => setExpanded(true)} aria-label="Expand">
          <I.expand />
        </button>
      </div>
    </div>
  )
}

export function SyncedLyrics({ lines, time, onSeek, big }: { lines: TimedLine[]; time: number; onSeek?: (t: number) => void; big?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const idx = activeLineIndex(lines, time + 0.15)
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [idx])
  return (
    <div ref={ref}>
      {lines.map((l, i) => (
        <div
          key={i}
          data-i={i}
          onClick={() => onSeek?.(l.start)}
          style={{
            fontSize: big ? 26 : 18,
            fontWeight: 700,
            lineHeight: 1.35,
            margin: '12px 0',
            cursor: onSeek ? 'pointer' : undefined,
            color: i === idx ? 'var(--text)' : i < idx ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.5)',
            transition: 'color .25s',
          }}
        >
          {l.text}
        </div>
      ))}
    </div>
  )
}

export function NowPlaying() {
  const { songId, time, setExpanded, seek } = usePlayer()
  const song = useApp((s) => s.songs.find((x) => x.id === songId))
  const cover = useCoverUrl(song ?? { coverSeed: 1, style: '' })
  if (!song) return null
  return (
    <div className="np">
      <div className="np-bg" style={{ backgroundImage: `url("${cover}")` }} />
      <button className="icon-btn" style={{ position: 'absolute', top: 14, left: 14 }} onClick={() => setExpanded(false)} aria-label="Close">
        <I.chevronDown />
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 18, minHeight: 0 }}>
        <div className="art">
          <img src={cover} alt="" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{song.title}</div>
          <div className="muted">{song.tags.slice(0, 4).join(', ') || song.style}</div>
        </div>
        <div className="row">
          <button
            className="btn primary"
            onClick={() => {
              setExpanded(false)
              navigate(`/karaoke/${song.id}`)
            }}
          >
            <I.mic /> Sing along
          </button>
          <button
            className="btn"
            onClick={() => {
              setExpanded(false)
              navigate(`/song/${song.id}`)
            }}
          >
            Song page
          </button>
        </div>
      </div>
      <div className="lyrics-scroll">
        {song.timedLyrics?.length ? (
          <SyncedLyrics lines={song.timedLyrics} time={time} onSeek={seek} big />
        ) : song.lyricsText ? (
          <div className="lyrics-view" style={{ fontSize: 18 }}>
            {song.lyricsText}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 18 }}>
            {song.instrumental ? 'Instrumental' : song.karaoke === 'processing' ? 'Syncing lyrics…' : 'No lyrics'}
          </div>
        )}
      </div>
    </div>
  )
}
