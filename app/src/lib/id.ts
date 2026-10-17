export function uid(prefix = ''): string {
  const r = crypto.getRandomValues(new Uint32Array(2))
  return prefix + Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4)
}
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}
