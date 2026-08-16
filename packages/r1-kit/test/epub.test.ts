// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractEpubDocument, NotEpubError } from '../src/epub'

function fixtureZip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
}

const ch1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body>
<p>One two three.</p>
<p>Four, five.</p>
</body></html>`

const ch2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c2</title></head><body>
<p>Six seven.</p>
<blockquote><p>Quoted words here now.</p></blockquote>
</body></html>`

const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Café ☕ Test</dc:title><dc:creator>Jane Author</dc:creator>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`

const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc"><ol>
<li><a href="ch1.xhtml">Beginning</a></li>
<li><a href="text/ch2.xhtml">Ending</a></li>
</ol></nav></body></html>`

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const book = fixtureZip({
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': container,
  'OEBPS/content.opf': opf,
  'OEBPS/nav.xhtml': nav,
  'OEBPS/ch1.xhtml': ch1,
  'OEBPS/text/ch2.xhtml': ch2,
  'OEBPS/style.css': 'p { color: red }',
})

describe('extractEpubDocument', () => {
  test('extracts metadata, nav titles, and paragraphs as text', async () => {
    const doc = await extractEpubDocument(book)
    expect(doc.title).toBe('Café ☕ Test')
    expect(doc.author).toBe('Jane Author')
    expect(doc.chapters).toEqual([
      { title: 'Beginning', paragraphs: ['One two three.', 'Four, five.'] },
      { title: 'Ending', paragraphs: ['Six seven.', 'Quoted words here now.'] },
    ])
    expect(doc.wordCount).toBe(11)
  })

  test('falls back to text/html parsing for malformed xhtml', async () => {
    const broken = fixtureZip({
      'META-INF/container.xml': container,
      'OEBPS/content.opf': opf.replace('href="text/ch2.xhtml"', 'href="ch2.xhtml"'),
      'OEBPS/nav.xhtml': nav,
      'OEBPS/ch1.xhtml': ch1,
      'OEBPS/ch2.xhtml': '<p><b>Broken but readable</p>',
    })
    const doc = await extractEpubDocument(broken)
    expect(doc.chapters[1].paragraphs).toEqual(['Broken but readable'])
  })

  test('rejects garbage bytes', async () => {
    await expect(extractEpubDocument(strToU8('plainly not a zip'))).rejects.toBeInstanceOf(NotEpubError)
  })
})
