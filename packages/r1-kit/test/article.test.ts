// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { extractArticle, NotArticleError } from '../src/article'

const page = (body: string, head = ''): string =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`

const article = page(
  `<nav><a href="/">Home</a><a href="/x">Link</a></nav>
   <script>var x = "ignore me";</script>
   <aside>sidebar junk sidebar junk</aside>
   <article>
     <h1>Reading on small screens</h1>
     <p>Reading on a tiny screen is different. You need focus.</p>
     <p>Bimodal reading helps. You see and hear the words together.</p>
     <h2>Why it works</h2>
     <p>The eye and the ear share one clock. That is the whole trick, really.</p>
     <h3>Details</h3>
     <p>Highlights follow the voice. Silence falls back to a timer.</p>
     <ul><li>One</li><li>Two words here</li></ul>
   </article>
   <footer>© site</footer>`,
  `<title>Reading on small screens — My Site</title><meta property="og:title" content="OG: Reading on small screens">
   <meta name="author" content="Jane Author">`,
)

describe('extractArticle', () => {
  test('title prefers og:title, captures author, strips chrome', async () => {
    const doc = extractArticle(article)
    expect(doc.title).toBe('OG: Reading on small screens')
    expect(doc.author).toBe('Jane Author')
    const all = doc.chapters.flatMap((c) => c.paragraphs).join(' ')
    expect(all).not.toContain('Home')
    expect(all).not.toContain('ignore me')
    expect(all).not.toContain('sidebar junk')
    expect(all).not.toContain('© site')
  })

  test('H2/H3 sections become chapters; leading content becomes an Intro chapter (ADR-0009)', () => {
    const doc = extractArticle(article)
    expect(doc.chapters.map((c) => c.title)).toEqual(['Intro', 'Why it works', 'Details'])
    expect(doc.chapters[0].paragraphs).toEqual([
      'Reading on a tiny screen is different. You need focus.',
      'Bimodal reading helps. You see and hear the words together.',
    ])
    expect(doc.chapters[2].paragraphs).toContain('One')
  })

  test('no headings → one chapter carrying the article title', () => {
    const doc = extractArticle(page(`<article><p>Only one paragraph here. Plus another sentence to pass the floor.</p></article>`, `<title>Plain</title>`))
    expect(doc.chapters).toHaveLength(1)
    expect(doc.chapters[0].title).toBe('Plain')
  })

  test('falls back through title, h1, and the provided fallback', () => {
    expect(extractArticle(page(`<article><p>Some words here. Enough words to pass the minimum count now.</p></article>`)).title).toBe('Untitled article')
    expect(extractArticle(page(`<article><h1>From h1</h1><p>Some words here. Enough words to pass the minimum count now.</p></article>`)).title).toBe('From h1')
    expect(
      extractArticle(page(`<article><p>Some words here. Enough words to pass the minimum count now.</p></article>`), { fallbackTitle: 'Fallback' }).title,
    ).toBe('Fallback')
  })

  test('rejects pages with no readable body', () => {
    expect(() => extractArticle(page('<div></div>'))).toThrow(NotArticleError)
    expect(() => extractArticle(page('<script>var nope = 1;</script>'))).toThrow(NotArticleError)
  })

  test('falls back to body when no article/main landmarks exist', () => {
    const doc = extractArticle(page(`<h2>Section A</h2><p>Words in the body itself. Enough words to count past the floor easily.</p>`))
    expect(doc.chapters.map((c) => c.title)).toEqual(['Section A'])
    expect(doc.chapters[0].paragraphs).toEqual(['Words in the body itself. Enough words to count past the floor easily.'])
  })
})
