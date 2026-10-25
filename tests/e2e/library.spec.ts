import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { appState, openApp } from './helpers';

/** La bibliothèque par défaut (Barbatronic/VibeCAD-Components) servie depuis tests/fixtures/library. */
async function serveLibrary(page: Page) {
  await page.route('https://raw.githubusercontent.com/Barbatronic/VibeCAD-Components/HEAD/**', (route) => {
    const path = new URL(route.request().url()).pathname.split('/HEAD/')[1]!;
    try {
      const body = readFileSync(`tests/fixtures/library/${decodeURIComponent(path)}`);
      return route.fulfill({ status: 200, body, headers: { 'access-control-allow-origin': '*' } });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
}

test('composants : parcourir une bibliothèque, chercher, insérer une pièce paramétrique puis dans l’assemblage', async ({ page }) => {
  await serveLibrary(page);
  await openApp(page);
  await page.click('#part-component');
  const dialog = page.getByRole('dialog', { name: 'Composants' });
  await expect(dialog.getByRole('button', { name: /Roulements/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Poulies/ })).toBeVisible();
  // Recherche, puis insertion : une nouvelle pièce avec son historique et sa matière.
  await dialog.getByLabel('Rechercher un composant').fill('roulement 608');
  const cards = dialog.getByRole('list', { name: 'Composants' }).getByRole('button');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('img')).toHaveJSProperty('complete', true);
  await page.screenshot({ path: 'tests/output/e2e-composants.png' });
  await cards.first().click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => appState(page, (s) => s.doc.parts.map((p: any) => p.name))).toEqual(['Pièce 1', 'Roulement 608-2RS']);
  const part = await appState(page, (s) => s.doc.parts[1]);
  expect(part.material).toBe('steel');
  expect(part.features.map((f: any) => f.type)).toEqual(['sketch', 'extrude', 'chamfer', 'sketch', 'pocket', 'sketch', 'pocket']);
  await expect.poll(() => appState(page, (s) => s.display[s.doc.parts[1].id]?.result.analysis?.solidCount)).toBe(1);
  // Esquisses du composant entièrement cotées : 0 degré de liberté (vertes).
  expect(await appState(page, (s) => s.display[s.doc.parts[1].id].result.sketches.map((k: any) => k.dof))).toEqual([0, 0, 0]);
  // Esquisses masquées : seul le volume du composant s'affiche.
  expect(part.features.filter((f: any) => f.type === 'sketch').map((f: any) => f.visible)).toEqual([false, false, false]);

  // Atelier Assemblage : la poulie est ajoutée au projet et insérée dans l'assemblage.
  await page.click('#tab-assembly');
  await page.click('#as-insert');
  await page.click('#as-insert-component');
  await dialog.getByRole('button', { name: /Poulies/ }).click();
  await dialog.getByRole('list', { name: 'Composants' }).getByRole('button', { name: /Poulie GT2 20 dents/ }).click();
  await expect.poll(() => appState(page, (s) => (s.doc.assembly?.instances ?? []).map((i: any) => i.name))).toEqual(['Poulie GT2 20 dents']);
  expect(await appState(page, (s) => s.doc.parts.length)).toBe(3);
});

test('composants : ajouter et retirer une bibliothèque, erreurs expliquées', async ({ page }) => {
  await serveLibrary(page);
  await page.route('https://exemple.invalid/**', (route) => route.fulfill({ status: 404, body: '' }));
  await openApp(page);
  await page.evaluate(() => (window as any).vibecad.controller.setDialog({ kind: 'preferences' }));
  const prefs = page.getByRole('dialog', { name: 'Préférences' });
  const list = prefs.getByRole('list', { name: 'Bibliothèques de composants' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  // Adresse invalide : refusée avec une explication.
  await prefs.getByLabel('Adresse d’une bibliothèque').fill('ftp://exemple');
  await prefs.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText(/Adresse invalide/).first()).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  // Adresse valide sans catalogue : ajoutée, l'erreur s'affiche dans la fenêtre des composants.
  await prefs.getByLabel('Adresse d’une bibliothèque').fill('https://exemple.invalid/biblio');
  await prefs.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.click('#part-component');
  const dialog = page.getByRole('dialog', { name: 'Composants' });
  await expect(dialog.getByText(/index.json introuvable/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Roulements/ })).toBeVisible();
  // Retirée : elle disparaît, la bibliothèque Barbatronic reste.
  await dialog.getByRole('button', { name: 'Bibliothèques…' }).click();
  await page.getByRole('button', { name: 'Retirer la bibliothèque https://exemple.invalid/biblio' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
});
