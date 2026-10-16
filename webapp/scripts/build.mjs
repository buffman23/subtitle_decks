// Builds every page bundle (see ENTRIES in vite.config.ts), one Vite build per
// entry. Under `npm run build:watch` each build keeps watching after its first
// pass, so all bundles rebuild on save.
import { build } from 'vite';

for (const entry of ['main', 'cards', 'study']) {
  process.env.ENTRY = entry;
  await build();
}
