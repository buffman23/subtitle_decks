import { defineConfig } from 'vite';
import path from 'path';

const isWatch = process.env['npm_lifecycle_event'] === 'build:watch';

export default defineConfig({
  build: {
    watch: isWatch ? { usePolling: true } : null,
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      name: 'App',        // required by Vite for IIFE; nothing reads window.App
      formats: ['iife'],  // plain <script src="..."> — no type="module" change needed
      fileName: () => 'app.js',  // no content hash
    },
    outDir: path.resolve(__dirname, 'app/static/js'),
    emptyOutDir: false,   // never delete other files in app/static/js/
    copyPublicDir: false,
    minify: false,        // keep readable; minify when deploying to prod
    sourcemap: false,
  },
});
