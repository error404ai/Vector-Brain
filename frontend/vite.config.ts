import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// A build is always a production build. Vite takes NODE_ENV from the
// environment, and a host that passes NODE_ENV=development into the build (as
// Coolify does with build variables) otherwise ships React's development
// build: it records every render's props — base64 screenshots included — in
// the performance timeline, which crashed Mission Control tabs.
if (process.argv.includes('build')) process.env.NODE_ENV = 'production';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
    },
  },
});
