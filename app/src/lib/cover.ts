// Procedural cover art: every song gets unique abstract artwork from its seed + style.

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

const PALETTES: Record<string, string[][]> = {
  warm: [['#ff6a3d', '#ffb347', '#ff3d7f', '#2a0a1f'], ['#f72585', '#ff9e00', '#7209b7', '#10002b']],
  cool: [['#4cc9f0', '#4361ee', '#3a0ca3', '#03045e'], ['#00f5d4', '#00bbf9', '#9b5de5', '#0b132b']],
  dark: [['#e63946', '#1d1d1d', '#6a040f', '#000000'], ['#8338ec', '#3a0ca3', '#111111', '#ff006e']],
  earthy: [['#e9c46a', '#f4a261', '#2a9d8f', '#264653'], ['#bc6c25', '#dda15e', '#606c38', '#283618']],
  pastel: [['#ffc8dd', '#bde0fe', '#cdb4db', '#a2d2ff'], ['#fbf8cc', '#f1c0e8', '#90dbf4', '#98f5e1']],
  neon: [['#ff00e6', '#00f0ff', '#7b2cff', '#0a0018'], ['#f9f871', '#ff4ecd', '#00d2ff', '#14002b']],
}

function paletteFor(style: string, r: () => number): string[] {
  const s = style.toLowerCase()
  let key = 'warm'
  if (/synth|80s|edm|house|techno|cyber|electro|neon|kpop/.test(s)) key = 'neon'
  else if (/dark|trap|metal|drill|horror|phonk|grunge/.test(s)) key = 'dark'
  else if (/folk|country|acoustic|blues|reggae|soul|gospel/.test(s)) key = 'earthy'
  else if (/lofi|lo-fi|chill|dream|ambient|bedroom|indie/.test(s)) key = 'pastel'
  else if (/sad|ballad|piano|jazz|ocean|night|rain|cinematic/.test(s)) key = 'cool'
  else key = Object.keys(PALETTES)[Math.floor(r() * 6)]
  const opts = PALETTES[key]
  return opts[Math.floor(r() * opts.length)]
}

const cache = new Map<string, string>()

export function coverDataUrl(seed: number, style: string): string {
  const k = `${seed}|${style}`
  const hit = cache.get(k)
  if (hit) return hit
  const r = rng(seed)
  const pal = paletteFor(style, r)
  const bg = pal[3]
  const blobs: string[] = []
  const n = 4 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    const cx = (r() * 100).toFixed(1)
    const cy = (r() * 100).toFixed(1)
    const rad = (25 + r() * 45).toFixed(1)
    const c = pal[Math.floor(r() * 3)]
    blobs.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${c}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`)
  }
  const shapeKind = Math.floor(r() * 4)
  let shape = ''
  if (shapeKind === 0) {
    const y = 30 + r() * 40
    shape = `<circle cx="50" cy="${y.toFixed(1)}" r="${(12 + r() * 14).toFixed(1)}" fill="${pal[1]}" opacity="0.9" filter="url(#g)"/>`
  } else if (shapeKind === 1) {
    const lines = []
    for (let i = 0; i < 9; i++) lines.push(`<rect x="0" y="${55 + i * 5}" width="100" height="${(1 + i * 0.25).toFixed(2)}" fill="${bg}" opacity="0.55"/>`)
    shape = lines.join('')
  } else if (shapeKind === 2) {
    const pts = Array.from({ length: 7 }, (_, i) => `${(i * 16.6).toFixed(1)},${(60 + Math.sin(i + r() * 3) * 18).toFixed(1)}`).join(' ')
    shape = `<polyline points="${pts}" fill="none" stroke="${pal[1]}" stroke-width="2.5" opacity="0.8"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
<defs>
<filter id="b"><feGaussianBlur stdDeviation="${(9 + r() * 6).toFixed(1)}"/></filter>
<filter id="g"><feGaussianBlur stdDeviation="1.2"/></filter>
<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 1000}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0"/></filter>
</defs>
<rect width="100" height="100" fill="${bg}"/>
<g filter="url(#b)">${blobs.join('')}</g>
${shape}
<rect width="100" height="100" filter="url(#n)"/>
</svg>`
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  cache.set(k, url)
  return url
}
