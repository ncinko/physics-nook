import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const mainEntry = fileURLToPath(new URL('./index.html', import.meta.url));
const orbitalsEntry = fileURLToPath(new URL('./orbitals/index.html', import.meta.url));
const ripplesEntry = fileURLToPath(new URL('./ripples/index.html', import.meta.url));
const outDir = process.env.CF_PAGES === '1'
  ? fileURLToPath(new URL('../../dist', import.meta.url))
  : 'dist';

export default defineConfig({
  root,
  envDir: workspaceRoot,
  envPrefix: ['VITE_', 'PUBLIC_'],
  server: {
    host: '0.0.0.0',
    port: 5173,
    fs: {
      allow: [root, workspaceRoot],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: mainEntry,
        orbitals: orbitalsEntry,
        ripples: ripplesEntry,
      },
    },
  },
});
