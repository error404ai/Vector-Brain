import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// A build is always a production build. Vite takes NODE_ENV from the
// environment, and a host that passes NODE_ENV=development into the build (as
// Coolify does with build variables) otherwise ships React's development
// build: it records every render's props — base64 screenshots included — in
// the performance timeline, which crashed Mission Control tabs.
if (process.argv.includes('build')) process.env.NODE_ENV = 'production';

/**
 * /llms-full.txt is the docs page's own source (src/docs/docs.md), so AI tools
 * read exactly what people read on /docs. Served in dev, emitted on build.
 */
function llmsFull(): Plugin {
  const docs = fileURLToPath(new URL('./src/docs/docs.md', import.meta.url));
  return {
    name: 'llms-full',
    configureServer(server) {
      server.middlewares.use('/llms-full.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(readFileSync(docs, 'utf8'));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: readFileSync(docs, 'utf8') });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), llmsFull()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // The prerender (scripts/prerender.mjs) runs the SSR build in Node; this
  // package ships CommonJS that Node cannot import by name, so bundle it.
  ssr: {
    noExternal: ['react-helmet-async', /^@fontsource/],
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
