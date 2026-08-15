import { describe, expect, test } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractEpub, wordsOf, NotEpubError } from '../src/ingestion/epub'

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

describe('wordsOf', () => {
  test('keeps trailing punctuation and leading quotes for RSVP pauses', () => {
    expect(wordsOf('He said "hello."')).toEqual(['He', 'said', '"hello."'])
    expect(wordsOf('one two\u00ADthree four\u200Bfive 6-seven')).toEqual(['one', 'twothree', 'fourfive', '6-seven'])
    expect(wordsOf('don’t stop')).toEqual(['don’t', 'stop'])
    expect(wordsOf('   ')).toEqual([])
  })
})

describe('extractEpub', () => {
  test('extracts metadata, chapter titles from nav, words and paragraph breaks', async () => {
    const b = await extractEpub(book)
    expect(b.title).toBe('Café ☕ Test')
    expect(b.author).toBe('Jane Author')
    expect(b.chapters).toHaveLength(2)
    expect(b.chapters[0]).toEqual({
      title: 'Beginning',
      words: ['One', 'two', 'three.', 'Four,', 'five.'],
      paras: [0, 3],
    })
    expect(b.chapters[1].title).toBe('Ending')
    expect(b.chapters[1].words).toEqual(['Six', 'seven.', 'Quoted', 'words', 'here', 'now.'])
    expect(b.chapters[1].paras).toEqual([0, 2])
    expect(b.wordCount).toBe(11)
  })

  test('falls back to text/html parsing for malformed xhtml', async () => {
    const broken = fixtureZip({
      'META-INF/container.xml': container,
      'OEBPS/content.opf': opf.replace('href="ch1.xhtml"', 'href="ch1.xhtml"').replace('href="text/ch2.xhtml" media-type="application/xhtml+xml"', 'href="ch2.xhtml" media-type="application/xhtml+xml"'),
      'OEBPS/nav.xhtml': nav,
      'OEBPS/ch1.xhtml': ch1,
      'OEBPS/ch2.xhtml': '<p><b>Broken but readable</p>',
    })
    const b = await extractEpub(broken)
    expect(b.chapters[1].words).toEqual(['Broken', 'but', 'readable'])
  })

  test('rejects garbage bytes', async () => {
    await expect(extractEpub(strToU8('plainly not a zip'))).rejects.toBeInstanceOf(NotEpubError)
  })
})
