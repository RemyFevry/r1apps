export interface Bookmark {
  id: string
  chapter: number
  wordIndex: number
  wpm: number
}

export function encodeBookmark(b: Bookmark): string {
  return [b.id, b.chapter.toString(36), b.wordIndex.toString(36), b.wpm.toString(36)].join('.')
}

export function decodeBookmark(s: string): Bookmark | null {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  const [id, ch, wi, wpm] = parts
  if (!/^[A-Za-z0-9-]+$/.test(id)) return null
  const chapter = parseInt(ch, 36)
  const wordIndex = parseInt(wi, 36)
  const w = parseInt(wpm, 36)
  if (!Number.isFinite(chapter) || !Number.isFinite(wordIndex) || !Number.isFinite(w)) return null
  if (chapter < 0 || wordIndex < 0 || w < 50 || w > 1200) return null
  return { id, chapter, wordIndex, wpm: w }
}

export function bookmarkUrl(baseUrl: string, buildId: string, b: Bookmark): string {
  return `${baseUrl}?v=${buildId}#p=${encodeBookmark(b)}`
}
