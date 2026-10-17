// Encore CORS proxy (optional). Forwards browser requests to the AI providers
// that Encore uses, adding CORS headers. Only allow-listed hosts are reachable.
// Deploy: supabase functions deploy encore-proxy --no-verify-jwt
// Then paste https://<project>.supabase.co/functions/v1/encore-proxy into Encore → Settings → Proxy URL.

const ALLOW = [
  'queue.fal.run',
  'fal.run',
  'rest.alpha.fal.ai',
  'api.elevenlabs.io',
]
const ALLOW_SUFFIX = ['.fal.media', '.fal.ai', '.fal.run']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, xi-api-key, x-fal-target-url',
  'Access-Control-Expose-Headers': 'content-type, song-id',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  const target = new URL(req.url).searchParams.get('url')
  if (!target) return new Response('missing ?url=', { status: 400, headers: cors })
  let u: URL
  try {
    u = new URL(target)
  } catch {
    return new Response('bad url', { status: 400, headers: cors })
  }
  if (u.protocol !== 'https:' || !(ALLOW.includes(u.hostname) || ALLOW_SUFFIX.some((s) => u.hostname.endsWith(s)))) {
    return new Response('host not allowed', { status: 403, headers: cors })
  }
  const headers = new Headers()
  for (const h of ['authorization', 'content-type', 'xi-api-key']) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }
  const upstream = await fetch(u, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
  })
  const out = new Headers(cors)
  const ct = upstream.headers.get('content-type')
  if (ct) out.set('content-type', ct)
  const sid = upstream.headers.get('song-id')
  if (sid) out.set('song-id', sid)
  return new Response(upstream.body, { status: upstream.status, headers: out })
})
