import { defineConfig } from 'vite'

export default defineConfig({
  base: '/r1apps/_template/',
  define: {
    __COMMIT_SHA__: JSON.stringify(process.env.COMMIT_SHA ?? 'dev'),
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
