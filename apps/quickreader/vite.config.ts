import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const booksDir = join(here, 'books')

const bundledBooks = existsSync(booksDir)
  ? readdirSync(booksDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(booksDir, f), 'utf8')))
  : []

const bundledSha = existsSync(booksDir)
  ? readdirSync(booksDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f + ':' + readFileSync(join(booksDir, f), 'utf8').length)
      .sort()
      .join('|')
  : ''

function smallSha(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export default defineConfig({
  base: '/r1apps/quickreader/',
  define: {
    __COMMIT_SHA__: JSON.stringify(process.env.COMMIT_SHA ?? 'dev'),
    __BUNDLED_BOOKS__: JSON.stringify(bundledBooks),
    __BUNDLED_BOOKS_SHA__: JSON.stringify(smallSha(bundledSha)),
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        install: 'install.html',
      },
    },
  },
})
