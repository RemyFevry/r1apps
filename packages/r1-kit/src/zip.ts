export interface ZipFile {
  has(name: string): boolean
  read(name: string): Promise<Uint8Array>
}

interface CdEntry {
  name: string
  method: number
  compSize: number
  dataOffset: number
}

let modePromise: Promise<InflateMode> | null = null

export type InflateMode = 'native' | 'fflate'

// Resolves which decompression path this platform will take — usable before
// any zip is opened (e.g. surfaced in diagnostics headers on-device).
export function inflateMode(): Promise<InflateMode> {
  if (!modePromise) {
    modePromise = new Promise((resolve) => {
      try {
        new DecompressionStream('deflate-raw')
        resolve('native')
      } catch {
        resolve('fflate')
      }
    })
  }
  return modePromise
}

export async function openZip(data: Uint8Array): Promise<ZipFile> {
  if ((await inflateMode()) === 'native') return openZipNative(data)
  const { unzipSync } = await import('fflate')
  const files = unzipSync(data)
  const cache = new Map<string, Uint8Array>()
  return {
    has(name: string) {
      return Object.prototype.hasOwnProperty.call(files, name) && !name.endsWith('/')
    },
    async read(name: string) {
      const hit = cache.get(name)
      if (hit) return hit
      const bytes = new Uint8Array(files[name])
      cache.set(name, bytes)
      return bytes
    },
  }
}

function openZipNative(data: Uint8Array): ZipFile {
  const byName = new Map(readCentralDirectory(data).filter((e) => !e.name.endsWith('/')).map((e) => [e.name, e]))
  const cache = new Map<string, Uint8Array>()
  return {
    has(name: string) {
      return byName.has(name)
    },
    async read(name: string) {
      const hit = cache.get(name)
      if (hit) return hit
      const e = byName.get(name)
      if (!e) throw new Error('not in zip: ' + name)
      const slice = data.subarray(e.dataOffset, e.dataOffset + e.compSize)
      const out = e.method === 0 ? new Uint8Array(slice) : await inflateRaw(slice)
      cache.set(name, out)
      return out
    },
  }
}

function readCentralDirectory(data: Uint8Array): CdEntry[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const scanFrom = Math.max(0, data.length - 65557)
  let eocd = -1
  for (let i = data.length - 22; i >= scanFrom; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip: end-of-central-directory signature not found')
  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)
  const entries: CdEntry[] = []
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('corrupt zip: bad central directory entry')
    const method = dv.getUint16(off + 10, true)
    const compSize = dv.getUint32(off + 20, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const localOff = dv.getUint32(off + 42, true)
    const name = dec.decode(data.subarray(off + 46, off + 46 + nameLen))
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    entries.push({ name, method, compSize, dataOffset: localOff + 30 + lNameLen + lExtraLen })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(comp: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  const written = writer.write(new Uint8Array(comp)).then(() => writer.close())
  const reader = ds.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const r = await reader.read()
    if (r.done) break
    chunks.push(r.value)
    total += r.value.length
  }
  await written
  const out = new Uint8Array(total)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}
