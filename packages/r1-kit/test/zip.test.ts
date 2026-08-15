import { describe, expect, test } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { openZip } from '../src/zip'

describe('openZip', () => {
  test('reads deflated entries on demand via the central directory', async () => {
    const long = 'hello world '.repeat(80)
    const zip = zipSync({
      'META-INF/container.xml': strToU8('<container/>'),
      'OEBPS/ch1.xhtml': strToU8(long),
      'OEBPS/': new Uint8Array(0),
    })
    const files = await openZip(zip)
    expect(files.has('META-INF/container.xml')).toBe(true)
    expect(files.has('OEBPS/')).toBe(false)
    expect(files.has('nope.txt')).toBe(false)
    expect(new TextDecoder().decode(await files.read('META-INF/container.xml'))).toBe('<container/>')
    expect(new TextDecoder().decode(await files.read('OEBPS/ch1.xhtml'))).toBe(long)
  })

  test('throws on non-zip data', async () => {
    await expect(openZip(strToU8('this is not a zip file at all'))).rejects.toThrow(/zip/)
  })
})
