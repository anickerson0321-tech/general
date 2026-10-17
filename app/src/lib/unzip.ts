// Minimal ZIP reader (stored + deflate) using the browser's DecompressionStream.

export interface ZipEntry {
  name: string
  data: Uint8Array
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function unzip(buf: ArrayBuffer): Promise<ZipEntry[]> {
  const v = new DataView(buf)
  const u8 = new Uint8Array(buf)
  // find end of central directory
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: ZipEntry[] = []
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const csize = v.getUint32(p + 20, true)
    const nlen = v.getUint16(p + 28, true)
    const xlen = v.getUint16(p + 30, true)
    const clen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/')) continue
    const lnlen = v.getUint16(local + 26, true)
    const lxlen = v.getUint16(local + 28, true)
    const start = local + 30 + lnlen + lxlen
    const raw = u8.subarray(start, start + csize)
    const data = method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw) : null
    if (data) out.push({ name, data })
  }
  return out
}
