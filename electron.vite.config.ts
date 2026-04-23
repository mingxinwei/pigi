import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // @mariozechner/pi-coding-agent is ESM-only;
      // exclude from auto-externalization so it gets bundled into CJS output
      externalizeDeps: {
        exclude: [
          '@mariozechner/pi-coding-agent',
          '@mariozechner/pi-agent-core',
          '@mariozechner/pi-ai',
        ],
      },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
})
