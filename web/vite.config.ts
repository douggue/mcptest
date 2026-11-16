import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.CUTROOM_API || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/media': { target: api, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
