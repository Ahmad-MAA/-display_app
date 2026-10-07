import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const shared = resolve(__dirname, 'src/shared');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          control: resolve(__dirname, 'src/preload/control.ts'),
          output: resolve(__dirname, 'src/preload/output.ts'),
        },
        // Sandboxed preloads cannot use ESM; emit CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared } },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          control: resolve(__dirname, 'src/renderer/control/index.html'),
          output: resolve(__dirname, 'src/renderer/output/index.html'),
        },
      },
    },
  },
});
