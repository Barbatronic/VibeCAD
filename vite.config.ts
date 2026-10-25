/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { licensesPlugin, offlinePlugin } from './scripts/vite-plugin-offline.ts';

// Configuration Vite : application statique, aucune ressource chargée depuis un CDN.
// - `base: './'` permet l'hébergement dans un sous-dossier (ex. GitHub Pages).
// - Le plugin hors ligne génère le service worker et la liste des fichiers à mettre en cache.
export default defineConfig({
  base: './',
  plugins: [licensesPlugin(), offlinePlugin()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Le noyau géométrique (WASM ~23 Mo) est un fichier séparé, chargé par le worker.
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: (filePath) => (filePath.endsWith('.wasm') ? false : undefined),
  },
  server: {
    port: 5173,
    host: 'localhost',
  },
  preview: {
    port: 4173,
    host: 'localhost',
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/geometry/**/*.test.ts', 'tests/library/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
