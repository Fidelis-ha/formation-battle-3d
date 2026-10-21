import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5183 },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
});
