import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: './',
  resolve: {
    dedupe: ['three'],
  },
  optimizeDeps: {
    include: ['three'],
  },
})
