import { useEffect, useState } from 'react'
import { useApp } from '../state/store'
import { PROVIDERS, friendlyError } from '../engines/generate'
import { measureLatency } from '../lib/calibrate'
import { Slider, Spinner, Toggle } from '../ui/components'
import { I } from '../ui/icons'

export function SettingsPage() {
  const { settings, setSettings, toast, songs } = useApp()
  const [testing, setTesting] = useState('')
  const [calib, setCalib] = useState('')
  const [usage, setUsage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null)
  const [show, setShow] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void (async () => {
      try {
        const est = await navigator.storage?.estimate?.()
        const persisted = (await navigator.storage?.persisted?.()) ?? false
        if (est) setUsage({ used: est.usage ?? 0, quota: est.quota ?? 0, persisted })
      } catch {
        /* ignore */
      }
    })()
  }, [songs.length])

  const test = async (id: 'fal' | 'elevenlabs') => {
    const key = settings.keys[id]
    if (!key) return
    setTesting(id)
    try {
      await PROVIDERS[id].testKey({ key, proxy: settings.proxyUrl })
      toast(`${PROVIDERS[id].label} key works!`, 'success')
    } catch (e) {
      toast(friendlyError(e), 'error')
    } finally {
      setTesting('')
    }
  }

  const calibrate = async () => {
    setCalib('Get ready — 6 clicks will play. Use your speaker, not headphones.')
    try {
      const r = await measureLatency((s) => setCalib(s))
      setSettings({ latencyMs: Math.max(-200, Math.min(500, r.extraMs)) })
      setCalib(`Measured ${r.totalMs} ms round trip (${r.hits}/6 clicks). Saved a ${r.extraMs} ms correction.`)
    } catch (e) {
      setCalib(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Everything stays on this device. Keys are stored only in this browser.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <I.sparkle />
          <h3 style={{ margin: 0 }}>AI music engine</h3>
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>
          Encore works offline with its built-in engine (synth vocals). For real, studio-quality AI singers, add <b>one</b> key below. <b>fal.ai is recommended</b>: a single pay-as-you-go key covers songs, vocal/instrumental splitting, karaoke lyric timing and AI lyrics.
        </p>
        {(['fal', 'elevenlabs'] as const).map((id) => {
          const p = PROVIDERS[id]
          return (
            <div key={id} className="field" style={{ marginTop: 14 }}>
              <div className="field-label">
                <span>
                  {p.label} API key {id === 'fal' && <span className="badge hot">recommended</span>}
                </span>
                <a href={p.keyUrl} target="_blank" rel="noreferrer" className="small" style={{ color: 'var(--accent)' }}>
                  Get a key ↗
                </a>
              </div>
              <div className="row">
                <input
                  className="input"
                  type={show[id] ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={id === 'fal' ? 'xxxxxxxx-xxxx-…:xxxxxxxx' : 'sk_…'}
                  value={settings.keys[id] ?? ''}
                  onChange={(e) => setSettings({ keys: { ...settings.keys, [id]: e.target.value.trim() } })}
                />
                <button className="icon-btn" onClick={() => setShow((s) => ({ ...s, [id]: !s[id] }))} aria-label="Show key">
                  <I.key />
                </button>
                <button className="btn sm" disabled={!settings.keys[id] || testing === id} onClick={() => void test(id)}>
                  {testing === id ? <Spinner size={14} /> : 'Test'}
                </button>
              </div>
              <div className="tiny dim">{p.keyHelp}</div>
            </div>
          )
        })}
        <div className="field" style={{ marginTop: 6 }}>
          <div className="field-label">Default engine for new songs</div>
          <select className="select" value={settings.engine} onChange={(e) => setSettings({ engine: e.target.value as typeof settings.engine })}>
            <option value="local">Encore Local (offline)</option>
            <option value="fal" disabled={!settings.keys.fal}>
              fal.ai {settings.keys.fal ? '' : '(add key)'}
            </option>
            <option value="elevenlabs" disabled={!settings.keys.elevenlabs}>
              ElevenLabs {settings.keys.elevenlabs ? '' : '(add key)'}
            </option>
          </select>
        </div>
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            Advanced: CORS proxy
          </summary>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="field-label">Proxy URL (optional)</div>
            <input className="input" placeholder="https://<project>.supabase.co/functions/v1/encore-proxy" value={settings.proxyUrl} onChange={(e) => setSettings({ proxyUrl: e.target.value.trim() })} />
            <div className="tiny dim">Only needed if your browser blocks direct calls to the provider. A ready-to-deploy Supabase Edge Function is included in the repo (supabase/functions/encore-proxy).</div>
          </div>
        </details>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <I.mic />
          <h3 style={{ margin: 0 }}>Singing & recording</h3>
        </div>
        <div className="row" style={{ margin: '12px 0' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Echo cancellation</div>
            <div className="small muted">Turn on if you sing without headphones, so the music playing from your speaker isn’t recorded with your voice. Off gives the most natural sound.</div>
          </div>
          <Toggle on={settings.echoCancellation} onChange={(v) => setSettings({ echoCancellation: v })} />
        </div>
        <div style={{ margin: '14px 0 6px', fontWeight: 600 }}>Timing correction</div>
        <div className="small muted">If your recorded voice sounds early or late against the music, calibrate once (on speaker) or set it by hand.</div>
        <div className="slider-row" style={{ marginTop: 10, gridTemplateColumns: '90px 1fr 60px' }}>
          <span>Latency</span>
          <Slider value={settings.latencyMs} min={-200} max={500} step={5} onChange={(v) => setSettings({ latencyMs: v })} label="Latency" />
          <span>{settings.latencyMs} ms</span>
        </div>
        <div className="row wrap">
          <button className="btn sm" onClick={() => void calibrate()}>
            <I.headphones /> Auto-calibrate
          </button>
          {calib && <span className="small muted">{calib}</span>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Profile</h3>
        <div className="field">
          <div className="field-label">Artist name</div>
          <input className="input" value={settings.displayName} maxLength={40} onChange={(e) => setSettings({ displayName: e.target.value })} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Storage</h3>
        {usage && (
          <div className="small muted" style={{ marginBottom: 10 }}>
            Using {(usage.used / 1e6).toFixed(1)} MB of {(usage.quota / 1e9).toFixed(1)} GB available · {usage.persisted ? 'protected from automatic cleanup' : 'the browser may clear this if space runs low'}
          </div>
        )}
        <div className="row wrap">
          {!usage?.persisted && (
            <button
              className="btn sm"
              onClick={async () => {
                const ok = await navigator.storage?.persist?.()
                toast(ok ? 'Storage protected.' : 'The browser declined — add Encore to your home screen to protect it.', ok ? 'success' : 'info')
              }}
            >
              Protect my library
            </button>
          )}
          <button
            className="btn sm danger"
            onClick={async () => {
              if (!confirm('Delete ALL songs, takes and settings on this device? This cannot be undone.')) return
              localStorage.clear()
              indexedDB.deleteDatabase('encore')
              location.reload()
            }}
          >
            <I.trash /> Erase everything
          </button>
        </div>
      </div>
      <p className="tiny dim" style={{ marginTop: 20 }}>
        Encore · AI songs you can sing yourself. Not affiliated with Suno.
      </p>
    </div>
  )
}
