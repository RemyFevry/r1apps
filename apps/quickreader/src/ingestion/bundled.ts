import type { BookRecord, Storage } from 'r1-kit'

const SYNCED_KEY = 'quickreader:shelf-synced'

/**
 * Persist bundled books on first run of a new bundle. Runs at most once per
 * bundle version (sha marker in localStorage): deleting a shelf book in the
 * library stays deleted until the next bundle changes.
 */
export async function ensureBundledBooks(storage: Storage, books: BookRecord[], sha: string): Promise<void> {
  if (!books.length) return
  if (typeof localStorage !== 'undefined' && localStorage.getItem(SYNCED_KEY) === sha) return
  for (const book of books) {
    if (!(await storage.loadBook(book.id))) {
      await storage.saveBook(book).catch(() => {})
    }
  }
  if (typeof localStorage !== 'undefined') localStorage.setItem(SYNCED_KEY, sha)
}
