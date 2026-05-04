import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'processes/utility/piAgent': resolve('src/processes/utility/piAgent.ts'),
        },
        output: {
          format: 'es',
        },
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
