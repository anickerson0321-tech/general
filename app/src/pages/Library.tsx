import { useMemo, useState } from 'react'
import { useApp } from '../state/store'
import { Modal, SongRow, useCoverUrl } from '../ui/components'
import type { Song } from '../state/models'
import { I } from '../ui/icons'
import { navigate } from '../ui/router'
import { UploadButton } from '../ui/UploadModal'
import { uid } from '../lib/id'
import { formatTime } from '../lib/audio'
import { describeLevel } from '../dsp'

const TABS = [
  ['songs', 'Songs'],
  ['liked', 'Liked'],
  ['playlists', 'Playlists'],
  ['vocals', 'My Vocals'],
] as const

export function LibraryPage({ tab = 'songs' }: { tab?: string }) {
  const { songs, playlists, savePlaylist, removePlaylist } = useApp()
  const [q, setQ] = useState('')
  const [type, setType] = useState<'all' | 'generation' | 'cover' | 'instrumental'>('all')
  const [newPl, setNewPl] = useState(false)
  const [openPl, setOpenPl] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const qq = q.toLowerCase()
    return songs.filter((s) => {
      if (s.trashed) return false
      if (tab === 'liked' && !s.liked) return false
      if (type === 'instrumental' && !s.instrumental) return false
      if (type === 'generation' && s.kind !== 'generation') return false
      if (type === 'cover' && s.kind !== 'cover') return false
      if (!qq) return true
      return (s.title + ' ' + s.style + ' ' + s.tags.join(' ') + ' ' + s.lyricsText).toLowerCase().includes(qq)
    })
  }, [songs, q, tab, type])
  const queue = filtered.map((s) => s.id)

  const takes = songs.flatMap((s) => s.takes.map((t) => ({ song: s, take: t }))).sort((a, b) => b.take.createdAt - a.take.createdAt)
  const pl = playlists.find((p) => p.id === openPl)

  return (
    <div className="page">
      <h1 className="page-title">Library</h1>
      <p className="page-sub">{songs.length} songs · {takes.length} vocal takes · everything is saved on this device</p>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="seg">
          {TABS.map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => navigate(`/library/${k}`)}>
              {l}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {(tab === 'songs' || tab === 'liked') && (
          <>
            <div className="row" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, padding: '0 12px', height: 36 }}>
              <I.search />
              <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ background: 'transparent', border: 'none', outline: 'none', width: 160 }} />
            </div>
            <select className="select" style={{ width: 'auto', borderRadius: 999, height: 36, padding: '0 12px' }} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="all">All types</option>
              <option value="generation">Generations</option>
              <option value="cover">Covers</option>
              <option value="instrumental">Instrumentals</option>
            </select>
          </>
        )}
        {(tab === 'songs' || tab === 'liked') && <UploadButton />}
        {tab === 'playlists' && (
          <button className="btn" onClick={() => setNewPl(true)}>
            <I.plus /> New playlist
          </button>
        )}
      </div>

      {(tab === 'songs' || tab === 'liked') &&
        (filtered.length ? (
          filtered.map((s) => <SongRow key={s.id} song={s} queue={queue} />)
        ) : (
          <div className="empty">
            {tab === 'liked' ? 'Songs you like will appear here.' : q ? 'No matches.' : 'No songs yet.'}{' '}
            {!q && (
              <a href="#/create" style={{ color: 'var(--accent)' }}>
                Create one
              </a>
            )}
          </div>
        ))}

      {tab === 'playlists' &&
        (pl ? (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <button className="icon-btn" onClick={() => setOpenPl(null)}>
                <I.chevronLeft />
              </button>
              <h2 style={{ margin: 0 }}>{pl.name}</h2>
              <span className="muted small">{pl.songIds.length} songs</span>
              <span className="spacer" />
              <button
                className="btn sm danger"
                onClick={() => {
                  removePlaylist(pl.id)
                  setOpenPl(null)
                }}
              >
                Delete playlist
              </button>
            </div>
            {pl.songIds.length === 0 && <div className="empty">Add songs from any song’s ⋯ menu.</div>}
            {pl.songIds
              .map((id) => songs.find((s) => s.id === id))
              .filter(Boolean)
              .map((s) => (
                <SongRow key={s!.id} song={s!} queue={pl.songIds} />
              ))}
          </>
        ) : playlists.length ? (
          <div className="grid">
            {playlists.map((p) => {
              const first = songs.find((s) => s.id === p.songIds[0])
              return (
                <div key={p.id} className="song-card" onClick={() => setOpenPl(p.id)}>
                  <div className="art" style={{ display: 'grid', placeItems: 'center' }}>
                    {first ? <PlArt song={first} /> : <I.list />}
                  </div>
                  <div className="t">{p.name}</div>
                  <div className="s">{p.songIds.length} songs</div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty">No playlists yet.</div>
        ))}

      {tab === 'vocals' &&
        (takes.length ? (
          takes.map(({ song, take }) => (
            <div key={take.id} className="song-row" onClick={() => navigate(`/take/${song.id}/${take.id}`)} style={{ cursor: 'pointer' }}>
              <div className="cover" style={{ display: 'grid', placeItems: 'center', background: 'var(--grad)', color: '#1a0710' }}>
                <I.mic />
              </div>
              <div className="meta">
                <div className="title">
                  <span className="t">{take.name}</span>
                  <span className="badge hot">{describeLevel(take.polish).short}</span>
                </div>
                <div className="tags">
                  on “{song.title}” · {formatTime(take.durationSec)} · {new Date(take.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">
            Sing over any song in{' '}
            <a href="#/karaoke" style={{ color: 'var(--accent)' }}>
              Karaoke
            </a>{' '}
            and your takes will be saved here.
          </div>
        ))}

      {newPl && (
        <Modal onClose={() => setNewPl(false)}>
          <h3>New playlist</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const name = String(new FormData(e.currentTarget).get('n') || '').trim()
              if (name) savePlaylist({ id: uid('p'), name, createdAt: Date.now(), songIds: [] })
              setNewPl(false)
            }}
          >
            <input className="input" name="n" autoFocus placeholder="Playlist name" maxLength={60} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn primary">Create</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function PlArt({ song }: { song: Song }) {
  const url = useCoverUrl(song)
  return <img src={url} alt="" />
}
