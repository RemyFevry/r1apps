import { defineConfig } from 'vite'
import { R1_BUILD_TARGET } from '../../r1.config.mjs'

export default defineConfig({
  base: '/r1apps/_template/',
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? 'dev'),
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
