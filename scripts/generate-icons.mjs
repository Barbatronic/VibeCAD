#!/usr/bin/env node
/**
 * Génère les icônes de l'application (public/icons) à partir du dessin du chat
 * (src/ui/mascot-art.ts, compilé au préalable dans .icons-tmp par `npm run icons`).
 * Les PNG sont rendus par Chromium (Playwright, déjà utilisé pour les tests).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const { catSvg } = await import(join(root, '.icons-tmp', 'mascot-art.js'));
const dir = join(root, 'public', 'icons');
const BLUE = '#1f5fc0';
const icon = catSvg('tip', { background: BLUE, padding: 7 });
// Icône « maskable » : fond plein, chat dans la zone sûre centrale.
const maskable = catSvg('tip', { padding: 16 }).replace(/(<svg[^>]*>)/, (m) => `${m}<rect x="-16" y="-16" width="80" height="80" fill="${BLUE}"/>`);
writeFileSync(join(dir, 'icon.svg'), `${icon}\n`);
writeFileSync(join(dir, 'icon-maskable.svg'), `${maskable}\n`);
const browser = await chromium.launch();
for (const [file, svg, size] of [
  ['icon-192.png', icon, 192],
  ['icon-512.png', icon, 512],
  ['icon-maskable-512.png', maskable, 512],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(dir, file), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('Icônes générées dans public/icons.');
