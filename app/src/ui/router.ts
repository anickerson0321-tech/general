import { useEffect, useState } from 'react'

export function currentPath(): string {
  const h = location.hash.replace(/^#/, '')
  return h || '/'
}

export function navigate(path: string) {
  if (currentPath() === path) return
  location.hash = path
}

export function back(fallback = '/') {
  if (history.length > 1) history.back()
  else navigate(fallback)
}

export function useRoute(): { path: string; parts: string[]; query: URLSearchParams } {
  const [path, setPath] = useState(currentPath())
  useEffect(() => {
    const on = () => setPath(currentPath())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const [p, q = ''] = path.split('?')
  return { path: p, parts: p.split('/').filter(Boolean), query: new URLSearchParams(q) }
}
