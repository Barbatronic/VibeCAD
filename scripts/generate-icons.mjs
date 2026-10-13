#!/usr/bin/env node
/**
 * Génère les icônes PNG de l'application (public/icons) à partir des logos SVG du même dossier
 * (icon.svg, et icon-maskable.svg pour les écrans qui découpent l'icône). Le logo actuel est
 * provisoire (cube en perspective) : pour le changer, modifier les deux SVG puis `npm run icons`.
 * Les PNG sont rendus par Chromium (Playwright, déjà utilisé pour les tests).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const dir = join(root, 'public', 'icons');
const icon = readFileSync(join(dir, 'icon.svg'), 'utf8');
const maskable = readFileSync(join(dir, 'icon-maskable.svg'), 'utf8');
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
