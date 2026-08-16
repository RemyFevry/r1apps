import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { APP_BASE } from './app.config'

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
  base: APP_BASE,
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? 'dev'),
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version),
    __BUNDLED_BOOKS__: JSON.stringify(bundledBooks),
    __BUNDLED_BOOKS_SHA__: JSON.stringify(smallSha(bundledSha)),
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        install: 'install.html',
        'shelf-install': 'shelf-install.html',
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'shelf-install' ? 'assets/shelf-install.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
})
