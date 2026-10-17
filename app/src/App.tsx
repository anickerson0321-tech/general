import { useEffect, type ReactNode } from 'react'
import { useApp } from './state/store'
import { useRoute } from './ui/router'
import { I, Logo } from './ui/icons'
import { Toasts } from './ui/components'
import { PlayerBar, NowPlaying } from './pages/Player'
import { HomePage } from './pages/Home'
import { CreatePage } from './pages/Create'
import { LibraryPage } from './pages/Library'
import { SongPage } from './pages/Song'
import { KaraokePage } from './pages/Karaoke'
import { TakePage } from './pages/Take'
import { StudioPage } from './pages/Studio'
import { SettingsPage } from './pages/Settings'
import { usePlayer } from './state/player'

const NAV: { path: string; label: string; icon: () => ReactNode }[] = [
  { path: '/', label: 'Home', icon: I.home },
  { path: '/create', label: 'Create', icon: I.create },
  { path: '/library', label: 'Library', icon: I.library },
  { path: '/karaoke', label: 'Karaoke', icon: I.mic },
  { path: '/studio', label: 'Studio', icon: I.studio },
]

export default function App() {
  const { loaded, load, settings } = useApp()
  const route = useRoute()
  const expanded = usePlayer((s) => s.expanded)
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    document.querySelector('.main')?.scrollTo({ top: 0 })
  }, [route.path])

  const top = '/' + (route.parts[0] ?? '')
  const isActive = (p: string) => (p === '/' ? top === '/' : top === p || (p === '/karaoke' && top === '/take'))

  let page: ReactNode
  const [a, b, c] = route.parts
  if (!loaded) page = <div className="page muted">Loading your library…</div>
  else if (!a) page = <HomePage />
  else if (a === 'create') page = <CreatePage query={route.query} />
  else if (a === 'library') page = <LibraryPage tab={b} />
  else if (a === 'song' && b) page = <SongPage id={b} />
  else if (a === 'karaoke') page = <KaraokePage id={b} />
  else if (a === 'take' && b && c) page = <TakePage songId={b} takeId={c} />
  else if (a === 'studio') page = <StudioPage id={b} />
  else if (a === 'settings') page = <SettingsPage />
  else page = <div className="page">Not found</div>

  const fullScreen = a === 'karaoke' && b

  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <a className="brand" href="#/">
            <Logo /> Encore
          </a>
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={`nav-item ${isActive(n.path) ? 'active' : ''}`}>
              <n.icon /> {n.label}
            </a>
          ))}
          <div className="nav-sep" />
          <a href="#/settings" className={`nav-item ${isActive('/settings') ? 'active' : ''}`}>
            <I.settings /> Settings
          </a>
          <div className="sidebar-foot">
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{settings.displayName}</div>
            {settings.keys.fal || settings.keys.elevenlabs ? (
              <span>
                <span className="badge good">AI on</span> {settings.keys.fal ? 'fal.ai' : 'ElevenLabs'} connected
              </span>
            ) : (
              <span>
                Offline engine only. <a href="#/settings">Add an AI key</a> for real vocals.
              </span>
            )}
          </div>
        </aside>
        <main className="main">
          <div className="mobile-top">
            <a className="brand" href="#/">
              <Logo /> Encore
            </a>
            <span className="spacer" />
            <a className="icon-btn" href="#/settings" aria-label="Settings">
              <I.settings />
            </a>
          </div>
          {page}
        </main>
      </div>
      {!fullScreen && <PlayerBar />}
      {expanded && !fullScreen && <NowPlaying />}
      <nav className="tabbar">
        {[NAV[0], NAV[2], NAV[1], NAV[3], NAV[4]].map((n) => (
          <a key={n.path} href={`#${n.path}`} className={`${isActive(n.path) ? 'active' : ''} ${n.path === '/create' ? 'create-tab' : ''}`}>
            <n.icon />
            {n.path === '/create' ? '' : n.label}
          </a>
        ))}
      </nav>
      <Toasts />
    </>
  )
}
