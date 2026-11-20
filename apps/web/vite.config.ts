import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The local API (packages/server); the dev server forwards /api to it. */
const API_ORIGIN = 'http://127.0.0.1:4317';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: API_ORIGIN, changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
