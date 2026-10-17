import { create } from 'zustand'
import type { Playlist, Song } from './models'
import { loadSettings, saveSettings, type Settings } from './settings'
import * as db from '../lib/db'

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
}

interface AppState {
  loaded: boolean
  songs: Song[]
  playlists: Playlist[]
  settings: Settings
  toasts: Toast[]
  load: () => Promise<void>
  upsertSong: (s: Song) => void
  patchSong: (id: string, patch: Partial<Song>, persist?: boolean) => void
  removeSong: (id: string) => Promise<void>
  setSettings: (patch: Partial<Settings>) => void
  savePlaylist: (p: Playlist) => void
  removePlaylist: (id: string) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
}

let toastId = 1
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useApp = create<AppState>((set, get) => ({
  loaded: false,
  songs: [],
  playlists: [],
  settings: loadSettings(),
  toasts: [],
  async load() {
    const [songs, playlists] = await Promise.all([db.getAllSongs(), db.getAllPlaylists()])
    // any song that was mid-generation when the app closed is marked failed
    for (const s of songs) {
      if (s.status === 'generating' || s.status === 'queued') {
        s.status = 'error'
        s.error = 'Interrupted — the app was closed while generating.'
        void db.putSong(s)
      }
      if (s.karaoke === 'processing') {
        s.karaoke = 'error'
        s.karaokeError = 'Interrupted'
        void db.putSong(s)
      }
    }
    songs.sort((a, b) => b.createdAt - a.createdAt)
    playlists.sort((a, b) => b.createdAt - a.createdAt)
    set({ songs, playlists, loaded: true })
  },
  upsertSong(s) {
    const songs = get().songs.filter((x) => x.id !== s.id)
    songs.unshift(s)
    songs.sort((a, b) => b.createdAt - a.createdAt)
    set({ songs })
    void db.putSong(s)
  },
  patchSong(id, patch, persist = true) {
    let updated: Song | undefined
    set({
      songs: get().songs.map((s) => {
        if (s.id !== id) return s
        updated = { ...s, ...patch }
        return updated
      }),
    })
    if (updated && persist) {
      // debounce progress writes
      clearTimeout(persistTimers.get(id))
      const u = updated
      persistTimers.set(id, setTimeout(() => void db.putSong(get().songs.find((x) => x.id === id) ?? u), 300))
    }
  },
  async removeSong(id) {
    const s = get().songs.find((x) => x.id === id)
    set({ songs: get().songs.filter((x) => x.id !== id) })
    await db.deleteSongRecord(id)
    if (s) {
      for (const k of [s.mixKey, s.instrumentalKey, s.vocalsKey, s.guidePitchKey, s.coverKey]) if (k) await db.deleteBlob(k)
      for (const t of s.takes) {
        await db.deleteBlob(t.rawKey)
        if (t.processedKey) await db.deleteBlob(t.processedKey)
      }
    }
  },
  setSettings(patch) {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    set({ settings })
  },
  savePlaylist(p) {
    set({ playlists: [p, ...get().playlists.filter((x) => x.id !== p.id)] })
    void db.putPlaylist(p)
  },
  removePlaylist(id) {
    set({ playlists: get().playlists.filter((x) => x.id !== id) })
    void db.deletePlaylist(id)
  },
  toast(text, kind = 'info') {
    const id = toastId++
    set({ toasts: [...get().toasts, { id, text, kind }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

export const getSong = (id: string) => useApp.getState().songs.find((s) => s.id === id)
