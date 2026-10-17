import { create } from 'zustand'
import { getBlob } from '../lib/db'
import { coverDataUrl } from '../lib/cover'
import { getSong, useApp } from './store'

interface PlayerState {
  songId: string | null
  queue: string[]
  playing: boolean
  time: number
  duration: number
  volume: number
  expanded: boolean
  play: (id: string, queue?: string[]) => Promise<void>
  toggle: () => void
  pause: () => void
  seek: (t: number) => void
  next: () => void
  prev: () => void
  setVolume: (v: number) => void
  setExpanded: (v: boolean) => void
}

const audio = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement)
let currentUrl: string | null = null

export const usePlayer = create<PlayerState>((set, get) => ({
  songId: null,
  queue: [],
  playing: false,
  time: 0,
  duration: 0,
  volume: 1,
  expanded: false,
  async play(id, queue) {
    const s = getSong(id)
    if (!s?.mixKey) return
    if (get().songId === id && audio.src) {
      void audio.play()
      return
    }
    const blob = await getBlob(s.mixKey)
    if (!blob) return
    if (currentUrl) URL.revokeObjectURL(currentUrl)
    currentUrl = URL.createObjectURL(blob)
    audio.src = currentUrl
    audio.volume = get().volume
    set({ songId: id, queue: queue ?? get().queue, time: 0, duration: s.durationSec })
    try {
      await audio.play()
    } catch {
      /* autoplay blocked */
    }
    useApp.getState().patchSong(id, { plays: (s.plays ?? 0) + 1 })
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.title,
        artist: useApp.getState().settings.displayName,
        album: 'Encore',
        artwork: [{ src: coverDataUrl(s.coverSeed, s.style), sizes: '512x512', type: 'image/svg+xml' }],
      })
      navigator.mediaSession.setActionHandler('nexttrack', () => get().next())
      navigator.mediaSession.setActionHandler('previoustrack', () => get().prev())
    }
  },
  toggle() {
    if (!audio.src) return
    if (audio.paused) void audio.play()
    else audio.pause()
  },
  pause() {
    audio.pause()
  },
  seek(t) {
    if (isFinite(t)) audio.currentTime = Math.max(0, t)
  },
  next() {
    const { queue, songId } = get()
    const i = queue.indexOf(songId ?? '')
    const nxt = queue.slice(i + 1).find((q) => getSong(q)?.status === 'ready')
    if (nxt) void get().play(nxt)
  },
  prev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const { queue, songId } = get()
    const i = queue.indexOf(songId ?? '')
    const prv = queue
      .slice(0, Math.max(0, i))
      .reverse()
      .find((q) => getSong(q)?.status === 'ready')
    if (prv) void get().play(prv)
  },
  setVolume(v) {
    audio.volume = v
    set({ volume: v })
  },
  setExpanded(v) {
    set({ expanded: v })
  },
}))

if (audio) {
  audio.addEventListener('play', () => usePlayer.setState({ playing: true }))
  audio.addEventListener('pause', () => usePlayer.setState({ playing: false }))
  audio.addEventListener('timeupdate', () => usePlayer.setState({ time: audio.currentTime }))
  audio.addEventListener('loadedmetadata', () => usePlayer.setState({ duration: audio.duration }))
  audio.addEventListener('ended', () => {
    usePlayer.setState({ playing: false })
    usePlayer.getState().next()
  })
}

/** Pause the main player (e.g. when entering karaoke or studio). */
export function pauseMainPlayer() {
  audio?.pause()
}

export function playerTimeNow() {
  return audio?.currentTime ?? 0
}
