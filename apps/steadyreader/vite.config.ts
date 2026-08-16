import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { APP_BASE } from './app.config'
import { R1_BUILD_TARGET } from '../../r1.config.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: APP_BASE,
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? 'dev'),
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version),
  },
  build: {
    target: R1_BUILD_TARGET,
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        install: 'install.html',
      },
    },
  },
})
