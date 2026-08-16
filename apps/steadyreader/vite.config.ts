import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  base: '/r1apps/steadyreader/',
  define: {
    __COMMIT_SHA__: JSON.stringify(process.env.COMMIT_SHA ?? 'dev'),
    __APP_VERSION__: JSON.stringify(version),
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
