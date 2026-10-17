import { openDB, type IDBPDatabase } from 'idb'
import type { Song, Playlist } from '../state/models'

interface Schema {
  songs: Song
  blobs: Blob
  playlists: Playlist
  kv: unknown
}

let dbp: Promise<IDBPDatabase> | null = null
function db() {
  if (!dbp) {
    dbp = openDB('encore', 1, {
      upgrade(d) {
        d.createObjectStore('songs', { keyPath: 'id' })
        d.createObjectStore('blobs')
        d.createObjectStore('playlists', { keyPath: 'id' })
        d.createObjectStore('kv')
      },
    })
  }
  return dbp
}

export async function getAllSongs(): Promise<Song[]> {
  return (await db()).getAll('songs')
}
export async function putSong(s: Song) {
  await (await db()).put('songs', s)
}
export async function deleteSongRecord(id: string) {
  await (await db()).delete('songs', id)
}
export async function getAllPlaylists(): Promise<Playlist[]> {
  return (await db()).getAll('playlists')
}
export async function putPlaylist(p: Playlist) {
  await (await db()).put('playlists', p)
}
export async function deletePlaylist(id: string) {
  await (await db()).delete('playlists', id)
}
export async function putBlob(key: string, blob: Blob) {
  await (await db()).put('blobs', blob, key)
}
export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await db()).get('blobs', key)
}
export async function deleteBlob(key: string) {
  await (await db()).delete('blobs', key)
}
export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key) as Promise<T | undefined>
}
export async function kvSet(key: string, value: unknown) {
  await (await db()).put('kv', value, key)
}
export type { Schema }
