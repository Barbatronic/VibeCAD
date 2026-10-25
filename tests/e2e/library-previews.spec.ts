/**
 * Vignettes de la bibliothèque de composants : chaque <collection>/<id>.vibecad du dépôt
 * LIBRARY_OUT est ouvert dans VibeCAD, puis photographié par la vue 3D (512 × 512, fond
 * transparent, vue isométrique) en <collection>/<id>.png. Ne tourne qu'à la demande :
 *   LIBRARY_OUT=../VibeCAD-Components npx playwright test library-previews --project=chromium
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { parseNativeFile } from '../../src/io/native-format';
import { openApp } from './helpers';

const OUT = process.env.LIBRARY_OUT ? resolve(process.env.LIBRARY_OUT) : '';
test.skip(!OUT, 'Vignettes de la bibliothèque : LIBRARY_OUT=<dépôt des composants> pour les refaire.');

/** Fichiers .vibecad des collections (un dossier = une collection). */
function models(): string[] {
  return readdirSync(OUT)
    .filter((d) => !d.startsWith('.') && statSync(join(OUT, d)).isDirectory())
    .flatMap((d) => readdirSync(join(OUT, d)).filter((f) => f.endsWith('.vibecad')).map((f) => join(OUT, d, f)));
}

test('vignettes des composants', async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page);
  for (const file of models()) {
    const parsed = parseNativeFile(readFileSync(file, 'utf8'));
    expect(parsed.ok, file).toBe(true);
    if (!parsed.ok) continue;
    await page.evaluate((doc) => (window as any).vibecad.controller.commit(doc, 'Composant'), parsed.doc as any);
    await expect
      .poll(() => page.evaluate(() => { const s = (window as any).vibecad.store.get(); return s.doc.parts.every((p: any) => s.display[p.id]?.mesh); }), { timeout: 60_000 })
      .toBe(true);
    // Rien de sélectionné : arêtes dans leur couleur normale.
    await page.evaluate(() => (window as any).vibecad.controller.select(null));
    await page.waitForTimeout(300);
    const url: string = await page.evaluate(() => (window as any).vibecad.controller.viewport.snapshot(512));
    writeFileSync(file.replace(/\.vibecad$/, '.png'), Buffer.from(url.split(',')[1]!, 'base64'));
  }
});
