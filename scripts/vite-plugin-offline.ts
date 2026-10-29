import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Plugin de build pour le mode hors ligne :
 * - génère `sw.js` à partir du modèle `src/workers/service-worker.template.js`, avec la liste
 *   exacte des fichiers du build (JS, CSS, WASM, aides, icônes) à mettre en cache ;
 * - ajoute une politique de sécurité (CSP) qui interdit tout chargement externe à l'exécution, sauf
 *   la lecture des bibliothèques de composants hébergées sur GitHub (raw.githubusercontent.com).
 *
 * En développement (`npm run dev`), aucun service worker n'est installé.
 */
export function offlinePlugin(): Plugin {
  let publicDir = '';
  let root = '';
  return {
    name: 'vibecad-offline',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
      root = config.root;
    },
    transformIndexHtml() {
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        // Bibliothèques de composants hébergées sur GitHub : catalogue, fichiers et vignettes.
        "img-src 'self' data: blob: https://raw.githubusercontent.com",
        "font-src 'self'",
        "connect-src 'self' https://raw.githubusercontent.com",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ');
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
          injectTo: 'head-prepend',
        },
      ];
    },
    generateBundle(_options, bundle) {
      const bundleFiles = Object.keys(bundle).filter((file) => !file.endsWith('.map'));
      const publicFiles = publicDir ? listFiles(publicDir).filter((file) => !file.endsWith('.map')) : [];
      const urls = Array.from(new Set(['./', 'index.html', ...bundleFiles, ...publicFiles])).sort();

      const hash = createHash('sha256');
      for (const file of bundleFiles.sort()) {
        const item = bundle[file];
        if (!item) continue;
        hash.update(file);
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      for (const file of publicFiles) hash.update(readFileSync(join(publicDir, file)));
      const templatePath = resolve(root, 'src/workers/service-worker.template.js');
      const template = readFileSync(templatePath, 'utf8');
      hash.update(template);
      const version = hash.digest('hex').slice(0, 16);

      const source = template
        .replace('__VIBECAD_CACHE_VERSION__', version)
        .replace('__VIBECAD_PRECACHE_URLS__', JSON.stringify(urls, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      this.emitFile({
        type: 'asset',
        fileName: 'offline-manifest.json',
        source: JSON.stringify({ version, files: urls, generatedFrom: relative(root, templatePath) }, null, 2),
      });
    },
  };
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

/**
 * Copie les licences dans le build : un dossier `dist/` redistribué contient ainsi la licence de
 * l'application, la notice des composants tiers et les textes de licence (dont la LGPL d'OCCT).
 */
export function licensesPlugin(): Plugin {
  let root = '';
  return {
    name: 'vibecad-licenses',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(resolve(root, 'LICENSE'), 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: readFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8') });
      for (const file of readdirSync(resolve(root, 'licenses'))) {
        this.emitFile({ type: 'asset', fileName: `licenses/${file}`, source: readFileSync(resolve(root, 'licenses', file), 'utf8') });
      }
    },
  };
}

