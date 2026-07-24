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
        // node-pty is a native module: keep it external so it loads its
        // rebuilt .node binary from node_modules at runtime instead of being
        // bundled (which would break the native require).
        external: ['node-pty'],
        input: {
          index: resolve('src/main/index.ts'),
          'processes/utility/piAgent': resolve('src/processes/utility/piAgent.ts'),
          'processes/utility/sessionWorker': resolve('src/processes/utility/sessionWorker.ts'),
          'processes/utility/terminal': resolve('src/processes/utility/terminal.ts'),
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
