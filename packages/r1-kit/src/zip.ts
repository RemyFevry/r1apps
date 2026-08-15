export interface ZipEntries extends Map<string, Uint8Array> {}

interface CdEntry {
  name: string
  method: number
  compSize: number
  dataOffset: number
}

let nativeOk: boolean | null = null

async function supportsDeflateRaw(): Promise<boolean> {
  if (nativeOk !== null) return nativeOk
  try {
    new DecompressionStream('deflate-raw')
    nativeOk = true
  } catch {
    nativeOk = false
  }
  return nativeOk
}

export async function unzip(data: Uint8Array): Promise<ZipEntries> {
  if (await supportsDeflateRaw()) return unzipNative(data)
  const { unzipSync } = await import('fflate')
  const res = unzipSync(data)
  const out: ZipEntries = new Map()
  for (const [k, v] of Object.entries(res)) {
    if (!k.endsWith('/')) out.set(k, v)
  }
  return out
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

async function unzipNative(data: Uint8Array): Promise<ZipEntries> {
  const out: ZipEntries = new Map()
  for (const e of readCentralDirectory(data)) {
    if (e.name.endsWith('/')) continue
    const slice = data.subarray(e.dataOffset, e.dataOffset + e.compSize)
    out.set(e.name, e.method === 0 ? new Uint8Array(slice) : await inflateRaw(slice))
  }
  return out
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
