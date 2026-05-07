import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const PIGI_DEBUG_PANEL_ENV = 'PIGI_DEBUG_PANEL';
const PIGI_DEBUG_PANEL_ENABLED_VALUE = '1';
const pigiDebugPanelEnabled = process.env[PIGI_DEBUG_PANEL_ENV] === PIGI_DEBUG_PANEL_ENABLED_VALUE;

export default defineConfig({
  main: {
    define: {
      __PIGI_DEBUG_PANEL__: JSON.stringify(pigiDebugPanelEnabled),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'processes/utility/piAgent': resolve('src/processes/utility/piAgent.ts'),
          'processes/utility/sessionIndex': resolve('src/processes/utility/sessionIndex.ts'),
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
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [tailwindcss(), react()],
  },
});
