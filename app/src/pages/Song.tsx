import { useApp } from '../state/store'
import { usePlayer } from '../state/player'
import { downloadBlobKey, playOrToggle, safeName, useCoverUrl } from '../ui/components'
import { I } from '../ui/icons'
import { navigate } from '../ui/router'
import { formatTime } from '../lib/audio'
import { keyName } from '../lib/keydetect'
import { describeLevel } from '../dsp'
import { prepareKaraoke } from '../engines/generate'
import { SyncedLyrics } from './Player'

export function SongPage({ id }: { id: string }) {
  const song = useApp((s) => s.songs.find((x) => x.id === id))
  const { patchSong } = useApp()
  const { songId, playing, time, seek } = usePlayer()
  const cover = useCoverUrl(song ?? { coverSeed: 1, style: '' })
  if (!song) return <div className="page">Song not found. <a href="#/library">Back to library</a></div>
  const isCur = songId === song.id
  const ready = song.status === 'ready'
  return (
    <div className="page">
      <button className="btn sm ghost" onClick={() => history.back()} style={{ marginBottom: 12 }}>
        <I.chevronLeft /> Back
      </button>
      <div className="song-hero">
        <div className="art">
          <img src={cover} alt="" />
        </div>
        <div>
          <div className="row" style={{ gap: 6 }}>
            <span className="badge">{song.modelLabel}</span>
            {song.kind !== 'generation' && <span className="badge hot">{song.kind}</span>}
            {song.instrumental && <span className="badge">Instrumental</span>}
          </div>
          <h1>{song.title}</h1>
          <div className="muted" style={{ marginBottom: 6 }}>
            {song.tags.join(', ') || song.style}
          </div>
          <div className="small dim" style={{ marginBottom: 18 }}>
            {[formatTime(song.durationSec), song.bpm ? `${Math.round(song.bpm)} bpm` : '', keyName(song.key), `${song.plays} plays`, new Date(song.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}
          </div>
          {song.status === 'error' && <div className="card" style={{ borderColor: 'rgba(255,90,90,.4)', marginBottom: 12 }}>{song.error}</div>}
          {song.status !== 'ready' && song.status !== 'error' && (
            <div style={{ maxWidth: 360, marginBottom: 14 }}>
              <div className="small">{song.progressLabel}… {Math.round(song.progress * 100)}%</div>
              <div className="progress">
                <div style={{ width: `${song.progress * 100}%` }} />
              </div>
            </div>
          )}
          <div className="row wrap">
            {ready && (
              <button className="play-fab" onClick={() => playOrToggle(song)}>
                {isCur && playing ? <I.pause /> : <I.play />}
              </button>
            )}
            {ready && !song.instrumental && (
              <button className="btn primary lg" onClick={() => navigate(`/karaoke/${song.id}`)}>
                <I.mic /> Sing it
              </button>
            )}
            {ready && (
              <button className="btn lg" onClick={() => navigate(`/studio/${song.id}`)}>
                <I.studio /> Studio
              </button>
            )}
            <button className={`icon-btn ${song.liked ? 'on' : ''}`} onClick={() => patchSong(song.id, { liked: !song.liked, disliked: false })} aria-label="Like">
              {song.liked ? <I.heartFill /> : <I.heart />}
            </button>
            <button className={`icon-btn ${song.disliked ? 'on' : ''}`} onClick={() => patchSong(song.id, { disliked: !song.disliked, liked: false })} aria-label="Dislike">
              <I.thumbDown />
            </button>
            {ready && (
              <button className="icon-btn" title="Download MP3" onClick={() => void downloadBlobKey(song.mixKey, `${safeName(song.title)}.mp3`)}>
                <I.download />
              </button>
            )}
          </div>
          {song.engine !== 'local' && ready && song.karaoke !== 'ready' && (
            <div className="small muted" style={{ marginTop: 12 }}>
              {song.karaoke === 'processing' && <>Preparing karaoke: {song.karaokeLabel}…</>}
              {song.karaoke === 'error' && (
                <>
                  Karaoke prep failed: {song.karaokeError}{' '}
                  <button className="btn sm" onClick={() => void prepareKaraoke(song.id)}>
                    Retry
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 28, marginTop: 34 }} className="song-cols">
        <div>
          <h2 style={{ fontSize: 18 }}>Lyrics</h2>
          {song.instrumental ? (
            <div className="muted">Instrumental</div>
          ) : isCur && song.timedLyrics?.length ? (
            <div style={{ maxHeight: 480, overflowY: 'auto', padding: '0 4px' }}>
              <SyncedLyrics lines={song.timedLyrics} time={time} onSeek={seek} />
            </div>
          ) : (
            <LyricsText text={song.lyricsText} />
          )}
        </div>
        <div>
          <h2 style={{ fontSize: 18 }}>Your vocal takes</h2>
          {song.takes.length === 0 ? (
            <div className="empty">
              No takes yet.{' '}
              {!song.instrumental && ready && (
                <a href={`#/karaoke/${song.id}`} style={{ color: 'var(--accent)' }}>
                  Sing this song
                </a>
              )}
            </div>
          ) : (
            song.takes.map((t) => (
              <div key={t.id} className="song-row" style={{ cursor: 'pointer' }} onClick={() => navigate(`/take/${song.id}/${t.id}`)}>
                <div className="cover" style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'var(--grad)', color: '#1a0710' }}>
                  <I.mic />
                </div>
                <div className="meta">
                  <div className="title">
                    <span className="t">{t.name}</span> <span className="badge hot">{describeLevel(t.polish).short}</span>
                  </div>
                  <div className="tags">
                    {formatTime(t.durationSec)} · {new Date(t.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))
          )}
          <h2 style={{ fontSize: 18, marginTop: 26 }}>Prompt</h2>
          <div className="card small">
            <div className="muted" style={{ marginBottom: 6 }}>
              <b style={{ color: 'var(--text)' }}>Style:</b> {song.style || '—'}
            </div>
            {song.excludeStyle && (
              <div className="muted" style={{ marginBottom: 6 }}>
                <b style={{ color: 'var(--text)' }}>Exclude:</b> {song.excludeStyle}
              </div>
            )}
            <div className="row wrap" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => navigate(`/create?from=${song.id}`)}>
                <I.copy /> Reuse prompt
              </button>
              <button className="btn sm" onClick={() => navigate(`/create?from=${song.id}&mode=cover`)}>
                <I.repeat /> Make a cover
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>{'@media (max-width: 760px){ .song-cols{ grid-template-columns: 1fr !important } }'}</style>
    </div>
  )
}

export function LyricsText({ text }: { text: string }) {
  if (!text.trim()) return <div className="muted">No lyrics</div>
  return (
    <div className="lyrics-view">
      {text.split('\n').map((l, i) =>
        /^\[.*\]$/.test(l.trim()) ? (
          <span key={i} className="sec">
            {l.trim().slice(1, -1)}
          </span>
        ) : (
          <div key={i}>{l || ' '}</div>
        ),
      )}
    </div>
  )
}
