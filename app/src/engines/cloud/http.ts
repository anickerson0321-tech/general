// Small fetch helpers shared by the cloud providers.

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** If a proxy URL is configured, requests go to `${proxy}?url=<encoded target>` with the same method/headers/body. */
export function withProxy(url: string, proxy: string): string {
  if (!proxy) return url
  return `${proxy.replace(/\/$/, '')}?url=${encodeURIComponent(url)}`
}

export async function readError(res: Response): Promise<string> {
  try {
    const t = await res.text()
    try {
      const j = JSON.parse(t)
      const d = j.detail ?? j.error ?? j.message ?? j
      if (typeof d === 'string') return d
      if (Array.isArray(d)) return d.map((x) => x.msg ?? JSON.stringify(x)).join('; ')
      if (d && typeof d === 'object' && 'message' in d) return String((d as { message: unknown }).message)
      return JSON.stringify(d).slice(0, 400)
    } catch {
      return t.slice(0, 400) || res.statusText
    }
  } catch {
    return res.statusText
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return `The API key was rejected (${e.status}). Check it in Settings. ${e.message}`
    if (e.status === 402) return `Out of credits on the provider account. ${e.message}`
    if (e.status === 429) return `Rate limited by the provider — wait a moment and try again.`
    return `${e.message} (HTTP ${e.status})`
  }
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message))
    return 'Network error reaching the AI provider (offline, blocked, or CORS). You can set a proxy in Settings.'
  return e instanceof Error ? e.message : String(e)
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

export async function fetchBlob(url: string, proxy = ''): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    res = await fetch(withProxy(url, proxy))
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res.blob()
}

export async function blobToDataUri(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}
