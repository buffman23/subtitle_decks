import { defineConfig } from 'vite';
import path from 'path';

const isWatch = process.env['npm_lifecycle_event'] === 'build:watch';

// One IIFE bundle per page. Vite's library mode takes a single entry per
// build, so scripts/build.mjs runs one build per entry with ENTRY set.
const ENTRIES: Record<string, { src: string; out: string }> = {
  main:  { src: 'src/main.ts',  out: 'app.js' },    // index.html (+ /demo)
  cards: { src: 'src/cards.ts', out: 'cards.js' },  // cards.html (card wizard)
  study: { src: 'src/study.ts', out: 'study.js' },  // study.html
};
const entry = ENTRIES[process.env['ENTRY'] ?? 'main'];
if (!entry) throw new Error(`Unknown ENTRY: ${process.env['ENTRY']}`);

export default defineConfig({
  build: {
    watch: isWatch ? { usePolling: true } : null,
    lib: {
      entry: path.resolve(__dirname, entry.src),
      name: 'App',        // required by Vite for IIFE; nothing reads window.App
      formats: ['iife'],  // plain <script src="..."> — no type="module" change needed
      fileName: () => entry.out,  // no content hash
    },
    outDir: path.resolve(__dirname, 'app/static/js'),
    emptyOutDir: false,   // never delete other files in app/static/js/
    copyPublicDir: false,
    minify: false,        // keep readable; minify when deploying to prod
    sourcemap: false,
  },
});
