import { describe, expect, test } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { unzip } from '../src/zip'

describe('unzip', () => {
  test('round-trips deflated entries via central directory', async () => {
    const long = 'hello world '.repeat(80)
    const zip = zipSync({
      'META-INF/container.xml': strToU8('<container/>'),
      'OEBPS/ch1.xhtml': strToU8(long),
      'OEBPS/': new Uint8Array(0),
    })
    const files = await unzip(zip)
    expect(files.size).toBe(2)
    expect(files.has('OEBPS/')).toBe(false)
    expect(new TextDecoder().decode(files.get('META-INF/container.xml')!)).toBe('<container/>')
    expect(new TextDecoder().decode(files.get('OEBPS/ch1.xhtml')!)).toBe(long)
  })

  test('throws on non-zip data', async () => {
    await expect(unzip(strToU8('this is not a zip file at all'))).rejects.toThrow(/zip/)
  })
})
